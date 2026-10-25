"""Resolve customer location and attach full location status for the chat API."""
from __future__ import annotations

from typing import Any

from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.location_status import build_location_status, format_location_status_for_llm, resolve_location_index
from app.artifacts_loader import load_data
from app.guards import Abstain


class StormContext(BaseModel):
    gust: float | None = Field(None, ge=0, le=150)
    rain: float | None = Field(None, ge=0, le=30)
    snow: float | None = Field(None, ge=0, le=60)
    ante: float | None = Field(None, ge=0, le=30)
    leaf: bool | None = None


class ScenarioContext(BaseModel):
    n_pole: float | None = Field(None, ge=0, le=200)
    n_arm: float | None = Field(None, ge=0, le=200)
    n_xf: float | None = Field(None, ge=0, le=200)
    n_ins: float | None = Field(None, ge=0, le=200)
    n_wire: float | None = Field(None, ge=0, le=200)
    n_rec: float | None = Field(None, ge=0, le=200)
    asset_group: Literal["Secondary wire", "Pole", "Fuse bank", "Transformer", "Other"] | None = None
    damage_location: Literal["branch", "other"] | None = None
    cr: int | None = Field(None, ge=1, le=8)
    mu: float | None = Field(None, ge=1, le=10)
    access_blocked: bool | None = None


class CustomerContext(BaseModel):
    customer_id: str | None = Field(None, description="Demo id P-0001, or numeric 1 → P-0001")
    premise_id: str | None = None
    latitude: float | None = Field(None, ge=-90, le=90)
    longitude: float | None = Field(None, ge=-180, le=180)
    use_nws: bool = Field(True, description="Pull current/incoming weather from NWS when locating the customer")
    scan_feeder_weather: bool = Field(
        True,
        description="Check weather along the feeder for upstream-storm effects on downstream customers",
    )
    storm: StormContext | None = None
    scenario: ScenarioContext | None = None
    declared_needs: list[Literal["medical_device", "medical_refrigeration", "mobility", "hearing_or_vision"]] = Field(
        default_factory=list, max_length=4,
        description="Needs the customer chose to declare. Never inferred; used only to tailor preparation guidance.",
    )
    address: str | None = Field(None, max_length=200)

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
    except Abstain:
        raise                                  # keep the type: the caller declines instead of reporting a bad request
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
    if geo:
        # The street address is deliberately NOT put in the prompt: it is personal data the model does not need,
        # and free text in a system prompt is an injection path. The model only sees the anonymized premise.
        note = (f"Location match: nearest anonymized demo premise {status['premise_id']} "
                f"({geo.get('match_quality', 'unknown')} match, about {geo.get('match_distance_km', '?')} km from the address). "
                "The customer's street address is intentionally not shown to you.")
        if geo.get("match_quality") == "approximate":
            note += " The match is approximate: tell the customer the estimate is for a nearby representative location."
        text = note + "\n" + text
    return text, status
