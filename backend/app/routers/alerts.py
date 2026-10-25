from __future__ import annotations

import asyncio
import html
import os
import time

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, Field

from app import alerts_db as db
from app import alerts_service as svc
from app.artifacts_loader import load_data
from app.guards import Abstain
from app.location_status import build_location_status, resolve_location_index

router = APIRouter(prefix="/alerts", tags=["alerts"])
_hits: dict[str, list[float]] = {}


class SubscribeBody(BaseModel):
    email: str = Field(..., max_length=254)
    address: str = Field(..., max_length=200)


def _page(msg: str, code: int = 200) -> HTMLResponse:
    return HTMLResponse(f"<!doctype html><meta charset=utf-8><title>Stormfront</title>"
                        f"<body style='font:16px sans-serif;max-width:32em;margin:3em auto;padding:0 1em'><h2>Stormfront</h2><p>{html.escape(msg)}</p>",
                        status_code=code)


def resolve_address(address: str):
    """Geocode the address and match it to the nearest demo premise (same matching the Assistant uses)."""
    data = load_data()
    try:
        idx, geo = resolve_location_index(data, address=address)
    except Abstain as e:
        if e.reason == "geocoder_unavailable":
            raise RuntimeError("geocoder unavailable") from e      # reported as a temporary 502 by svc.subscribe
        raise svc.OutOfArea(address) from e
    return idx, data["prem"][idx]["id"]


@router.post("/subscribe")
async def subscribe(body: SubscribeBody, request: Request):
    ip = request.client.host if request.client else "unknown"
    now = time.time()
    hits = [t for t in _hits.get(ip, []) if now - t < 3600]
    if len(hits) >= 10:
        return JSONResponse({"message": "Too many requests. Try again later."}, status_code=429)
    _hits[ip] = hits + [now]
    con = db.connect(svc.db_path())
    try:
        status, msg = await svc.subscribe(con, body.email, body.address, resolve_address)
    finally:
        con.close()
    return JSONResponse({"message": msg}, status_code=status)


@router.get("/verify", response_class=HTMLResponse)
def verify(id: int = 0, t: str = ""):
    con = db.connect(svc.db_path())
    try:
        sub = db.get(con, id)
        if not svc.token_ok("verify", sub, t):
            return _page("This link is not valid.", 400)
        db.mark_verified(con, sub["id"])
        return _page(f"Thank you. Alerts are on for {sub['address']}. We will email you when the modeled outage chance reaches "
                     f"{round(svc.alert_threshold() * 100)}%, at most once a day.")
    finally:
        con.close()


@router.get("/unsubscribe", response_class=HTMLResponse)
def unsubscribe(id: int = 0, t: str = ""):
    con = db.connect(svc.db_path())
    try:
        sub = db.get(con, id)
        if not svc.token_ok("unsub", sub, t):
            return _page("This link is not valid.", 400)
        db.delete(con, sub["id"])
        return _page("You have been unsubscribed and your details were deleted.")
    finally:
        con.close()


async def current_probability(premise_idx: int) -> float:
    """Current modeled outage probability for a premise, with live NWS weather (the same number the page shows)."""
    status = await build_location_status(premise_idx, use_nws=True, scan_feeder_weather=False)
    return float(status["outage_risk"]["probability"])


async def checker_loop():
    every = float(os.environ.get("CHECK_MINUTES", "30")) * 60
    while True:
        try:
            con = db.connect(svc.db_path())
            try:
                n = await svc.run_check(con, current_probability)
            finally:
                con.close()
            if n:
                print(f"alerts: sent {n} email(s)")
        except Exception as e:
            print("alert check failed:", e)
        await asyncio.sleep(every)
