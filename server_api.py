"""블록아웃 스튜디오 앱 서버 API(/api/*) — 프로젝트 저장·열기·자동 저장·세션·모델 목록·폴더 열기·설정·버전·자동 업데이트.
serve.py(개발)와 launcher.py(exe)가 같이 쓴다. 보안 검사·파일 이름 다듬기·저장 폴더 찾기는 mcp_bridge 것을 그대로 씀.

저장: 프로젝트 = 문서\\블록아웃 스튜디오\\프로젝트\\<이름>.json (+ 같은 이름 .jpg 썸네일), 자동 저장 = …\\자동저장 (최근 10개).
      문서 폴더에 못 쓰는 PC 면 %LOCALAPPDATA%\\블록아웃 스튜디오\\files\\… (mcp_bridge.out_dir).
세션: 지금 작업 상태를 %LOCALAPPDATA%\\블록아웃 스튜디오\\session.json 에도 둔다 — 브라우저 저장소(포트·프로필마다 따로)가 비어도 이어서 열림.

업데이트 규칙(README 「업데이트 규칙」과 같음)
  · 판 = 주.부.고침. 새 판은 GitHub 릴리스(태그 v<판>)에 BlockoutStudio.exe + latest.json({version, date, size, sha256, notes}).
  · 켤 때(4초 뒤)와 6시간마다 releases/latest/download/latest.json 을 본다(API 한도 없음). 새 판이면 받아 두기만 하고(크기·SHA-256 확인),
    바꿔 끼우는 건 다음에 켤 때(또는 「지금 다시 시작」) — 작업 중엔 절대 안 바꿈. 실행 중인 exe 는 지울 수 없지만 이름은 바꿀 수 있어 .old 로 비켜 둠.
  · 바꿔 끼운 뒤 처음 켜면 「v… 로 바뀌었습니다」 공지(바뀐 점) 한 번. 받기·검증 실패, 쓸 수 없는 폴더는 조용히 다음에 다시(버튼에만 표시).
"""
import hashlib
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

import mcp_bridge as mb

SETTINGS = os.path.join(mb.DATA_DIR, "settings.json")
UPDATED = os.path.join(mb.DATA_DIR, "updated.json")          # 바꿔 끼운 직후 한 번 띄울 공지 {from, to, notes, at}
ASSET = "BlockoutStudio.exe"                                  # 릴리스에 올리는 exe 이름(영문 — 주소에 한글이 안 들어가게)
LATEST = "latest.json"                                        # 릴리스에 같이 올리는 설명표
KEEP_AUTOSAVES = 10
CHECK_EVERY = 6 * 3600
UA = {"User-Agent": "BlockoutStudio"}


def read_version(app_dir):
    v = mb.read_json(os.path.join(app_dir, "version.json"), {}) or {}
    return {"version": v.get("version", "0.0.0"), "date": v.get("date", ""), "repo": v.get("repo", ""), "notes": v.get("notes", [])}


def vtuple(s):
    return tuple(int(x) for x in re.findall(r"\d+", s or "0")[:3]) or (0,)


def folder(kind):
    return mb.out_dir(kind)


def migrate_old_folder():
    """shortcut: 10/13 이전 판은 프로젝트를 「장면」 폴더에 저장 — 처음 한 번 「프로젝트」로 옮김(덮어쓰지 않음). 옛 판이 다 사라지면 지울 것."""
    old = os.path.join(mb.documents_dir(), mb.TITLE, "장면")
    if not os.path.isdir(old):
        return
    new = folder("project")
    for f in os.listdir(old):
        src, dst = os.path.join(old, f), os.path.join(new, f)
        if os.path.isfile(src) and not os.path.exists(dst):
            try:
                os.replace(src, dst)
            except OSError:
                pass
    try:
        os.rmdir(old)                               # 비었을 때만 지워짐
    except OSError:
        pass


def settings():
    return {"auto_update": True, **(mb.read_json(SETTINGS, {}) or {})}


def list_dir(d, ext=".json"):
    out = []
    for f in os.listdir(d):
        p = os.path.join(d, f)
        if f.lower().endswith(ext) and os.path.isfile(p):
            st = os.stat(p)
            stem = f[: -len(ext)]
            out.append({"name": stem, "file": f, "modified": st.st_mtime, "size": st.st_size, "thumb": os.path.exists(os.path.join(d, stem + ".jpg"))})
    return sorted(out, key=lambda x: -x["modified"])


def open_in_explorer(path):
    if os.name == "nt":
        os.startfile(path)                          # noqa — 탐색기로 폴더 열기
    else:
        subprocess.Popen(["xdg-open", path])


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def writable(d):
    try:
        p = os.path.join(d, f".write-test-{os.getpid()}")
        with open(p, "wb") as f:
            f.write(b"ok")
        os.remove(p)
        return True
    except OSError:
        return False


