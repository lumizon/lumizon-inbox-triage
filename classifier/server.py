"""Local d3 decision-model service for triage. Runs on Apple Silicon (MPS), CUDA or CPU.

The questions (categories, priorities...) come from the Node app in each request, so this file never
needs to change for a new client. Run: npm run classifier   (or: uv run python server.py)

Note: d3 ships custom model code, so loading it uses trust_remote_code=True. Review the files in the
Hugging Face repo before first use, and pin D3_REVISION to the commit you reviewed.
"""

import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import torch
from transformers import AutoModel

MODEL_ID = os.environ.get("D3_MODEL", "vllm-sr/d3-nano")

# Commits whose custom code was reviewed (no shell/exec/pickle/credential access; network only for
# image/video URLs and the Hub download). A new model or revision must be reviewed before it's added here.
REVIEWED = {
    "vllm-sr/d3-nano": "8198c9f763b046605b2f4827b4999971fa2c92c4",  # reviewed 2026-11-03
}
REVISION = os.environ.get("D3_REVISION") or REVIEWED.get(MODEL_ID)
if REVISION is None:
    raise SystemExit(f"{MODEL_ID} has no reviewed revision. Review its .py files on the Hub, then add it to REVIEWED or set D3_REVISION.")
PORT = int(os.environ.get("D3_PORT", "4401"))

device = "mps" if torch.backends.mps.is_available() else "cuda" if torch.cuda.is_available() else "cpu"
started = time.perf_counter()
model = AutoModel.from_pretrained(MODEL_ID, revision=REVISION, trust_remote_code=True, dtype=torch.bfloat16).to(device).eval()
print(f"Loaded {MODEL_ID} on {device} in {time.perf_counter() - started:.1f}s")

# One forward pass at a time: the model isn't guaranteed thread-safe and the GPU is the bottleneck anyway.
lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, payload: dict):
        body = json.dumps(payload, default=float).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            return self._send(200, {"model": MODEL_ID, "device": device})
        self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/classify":
            return self._send(404, {"error": "not found"})
        try:
            req = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))))
            t0 = time.perf_counter()
            with lock, torch.inference_mode():
                result = model.system_one(state=req["state"], questions=req["questions"])
            self._send(200, {"answers": result["answers"], "ms": round((time.perf_counter() - t0) * 1000, 1), "model": MODEL_ID})
        except Exception as err:  # noqa: BLE001 - report any failure to the caller
            self._send(500, {"error": f"{type(err).__name__}: {err}"})

    def log_message(self, *args):  # keep the console quiet
        pass


if __name__ == "__main__":
    print(f"d3 classifier on http://127.0.0.1:{PORT}  (model {MODEL_ID}, device {device})")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
