"""블록아웃 스튜디오 MCP — AI 앱(Claude · ChatGPT/Codex · Cursor …)이 열려 있는 앱 창을 직접 고치게 하는 입구. 표준 라이브러리만 씀.

  AI 앱 ──MCP──▶ 이 서버 ──긴 폴링(/bridge/*)──▶ 앱 창(app/api.js 가 버튼과 같은 함수로 실행) ──▶ 결과·그림을 돌려줌
     · Streamable HTTP : http://127.0.0.1:<포트>/mcp   (Claude Code · Codex · Cursor · VS Code — 앱이 켜져 있어야 함)
     · stdio           : 「블록아웃 스튜디오.exe --mcp」 (Claude 데스크톱 · Codex 데스크톱 — 앱이 꺼져 있으면 첫 명령 때 창을 띄움)

  도구 목록·설명서는 앱 창이 스스로 알려 준다(app/api.js 의 COMMANDS + app/mcp_guide.md → /bridge/hello).
  앱에 기능을 넣으면 MCP 쪽은 손대지 않아도 도구 목록·설명서가 따라온다. 창이 안 떠 있을 때는 마지막으로 받은 목록(캐시) 또는 exe 에 든 목록을 쓴다.
  MCP 규격: 2026-07-28(요청마다 _meta 로 버전, server/discover)과 그 전 판(initialize 인사)을 둘 다 받는다(dual-era).
"""
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
import uuid

APP_ID = "blockout-studio"
TITLE = "블록아웃 스튜디오"
MODERN = "2026-07-28"
LEGACY = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]
SUPPORTED = [MODERN] + LEGACY
META_VER = "io.modelcontextprotocol/protocolVersion"
DATA_DIR = os.environ.get("BLOCKOUT_DATA_DIR") or os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), TITLE)   # 시험할 땐 BLOCKOUT_DATA_DIR 로 따로
LOCK = os.path.join(DATA_DIR, "server.json")          # 지금 떠 있는 앱 서버 {port, pid, exe}
CACHE = os.path.join(DATA_DIR, "mcp_registry.json")   # 마지막으로 앱 창이 알려 준 도구 목록


def log(*a):                                           # stdio 모드에서 stdout 은 MCP 전용 — 기록은 stderr 로
    try:
        print(*a, file=sys.stderr, flush=True)
    except Exception:
        pass


def documents_dir():
    """문서 폴더(OneDrive 로 옮겨졌어도 실제 자리). 시험할 땐 BLOCKOUT_DOCS_DIR."""
    if os.environ.get("BLOCKOUT_DOCS_DIR"):
        return os.environ["BLOCKOUT_DOCS_DIR"]
    if os.name == "nt":
        try:
            import ctypes
            from ctypes import wintypes

            class GUID(ctypes.Structure):
                _fields_ = [("a", wintypes.DWORD), ("b", wintypes.WORD), ("c", wintypes.WORD), ("d", ctypes.c_ubyte * 8)]
            g = GUID(0xFDD39AD0, 0x238F, 0x46AF, (ctypes.c_ubyte * 8)(0xAD, 0xB4, 0x6C, 0x85, 0x48, 0x03, 0x69, 0xC7))   # FOLDERID_Documents
            p = ctypes.c_wchar_p()
            if ctypes.windll.shell32.SHGetKnownFolderPath(ctypes.byref(g), 0, None, ctypes.byref(p)) == 0:
                path = p.value
                ctypes.windll.ole32.CoTaskMemFree(p)
                if path:
                    return path
        except Exception:
            pass
    return os.path.join(os.path.expanduser("~"), "Documents")


_OUT = {}


def out_dir(kind):
    """저장하는 곳 — 문서\\블록아웃 스튜디오\\(내보내기 | 프로젝트 | 자동저장 | 자동백업).
    문서 폴더에 못 쓰는 PC(제어된 폴더 액세스·권한·없는 드라이브)면 %LOCALAPPDATA%\\블록아웃 스튜디오\\files 로 — 저장이 조용히 실패하지 않게 한 번 써 보고 정한다."""
    sub = {"export": "내보내기", "project": "프로젝트", "autosave": "자동저장", "backup": "자동백업"}.get(kind, "내보내기")
    if sub in _OUT and os.path.isdir(_OUT[sub]):
        return _OUT[sub]
    err = None
    for base in (os.path.join(documents_dir(), TITLE), os.path.join(DATA_DIR, "files")):
        d = os.path.join(base, sub)
        try:
            os.makedirs(d, exist_ok=True)
            probe = os.path.join(d, f".write-test-{os.getpid()}")
            with open(probe, "wb") as f:
                f.write(b"ok")
            os.remove(probe)
            _OUT[sub] = d
            return d
        except OSError as e:
            err = e
            log("save folder not writable:", d, e)
    raise OSError(f"저장할 폴더를 만들 수 없음: {err}")


def safe_name(name, default="파일"):
    name = os.path.basename(str(name or "")).strip().strip(".")
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", name)
    return name[:120] or default


def read_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def reg_hash(reg):
    import hashlib
    body = json.dumps([reg.get("app_version"), reg.get("commands"), reg.get("instructions")], ensure_ascii=False, sort_keys=True)
    return hashlib.sha1(body.encode("utf-8")).hexdigest()[:12]


