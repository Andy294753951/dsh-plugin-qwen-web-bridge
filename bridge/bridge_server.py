#!/usr/bin/env python3
"""Small loopback HTTP bridge for the Qwen Web Bridge browser extension.

The extension polls:
    GET  /api/next?clientId=...
    POST /api/client/heartbeat
    POST /api/result

This server owns a one-deep pending-command queue.  Send a command with:
    POST /api/enqueue  {"command": {"action": "...", "params": {...}}}

Only the loopback interface is used by default.  Keep it that way.
"""

from __future__ import annotations

import argparse
import json
import os
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 17172
DEFAULT_STATE_DIR = Path(os.environ.get("QWEN_BRIDGE_STATE_DIR", Path.cwd() / ".qwen-bridge-state"))


class BridgeState:
    def __init__(self, state_dir: Path) -> None:
        self.state_dir = state_dir
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._pending: dict[str, Any] | None = None

    def take_pending(self) -> dict[str, Any] | None:
        with self._lock:
            cmd = self._pending
            self._pending = None
        return cmd

    def set_pending(self, command: dict[str, Any]) -> str:
        command = dict(command)
        command.setdefault("id", str(uuid.uuid4()))
        with self._lock:
            self._pending = command
        cmd_path = self.state_dir / f"cmd_{command['id']}.json"
        cmd_path.write_text(json.dumps(command, ensure_ascii=False, indent=2), encoding="utf-8")
        return str(command["id"])

    def store_result(self, payload: dict[str, Any]) -> None:
        cid = payload.get("id", "unknown")
        result_path = self.state_dir / f"result_{cid}.json"
        result_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def make_handler(state: BridgeState, log_path: Path | None):
    class Handler(BaseHTTPRequestHandler):
        def _send(self, code: int, obj: dict[str, Any]) -> None:
            body = json.dumps(obj).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)

        def _log(self, *parts: Any) -> None:
            if log_path is None:
                return
            with log_path.open("a", encoding="utf-8") as f:
                f.write(f"{time.time():.3f} {' '.join(str(p) for p in parts)}\n")

        def do_GET(self) -> None:  # noqa: N802 - http.server API
            self._log("GET", self.path)
            if self.path.startswith("/health"):
                self._send(200, {"ok": True, "status": "ok"})
                return
            if self.path.startswith("/api/next"):
                self._send(200, {"ok": True, "command": state.take_pending()})
                return
            self._send(404, {"ok": False, "error": "not found"})

        def do_POST(self) -> None:  # noqa: N802 - http.server API
            length = int(self.headers.get("Content-Length", "0") or 0)
            raw = self.rfile.read(length).decode("utf-8", "replace") if length else ""
            self._log("POST", self.path, raw[:4000])

            if self.path.startswith("/api/client/heartbeat"):
                self._send(200, {"ok": True, "received": True})
                return

            if self.path.startswith("/api/result"):
                try:
                    state.store_result(json.loads(raw))
                except Exception as exc:  # noqa: BLE001
                    self._log("RESULT WRITE ERROR", repr(exc))
                self._send(200, {"ok": True, "received": True})
                return

            if self.path.startswith("/api/enqueue"):
                try:
                    payload = json.loads(raw)
                    cid = state.set_pending(payload["command"])
                except Exception as exc:  # noqa: BLE001
                    self._send(400, {"ok": False, "error": str(exc)})
                    return
                self._send(200, {"ok": True, "id": cid})
                return

            self._send(404, {"ok": False, "error": "not found"})

        def log_message(self, *args: Any) -> None:  # silence stderr request logs
            return

    return Handler


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bind", default=DEFAULT_HOST, help=f"listen host (default: {DEFAULT_HOST})")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"listen port (default: {DEFAULT_PORT})")
    parser.add_argument(
        "--state-dir",
        type=Path,
        default=DEFAULT_STATE_DIR,
        help=f"state directory for command/result files (default: {DEFAULT_STATE_DIR})",
    )
    parser.add_argument("--log", type=Path, default=None, help="optional JSON-line log file")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    state = BridgeState(args.state_dir)
    handler = make_handler(state, args.log)
    server = ThreadingHTTPServer((args.bind, args.port), handler)
    print(f"Qwen bridge listening on http://{args.bind}:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopping", flush=True)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
