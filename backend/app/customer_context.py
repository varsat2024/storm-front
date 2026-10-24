"""Resolve customer location and attach full location status for the chat API."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, model_validator

from app.location_status import build_location_status, format_location_status_for_llm, resolve_location_index
from app.artifacts_loader import load_data


class StormContext(BaseModel):
    gust: float | None = None
    rain: float | None = None
    snow: float | None = None
    ante: float | None = None
    leaf: bool | None = None


class ScenarioContext(BaseModel):
    n_pole: float | None = None
    n_arm: float | None = None
    n_xf: float | None = None
    n_ins: float | None = None
    n_wire: float | None = None
    n_rec: float | None = None
    asset_group: str | None = None
    damage_location: str | None = None
    cr: int | None = None
    mu: float | None = None
    access_blocked: bool | None = None


class CustomerContext(BaseModel):
    customer_id: str | None = Field(None, description="Demo id P-0001, or numeric 1 → P-0001")
    premise_id: str | None = None
    latitude: float | None = Field(None, ge=-90, le=90)
    longitude: float | None = Field(None, ge=-180, le=180)
    address: str | None = None
    use_nws: bool = Field(True, description="Pull current/incoming weather from NWS when locating the customer")
    scan_feeder_weather: bool = Field(
        True,
        description="Check weather along the feeder for upstream-storm effects on downstream customers",
    )
    storm: StormContext | None = None
    scenario: ScenarioContext | None = None

    @model_validator(mode="after")
    def _at_most_one_location(self):
        has_id = bool(self.premise_id or self.customer_id)
        has_ll = self.latitude is not None and self.longitude is not None
        has_addr = bool(self.address and self.address.strip())
        if sum([has_id, has_ll, has_addr]) > 1:
            raise ValueError(
                "Provide at most one of customer_id/premise_id, latitude+longitude, or address in customer context."
            )
        return self


async def build_customer_context_block(ctx: CustomerContext) -> tuple[str, dict[str, Any] | None]:
    has_loc = bool(ctx.premise_id or ctx.customer_id) or (
        ctx.latitude is not None and ctx.longitude is not None
    ) or bool(ctx.address and ctx.address.strip())
    if not has_loc:
        return "", None

    data = load_data()
    try:
        idx, geo = resolve_location_index(
            data,
            customer_id=ctx.customer_id,
            premise_id=ctx.premise_id,
            latitude=ctx.latitude,
            longitude=ctx.longitude,
            address=ctx.address,
        )
    except ValueError as e:
        raise ValueError(str(e)) from e

    storm: dict[str, Any] = {}
    if ctx.storm:
        storm = {k: v for k, v in ctx.storm.model_dump().items() if v is not None}
    scenario = {k: v for k, v in ctx.scenario.model_dump().items() if v is not None} if ctx.scenario else None

    status = await build_location_status(
        idx,
        storm=storm or None,
        scenario=scenario,
        use_nws=ctx.use_nws,
        scan_feeder_weather=ctx.scan_feeder_weather,
    )
    if geo:
        status["geocode"] = geo
    text = format_location_status_for_llm(status)
    if ctx.address:
        text = f"Customer address (geocoded): {ctx.address.strip()}\n{text}"
        if geo and geo.get("formatted_address"):
            text = f"Geocoded ({geo.get('geocoder', 'unknown')}): {geo['formatted_address']}\n" + text
    return text, status