def fallback_registry(app_dir):
    """창이 없을 때 쓸 도구 목록: exe 에 든 것(이 빌드와 같은 판) → 마지막 캐시 → 설명서만."""
    for p in (os.path.join(app_dir, "app", "mcp_registry.json"), CACHE):
        reg = read_json(p)
        if reg and reg.get("commands"):
            reg["_source"] = "bundled" if p != CACHE else "cache"
            return reg
    return {"app": APP_ID, "app_version": "?", "commands": [], "guide": "앱 창을 열면 도구 목록이 채워집니다.", "instructions": "", "_source": "none"}


class BridgeError(Exception):
    pass


# ====================================================================== 앱 서버 안의 다리(창 ↔ AI)
class Bridge:
    def __init__(self, app_dir, open_window=None, write_bundle=False):
        self.app_dir = app_dir
        self.open_window = open_window          # 창이 없을 때 띄우는 함수(없으면 None)
        self.write_bundle = write_bundle        # 개발 서버: 창이 알려 준 목록을 app/mcp_registry.json 에도 씀(exe 에 넣는 기본 목록)
        self.cv = threading.Condition()
        self.queue = []
        self.results = {}
        self.taken = set()
        self.registry = None
        self.pages = {}                         # 창마다 {seen, vis, focus, hello} — 명령은 '앞에 보이는 창' 하나만 받는다(창이 둘이면 나뉘어 들어가던 문제)
        self.clients = {}                       # AI 앱 이름 → 마지막 시각
        self.last_call = 0.0

    # ---- 창 쪽
    def _touch(self, pid, vis=None, focus=False, hello=False):
        now = time.time()
        p = self.pages.setdefault(pid or "?", {"seen": now, "vis": 1, "focus": 0.0, "hello": 0.0})
        p["seen"] = now
        if vis is not None:
            p["vis"] = 1 if vis else 0
        if focus:
            p["focus"] = now
        if hello:
            p["hello"] = now

    def leader(self):
        """명령을 받을 창: 보이는 창 > 마지막으로 포커스 받은 창 > 마지막으로 붙은 창. 30 초 넘게 소식 없는 창은 뺀다."""
        now = time.time()
        for k in [k for k, v in self.pages.items() if now - v["seen"] > 30]:
            del self.pages[k]
        if not self.pages:
            return None
        return max(self.pages, key=lambda k: (self.pages[k]["vis"], self.pages[k]["focus"], self.pages[k]["hello"]))

    def connected(self):
        return self.leader() is not None

    def page_event(self, pid, vis=None, focus=False, bye=False):
        with self.cv:
            if bye:
                self.pages.pop(pid, None)
            else:
                self._touch(pid, vis, focus)
            self.cv.notify_all()

    def hello(self, desc, pid=None):
        desc = dict(desc or {})
        desc["hash"] = reg_hash(desc)
        with self.cv:
            changed = not self.registry or self.registry.get("hash") != desc["hash"]
            self.registry = desc
            self._touch(pid, hello=True)
            self.cv.notify_all()
        if changed:
            try:
                write_json(CACHE, desc)
                if self.write_bundle:
                    write_json(os.path.join(self.app_dir, "app", "mcp_registry.json"), {k: v for k, v in desc.items() if k != "hash"})
            except Exception as e:
                log("registry write failed:", e)
        return {"ok": True, "hash": desc["hash"], "changed": changed}

    def poll(self, pid=None, vis=None, focus=False, wait=20.0):
        with self.cv:
            self._touch(pid, vis, focus)
            if not self.registry or (pid and self.pages.get(pid, {}).get("hello", 0) == 0):
                return {"type": "hello"}                # 서버가 새로 떴거나 처음 보는 창 — 목록부터 보내라
            end = time.time() + wait
            while True:
                if self.queue and self.leader() == (pid or "?"):
                    cmd = self.queue.pop(0)
                    self.taken.add(cmd["id"])
                    return cmd
                left = end - time.time()
                if left <= 0:
                    return None
                self.cv.wait(min(left, 2.0))
                self._touch(pid)                        # 기다리는 동안에도 살아 있음

    def result(self, res):
        with self.cv:
            cid = res.get("id")
            if cid in self.taken:
                self.taken.discard(cid)
                self.results[cid] = res
                self.cv.notify_all()

    # ---- AI 쪽
    def get_registry(self):
        return self.registry or fallback_registry(self.app_dir)

    def call(self, name, args, client=None, timeout=None):
        if client:
            self.clients[client] = time.time()
        self.last_call = time.time()
        with self.cv:
            up = self.connected()
        if not up:
            if self.open_window:
                try:
                    self.open_window()
                except Exception as e:
                    log("open window failed:", e)
            end = time.time() + 25
            with self.cv:
                while not self.connected() or not self.registry:
                    left = end - time.time()
                    if left <= 0:
                        raise BridgeError("블록아웃 스튜디오 창이 열려 있지 않음 — 앱을 실행해 두고 다시 시도하세요.")
                    self.cv.wait(min(left, 0.5))
        reg = self.get_registry()
        spec = next((c for c in reg.get("commands", []) if c.get("name") == name), None)
        if timeout is None:
            timeout = 600 if (spec or {}).get("longRunning") else 90
        cid = uuid.uuid4().hex
        cmd = {"type": "call", "id": cid, "name": name, "args": args or {}, "client": client or ""}
        with self.cv:
            self.queue.append(cmd)
            self.cv.notify_all()
            end = time.time() + timeout
            while cid not in self.results:
                left = end - time.time()
                if left <= 0:
                    if cmd in self.queue:
                        self.queue.remove(cmd)
                    self.taken.discard(cid)
                    raise BridgeError(f"앱이 {int(timeout)} 초 안에 답하지 않음 — 창이 멈췄거나 닫혔는지 확인하세요.")
                self.cv.wait(min(left, 1.0))
            return self.results.pop(cid)

    def status(self):
        reg = self.get_registry()
        with self.cv:
            lead = self.leader()
            pages = len(self.pages)
        return {"app": APP_ID, "connected": lead is not None, "windows": pages, "leader": lead, "app_version": reg.get("app_version"), "registry": reg.get("hash") or reg.get("_source"),
                "tools": len(reg.get("commands", [])), "clients": {k: round(time.time() - v) for k, v in self.clients.items()}, "last_call_ago": round(time.time() - self.last_call) if self.last_call else None}


