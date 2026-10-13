"""블록아웃 스튜디오 실행기 — 더블클릭 한 번으로 뜨는 exe 의 본체.

  · 앱 파일(index.html · app · vendor · scenes)은 exe 안에 들어 있고, 큰 모델(assets 폴더)은 exe 옆에 있으면 씀(없어도 됨).
  · 127.0.0.1 의 8795 번(막혀 있으면 다음 번호)에서 서빙하고, Edge/Chrome 을 '앱 창'(주소창 없는 창)으로 연다. 둘 다 없으면 기본 브라우저.
  · 창을 닫으면 끝남: 앱 창 프로세스가 끝나거나, 페이지의 /ping 이 10초 넘게 끊기면 서버가 스스로 종료.
  · AI 연결(MCP): http://127.0.0.1:<포트>/mcp (앱이 켜져 있을 때) 또는 「블록아웃 스튜디오.exe --mcp」(stdio — 앱이 꺼져 있으면 첫 명령 때 띄움). 세부는 mcp_bridge.py.
  · 프로젝트 저장·열기·자동 저장·업데이트(/api/*)는 server_api.py. 켤 때 GitHub 릴리스를 확인해 새 판을 받아 두고(<exe>.new), 다음에 켤 때 바꿔 끼운다.
  옵션: --no-open(브라우저 안 열기) --port N --dry-run(실행할 브라우저 명령만 출력) --mcp(AI 앱용 stdio)
"""
import http.server
import os
import socketserver
import subprocess
import sys
import threading
import time
import webbrowser

import mcp_bridge
import server_api

PORT0 = 8795
HEARTBEAT_TIMEOUT = 10.0
EXE_DIR = os.path.dirname(os.path.abspath(sys.executable if getattr(sys, "frozen", False) else __file__))
BUNDLE = getattr(sys, "_MEIPASS", EXE_DIR)          # exe 안에 묶인 앱 파일
VERSION = server_api.read_version(BUNDLE)["version"]   # version.json 하나로(앱 화면 · 업데이트 · AI 설명서가 같이 씀)
LAST_APP = os.path.join(mcp_bridge.DATA_DIR, "last_app.json")   # 마지막으로 켠 앱 exe — Claude 확장 안의 옛 사본도 이걸 띄움
PORT = int(next((sys.argv[i + 1] for i, a in enumerate(sys.argv) if a == "--port" and i + 1 < len(sys.argv)), PORT0))
state = {"last_ping": 0.0, "pinged": False, "started": time.time()}
BRIDGE = None                                       # AI(MCP) ↔ 앱 창 다리 — main 에서 만듦
MCP = None
API = None
HTTPD = None
PROC = None                                         # 앱 창(Edge) 프로세스


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=BUNDLE, **kw)

    def translate_path(self, path):                 # assets/ 의 모델만 exe 옆에서(있으면), 나머지는 늘 exe 안의 파일 — exe 를 둔 폴더(다운로드 등)의 다른 파일은 안 내줌
        inside = super().translate_path(path)
        rel = os.path.relpath(inside, BUNDLE)
        if rel.replace("\\", "/").startswith("assets/"):
            beside = os.path.join(EXE_DIR, rel)
            if os.path.isfile(beside) and os.path.abspath(EXE_DIR) != os.path.abspath(BUNDLE):
                return beside
        return inside

    def do_HEAD(self):
        if not mcp_bridge._origin_ok(self):
            self.send_error(403); return
        super().do_HEAD()

    def do_GET(self):
        if not mcp_bridge._origin_ok(self):             # 이 PC 이름으로 온 요청만(DNS 리바인딩 페이지가 파일을 읽지 못하게)
            self.send_error(403); return
        if self.path.startswith("/ping"):
            state["last_ping"] = time.time(); state["pinged"] = True
            self.send_response(204); self.send_header("Cache-Control", "no-store"); self.end_headers()
            return
        if API.route(self, "GET") or mcp_bridge.route(self, "GET", BRIDGE, MCP):
            return
        super().do_GET()

    def do_POST(self):
        if not (API.route(self, "POST") or mcp_bridge.route(self, "POST", BRIDGE, MCP)):
            self.send_error(405)

    def do_DELETE(self):
        if not mcp_bridge.route(self, "DELETE", BRIDGE, MCP):
            self.send_error(405)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = os.name != "nt"           # Windows 에선 이게 켜져 있으면 같은 포트에 두 서버가 붙어 요청을 나눠 받음 — 꺼야 다음 포트로 비켜 감
    daemon_threads = True


def find_browser():
    pf, pf86, local = os.environ.get("ProgramFiles", r"C:\Program Files"), os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"), os.environ.get("LOCALAPPDATA", "")
    for p in [os.path.join(pf86, r"Microsoft\Edge\Application\msedge.exe"), os.path.join(pf, r"Microsoft\Edge\Application\msedge.exe"),
              os.path.join(pf, r"Google\Chrome\Application\chrome.exe"), os.path.join(pf86, r"Google\Chrome\Application\chrome.exe"), os.path.join(local, r"Google\Chrome\Application\chrome.exe")]:
        if os.path.exists(p):
            return p
    return None


