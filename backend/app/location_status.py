"""Full location status: visualizer model + grid topology + weather + electricity inference."""
from __future__ import annotations

from typing import Any

import httpx

from app.artifacts_loader import load_data, load_model
from app.geocode import geocode_address
from app.grid_exposure import (
    compute_exposure_risks,
    infer_electricity,
    merge_exposure_into_status,
    sample_circuit_weather_points,
    topology_summary,
)
from app.nws_weather import fetch_storm_inputs
from app.visualizer_engine import compute_status, default_storm, format_status_for_llm, resolve_premise_index


def normalize_customer_id(customer_id: str | None, premise_id: str | None) -> str | None:
    if premise_id:
        return premise_id.strip()
    if not customer_id:
        return None
    cid = customer_id.strip().upper()
    if cid.startswith("P-"):
        return cid
    if cid.isdigit():
        return f"P-{int(cid):04d}"
    return cid


def resolve_location_index(
    data: dict,
    *,
    customer_id: str | None = None,
    premise_id: str | None = None,
    latitude: float | None = None,
    longitude: float | None = None,
    address: str | None = None,
) -> tuple[int, dict[str, Any] | None]:
    meta: dict[str, Any] | None = None
    pid = normalize_customer_id(customer_id, premise_id)
    if address:
        geo = geocode_address(address)
        lon, lat = geo["longitude"], geo["latitude"]
        meta = {
            "input_address": address.strip(),
            "longitude": lon,
            "latitude": lat,
            "geocoder": geo.get("geocoder"),
            "formatted_address": geo.get("formatted_address"),
        }
        return resolve_premise_index(data, latitude=lat, longitude=lon), meta
    if pid:
        return resolve_premise_index(data, premise_id=pid), meta
    if latitude is not None and longitude is not None:
        return resolve_premise_index(data, latitude=latitude, longitude=longitude), meta
    raise ValueError("Provide customer_id, premise_id, address, or latitude+longitude.")


async def _storms_for_circuit(
    data: dict,
    premise_index: int,
    storm_base: dict,
    use_nws: bool,
    client: httpx.AsyncClient,
) -> tuple[dict[str, dict], dict[str, Any]]:
    prem = data["prem"][premise_index]
    lon, lat = prem["p"]
    weather: dict[str, Any] = {"local": {}}
    storms: dict[str, dict] = {"local": dict(storm_base)}

    if use_nws:
        local_nws = await fetch_storm_inputs(lat, lon, client=client)
        weather["local"] = {
            "source": local_nws.get("nws_source"),
            "current": {
                "max_gust_mph": local_nws["gust"],
                "rain_24h_in": local_nws["rain"],
                "snow_24h_in": local_nws["snow"],
                "rain_prior_3d_in": local_nws["ante"],
            },
            "incoming": {
                "max_gust_mph_next_24h": local_nws.get("forecast_next_24h_max_gust_mph"),
                "rain_in_hours_24_48": local_nws.get("forecast_hours_24_48_rain_in"),
            },
        }
        for key in ("gust", "rain", "snow", "ante", "leaf"):
            if key not in storms["local"]:
                storms["local"][key] = local_nws[key]

    points = sample_circuit_weather_points(data, prem["c"])
    weather["feeder_sample_points"] = points
    for i, pt in enumerate(points):
        label = f"feeder_cell_{i + 1}"
        st = dict(storms["local"])
        if use_nws:
            nws = await fetch_storm_inputs(pt["latitude"], pt["longitude"], client=client)
            st = {**st, **{k: nws[k] for k in ("gust", "rain", "snow", "ante", "leaf")}}
            pt["weather"] = {
                "max_gust_mph": nws["gust"],
                "rain_24h_in": nws["rain"],
                "incoming_max_gust_mph": nws.get("forecast_next_24h_max_gust_mph"),
            }
        storms[label] = st

    for j in range(len(data["prem"])):
        if j == premise_index:
            continue
        peer = data["prem"][j]
        if peer["c"] != prem["c"] or peer["ch"] != prem["ch"] or peer["z"] != prem["z"]:
            continue
        plon, plat = peer["p"]
        st = dict(storms["local"])
        if use_nws:
            nws = await fetch_storm_inputs(plat, plon, client=client)  # lat, lon
            st = {**st, **{k: nws[k] for k in ("gust", "rain", "snow", "ante", "leaf")}}
        storms[f"peer_{peer['id']}"] = st

    return storms, weather


async def build_location_status(
    premise_index: int,
    storm: dict | None = None,
    scenario: dict | None = None,
    use_nws: bool = False,
    scan_feeder_weather: bool = True,
) -> dict[str, Any]:
    model = load_model()
    data = load_data()
    storm_base: dict[str, Any] = {**default_storm(), **(storm or {})}
    weather_report: dict[str, Any] = {}

    async with httpx.AsyncClient(timeout=25.0) as client:
        if use_nws or scan_feeder_weather:
            storms, weather_report = await _storms_for_circuit(
                data, premise_index, storm_base, use_nws or scan_feeder_weather, client
            )
        else:
            storms = {"local": storm_base}

    status = compute_status(model, data, premise_index, storm=storms.get("local", storm_base), scenario=scenario)
    topology = topology_summary(data, premise_index)
    exposure = compute_exposure_risks(model, data, premise_index, storms["local"], storms)
    electricity = infer_electricity(
        status, exposure, scenario_damage=status["restoration"]["scenario_has_damage"]
    )
    merge_exposure_into_status(status, topology, exposure, electricity)
    if weather_report:
        status["weather"] = weather_report
    status["customer_id"] = status["premise_id"]
    return status


def format_location_status_for_llm(status: dict) -> str:
    lines = [format_status_for_llm(status)]
    grid = status.get("grid") or {}
    exp = status.get("upstream_exposure") or {}
    wx = status.get("weather") or {}
    elec = status.get("electricity") or {}

    lines.append(f"Grid topology: {grid.get('exposure_note', '')}")
    if exp.get("upstream_exceeds_local"):
        lines.append(
            "Upstream feeder: storm conditions elsewhere on your circuit raise the modeled interruption chance "
            f"from {exp.get('local_risk_band')} (local only) to {exp.get('combined_risk_band')} "
            f"({exp.get('combined_display')} including upstream exposure)."
        )
    loc = wx.get("local") or {}
    if loc:
        cur = loc.get("current") or {}
        inc = loc.get("incoming") or {}
        lines.append(
            f"Weather at your area (NWS): gust {cur.get('max_gust_mph')} mph, rain {cur.get('rain_24h_in')} in (24h); "
            f"incoming next 24h gust up to {inc.get('max_gust_mph_next_24h')} mph."
        )
    lines.append(
        f"Electricity (model only, not confirmed): {elec.get('model_inference')} — {elec.get('summary', '')}"
    )
    return "\n".join(lines)