# ====================================================================== stdio 쪽: 떠 있는 앱 서버에 HTTP 로 붙는 다리
class HttpBackend:
    def __init__(self, app_dir, launch):
        self.app_dir = app_dir
        self.launch = launch                    # 앱을 띄우는 함수
        self.base = None
        self.launched_at = 0.0
        self.last_reg = None
        self.miss_at = 0.0                      # 방금 못 찾았으면 3 초 동안은 다시 안 두드림(인사·목록이 몰려 와도 빠르게)

    def _get(self, path, timeout=3.0):
        with urllib.request.urlopen(self.base + path, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))

    def find(self):
        """떠 있는 앱 서버 찾기 — 잠금 파일(앱이 뜰 때 씀)의 포트만 본다. Windows 는 닫힌 포트에 붙어 보는 데 ~0.5 s 씩 걸려
        포트를 줄줄이 두드리면 AI 앱의 첫 인사가 7 s 넘게 걸렸음(10/13). 잠금 파일이 없을 때만 기본 포트 하나를 더 본다."""
        info = read_json(LOCK) or {}
        ports = [info["port"]] if info.get("port") else [8795]
        for p in ports:
            base = f"http://127.0.0.1:{p}"
            try:
                with urllib.request.urlopen(base + "/bridge/status", timeout=0.8) as r:
                    st = json.loads(r.read().decode("utf-8"))
                if st.get("app") == APP_ID:
                    self.base = base
                    return True
            except Exception:
                continue
        self.base = None
        return False

    def ensure(self, launch=False, wait=30.0):
        if not launch and not self.base and time.time() - self.miss_at < 3:
            return False
        if self.base:
            try:
                self._get("/bridge/status", 1.5)
                return True
            except Exception:
                self.base = None
        if self.find():
            return True
        self.miss_at = time.time()
        if not launch:
            return False
        if time.time() - self.launched_at > 40:
            self.launched_at = time.time()
            log("launching app…")
            self.launch()
        end = time.time() + wait
        while time.time() < end:
            time.sleep(0.5)
            if self.find():
                return True
        return False

    def get_registry(self):
        if self.ensure(launch=False):
            try:
                self.last_reg = self._get("/bridge/registry")
                return self.last_reg
            except Exception:
                pass
        return self.last_reg or fallback_registry(self.app_dir)

    def call(self, name, args, client=None, timeout=None):
        if not self.ensure(launch=True, wait=40):
            raise BridgeError("블록아웃 스튜디오를 띄우지 못함 — 앱을 직접 실행한 뒤 다시 시도하세요.")
        body = json.dumps({"name": name, "args": args or {}, "client": client or ""}, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(self.base + "/bridge/call", data=body, headers={"Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=(timeout or 620)) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            try:
                return json.loads(e.read().decode("utf-8"))
            except Exception:
                raise BridgeError(f"앱 서버 오류 {e.code}")


# ====================================================================== MCP 규칙(JSON-RPC)
class McpServer:
    def __init__(self, backend, server_version="1"):
        self.b = backend
        self.server_version = server_version
        self.client_name = None
        self.listed_hash = None

    def info(self):
        return {"name": APP_ID, "title": TITLE, "version": self.server_version}

    def caps(self):
        return {"tools": {"listChanged": True}, "resources": {}, "prompts": {}}

    def instructions(self, reg):
        head = reg.get("instructions") or ""
        return head + f"\n(앱 {reg.get('app_version', '?')} · 도구 {len(reg.get('commands', []))}개 · 자세한 사용법은 get_guide)"

    def tools(self, reg):
        out = []
        for c in reg.get("commands", []):
            t = {"name": c["name"], "title": c.get("title") or c["name"], "description": c.get("description", ""),
                 "inputSchema": c.get("inputSchema") or {"type": "object", "properties": {}}}
            if c.get("annotations"):
                t["annotations"] = c["annotations"]
            out.append(t)
        out.append({"name": "get_guide", "title": "설명서 읽기", "description": "Full usage guide for Blockout Studio: coordinate system, sets, object kinds and sizes, camera shots, workflow tips, and the keyboard shortcuts a human uses. Read this first if unsure.",
                    "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
                    "annotations": {"title": "설명서 읽기", "readOnlyHint": True, "openWorldHint": False}})
        return out

    def _client(self, params):
        meta = (params or {}).get("_meta") or {}
        ci = meta.get("io.modelcontextprotocol/clientInfo") or {}
        return ci.get("name") or self.client_name

    def handle(self, msg):
        """메시지 하나 → 응답(dict) 또는 None(알림)."""
        if not isinstance(msg, dict) or msg.get("jsonrpc") != "2.0":
            return {"jsonrpc": "2.0", "id": None, "error": {"code": -32600, "message": "Invalid Request"}}
        mid, method, params = msg.get("id"), msg.get("method"), msg.get("params") or {}
        if method is None:                         # 응답이 들어온 경우(우리는 서버에서 요청을 안 보냄)
            return None
        if mid is None:                             # 알림
            return None
        meta = params.get("_meta") or {}
        modern = META_VER in meta
        if modern and meta[META_VER] not in SUPPORTED:
            return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32022, "message": "Unsupported protocol version", "data": {"supported": SUPPORTED, "requested": meta[META_VER]}}}
        try:
            result = self.dispatch(method, params, modern)
        except McpError as e:
            return {"jsonrpc": "2.0", "id": mid, "error": {"code": e.code, "message": str(e)}}
        except Exception as e:                      # 앱 버그도 대화로 돌려준다
            log("handler error:", repr(e))
            return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32603, "message": f"Internal error: {e}"}}
        if isinstance(result, dict):
            if modern:                              # 새 판: 결과 종류·서버 이름·캐시 힌트
                result.setdefault("resultType", "complete")
                result.setdefault("_meta", {})["io.modelcontextprotocol/serverInfo"] = self.info()
            else:                                   # 옛 판 클라이언트엔 모르는 칸을 안 보냄
                for k in ("resultType", "ttlMs", "cacheScope"):
                    result.pop(k, None)
        return {"jsonrpc": "2.0", "id": mid, "result": result}

    def dispatch(self, method, params, modern):
        if method == "initialize":
            want = params.get("protocolVersion")
            self.client_name = ((params.get("clientInfo") or {}).get("name")) or self.client_name
            reg = self.b.get_registry()
            return {"protocolVersion": want if want in LEGACY else LEGACY[0], "capabilities": self.caps(), "serverInfo": self.info(), "instructions": self.instructions(reg)}
        if method == "server/discover":
            reg = self.b.get_registry()
            return {"supportedVersions": SUPPORTED, "capabilities": self.caps(), "_meta": {"io.modelcontextprotocol/serverInfo": self.info()},
                    "instructions": self.instructions(reg), "ttlMs": 60000, "cacheScope": "private"}
        if method == "ping":
            return {}
        if method == "logging/setLevel":
            return {}
        if method == "tools/list":
            reg = self.b.get_registry()
            self.listed_hash = reg.get("hash")
            return {"tools": self.tools(reg), "ttlMs": 30000, "cacheScope": "private"}
        if method == "tools/call":
            return self.call_tool(params.get("name"), params.get("arguments") or {}, self._client(params))
        if method == "resources/list":
            return {"resources": [
                {"uri": "blockout://guide", "name": "guide", "title": "블록아웃 스튜디오 AI 설명서", "mimeType": "text/markdown"},
                {"uri": "blockout://scene", "name": "scene", "title": "지금 장면(JSON)", "mimeType": "application/json"}], "ttlMs": 30000, "cacheScope": "private"}
        if method == "resources/templates/list":
            return {"resourceTemplates": [], "ttlMs": 60000, "cacheScope": "private"}
        if method == "resources/read":
            uri = params.get("uri")
            if uri == "blockout://guide":
                return {"contents": [{"uri": uri, "mimeType": "text/markdown", "text": self.b.get_registry().get("guide", "")}], "ttlMs": 30000, "cacheScope": "private"}
            if uri == "blockout://scene":
                res = self.b.call("get_scene", {}, self._client(params))
                return {"contents": [{"uri": uri, "mimeType": "application/json", "text": json.dumps(res.get("data"), ensure_ascii=False)}], "ttlMs": 0, "cacheScope": "private"}
            raise McpError(-32602, f"Unknown resource: {uri}")
        if method == "prompts/list":
            return {"prompts": PROMPTS_LIST, "ttlMs": 60000, "cacheScope": "private"}
        if method == "prompts/get":
            return prompt_get(params.get("name"), params.get("arguments") or {})
        if method == "completion/complete":
            return {"completion": {"values": [], "total": 0, "hasMore": False}}
        raise McpError(-32601, f"Method not found: {method}")

    def call_tool(self, name, args, client):
        if not name:
            raise McpError(-32602, "tool name missing")
        reg = self.b.get_registry()
        if name == "get_guide":
            return {"content": [{"type": "text", "text": reg.get("guide", "")}], "isError": False}
        known = {c["name"] for c in reg.get("commands", [])}
        if known and name not in known:
            return {"content": [{"type": "text", "text": f"없는 도구: {name}. 쓸 수 있는 도구: {', '.join(sorted(known))}"}], "isError": True}
        try:
            res = self.b.call(name, args, client)
        except BridgeError as e:
            return {"content": [{"type": "text", "text": str(e)}], "isError": True}
        return to_content(res)


