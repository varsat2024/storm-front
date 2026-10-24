"""Fetch daily weather for the service territory from the Open-Meteo historical (ERA5) archive.

Needs outbound HTTPS to archive-api.open-meteo.com, which was NOT reachable from the sandbox
this pipeline was developed in, so this module has not been run against the live API.
It writes data/raw/weather_daily.csv, which train_severity.py uses when present.

Usage:  python weather.py --start 2022-10-01 --end 2026-08-31
"""
import argparse
import json
import urllib.parse
import urllib.request

import numpy as np
import pandas as pd

import config as C

POINTS = [(37.10, -80.10), (37.25, -79.95), (37.40, -79.80)]  # spread across the footprint
VARS = ["wind_gusts_10m_max", "precipitation_sum", "snowfall_sum"]


def fetch(start, end, points=POINTS, timeout=60):
    frames = []
    for lat, lon in points:
        q = urllib.parse.urlencode({
            "latitude": lat, "longitude": lon, "start_date": start, "end_date": end,
            "daily": ",".join(VARS), "wind_speed_unit": "mph", "precipitation_unit": "inch",
            "timezone": "America/New_York"})
        with urllib.request.urlopen(f"https://archive-api.open-meteo.com/v1/archive?{q}", timeout=timeout) as r:
            d = json.load(r)["daily"]
        frames.append(pd.DataFrame(d).set_index("time"))
    stack = np.stack([f[VARS].values.astype(float) for f in frames])
    out = pd.DataFrame(index=frames[0].index)
    out["gust"] = np.nanmax(stack[:, :, 0], axis=0)      # worst gust anywhere in the territory
    out["rain"] = np.nanmean(stack[:, :, 1], axis=0)     # territory-average precipitation
    out["snow"] = np.nanmean(stack[:, :, 2], axis=0)
    out.index = pd.to_datetime(out.index)
    return out


def add_features(w):
    w = w.copy()
    w["ante"] = w.rain.rolling(3).sum().shift(1).fillna(0.0)  # rain over the previous 3 days
    w["leaf"] = w.index.month.isin([5, 6, 7, 8, 9, 10]).astype(float)
    return w


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="2022-10-01")
    ap.add_argument("--end", default="2026-08-31")
    a = ap.parse_args()
    w = add_features(fetch(a.start, a.end))
    C.WEATHER_CSV.parent.mkdir(parents=True, exist_ok=True)
    w.to_csv(C.WEATHER_CSV, index_label="date")
    print(f"wrote {len(w)} days to {C.WEATHER_CSV}")


if __name__ == "__main__":
    main()
