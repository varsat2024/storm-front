"""Resolve a free-text address to (longitude, latitude) for premise matching."""
from __future__ import annotations

import json
import urllib.parse
import urllib.request

from app.config import MAPBOX_ACCESS_TOKEN

MAPBOX_GEOCODE_URL = "https://api.mapbox.com/search/geocode/v6/forward"


def geocode_address(address: str, timeout: float = 15.0) -> dict:
    """
    Returns longitude, latitude, geocoder name, and optional formatted_address.
    Uses Mapbox v6 forward when MAPBOX_ACCESS_TOKEN is set; otherwise US Census.
    """
    text = address.strip()
    if not text:
        raise ValueError("Address is empty.")
    if MAPBOX_ACCESS_TOKEN:
        return _mapbox_geocode(text, timeout)
    return _census_geocode(text, timeout)


def geocode_oneline_address(address: str, timeout: float = 15.0) -> tuple[float, float]:
    g = geocode_address(address, timeout=timeout)
    return g["longitude"], g["latitude"]


def _mapbox_geocode(address: str, timeout: float) -> dict:
    q = urllib.parse.urlencode(
        {
            "q": address,
            "access_token": MAPBOX_ACCESS_TOKEN,
            "limit": "1",
            "country": "us",
        }
    )
    url = f"{MAPBOX_GEOCODE_URL}?{q}"
    req = urllib.request.Request(url, headers={"User-Agent": "storm-front-outage-concierge/0.1"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = json.loads(resp.read().decode())
    features = body.get("features") or []
    if not features:
        raise ValueError(f"No geocode match for address: {address!r}")
    feat = features[0]
    coords = feat.get("geometry", {}).get("coordinates")
    if not coords or len(coords) < 2:
        raise ValueError(f"Mapbox returned no coordinates for address: {address!r}")
    props = feat.get("properties") or {}
    formatted = props.get("full_address") or props.get("place_formatted") or props.get("name")
    return {
        "longitude": float(coords[0]),
        "latitude": float(coords[1]),
        "formatted_address": formatted,
        "geocoder": "mapbox",
    }


def _census_geocode(address: str, timeout: float) -> dict:
    q = urllib.parse.urlencode(
        {
            "address": address,
            "benchmark": "Public_AR_Current",
            "format": "json",
        }
    )
    url = f"https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?{q}"
    req = urllib.request.Request(url, headers={"User-Agent": "storm-front-outage-concierge/0.1"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = json.loads(resp.read().decode())
    matches = body.get("result", {}).get("addressMatches") or []
    if not matches:
        raise ValueError(f"No geocode match for address: {address!r}")
    coords = matches[0]["coordinates"]
    matched = matches[0].get("matchedAddress")
    return {
        "longitude": float(coords["x"]),
        "latitude": float(coords["y"]),
        "formatted_address": matched,
        "geocoder": "us_census",
    }