class McpError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def to_content(res):
    """앱 창의 결과 {ok, text, data, images:[{data, mimeType, label}], error} → MCP 결과."""
    if not res.get("ok", False):
        return {"content": [{"type": "text", "text": "실패: " + str(res.get("error") or "알 수 없는 오류")}], "isError": True}
    content = []
    text = res.get("text") or ""
    if res.get("data") is not None:
        text = (text + "\n" if text else "") + json.dumps(res["data"], ensure_ascii=False, separators=(",", ":"))
    if text:
        content.append({"type": "text", "text": text})
    for im in res.get("images") or []:
        if im.get("label"):
            content.append({"type": "text", "text": im["label"]})
        content.append({"type": "image", "data": im["data"], "mimeType": im.get("mimeType", "image/jpeg")})
    if not content:
        content.append({"type": "text", "text": "완료"})
    return {"content": content, "isError": False}


PROMPTS_LIST = [
    {"name": "build_scene", "title": "장면 만들기", "description": "말로 설명한 장면을 블록아웃 스튜디오에 직접 만든다(세트 고르기 → 물체 → 사람 동선 → 카메라 → 확인 그림).",
     "arguments": [{"name": "idea", "description": "만들고 싶은 장면 (예: 성문 앞에서 기사 둘이 마주 걸어오는 장면)", "required": True}]},
    {"name": "plan_shots", "title": "카메라 무빙 짜기", "description": "지금 장면에 어울리는 카메라 무빙(장면 3~6개)을 짜서 넣고 재생한다.",
     "arguments": [{"name": "style", "description": "원하는 느낌 (예: 긴장감 있게 천천히 다가가기)", "required": False}]},
]


