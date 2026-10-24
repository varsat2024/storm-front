"""Fetch storm slider values from api.weather.gov (same idea as frontend loadNWS)."""
from __future__ import annotations

import re
from datetime import datetime, timezone

import httpx

NWS = "https://api.weather.gov"
MM_IN = 1 / 25.4
KMH_MPH = 0.621371


def _iso_dur_h(d: str) -> float:
    m = re.match(r"P(?:(\d+)D)?(?:T(?:(\d+)H)?)?", d) or []
    return (int(m.group(1) or 0) * 24 + int(m.group(2) or 0)) or 1


def _grid_series(prop: dict | None) -> list[dict]:
    out = []
    for v in (prop or {}).get("values") or []:
        if v.get("value") is None:
            continue
        t, d = v["validTime"].split("/")
        a = datetime.fromisoformat(t.replace("Z", "+00:00")).timestamp() * 1000
        b = a + _iso_dur_h(d) * 3600_000
        out.append({"a": a, "b": b, "v": v["value"]})
    return out


def _overlap(x: dict, a: float, b: float) -> float:
    return max(0, min(x["b"], b) - max(x["a"], a)) / (x["b"] - x["a"])


async def fetch_storm_inputs(lat: float, lon: float, client: httpx.AsyncClient | None = None) -> dict:
    lat_s, lon_s = f"{lat:.2f}", f"{lon:.2f}"
    own = client is None
    if own:
        client = httpx.AsyncClient(timeout=20.0, headers={"Accept": "application/geo+json"})
    try:
        pt = (await client.get(f"{NWS}/points/{lat_s},{lon_s}")).json()["properties"]
        grid = (await client.get(pt["forecastGridData"])).json()["properties"]
        stn_ids = [
            f["properties"]["stationIdentifier"]
            for f in (await client.get(pt["observationStations"])).json().get("features", [])[:3]
        ]
        now = datetime.now(timezone.utc).timestamp() * 1000
        gust = rain_f = snow_f = 0.0
        for x in _grid_series(grid.get("windGust")):
            if _overlap(x, now, now + 864_000) > 0:
                gust = max(gust, x["v"] * KMH_MPH)
        for x in _grid_series(grid.get("quantitativePrecipitation")):
            rain_f += x["v"] * MM_IN * _overlap(x, now, now + 864_000)
        for x in _grid_series(grid.get("snowfallAmount")):
            snow_f += x["v"] * MM_IN * _overlap(x, now, now + 864_000)
        rain24 = rain3d = obs_gust = 0.0
        used = "forecast only"
        for sid in stn_ids:
            try:
                start = datetime.fromtimestamp((now - 72 * 3600_000) / 1000, tz=timezone.utc).isoformat()
                obs = (
                    await client.get(f"{NWS}/stations/{sid}/observations", params={"start": start, "limit": 300})
                ).json()
                hours: dict[int, float] = {}
                for f in obs.get("features", []):
                    q = f["properties"]
                    t = datetime.fromisoformat(q["timestamp"].replace("Z", "+00:00")).timestamp() * 1000
                    wg = q.get("windGust") or {}
                    w = wg.get("value")
                    if w is not None and now - t < 864_000:
                        obs_gust = max(obs_gust, w * 2.23694 if "m_s" in (wg.get("unitCode") or "") else w * KMH_MPH)
                    pr = (q.get("precipitationLastHour") or {}).get("value")
                    if pr is not None:
                        hours[int(t // 3_600_000)] = pr
                if hours:
                    for h, pr in hours.items():
                        age = now - h * 3_600_000
                        if age < 864_000:
                            rain24 += pr * MM_IN
                        else:
                            rain3d += pr * MM_IN
                    used = f"station {sid}"
                    break
            except Exception:
                continue
        incoming_gust = gust
        incoming_rain = rain_f
        for x in _grid_series(grid.get("windGust")):
            if _overlap(x, now + 864_000, now + 2 * 864_000) > 0:
                incoming_gust = max(incoming_gust, x["v"] * KMH_MPH)
        for x in _grid_series(grid.get("quantitativePrecipitation")):
            incoming_rain += x["v"] * MM_IN * _overlap(x, now + 864_000, now + 2 * 864_000)

        month = datetime.now().month
        leaf = 1 if 4 <= month <= 9 else 0
        return {
            "gust": max(gust, obs_gust),
            "rain": max(rain24, rain_f),
            "snow": snow_f,
            "ante": rain3d,
            "leaf": leaf,
            "nws_source": used,
            "forecast_next_24h_max_gust_mph": round(incoming_gust, 1),
            "forecast_hours_24_48_rain_in": round(incoming_rain, 2),
        }
    finally:
        if own:
            await client.aclose()
