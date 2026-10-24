"""Upstream feeder / protection-zone exposure (AEP topology as in matched_upstream.txt)."""
from __future__ import annotations

import math
from typing import Any

from app.visualizer_engine import _band_of, _pc, _risk


def _cell_centre(cell: list) -> tuple[float, float]:
    lon0, lat0 = cell[0], cell[1]
    return lon0, lat0


def circuit_cells(data: dict, circuit_index: int) -> list[list]:
    return [c for c in data["cells"] if c[4] == circuit_index]


def sample_circuit_weather_points(data: dict, circuit_index: int, max_points: int = 5) -> list[dict]:
    """Spread sample points along the circuit for NWS (storm may hit feeder elsewhere)."""
    cells = circuit_cells(data, circuit_index)
    if not cells:
        return []
    cells = sorted(cells, key=lambda c: (c[0], c[1]))
    if len(cells) <= max_points:
        chosen = cells
    else:
        step = (len(cells) - 1) / (max_points - 1)
        chosen = [cells[round(i * step)] for i in range(max_points)]
    out = []
    for c in chosen:
        lon, lat = _cell_centre(c)
        out.append(
            {
                "longitude": lon,
                "latitude": lat,
                "customers_in_cell": c[2],
                "historical_damage_records": c[3],
            }
        )
    return out


def zone_peer_indices(data: dict, premise_index: int) -> list[int]:
    """Premises sharing the same upstream isolating path and protection-zone size."""
    prem = data["prem"][premise_index]
    key = (prem["c"], prem["ch"], prem["z"])
    return [i for i, p in enumerate(data["prem"]) if (p["c"], p["ch"], p["z"]) == key]


def topology_summary(data: dict, premise_index: int) -> dict[str, Any]:
    prem = data["prem"][premise_index]
    peers = zone_peer_indices(data, premise_index)
    circ = data["circ"][prem["c"]]
    if prem["nd"]:
        zone_desc = (
            f"{prem['z']} customers on your side of the nearest fuse/recloser "
            f"(path: {prem['ch']}). Damage anywhere in that zone can interrupt your service."
        )
    else:
        zone_desc = (
            f"No fuse or recloser upstream in the topology file — model uses the full circuit "
            f"({circ['n']} customers) as the exposure zone."
        )
    return {
        "upstream_device_path": prem["ch"],
        "isolating_devices_upstream": int(prem["nd"]),
        "protection_zone_customers": prem["z"] if prem["nd"] else circ["n"],
        "step_transformer_on_service": bool(prem["st"]),
        "zone_peer_premises": len(peers),
        "exposure_note": zone_desc,
        "downstream_of_feeder": True,
    }


def compute_exposure_risks(
    model: dict,
    data: dict,
    premise_index: int,
    storm_local: dict,
    storms_by_label: dict[str, dict] | None = None,
) -> dict[str, Any]:
    """
    Compare local storm risk vs risk if weather matches harsher points on the same circuit
    (customer can lose power from upstream damage while local skies are calmer).
    """
    prem = data["prem"][premise_index]
    local_x = _risk(prem, storm_local, model, data)
    local_p = local_x["P"]
    local_band = _band_of(local_p, model["bands"]["cuts"], model["bands"]["names"])

    storms_by_label = storms_by_label or {"local": storm_local}
    feeder_p = local_p
    feeder_label = "local"
    feeder_storm = storm_local
    for label, st in storms_by_label.items():
        if label == "local":
            continue
        p = _risk(prem, st, model, data)["P"]
        if p > feeder_p:
            feeder_p, feeder_label, feeder_storm = p, label, st

    zone_max_p = local_p
    zone_from = prem["id"]
    for j in zone_peer_indices(data, premise_index):
        if j == premise_index:
            continue
        peer = data["prem"][j]
        st = storms_by_label.get(f"peer_{peer['id']}", storm_local)
        p = _risk(prem, st, model, data)["P"]
        if p > zone_max_p:
            zone_max_p, zone_from = p, peer["id"]

    combined_p = max(local_p, feeder_p, zone_max_p)
    combined_band = _band_of(combined_p, model["bands"]["cuts"], model["bands"]["names"])
    return {
        "local_outage_probability": local_p,
        "local_risk_band": local_band,
        "feeder_worst_outage_probability": feeder_p,
        "feeder_worst_point": feeder_label,
        "feeder_worst_storm": {
            "gust_mph": feeder_storm.get("gust"),
            "rain_24h_in": feeder_storm.get("rain"),
        },
        "zone_peer_max_outage_probability": zone_max_p,
        "zone_peer_reference_premise": zone_from,
        "combined_outage_probability": combined_p,
        "combined_risk_band": combined_band,
        "combined_display": _pc(combined_p),
        "upstream_exceeds_local": combined_p > local_p + 0.02,
    }


def infer_electricity(status: dict, exposure: dict, scenario_damage: bool) -> dict[str, Any]:
    p = max(
        status["outage_risk"]["probability"],
        exposure.get("combined_outage_probability", 0),
    )
    if scenario_damage and p >= 0.2:
        inference = "modeled_outage_likely"
        summary = "Damage scenario entered; model treats an active repair event on your branch or zone."
    elif p >= 0.45:
        inference = "modeled_outage_likely"
        summary = "High modeled probability of an interruption affecting your protection zone."
    elif p >= 0.12:
        inference = "modeled_outage_possible"
        summary = "Outage is possible, including from upstream feeder damage outside your immediate weather."
    else:
        inference = "modeled_likely_serving"
        summary = "Low modeled outage chance at this time; not a confirmation that power is on."
    return {
        "confirmed_from_utility_oms": False,
        "model_inference": inference,
        "summary": summary,
        "disclaimer": "This demo has no live outage-management or meter feed. Use the utility outage map or phone line to confirm.",
    }


def merge_exposure_into_status(status: dict, topology: dict, exposure: dict, electricity: dict) -> dict:
    status["grid"] = topology
    status["upstream_exposure"] = exposure
    status["electricity"] = electricity
    if exposure.get("upstream_exceeds_local"):
        status["outage_risk"]["band"] = exposure["combined_risk_band"]
        status["outage_risk"]["probability"] = exposure["combined_outage_probability"]
        status["outage_risk"]["probability_display"] = exposure["combined_display"]
        status["outage_risk"]["includes_upstream_feeder"] = True
    else:
        status["outage_risk"]["includes_upstream_feeder"] = False
    return status