def prompt_get(name, args):
    if name == "build_scene":
        idea = args.get("idea") or "자유 주제"
        text = (f"블록아웃 스튜디오(열려 있는 3D 앱)에 이 장면을 만들어 줘: {idea}\n"
                "순서: get_guide 를 처음 한 번 읽고 → get_scene 으로 지금 상태 확인 → 필요하면 new_scene(세트) → add_objects 로 큰 덩어리부터 → "
                "animate_object 로 사람·차 동선 → add_shots 로 카메라 장면 3~5개 → look(top 과 sheet)으로 그림을 보고 고칠 것 고치기 → playback 으로 재생. "
                "한 단계마다 무엇을 했는지 짧게 말해 줘.")
    elif name == "plan_shots":
        style = args.get("style") or "장면에 어울리게"
        text = (f"블록아웃 스튜디오의 지금 장면에 카메라 무빙을 짜 줘 ({style}). get_scene 과 look(top) 으로 배치를 보고, add_shots 또는 add_camera_move 로 "
                "장면 3~6개를 넣은 뒤 look(sheet) 로 확인하고 playback 으로 처음부터 재생해 줘.")
    else:
        raise McpError(-32602, f"Unknown prompt: {name}")
    return {"description": text[:80], "messages": [{"role": "user", "content": {"type": "text", "text": text}}]}


# ====================================================================== HTTP 라우팅(앱 서버 Handler 에서 부름)
def _send(h, code, body=None, ctype="application/json; charset=utf-8", extra=None):
    data = b"" if body is None else (body if isinstance(body, (bytes, bytearray)) else json.dumps(body, ensure_ascii=False).encode("utf-8"))
    h.send_response(code)
    if body is not None:
        h.send_header("Content-Type", ctype)
    h.send_header("Content-Length", str(len(data)))
    for k, v in (extra or {}).items():
        h.send_header(k, v)
    h.end_headers()
    if data:
        h.wfile.write(data)


LOCAL_HOSTS = ("127.0.0.1", "localhost", "::1")


def _origin_ok(h):
    """브라우저의 다른 사이트가 이 주소로 몰래 요청하는 것을 막는다 — Host 가 이 PC 이름이어야(DNS 리바인딩), Origin 이 있으면 이 PC 여야(CSRF).
    Origin 이 없는 요청(AI 앱·명령줄)은 Host 만 본다."""
    try:
        host = urllib.parse.urlparse("http://" + (h.headers.get("Host") or "")).hostname
        if host not in LOCAL_HOSTS:
            return False
        if (h.headers.get("Sec-Fetch-Site") or "same-origin") not in ("same-origin", "none"):
            return False
        o = h.headers.get("Origin")
        if not o:
            return True
        return o != "null" and urllib.parse.urlparse(o).hostname in LOCAL_HOSTS
    except Exception:
        return False


def _body(h, limit=200 * 1024 * 1024):
    n = int(h.headers.get("Content-Length") or 0)
    if n > limit:
        raise ValueError("too large")
    return h.rfile.read(n) if n else b""


def q1(qs, k):
    v = qs.get(k)
    return v[0] if v else None


