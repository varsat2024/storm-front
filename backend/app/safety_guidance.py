"""Vetted, deterministic preparation and safety guidance.

Safety-critical wording is fixed here rather than left to the LLM. The LLM is told to use these items (and not to invent
electrical or medical advice); when the LLM is unavailable the same items are used in the deterministic fallback reply.
The rules mirror the visualizer's "Prepare and stay safe" panel: tied to the risk band, whether the estimate runs past
24 hours, and *declared* needs only (nothing is inferred about a customer).
"""
from __future__ import annotations

from typing import Any

EMERGENCY = [
    "Treat every downed power line as live: stay at least 30 feet away, call 911 if anyone is in danger, then call your utility.",
    "Never run a generator, grill or camp stove indoors or in a garage; carbon monoxide can kill. Keep generators outdoors, away from doors and windows.",
]

BASIC_PREP = [
    "Charge phones and power banks, and keep flashlights where you can find them.",
    "Fill water containers and set aside shelf-stable food.",
]
ELEVATED_PREP = [
    "Know where your breaker panel and manual garage-door release are.",
]
LONG_OUTAGE_PREP = [
    "Keep fridge and freezer doors closed to hold the cold.",
    "Plan where you could stay if the outage runs past a day.",
    "Keep about a week of essential medications on hand.",
]
LIFE_SUPPORT = (
    "Someone at this address has been declared as relying on life-support equipment. Have backup power or a backup "
    "location ready now, talk to your equipment provider about backup options, do not rely on alerts alone, and call "
    "911 for a medical emergency. Ask your utility whether it has a medical or critical-care customer program."
)

# Needs the customer may *declare*. Nothing here is inferred.
DECLARED_NEEDS: dict[str, str] = {
    "medical_device": LIFE_SUPPORT,
    "medical_refrigeration": "You told us you keep medication that needs refrigeration: plan a cooler with ice packs and know where you could store it if the outage runs long.",
    "mobility": "You told us mobility is a concern: plan how you would leave safely if elevators or powered equipment stop working, and tell a neighbour or family member your plan.",
    "hearing_or_vision": "You told us hearing or vision is a concern: set up a battery-powered radio or flashlight you can use without sight, and ask a contact to check in by phone or text.",
}


def build_guidance(status: dict[str, Any], declared_needs: list[str] | None = None) -> dict[str, list[str]]:
    """Return {"emergency": [...], "prepare": [...], "declared": [...]} for a computed status."""
    band = status["outage_risk"]["band"]
    hi_hours = status["restoration"]["estimate_hours"]["high"]
    long_est = hi_hours >= 24 and status["restoration"].get("scenario_has_damage", False)
    prepare = list(BASIC_PREP)
    if band != "Low":
        prepare += ELEVATED_PREP
    if long_est:
        prepare += LONG_OUTAGE_PREP

    declared: list[str] = []
    needs = list(dict.fromkeys(declared_needs or []))
    if status.get("life_support_declared") and "medical_device" not in needs:
        needs.insert(0, "medical_device")
    for n in needs:
        if n in DECLARED_NEEDS:
            declared.append(DECLARED_NEEDS[n])
    return {"emergency": list(EMERGENCY), "prepare": prepare, "declared": declared}


def format_guidance_for_llm(status: dict[str, Any], declared_needs: list[str] | None = None) -> str:
    g = build_guidance(status, declared_needs)
    lines = ["Vetted guidance (use these items; do not invent other electrical, medical or generator safety advice):"]
    lines += [f"- SAFETY (always lead with this): {s}" for s in g["emergency"]]
    lines += [f"- PREPARE: {s}" for s in g["prepare"]]
    lines += [f"- DECLARED NEED: {s}" for s in g["declared"]]
    return "\n".join(lines)


def deterministic_reply(status: dict[str, Any], declared_needs: list[str] | None = None, reason: str = "") -> str:
    """Plain-language reply built only from the computed status and vetted guidance (used when the LLM is unavailable)."""
    o, r, al = status["outage_risk"], status["restoration"], status["alerts"]
    ex = status.get("explanation", {})
    g = build_guidance(status, declared_needs)
    lines = [
        "**Safety first**",
        *[f"- {s}" for s in g["emergency"]],
        "",
        "**What the model estimates** (a model estimate, not a confirmed utility report)",
        f"- Outage risk: **{o['band']}** (about {o['probability_display']}; 80% range {o['interval_80pct']['display']}; confidence {o['confidence']}).",
    ]
    if r.get("scenario_has_damage"):
        lines.append(f"- If the damage you entered occurred, restoration is estimated at **{r['estimate_range']}** once crews can safely start. This is a range, not a promise.")
    else:
        lines.append("- No damage scenario is entered, so there is no restoration estimate to give yet.")
    lines.append(f"- Pre-storm alerts: {'you qualify' if al['pre_storm_eligible'] else 'not yet (risk is Low)'}.")
    factors = ex.get("top_factors") or []
    if factors:
        lines.append("- Biggest factors: " + "; ".join(f"{f['factor'].lower()} {f['direction']} expected damage by about {abs(f['effect_pct'])}%" for f in factors) + ".")
    for a in ex.get("assumptions", [])[:2]:
        lines.append(f"- Assumption: {a}")
    lines += ["", "**How to prepare**", *[f"- {s}" for s in g["prepare"]], *[f"- {s}" for s in g["declared"]]]
    lines += ["", f"For confirmed outage information use your utility's official outage map or the outage phone number on your bill."]
    return "\n".join(lines)