def open_window(url):
    """앱 창으로 열고 프로세스를 돌려준다(없으면 None = 기본 브라우저로 열었음)."""
    exe = find_browser()
    if not exe:
        webbrowser.open(url)
        return None
    profile = os.path.join(mcp_bridge.DATA_DIR, "browser")   # 전용 프로필 — 자동 저장(localStorage)이 여기 남고, 창을 닫으면 프로세스가 끝남
    os.makedirs(profile, exist_ok=True)
    cmd = [exe, f"--app={url}", f"--user-data-dir={profile}", "--no-first-run", "--no-default-browser-check", "--window-size=1600,960", "--disable-features=msEdgeSidebar,msHubApps"]
    if "--dry-run" in sys.argv:
        print(" ".join(cmd)); return None
    try:
        return subprocess.Popen(cmd, close_fds=True)
    except OSError:
        webbrowser.open(url)
        return None


def watchdog(httpd, proc):
    """앱 창이 닫히거나(프로세스 종료) 페이지의 ping 이 끊기면 서버를 내린다."""
    while True:
        time.sleep(1.0)
        now = time.time()
        if proc is not None:
            if proc.poll() is not None:
                time.sleep(1.5)                     # 창을 다시 열 틈
                if now - state["last_ping"] > 3.0:
                    break
                proc = None                         # 다른 창이 살아 있으면 ping 으로 넘어감
        else:
            if state["pinged"] and now - state["last_ping"] > HEARTBEAT_TIMEOUT:
                break
            if not state["pinged"] and now - state["started"] > 180:   # 3 분 동안 아무도 안 열면
                break
    httpd.shutdown()


def app_argv():
    """앱(창 + 서버)을 새로 띄우는 명령 — 마지막으로 켠 앱 exe(업데이트된 것) > 자기 자신 > 개발 중이면 python launcher.py."""
    last = (mcp_bridge.read_json(LAST_APP) or {}).get("exe")
    if last and os.path.isfile(last) and last.lower().endswith(".exe"):
        return [last]
    if getattr(sys, "frozen", False):
        return [sys.executable]
    return [sys.executable, os.path.abspath(__file__)]


RESTART = []                                        # 「지금 다시 시작」: 서버를 내린 뒤 main 이 띄울 새 exe 명령


def restart_updated(port):
    """「지금 다시 시작」 — 받아 둔 새 exe 로 바꿔 끼우고, 앱 창과 서버를 닫는다. 새 exe 는 main 이 포트를 비운 뒤 띄운다
    (여기서 띄우면 안 됨: 요청 처리 스레드가 만든 데몬 타이머에서 돌아, 서버가 내려가 프로세스가 끝나면 같이 죽음 — 10/13 업데이트 시험에서 다시 안 켜졌던 것)."""
    exe = sys.executable
    if not server_api.apply_pending(exe, VERSION):
        return
    try:
        if PROC is not None and PROC.poll() is None:
            PROC.terminate()
    except Exception:
        pass
    RESTART.append([exe] + sys.argv[1:])            # 켤 때 준 옵션(--port · --no-open)은 그대로
    HTTPD.shutdown()


def main():
    global BRIDGE, MCP
    global API, HTTPD, PROC
    if "--mcp" in sys.argv:                         # AI 앱(Claude 데스크톱 · Codex …)이 띄우는 stdio MCP — 앱 서버에 붙고, 없으면 첫 명령 때 띄운다
        sys.exit(mcp_bridge.run_stdio(BUNDLE, lambda: mcp_bridge.launch_detached(app_argv()), VERSION))
    frozen = getattr(sys, "frozen", False)
    if frozen and server_api.apply_pending(sys.executable, VERSION):   # 지난번에 받아 둔 새 판 → 바꿔 끼우고 새 exe 로 다시 켬(새 exe 가 켜지면 공지)
        mcp_bridge.launch_detached([sys.executable] + sys.argv[1:])
        return
    if frozen:
        mcp_bridge.write_json(LAST_APP, {"exe": sys.executable, "version": VERSION})
    httpd = None
    port = PORT
    for p in range(PORT, PORT + 12):
        try:
            httpd = Server(("127.0.0.1", p), Handler); port = p; break
        except OSError:
            continue
    if httpd is None:
        sys.exit("포트를 열 수 없음")
    url = f"http://127.0.0.1:{port}/"
    print(f"블록아웃 스튜디오: {url}")
    BRIDGE = mcp_bridge.Bridge(BUNDLE, open_window=None if "--no-open" in sys.argv else (lambda: open_window(url)))   # AI 가 부를 때 창이 없으면 다시 엶
    MCP = mcp_bridge.McpServer(BRIDGE, VERSION)
    updater = server_api.Updater(BUNDLE, exe=sys.executable if frozen else None)
    API = server_api.Api(BUNDLE, [os.path.join(EXE_DIR, "assets"), os.path.join(BUNDLE, "assets")], updater, restart=(lambda: restart_updated(port)) if frozen else None)
    HTTPD = httpd
    mcp_bridge.write_lock(port)
    proc = None
    if "--no-open" not in sys.argv:
        proc = open_window(url)
    PROC = proc
    if frozen:
        updater.background()                        # 조금 뒤 새 판 확인 → 자동 업데이트가 켜져 있으면 받아 둠
    threading.Thread(target=watchdog, args=(httpd, proc), daemon=True).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        mcp_bridge.clear_lock(port)
    httpd.server_close()                            # 포트를 비워야 새 exe 가 같은 주소로 뜸
    if RESTART:
        mcp_bridge.launch_detached(RESTART[0])


if __name__ == "__main__":
    main()