def route(h, method, bridge, mcp):
    """처리했으면 True. /mcp · /bridge/* 만 맡고 나머지는 원래 파일 서버로."""
    path = h.path.split("?", 1)[0]
    if path != "/mcp" and not path.startswith("/bridge/"):
        return False
    if not _origin_ok(h):
        _send(h, 403, {"error": "origin not allowed"})
        return True
    qs = urllib.parse.parse_qs(h.path.split("?", 1)[1]) if "?" in h.path else {}
    try:
        if path == "/mcp":
            if method != "POST":
                _send(h, 405, {"error": "POST only (no server-initiated stream)"}, extra={"Allow": "POST"})
                return True
            raw = _body(h)
            try:
                msg = json.loads(raw.decode("utf-8"))
            except Exception:
                _send(h, 400, {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}})
                return True
            if isinstance(msg, list):                       # 옛 판의 묶음 요청
                outs = [r for r in (mcp.handle(m) for m in msg) if r is not None]
                _send(h, 200 if outs else 202, outs if outs else None)
                return True
            out = mcp.handle(msg)
            if out is None:
                _send(h, 202)
            else:
                _send(h, 200, out)
            return True
        if path == "/bridge/status":
            _send(h, 200, bridge.status())
        elif path == "/bridge/registry":
            _send(h, 200, bridge.get_registry())
        elif path == "/bridge/hello" and method == "POST":
            _send(h, 200, bridge.hello(json.loads(_body(h).decode("utf-8") or "{}"), q1(qs, "page")))
        elif path == "/bridge/poll":
            cmd = bridge.poll(q1(qs, "page"), q1(qs, "vis") == "1", q1(qs, "focus") == "1")
            if cmd is None:
                _send(h, 204)
            else:
                _send(h, 200, cmd)
        elif path in ("/bridge/focus", "/bridge/bye") and method == "POST":     # 창이 앞으로 나옴·숨음·닫힘
            _body(h)
            bridge.page_event(q1(qs, "page"), q1(qs, "vis") == "1", q1(qs, "focus") == "1", bye=path.endswith("bye"))
            _send(h, 204)
        elif path == "/bridge/result" and method == "POST":
            bridge.result(json.loads(_body(h).decode("utf-8") or "{}"))
            _send(h, 204)
        elif path == "/bridge/call" and method == "POST":
            req = json.loads(_body(h).decode("utf-8") or "{}")
            try:
                _send(h, 200, bridge.call(req.get("name"), req.get("args"), req.get("client")))
            except BridgeError as e:
                _send(h, 200, {"ok": False, "error": str(e)})
        elif path == "/bridge/file" and method == "POST":    # 앱 창이 만든 파일(AI 내보내기 · 열기 전 백업)을 문서 폴더에 — 프로젝트 저장은 /api/project
            kind = (qs.get("kind") or ["export"])[0]
            if kind not in ("export", "backup"):
                return _send(h, 400, {"error": "kind"}) or True
            name = safe_name((qs.get("name") or ["파일"])[0])
            d = out_dir(kind)
            p = os.path.join(d, name)
            stem, ext = os.path.splitext(name)
            i = 2
            while os.path.exists(p):
                p = os.path.join(d, f"{stem} ({i}){ext}")
                i += 1
            data = _body(h)
            with open(p, "wb") as f:
                f.write(data)
            _send(h, 200, {"path": p, "bytes": len(data)})
        elif path == "/bridge/file":                         # 프로젝트 JSON 읽기(문서\블록아웃 스튜디오\프로젝트 또는 .json 경로)
            want = (qs.get("path") or [""])[0]
            d = out_dir("project")
            if want.startswith(("\\\\", "//")) or re.match(r"^[a-zA-Z]+://", want):   # 네트워크 경로(\\서버\…)는 안 엶 — 열기만 해도 Windows 로그인 정보가 그 서버로 감
                return _send(h, 400, {"error": "네트워크 경로는 열 수 없음"}) or True
            p = want if os.path.isabs(want) else os.path.join(d, safe_name(want))
            if not p.lower().endswith(".json"):
                p += ".json"
            if not os.path.isfile(p) or os.path.getsize(p) > 50 * 1024 * 1024:
                _send(h, 404, {"error": f"없음: {p}", "folder": d, "files": sorted(f for f in os.listdir(d) if f.lower().endswith(".json"))})
            else:
                with open(p, "rb") as f:
                    _send(h, 200, f.read())
        elif path == "/bridge/setup":
            if method == "POST":
                req = json.loads(_body(h).decode("utf-8") or "{}")
                _send(h, 200, setup_client(req.get("client"), h.server.server_address[1]))
            else:
                _send(h, 200, setup_info(h.server.server_address[1]))
        else:
            _send(h, 404, {"error": "unknown"})
    except (BrokenPipeError, ConnectionResetError):
        pass
    except Exception as e:
        log("bridge error:", repr(e))
        try:
            _send(h, 500, {"error": str(e)})
        except Exception:
            pass
    return True


def write_lock(port):
    try:
        write_json(LOCK, {"port": port, "pid": os.getpid(), "exe": sys.executable, "started": time.strftime("%Y-%m-%d %H:%M:%S")})
    except Exception as e:
        log("lock write failed:", e)