def write_atomic(path, data):
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, path)


# ====================================================================== 업데이트
class Updater:
    def __init__(self, app_dir, exe=None):
        self.ver = read_version(app_dir)
        self.exe = exe                              # exe 로 돌 때만(개발 서버는 None — 확인만 하고 받지는 않음)
        self.state = "idle"
        self.latest = None
        self.info = {}
        self.progress = 0.0
        self.error = ""
        self.lock = threading.Lock()
        self.just = mb.read_json(UPDATED) if exe else None      # 바꿔 끼운 뒤 처음 켠 것이면 공지할 내용

    def status(self):
        repo = self.ver["repo"]
        return {"current": self.ver["version"], "date": self.ver["date"], "repo": repo, "latest": self.latest, "state": self.state,
                "progress": round(self.progress, 3), "error": self.error, "can_install": bool(self.exe), "notes": self.info.get("notes") or [],
                "release_url": f"https://github.com/{repo}/releases/latest" if repo else "", "auto": settings().get("auto_update", True),
                "just_updated": self.just if self.just and not self.just.get("seen") else None}

    def _fetch_info(self):
        """latest.json(판·크기·SHA-256·바뀐 점). 없는 옛 릴리스면 releases/latest 가 넘겨 주는 태그만."""
        repo = self.ver["repo"]
        try:
            req = urllib.request.Request(f"https://github.com/{repo}/releases/latest/download/{LATEST}", headers=UA)
            with urllib.request.urlopen(req, timeout=10) as r:
                return json.loads(r.read(256 * 1024).decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code != 404:
                raise
        req = urllib.request.Request(f"https://github.com/{repo}/releases/latest", method="HEAD", headers=UA)
        with urllib.request.urlopen(req, timeout=10) as r:
            m = re.search(r"/releases/tag/v?([0-9][0-9.]*)", r.geturl())
        return {"version": m.group(1)} if m else {}

    def check(self):
        if not self.ver["repo"]:
            self.state, self.error = "error", "저장소 주소가 없음(version.json)"
            return self.status()
        if self.state == "downloading":
            return self.status()
        self.state, self.error = "checking", ""
        try:
            info = self._fetch_info()
            v = str(info.get("version") or "").lstrip("v")
            if not v:
                self.state = "none"                     # 아직 릴리스가 없음
                return self.status()
            if not re.fullmatch(r"\d+(\.\d+){0,3}", v):
                raise ValueError(f"판 번호가 이상함: {v}")
            self.latest, self.info = v, info
            pending = (mb.read_json(self.exe + ".new.json") or {}) if self.exe else {}
            if vtuple(v) <= vtuple(self.ver["version"]):
                self.state = "none"
            elif self.exe and pending.get("version") == v and os.path.exists(self.exe + ".new"):
                self.state = "ready"
            elif self.exe and not writable(os.path.dirname(self.exe)):
                self.state, self.error = "manual", "이 폴더엔 새 판을 받아 둘 수 없음(읽기 전용) — GitHub 에서 받아 바꿔 주세요"
            else:
                self.state = "available"
        except urllib.error.HTTPError as e:
            self.state, self.error = ("none", "") if e.code == 404 else ("error", f"HTTP {e.code}")
        except Exception as e:
            self.state, self.error = "error", str(e)[:120]
        return self.status()

    def download(self):
        if not self.exe:
            self.state, self.error = "error", "개발 서버에선 받지 않음 — exe 로 실행할 때만"
            return self.status()
        with self.lock:
            if self.state not in ("available", "error") or not self.latest:
                return self.status()
            self.state, self.progress, self.error = "downloading", 0.0, ""
        url = f"https://github.com/{self.ver['repo']}/releases/download/v{self.latest}/{ASSET}"
        tmp = self.exe + ".download"
        want_size, want_sha = int(self.info.get("size") or 0), str(self.info.get("sha256") or "").lower()
        try:
            h = hashlib.sha256()
            got = 0
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r, open(tmp, "wb") as f:
                sent = int(r.headers.get("Content-Length") or 0)
                total = want_size or sent
                while True:
                    chunk = r.read(256 * 1024)
                    if not chunk:
                        break
                    f.write(chunk)
                    h.update(chunk)
                    got += len(chunk)
                    self.progress = got / total if total else 0.5
            with open(tmp, "rb") as f:
                head = f.read(2)
            if head != b"MZ" or got < 1_000_000:                       # 오류 페이지·받다 만 파일을 exe 로 끼우지 않게
                raise ValueError("받은 파일이 실행 파일이 아님")
            if (want_size and got != want_size) or (sent and got != sent):     # 연결이 끊기면 오류 없이 빈 조각으로 끝나기도 함(http.client) — 크기로 잡음
                raise ValueError(f"덜 받음({got} / {want_size or sent}) — 다음에 다시")
            if want_sha and h.hexdigest() != want_sha:
                raise ValueError("SHA-256 이 다름 — 받은 파일이 릴리스와 다름")
            os.replace(tmp, self.exe + ".new")
            mb.write_json(self.exe + ".new.json", {"version": self.latest, "sha256": h.hexdigest(), "size": got, "notes": self.info.get("notes") or []})
            self.state, self.progress = "ready", 1.0
        except Exception as e:
            self.state, self.error = "error", str(e)[:160]
            try:
                os.remove(tmp)
            except OSError:
                pass
        return self.status()

    def background(self, delay=4.0):
        """켤 때 한 번(조금 뒤)과 6시간마다: 확인하고, 자동 업데이트가 켜져 있으면 받아 둔다(바꿔 끼우는 건 다음에 켤 때)."""
        def run():
            time.sleep(delay)
            while True:
                self.check()
                if self.state == "available" and self.exe and settings().get("auto_update", True):
                    self.download()
                time.sleep(CHECK_EVERY)
        threading.Thread(target=run, daemon=True).start()

    def ack(self):
        """업데이트 공지를 사람이 봤음 — 다음엔 안 띄움."""
        if self.just:
            self.just["seen"] = True
            try:
                mb.write_json(UPDATED, self.just)
            except OSError:
                pass


def apply_pending(exe, current=""):
    """켤 때 맨 먼저: 받아 둔 새 exe(<exe>.new)가 있으면 바꿔 끼우고 True(공지할 내용을 updated.json 에). 옛 것(.old)은 지울 수 있으면 지움."""
    old, new, meta_p = exe + ".old", exe + ".new", exe + ".new.json"
    if os.path.exists(old):
        try:
            os.remove(old)
        except OSError:
            pass
    if not os.path.exists(new):
        return False
    meta = mb.read_json(meta_p) or {}
    try:
        if not meta.get("sha256") or sha256(new) != meta["sha256"]:      # 받은 뒤 깨졌거나 바뀌었으면 끼우지 않음(다음 확인 때 다시 받음)
            os.replace(new, new + ".bad")
            return False
    except OSError:
        return False
    try:
        if os.path.exists(old):
            os.replace(old, old + str(int(time.time())))
        os.replace(exe, old)                        # 실행 중인 exe 도 이름은 바뀜
        os.replace(new, exe)
    except OSError as e:
        mb.log("update swap failed:", e)
        try:
            if not os.path.exists(exe) and os.path.exists(old):
                os.replace(old, exe)                # 반쯤 바뀌었으면 되돌림
        except OSError:
            pass
        return False
    try:
        mb.write_json(UPDATED, {"from": current, "to": meta.get("version", ""), "notes": meta.get("notes") or [], "at": time.strftime("%Y-%m-%d %H:%M")})
        os.remove(meta_p)
    except OSError:
        pass
    return True


# ====================================================================== 라우팅
class Api:
    def __init__(self, app_dir, model_dirs, updater, restart=None, session_name="session.json"):
        self.app_dir = app_dir
        self.model_dirs = model_dirs                # 모델(GLB)을 찾는 폴더들 — exe 옆·exe 안·개발 폴더의 assets
        self.updater = updater
        self.restart = restart                      # 「지금 다시 시작해서 업데이트」 — launcher 만 줌
        self.session = os.path.join(mb.DATA_DIR, session_name)   # 개발 서버는 session-dev.json(exe 와 섞이지 않게)
        try:
            migrate_old_folder()
        except OSError as e:
            mb.log("migrate failed:", e)

    def route(self, h, method):
        path = h.path.split("?", 1)[0]
        if not path.startswith("/api/"):
            return False
        if not mb._origin_ok(h):
            mb._send(h, 403, {"error": "origin not allowed"})
            return True
        qs = urllib.parse.parse_qs(h.path.split("?", 1)[1]) if "?" in h.path else {}
        q = lambda k, d=None: (qs.get(k) or [d])[0]
        try:
            self._route(h, method, path, q)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            mb.log("api error:", path, repr(e))
            try:
                mb._send(h, 500, {"error": str(e)})
            except Exception:
                pass
        return True

    def _route(self, h, method, path, q):
        send = lambda code, body=None, ctype="application/json; charset=utf-8": mb._send(h, code, body, ctype)
        if path == "/api/projects":
            d = folder("project")
            send(200, {"folder": d, "items": list_dir(d)})
        elif path == "/api/project":
            name = mb.safe_name(q("name", ""), "")
            if not name:
                return send(400, {"error": "name"})
            if not name.lower().endswith(".json"):
                name += ".json"
            p = os.path.join(folder("project"), name)
            if method == "POST":
                data = mb._body(h, 300 * 1024 * 1024)
                json.loads(data.decode("utf-8"))    # 깨진 JSON 은 저장 안 함(덮어써서 날리지 않게)
                if q("new") == "1" and os.path.exists(p):
                    return send(409, {"error": "exists", "name": name})
                write_atomic(p, data)
                send(200, {"path": p, "file": name, "name": name[:-5]})
            elif os.path.isfile(p):
                with open(p, "rb") as f:
                    send(200, f.read())
            else:
                send(404, {"error": "없음", "file": name})
        elif path == "/api/project/thumb":
            name = mb.safe_name(q("name", ""), "x")
            stem = name[:-5] if name.lower().endswith(".json") else name
            p = os.path.join(folder("project"), stem + ".jpg")
            if method == "POST":
                write_atomic(p, mb._body(h, 5 * 1024 * 1024))
                send(204)
            elif os.path.isfile(p):
                with open(p, "rb") as f:
                    send(200, f.read(), "image/jpeg")
            else:
                send(404, {"error": "no thumb"})
        elif path == "/api/autosave":
            d = folder("autosave")
            if method == "POST":
                name = mb.safe_name(q("name", "제목 없음"), "제목 없음")
                data = mb._body(h, 300 * 1024 * 1024)
                json.loads(data.decode("utf-8"))
                p = os.path.join(d, f"{time.strftime('%Y%m%d-%H%M%S')}_{name}.json")
                write_atomic(p, data)
                for old in list_dir(d)[KEEP_AUTOSAVES:]:
                    try:
                        os.remove(os.path.join(d, old["file"]))
                    except OSError:
                        pass
                send(200, {"path": p})
            elif q("name"):
                p = os.path.join(d, mb.safe_name(q("name")))
                if os.path.isfile(p):
                    with open(p, "rb") as f:
                        send(200, f.read())
                else:
                    send(404, {"error": "없음"})
            else:
                send(200, {"folder": d, "items": list_dir(d)})
        elif path == "/api/session":                 # 지금 작업(브라우저 저장소가 비어도 이어서 열리게) — 한 PC 한 사용자, 마지막에 쓴 것이 남음
            if method == "POST":
                data = mb._body(h, 100 * 1024 * 1024)
                json.loads(data.decode("utf-8"))
                os.makedirs(mb.DATA_DIR, exist_ok=True)
                write_atomic(self.session, data)
                send(204)
            elif os.path.isfile(self.session):
                with open(self.session, "rb") as f:
                    send(200, f.read())
            else:
                send(204)
        elif path == "/api/models":
            seen, items = set(), []
            for d in self.model_dirs:
                if os.path.isdir(d):
                    for f in sorted(os.listdir(d)):
                        if f.lower().endswith((".glb", ".gltf")) and f not in seen:
                            seen.add(f)
                            items.append({"name": os.path.splitext(f)[0], "src": "assets/" + urllib.parse.quote(f), "mb": round(os.path.getsize(os.path.join(d, f)) / 1048576, 1)})
            send(200, {"items": items})
        elif path == "/api/open-folder" and method == "POST":
            open_in_explorer(folder(q("which", "project")))
            send(204)
        elif path == "/api/settings":
            if method == "POST":
                cur = settings()
                body = json.loads(mb._body(h).decode("utf-8") or "{}")
                cur.update({k: v for k, v in body.items() if k in ("auto_update",)})
                mb.write_json(SETTINGS, cur)
            send(200, settings())
        elif path == "/api/version":
            send(200, {**read_version(self.app_dir), "frozen": bool(getattr(sys, "frozen", False)), "folders": {k: folder(k) for k in ("project", "autosave", "export", "backup")}})
        elif path == "/api/update/status":
            send(200, self.updater.status())
        elif path == "/api/update/check" and method == "POST":
            send(200, self.updater.check())
        elif path == "/api/update/download" and method == "POST":
            threading.Thread(target=self.updater.download, daemon=True).start()
            send(200, self.updater.status())
        elif path == "/api/update/ack" and method == "POST":
            self.updater.ack()
            send(204)
        elif path == "/api/update/apply" and method == "POST":
            if self.updater.state != "ready" or not self.restart:
                return send(409, {"error": "받아 둔 새 판이 없음", **self.updater.status()})
            send(200, {"ok": True})
            threading.Timer(0.4, self.restart).start()
        else:
            send(404, {"error": "unknown"})
