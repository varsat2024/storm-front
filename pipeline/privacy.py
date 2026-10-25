"""Privacy hardening for everything that is published to the browser.

Why: the challenge brief asks that the experience "protects identity and avoids revealing sensitive locations".
Three things were weaker than the page claimed:
  * premises in tiny cells (as few as 1 customer) were published at the cell centre, some with a life-support flag;
  * distances to fire stations / hospitals were published to 0.1 km;
  * facility marker coordinates were embedded at ~100 m precision.

`harden_premises` / `harden_data` are used by export_frontend_data.py. The CLI also re-applies the same rules to an
already-built site (data.json, the DATA constant inside index.html / artifact.html, and the facility list), so the
fix does not need the raw data to be re-processed. Every step is idempotent.

    python privacy.py                # hardens ../site/data.json, ../site/index.html, ../site/artifact.html, ../frontend/app.js
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import config as C


def _band(x: float, step: float) -> float:
    return round(round(float(x) / step) * step, 1)


def harden_premises(prems: list[dict], min_customers: int = C.MIN_CELL_CUSTOMERS, band_km: float = C.DIST_BAND_KM):
    """Drop premises in cells with fewer than `min_customers`, band distances, renumber ids. Returns (premises, n_dropped)."""
    kept = [dict(p) for p in prems if p["cn"] >= min_customers]
    for i, p in enumerate(kept):
        p["id"] = f"P-{i + 1:04d}"
        for k in ("fk", "hk"):
            if k in p:
                p[k] = _band(p[k], band_km)
    return kept, len(prems) - len(kept)


def harden_data(data: dict) -> tuple[dict, int]:
    data = dict(data)
    data["prem"], dropped = harden_premises(data["prem"])
    return data, dropped


_FAC = re.compile(r'(\["(?:hospital|police|fire)", "[^"]+", \d+, )(-?\d+\.\d+), (-?\d+\.\d+)(\])')


def round_facilities(js: str, decimals: int = C.FACILITY_DECIMALS) -> str:
    return _FAC.sub(lambda m: f"{m.group(1)}{round(float(m.group(2)), decimals)}, {round(float(m.group(3)), decimals)}{m.group(4)}", js)


# UI copy that described the old behaviour. (old, new) pairs; applied only where `old` is present.
COPY = [
    (
        "Premise IDs are re-numbered, the map shows only a ≈400 m cell, fire-station distance is banded, and only cell-level features reach the browser. No addresses, premise numbers, exact coordinates, crew details or sensitive-facility locations appear. Only declared flags are used. If a premise cannot be matched, the concierge should decline to estimate and point to the official outage map and phone line.",
        "Premise IDs are re-numbered and the map shows only a ≈400 m cell. Premises in cells with fewer than 20 customers are left out of the published data so a flag cannot point at one household. Distances to fire stations and hospitals are rounded to 0.5 km. Hospitals, police and fire stations are not drawn on the map; their locations (rounded to about 1 km and labelled generically) are used only inside the crew-priority score. Only cell-level features reach the browser. No addresses, premise numbers, exact coordinates, crew details or exact facility locations appear. Only declared flags are used. If a location is outside the served area or cannot be matched, the concierge declines to estimate and points to the official outage map and phone line.",
    ),
    (
        "We will route you to a person.",
        "In a production system this would also route you to a person (not built in this demo).",
    ),
    (
        'else chatAdd("bot", "Could not reach the assistant: " + e.message);',
        'else chatAdd("bot", "The assistant is unavailable right now, so I can\'t answer in chat. The risk, restoration and preparation panels on this page still work. For confirmed outage information use your utility\'s official outage map or the outage phone number on your bill. If anyone is in danger, call 911.");',
    ),
    (   # older page variant (artifact.html): server messages are customer-safe; browser/network errors are not
        'chatAdd("bot", "Could not reach the assistant: " + e.message);',
        'chatAdd("bot", e.message && !/fetch|network|load failed/i.test(e.message) ? e.message : "The assistant is unavailable right now, so I can\'t answer in chat. For confirmed outage information use your utility\'s official outage map or the outage phone number on your bill. If anyone is in danger, call 911.");',
    ),
    (
        "$(\"chat_status\").textContent = data.visualizer_status\n      ? `Matched",
        "$(\"chat_status\").textContent = data.abstained ? \"No estimate: this location is outside the area the demo covers.\"\n      : data.fallback ? \"The AI service is unavailable, so this is a built-in summary of the model results.\"\n      : data.visualizer_status\n      ? `Matched",
    ),
]


def patch_html(path: Path) -> list[str]:
    """Harden one built page in place. Returns a list of what changed."""
    changed: list[str] = []
    s = path.read_text(encoding="utf-8")
    orig = s
    m = re.search(r"const DATA=(\{.*?\});\n\"use strict\";", s, re.S)
    if m:
        data = json.loads(m.group(1))
        new, dropped = harden_data(data)
        s = s[:m.start(1)] + json.dumps(new, separators=(",", ":")) + s[m.end(1):]
        changed.append(f"DATA: {len(data['prem'])} -> {len(new['prem'])} premises ({dropped} dropped)")
    r = round_facilities(s)
    if r != s:
        changed.append("facility coordinates rounded")
        s = r
    for old, new in COPY:
        if old in s:
            s = s.replace(old, new)
            changed.append("copy: " + old[:40])
    if s != orig:
        path.write_text(s, encoding="utf-8")
    return changed


def main():
    data_path = C.SITE / "data.json"
    data = json.loads(data_path.read_text(encoding="utf-8"))
    new, dropped = harden_data(data)
    data_path.write_text(json.dumps(new, separators=(",", ":")), encoding="utf-8")
    print(f"{data_path.name}: {len(data['prem'])} -> {len(new['prem'])} premises ({dropped} dropped, cells < {C.MIN_CELL_CUSTOMERS} customers)")
    for p in (C.SITE / "index.html", C.SITE / "artifact.html", C.FRONTEND / "app.js"):
        if p.exists():
            print(p.name, patch_html(p) or "no change")


if __name__ == "__main__":
    sys.exit(main())
