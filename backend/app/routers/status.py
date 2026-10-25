from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field, model_validator

from app.guards import Abstain
from app.location_status import build_location_status, resolve_location_index
from app.artifacts_loader import load_data

router = APIRouter(prefix="/status", tags=["status"])


class StormBody(BaseModel):
    gust: float | None = Field(None, ge=0, le=120, description="Peak wind gust (mph)")
    rain: float | None = Field(None, ge=0, description="Rain past 24h (in)")
    snow: float | None = Field(None, ge=0, description="Snow past 24h (in)")
    ante: float | None = Field(None, ge=0, description="Rain in previous 3 days (in)")
    leaf: bool | None = None


class ScenarioBody(BaseModel):
    n_pole: float = Field(1, ge=0, le=200)
    n_arm: float = Field(1, ge=0, le=200)
    n_xf: float = Field(0, ge=0, le=200)
    n_ins: float = Field(3, ge=0, le=200)
    n_wire: float = Field(2, ge=0, le=200)
    n_rec: float = Field(0, ge=0, le=200)
    asset_group: Literal["Secondary wire", "Pole", "Fuse bank", "Transformer", "Other"] = "Pole"
    damage_location: str = Field("branch", pattern="^(branch|other)$")
    cr: int = Field(3, ge=1, le=8)
    mu: float | None = Field(None, ge=1, le=10)
    access_blocked: bool = False


class StatusRequest(BaseModel):
    customer_id: str | None = Field(None, description="Same as visualizer premise id, e.g. P-0001 or 1 → P-0001")
    premise_id: str | None = None
    latitude: float | None = Field(None, ge=-90, le=90)
    longitude: float | None = Field(None, ge=-180, le=180)
    address: str | None = Field(None, min_length=3, max_length=200, description="US street address; geocoded, checked against the served area, then matched to a nearby demo premise")
    use_nws: bool = Field(
        False,
        description="Fill storm sliders from NWS at your location (and feeder sample points when scan_feeder_weather is true)",
    )
    scan_feeder_weather: bool = Field(
        True,
        description="Sample weather along the circuit to detect upstream-storm / downstream-customer exposure",
    )
    storm: StormBody | None = None
    scenario: ScenarioBody | None = None

    @model_validator(mode="after")
    def _location_required(self):
        has_id = bool(self.premise_id or self.customer_id)
        has_ll = self.latitude is not None and self.longitude is not None
        has_addr = bool(self.address and self.address.strip())
        if sum([has_id, has_ll, has_addr]) != 1:
            raise ValueError("Provide exactly one of: customer_id/premise_id, latitude+longitude, or address.")
        return self


async def _resolve_and_compute(body: StatusRequest) -> dict[str, Any]:
    data = load_data()
    try:
        idx, geo = resolve_location_index(
            data,
            customer_id=body.customer_id,
            premise_id=body.premise_id,
            latitude=body.latitude,
            longitude=body.longitude,
            address=body.address,
        )
    except Abstain as e:
        # Outside the served area / no representative premise / geocoder down: decline rather than answer from a bad match.
        raise HTTPException(status_code=503 if e.reason == "geocoder_unavailable" else 422, detail=e.message) from e
    except ValueError as e:
        if body.address:
            raise HTTPException(status_code=404, detail=str(e)) from e
        raise HTTPException(status_code=400, detail=str(e)) from e

    storm: dict[str, Any] = {}
    if body.storm:
        storm = {k: v for k, v in body.storm.model_dump().items() if v is not None}

    scenario = body.scenario.model_dump() if body.scenario else None
    status = await build_location_status(
        idx,
        storm=storm or None,
        scenario=scenario,
        use_nws=body.use_nws,
        scan_feeder_weather=body.scan_feeder_weather,
    )
    if geo:
        status["geocode"] = geo
        status["match_note"] = (
            f"Address geocoded and matched to demo customer {status['customer_id']} "
            f"(≈400 m cell used in the visualizer)."
        )
    return status


@router.post("", response_model=dict)
async def status_post(body: StatusRequest):
    """
    Location status for chat and integrations: model risk, grid topology, weather, electricity inference.

    Pick one locator: `customer_id` / `premise_id`, lat/lon, or US `address`.
    """
    return await _resolve_and_compute(body)


@router.get("", response_model=dict)
async def status_get(
    customer_id: str | None = Query(None, description="Demo customer id, e.g. P-0001"),
    premise_id: str | None = Query(None),
    latitude: float | None = Query(None),
    longitude: float | None = Query(None),
    address: str | None = Query(None),
    use_nws: bool = Query(False),
    scan_feeder_weather: bool = Query(True),
    gust: float | None = Query(None),
    rain: float | None = Query(None),
    snow: float | None = Query(None),
    ante: float | None = Query(None),
    leaf: bool | None = Query(None),
):
    try:
        body = StatusRequest(
            customer_id=customer_id,
            premise_id=premise_id,
            latitude=latitude,
            longitude=longitude,
            address=address,
            use_nws=use_nws,
            scan_feeder_weather=scan_feeder_weather,
            storm=StormBody(gust=gust, rain=rain, snow=snow, ante=ante, leaf=leaf)
            if any(v is not None for v in (gust, rain, snow, ante, leaf))
            else None,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    return await _resolve_and_compute(body)