def clear_lock(port):
    info = read_json(LOCK) or {}
    if info.get("pid") == os.getpid() and info.get("port") == port:
        try:
            os.remove(LOCK)
        except OSError:
            pass


# ====================================================================== AI 앱에 연결(사람이 앱에서 버튼을 눌렀을 때만)
def mcp_command(app_dir):
    if getattr(sys, "frozen", False):
        return sys.executable, ["--mcp"]
    return sys.executable, [os.path.join(app_dir, "launcher.py"), "--mcp"]


def claude_config_path():
    cands = [os.path.join(os.environ.get("APPDATA", ""), "Claude", "claude_desktop_config.json")]
    pk = os.path.join(os.environ.get("LOCALAPPDATA", ""), "Packages")
    if os.path.isdir(pk):
        for d in os.listdir(pk):
            if d.startswith("Claude_"):
                cands.append(os.path.join(pk, d, "LocalCache", "Roaming", "Claude", "claude_desktop_config.json"))
    for p in cands:
        if os.path.isdir(os.path.dirname(p)):
            return p
    return None


def codex_config_path():
    home = os.environ.get("CODEX_HOME") or os.path.join(os.path.expanduser("~"), ".codex")
    return os.path.join(home, "config.toml") if os.path.isdir(home) else None


def _backup(path):
    if os.path.exists(path):
        b = f"{path}.bak-{time.strftime('%Y%m%d-%H%M%S')}"
        with open(path, "rb") as s, open(b, "wb") as d:
            d.write(s.read())
        return b
    return None


TOML_SECTION = re.compile(r"(?m)^\[mcp_servers\.(?:\"blockout-studio\"|blockout-studio)\]\s*$")


def _toml_str(s):
    return "'" + s + "'" if "'" not in s and "\n" not in s else json.dumps(s, ensure_ascii=False)


def setup_info(port, app_dir=None):
    app_dir = app_dir or _APP_DIR
    cmd, args = mcp_command(app_dir)
    url = f"http://127.0.0.1:{port}/mcp"
    cp, xp = claude_config_path(), codex_config_path()
    claude_cmd = codex_cmd = None
    if cp:
        claude_cmd = (((read_json(cp, {}) or {}).get("mcpServers") or {}).get(APP_ID) or {}).get("command")
    if xp and os.path.exists(xp):
        try:
            import tomllib
            with open(xp, "rb") as f:
                codex_cmd = (((tomllib.load(f).get("mcp_servers") or {}).get(APP_ID)) or {}).get("command")
        except Exception:
            with open(xp, encoding="utf-8", errors="replace") as f:
                codex_cmd = "?" if TOML_SECTION.search(f.read()) else None
    ok = lambda c: bool(c) and (c == "?" or os.path.exists(c))            # exe 를 옮겼으면 설정의 경로가 없음 → 다시 연결
    q = lambda s: '"' + s + '"' if " " in s else s
    snippets = {
        "claude_code": f'claude mcp add {APP_ID} -- {q(cmd)} ' + " ".join(q(a) for a in args),
        "codex_cli": f'codex mcp add {APP_ID} -- {q(cmd)} ' + " ".join(q(a) for a in args),
        "json": json.dumps({"mcpServers": {APP_ID: {"command": cmd, "args": args}}}, ensure_ascii=False, indent=2),
        "vscode": json.dumps({"servers": {APP_ID: {"type": "stdio", "command": cmd, "args": args}}}, ensure_ascii=False, indent=2),
        "url": url,
    }
    return {"exe": cmd, "args": args, "url": url,
            "claude": {"found": bool(cp), "connected": ok(claude_cmd), "stale": bool(claude_cmd) and not ok(claude_cmd), "config": cp},
            "codex": {"found": bool(xp), "connected": ok(codex_cmd), "stale": bool(codex_cmd) and not ok(codex_cmd), "config": xp},
            "snippets": snippets, "output": os.path.dirname(out_dir("project"))}


