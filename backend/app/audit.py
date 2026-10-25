"""Append-only audit trail for assistant decisions (JSON lines).

Logs *what the system decided*, never the customer's words or address: the last message is stored only as a short hash
so repeated/abusive prompts can be correlated without keeping personal data. Failures to write never break a request.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import time
import uuid
from pathlib import Path

log = logging.getLogger("stormfront.audit")
BACKEND_DIR = Path(__file__).resolve().parents[1]


def audit_path() -> Path:
    return Path(os.environ.get("AUDIT_LOG", str(BACKEND_DIR / "data" / "audit.jsonl")))


def fingerprint(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()[:12]


def new_request_id() -> str:
    return uuid.uuid4().hex[:12]


def record(event: dict) -> None:
    """Write one audit line. Never raises."""
    try:
        row = {"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), **event}
        p = audit_path()
        p.parent.mkdir(parents=True, exist_ok=True)
        with p.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row, separators=(",", ":"), default=str) + "\n")
    except Exception:   # noqa: BLE001 - auditing must not take the service down
        log.exception("audit write failed")
