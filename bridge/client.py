#!/usr/bin/env python3
"""Tiny command-line client for the Qwen Web Bridge server."""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
from pathlib import Path

DEFAULT_URL = "http://127.0.0.1:17172"
DEFAULT_STATE_DIR = Path(__file__).resolve().parent.parent / ".qwen-bridge-state"


def request(url: str, method: str, payload: dict | None) -> dict:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())


def wait_for_result(server: str, state_dir: Path, command_id: str, timeout: float) -> dict:
    result_path = state_dir / f"result_{command_id}.json"
    deadline = time.time() + timeout
    while time.time() < deadline:
        if result_path.exists():
            return json.loads(result_path.read_text(encoding="utf-8"))
        time.sleep(0.2)
    return {"id": command_id, "ok": False, "error": "timeout waiting for result"}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--server", default=DEFAULT_URL)
    parser.add_argument("--state-dir", type=Path, default=DEFAULT_STATE_DIR)
    parser.add_argument("--timeout", type=float, default=120.0)
    parser.add_argument("--action", help="extension action, e.g. getTabs / eval / navigate")
    parser.add_argument("--params", default="{}", help="JSON object with action params")
    parser.add_argument("--raw", help="full JSON command object (overrides --action/--params)")
    args = parser.parse_args()

    command = json.loads(args.raw) if args.raw else {
        "action": args.action,
        "params": json.loads(args.params),
    }
    enqueue = request(f"{args.server}/api/enqueue", "POST", {"command": command})
    if not enqueue.get("ok"):
        print(json.dumps(enqueue, ensure_ascii=False, indent=2))
        raise SystemExit(1)

    result = wait_for_result(args.server, args.state_dir, enqueue["id"], args.timeout)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if not result.get("ok"):
        raise SystemExit(2)


if __name__ == "__main__":
    main()