def setup_client(client, port, app_dir=None):
    app_dir = app_dir or _APP_DIR
    cmd, args = mcp_command(app_dir)
    try:
        if client == "claude":
            p = claude_config_path()
            if not p:
                return {"ok": False, "message": "Claude 데스크톱이 이 PC 에 없습니다 — claude.ai/download 에서 설치한 뒤 다시 누르세요."}
            cfg = read_json(p, {}) if os.path.exists(p) else {}
            if cfg is None:
                return {"ok": False, "message": f"Claude 설정 파일을 읽지 못했습니다(형식 오류): {p}"}
            bak = _backup(p)
            cfg.setdefault("mcpServers", {})[APP_ID] = {"command": cmd, "args": args}
            write_json(p, cfg)
            return {"ok": True, "message": "Claude 데스크톱에 연결했습니다. Claude 를 완전히 껐다(트레이 아이콘 › 종료) 다시 켜면 도구에 「blockout-studio」가 보입니다.", "config": p, "backup": bak}
        if client == "codex":
            p = codex_config_path()
            if not p:
                return {"ok": False, "message": "Codex(ChatGPT 데스크톱 · Codex 앱)가 이 PC 에 없습니다 — 설치·로그인한 뒤 다시 누르세요."}
            text = open(p, encoding="utf-8").read() if os.path.exists(p) else ""
            bak = _backup(p)
            block = (f"[mcp_servers.{APP_ID}]\n"
                     f"command = {_toml_str(cmd)}\n"
                     f"args = [{', '.join(_toml_str(a) for a in args)}]\n"
                     f"startup_timeout_sec = 30\n"
                     f"tool_timeout_sec = 600\n"
                     f"# 블록아웃 스튜디오 도구는 앱 창 안에서만 움직이고(Ctrl+Z 로 되돌림) 문서의 블록아웃 스튜디오 폴더에만 저장 — 매번 묻지 않게\n"
                     f'default_tools_approval_mode = "approve"\n')
            m = TOML_SECTION.search(text)
            if m:                                             # 있던 칸은 다음 [칸] 전까지 바꿔 끼움
                nxt = re.search(r"(?m)^\[", text[m.end():])
                end = m.end() + nxt.start() if nxt else len(text)
                text = text[:m.start()] + block + "\n" + text[end:].lstrip("\n")
            else:
                text = text.rstrip("\n") + ("\n\n" if text.strip() else "") + block
            try:                                              # 덧붙인 결과가 TOML 로 안 읽히면(예: mcp_servers 를 한 줄 표로 써 둔 설정) 손대지 않음
                import tomllib
                parsed = tomllib.loads(text)
                if APP_ID not in (parsed.get("mcp_servers") or {}):
                    raise ValueError("blockout-studio 칸이 안 보임")
            except Exception as e:
                return {"ok": False, "message": f"Codex 설정 형식이 특이해서 손대지 않았습니다({e}). 「다른 AI 앱 설정 글」의 Codex 줄을 직접 붙여 넣어 주세요.", "config": p}
            tmp = p + ".tmp"
            with open(tmp, "w", encoding="utf-8", newline="\n") as f:
                f.write(text)
            os.replace(tmp, p)
            return {"ok": True, "message": "Codex 에 연결했습니다(ChatGPT 데스크톱의 Codex · Codex 앱 · CLI 가 같이 씀). Codex 를 다시 켜거나 새 대화를 열면 도구에 「blockout-studio」가 보입니다.", "config": p, "backup": bak}
        return {"ok": False, "message": f"모르는 AI 앱: {client}"}
    except Exception as e:
        return {"ok": False, "message": f"연결하지 못했습니다: {e}"}


_APP_DIR = os.path.dirname(os.path.abspath(__file__))


# ====================================================================== stdio 모드(--mcp)
def run_stdio(app_dir, launch, server_version="1"):
    import io
    global _APP_DIR
    _APP_DIR = app_dir
    if sys.stdin is None or sys.stdout is None:
        return 2
    inp = io.TextIOWrapper(sys.stdin.buffer, encoding="utf-8", errors="replace", newline="\n")
    out = sys.stdout.buffer
    lock = threading.Lock()
    backend = HttpBackend(app_dir, launch)
    srv = McpServer(backend, server_version)
    state = {"legacy": False}

    def send(obj):
        data = (json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
        with lock:
            out.write(data)
            out.flush()

    def work(msg):
        try:
            if isinstance(msg, dict) and msg.get("method") == "initialize":
                state["legacy"] = True
            res = srv.handle(msg)
            if res is not None:
                send(res)
        except Exception as e:
            log("stdio handler error:", repr(e))

    def watch():                                          # 앱이 새 도구를 알려 오면(업데이트) 클라이언트에 다시 받으라고 알림
        while True:
            time.sleep(10)
            try:
                if not state["legacy"] or srv.listed_hash is None or not backend.ensure(launch=False):
                    continue
                h = backend.get_registry().get("hash")
                if h and h != srv.listed_hash:
                    srv.listed_hash = h
                    send({"jsonrpc": "2.0", "method": "notifications/tools/list_changed"})
            except Exception:
                pass

    threading.Thread(target=watch, daemon=True).start()
    for line in inp:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except Exception:
            send({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}})
            continue
        if isinstance(msg, list):
            for m in msg:
                threading.Thread(target=work, args=(m,), daemon=True).start()
        else:
            threading.Thread(target=work, args=(msg,), daemon=True).start()
    return 0


def launch_detached(argv):
    """창 없이 떼어 놓고 실행(Windows 콘솔 창 안 뜸) — AI 앱이 꺼져도 앱은 남는다."""
    flags = 0
    if os.name == "nt":
        flags = 0x00000008 | 0x00000200 | 0x08000000           # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW
    env = dict(os.environ)
    if getattr(sys, "frozen", False):                           # 한 파일 exe 가 자기 자신을 띄울 때: 부모의 임시 폴더(_MEI…)를 같이 쓰면 부모가 끝나며 지우려다 멈추고 앱 파일이 사라짐 → 새 앱은 따로 풀게
        env["PYINSTALLER_RESET_ENVIRONMENT"] = "1"
        for k in [k for k in env if k.startswith("_PYI") or k == "_MEIPASS2"]:
            env.pop(k)
    return subprocess.Popen(argv, creationflags=flags, close_fds=True, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
