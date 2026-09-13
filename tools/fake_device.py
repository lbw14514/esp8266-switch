import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

INFO = {
    "id": "a4cf12ab34cd",
    "name": "模拟开关",
    "host": "esp-switch-abcd",
    "fw": "1.0.0",
    "pulse_ms": 500,
    "ip": "192.168.1.150",
    "mode": "sta",
    "pins": [4, 5, 12, 13, 14, 16],
    "channels": [
        {"index": 1, "name": "A", "pinA": 12, "pinB": 13, "active": False},
        {"index": 2, "name": "B", "pinA": 14, "pinB": 4, "active": False},
        {"index": 3, "name": "C", "pinA": 5, "pinB": 16, "active": False}
    ]
}


class Handler(BaseHTTPRequestHandler):
    def send_json(self, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/api/info"):
            self.send_json(INFO)
        elif self.path.startswith("/api/pulse"):
            print("PULSE %s" % self.path, flush=True)
            ch = "1"
            if "ch=" in self.path:
                ch = self.path.split("ch=")[1].split("&")[0]
            self.send_json({"ok": True, "ch": ch, "ms": 500})
        elif self.path.startswith("/api/config"):
            print("CONFIG %s" % self.path, flush=True)
            self.send_json(INFO)
        else:
            self.send_json({"ok": False})

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        payload = self.rfile.read(length).decode("utf-8", "replace")
        print("POST %s %s" % (self.path, payload), flush=True)
        self.send_json({"ok": True})

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8099
    HTTPServer(("0.0.0.0", port), Handler).serve_forever()
