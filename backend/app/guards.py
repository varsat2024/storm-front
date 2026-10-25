"""Input and coverage guards: decide *before* any model or LLM call whether the system can answer reliably.

Pure Python (no FastAPI / boto3 imports) so the logic is easy to unit-test.

Abstain policy
--------------
The demo only has data for the Roanoke, VA service area. An address elsewhere in the US still geocodes, and the
old code then matched it to the nearest of the demo premises and answered as if it were reliable. These guards
make the system decline instead and point the customer to official channels.
"""
from __future__ import annotations

import math
import re
import unicodedata
from typing import Any

# ---- limits ---------------------------------------------------------------------------------------------------
MAX_MESSAGES = 24             # most recent turns kept from the client-supplied history
MAX_USER_CHARS = 2000
MAX_ASSISTANT_CHARS = 6000    # history only; replies are capped by MAX_TOKENS
MAX_ADDRESS_CHARS = 200

# ---- coverage -------------------------------------------------------------------------------------------------
COVERAGE_RADIUS_KM = 1.5      # a location farther than this from every served 400 m cell is "outside the area"
MATCH_CLOSE_KM = 1.5          # nearest demo premise within this distance: "close" match
MATCH_MAX_KM = 8.0            # beyond this the nearest demo premise is not representative: abstain

OFFICIAL_CHANNELS = (
    "your utility's official outage map or the outage phone number on your bill"
)

_MESSAGES = {
    "out_of_area": (
        "That location is outside the area this demo has data for (the Roanoke, VA area), so I can't "
        "estimate outage risk or restoration time for it. For confirmed outage information, use "
        + OFFICIAL_CHANNELS + ". If anyone is in danger, call 911."
    ),
    "no_nearby_premise": (
        "I don't have a close enough match for that location in the demo data, so I can't give a "
        "reliable outage estimate. For confirmed outage information, use " + OFFICIAL_CHANNELS +
        ". If anyone is in danger, call 911."
    ),
    "geocoder_unavailable": (
        "I couldn't look up that address right now, so I can't give an outage estimate. Please try again "
        "in a few minutes. For confirmed outage information, use " + OFFICIAL_CHANNELS +
        ". If anyone is in danger, call 911."
    ),
}


class Abstain(ValueError):
    """The system should decline to estimate. Subclasses ValueError so older `except ValueError` paths still catch it."""

    def __init__(self, reason: str, detail: str = ""):
        self.reason = reason
        self.detail = detail
        self.message = _MESSAGES.get(reason, _MESSAGES["out_of_area"])
        super().__init__(self.message)

    def payload(self) -> dict[str, Any]:
        return {"abstain": True, "reason": self.reason, "message": self.message}


# ---- geometry -------------------------------------------------------------------------------------------------
def km_between(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    k = 111.32
    dx = (lon1 - lon2) * k * math.cos(math.radians((lat1 + lat2) / 2))
    dy = (lat1 - lat2) * k
    return math.hypot(dx, dy)


def nearest_cell_km(data: dict, lon: float, lat: float) -> float:
    """Distance from a point to the nearest served 400 m cell centre (cells are [lon0, lat0, customers, damage, circuit])."""
    cw, ch = data.get("cell_size", [0.0045, 0.0036])
    best = float("inf")
    for c in data["cells"]:
        d = km_between(lon, lat, c[0] + cw / 2, c[1] + ch / 2)
        if d < best:
            best = d
    return best


def nearest_premise(data: dict, lon: float, lat: float) -> tuple[int, float]:
    best_i, best_d = 0, float("inf")
    for i, p in enumerate(data["prem"]):
        d = km_between(lon, lat, p["p"][0], p["p"][1])
        if d < best_d:
            best_i, best_d = i, d
    return best_i, best_d


def match_quality(distance_km: float) -> str:
    return "close" if distance_km <= MATCH_CLOSE_KM else "approximate"


def locate(data: dict, lon: float, lat: float) -> tuple[int, dict[str, Any]]:
    """Return (premise_index, match_meta) for a coordinate, or raise Abstain.

    Order matters: first "is this inside the served area at all", then "is there a representative demo premise".
    """
    if not (math.isfinite(lon) and math.isfinite(lat)):
        raise Abstain("out_of_area", "non-finite coordinates")
    d_cell = nearest_cell_km(data, lon, lat)
    if d_cell > COVERAGE_RADIUS_KM:
        raise Abstain("out_of_area", f"{d_cell:.1f} km from nearest served cell")
    idx, d_prem = nearest_premise(data, lon, lat)
    if d_prem > MATCH_MAX_KM:
        raise Abstain("no_nearby_premise", f"{d_prem:.1f} km to nearest demo premise")
    return idx, {
        "match_distance_km": round(d_prem, 1),
        "match_quality": match_quality(d_prem),
        "nearest_served_cell_km": round(d_cell, 2),
    }


# ---- text hygiene ---------------------------------------------------------------------------------------------
_CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f​-‏‪-‮⁦-⁩]")
_INJECTION_HINTS = re.compile(
    r"ignore (all |any |the )?(previous|prior|above)|system prompt|you are now|disregard (the )?(rules|instructions)|"
    r"reveal (your )?(prompt|instructions)|developer mode|jailbreak",
    re.I,
)


def clean_text(text: str, max_chars: int) -> str:
    """Normalise unicode, strip control / bidi characters, collapse runs of blank space, truncate."""
    t = unicodedata.normalize("NFKC", text or "")
    t = _CTRL.sub("", t)
    t = re.sub(r"[ \t]+", " ", t)
    t = re.sub(r"\n{3,}", "\n\n", t).strip()
    return t[:max_chars]


def looks_like_injection(text: str) -> bool:
    """Heuristic used for the audit log only; it never blocks (the system prompt and structure do the defending)."""
    return bool(_INJECTION_HINTS.search(text or ""))


def validate_messages(messages: list[dict]) -> list[dict]:
    """Validate and clean a client-supplied conversation. Raises ValueError with a customer-safe message."""
    if not messages:
        raise ValueError("messages list cannot be empty.")
    cleaned: list[dict] = []
    for m in messages[-MAX_MESSAGES:]:
        role = m.get("role")
        if role not in ("user", "assistant"):
            raise ValueError("Each message needs a role of 'user' or 'assistant'.")
        limit = MAX_USER_CHARS if role == "user" else MAX_ASSISTANT_CHARS
        raw = m.get("content") or ""
        if role == "user" and len(raw) > MAX_USER_CHARS:
            raise ValueError(f"Messages are limited to {MAX_USER_CHARS} characters. Please shorten your question.")
        content = clean_text(raw, limit)
        if not content:
            raise ValueError("Messages cannot be empty.")
        cleaned.append({"role": role, "content": content})
    while cleaned and cleaned[0]["role"] != "user":   # Bedrock requires the conversation to start with a user turn
        cleaned.pop(0)
    if not cleaned or cleaned[-1]["role"] != "user":
        raise ValueError("The last message must be from the customer.")
    return cleaned
