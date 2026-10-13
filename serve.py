"""블록아웃 스튜디오 로컬 서버 — 이 폴더를 http://localhost:<포트>/ 로 띄운다(캐시 없음 → 파일을 고치면 새로고침만으로 반영).

  python serve.py            → 8795 번 포트, 브라우저 자동 열기
  python serve.py 8795 --no-open

AI 연결(MCP)도 같이 뜬다: http://localhost:<포트>/mcp · 앱 창이 알려 준 도구 목록을 app/mcp_registry.json 에도 써서 exe 에 넣는다(build_exe.py).
프로젝트 저장·열기·업데이트 확인(/api/*)은 server_api.py — exe 와 같은 것(개발 서버는 새 판을 받지는 않음).
"""
import http.server
import os
import socketserver
import sys
import threading
import webbrowser

import mcp_bridge
import server_api

PORT = int(next((a for a in sys.argv[1:] if a.isdigit()), 8795))
ROOT = os.path.dirname(os.path.abspath(__file__))
BRIDGE = mcp_bridge.Bridge(ROOT, open_window=None, write_bundle=True)
MCP = mcp_bridge.McpServer(BRIDGE, "dev")
API = server_api.Api(ROOT, [os.path.join(ROOT, "assets")], server_api.Updater(ROOT, exe=None), session_name="session-dev.json")   # 세션은 exe 와 따로


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def do_HEAD(self):
        if not mcp_bridge._origin_ok(self):
            self.send_error(403); return
        super().do_HEAD()

    def do_GET(self):
        if not mcp_bridge._origin_ok(self):
            self.send_error(403); return
        if self.path.startswith("/ping"):            # 앱이 보내는 생존 신호(exe 실행기용) — 여기선 그냥 받기만
            self.send_response(204); self.end_headers(); return
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

    def log_message(self, fmt, *args):          # 조용히
        pass


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = os.name != "nt"           # Windows: 켜면 같은 포트에 서버 둘이 붙음(exe 와 개발 서버가 요청을 나눠 받던 것)
    daemon_threads = True                            # 앱 창의 긴 폴링이 꺼질 때 붙잡지 않게


if __name__ == "__main__":
    with Server(("127.0.0.1", PORT), Handler) as httpd:
        url = f"http://localhost:{PORT}/"
        print(f"블록아웃 스튜디오: {url}  (끝내기 Ctrl+C)")
        if "--no-open" not in sys.argv:
            threading.Timer(0.6, lambda: webbrowser.open(url)).start()
        mcp_bridge.write_lock(PORT)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            mcp_bridge.clear_lock(PORT)
