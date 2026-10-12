"""Thin JSON-lines client for the Node simulation process (rl/bridge.js)."""

from __future__ import annotations

import base64
import json
import os
import shutil
import subprocess
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[2]
BRIDGE_SCRIPT = REPO_ROOT / "rl" / "bridge.js"


class NodeBridge:
    def __init__(self, node: str | None = None, script: str | os.PathLike | None = None):
        node = node or os.environ.get("MOBA_NODE") or shutil.which("node")
        if not node:
            raise RuntimeError("Node.js not found. Install Node >= 18 or set MOBA_NODE.")
        self.proc = subprocess.Popen(
            [node, str(script or BRIDGE_SCRIPT)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            cwd=str(REPO_ROOT),
            text=True,
            encoding="utf-8",
            bufsize=1,
        )

    def call(self, cmd: str, **kwargs):
        if self.proc.poll() is not None:
            raise RuntimeError(f"simulation process exited with code {self.proc.returncode}")
        self.proc.stdin.write(json.dumps({"cmd": cmd, **kwargs}) + "\n")
        self.proc.stdin.flush()
        line = self.proc.stdout.readline()
        if not line:
            raise RuntimeError("simulation process closed its output")
        msg = json.loads(line)
        if not msg.get("ok"):
            raise RuntimeError(f"bridge error in '{cmd}': {msg.get('error')}")
        return msg

    def close(self):
        if self.proc.poll() is None:
            try:
                self.call("close")
            except Exception:
                pass
            try:
                self.proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.proc.kill()

    def __del__(self):
        try:
            self.close()
        except Exception:
            pass


def decode_f32(b64: str, shape) -> np.ndarray:
    return np.frombuffer(base64.b64decode(b64), dtype="<f4").reshape(shape)


def decode_u8(b64: str, shape) -> np.ndarray:
    return np.frombuffer(base64.b64decode(b64), dtype=np.uint8).reshape(shape)
