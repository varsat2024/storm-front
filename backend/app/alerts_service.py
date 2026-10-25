"""Email-alert logic for the Stormfront API: sign-up, emailed verification links, and the daily 25% check.

No signing secret is used: each row stores random link tokens.
Env: PUBLIC_URL (base URL used in emailed links, default http://127.0.0.1:8000), SMTP_HOST / SMTP_PORT / SMTP_USER /
     SMTP_PASS / MAIL_FROM (without SMTP_HOST, emails are written to backend/outbox/), ALERT_DB, ALERT_THRESHOLD
     (default 0.25), CHECK_MINUTES (default 30), ALERT_TZ (default America/New_York),.
"""
from __future__ import annotations

import asyncio
import hmac
import os
import re
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from zoneinfo import ZoneInfo

from app import alerts_db as db
from app.mailer import send_email

load_dotenv()   # settings below come from backend/.env; read them lazily so import order does not matter
BACKEND_DIR = Path(__file__).resolve().parents[1]


def smtp_configured() -> bool:
    """True when SMTP_HOST is set (real email is sent); otherwise emails are only saved to backend/outbox/."""
    return bool(os.environ.get("SMTP_HOST", "").strip().strip('"').strip("'"))


def db_path() -> str:
    return os.environ.get("ALERT_DB", str(BACKEND_DIR / "data" / "alerts.sqlite"))


def alert_threshold() -> float:
    return float(os.environ.get("ALERT_THRESHOLD", "0.25"))


EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,}$")
class OutOfArea(ValueError):
    """The address geocodes to a place this demo does not cover."""


# Aliases for code written against the earlier version of this module (the functions above are preferred).
DB_PATH = db_path()
THRESHOLD = alert_threshold()

GENERIC_OK = "If this email is new to us, a confirmation link has been sent. Check your inbox."
DEV_NOTE = (" Note: this server has no SMTP_HOST configured, so the email was saved to backend/outbox/ instead of being sent."
            " Set SMTP_HOST and the other SMTP_* settings in backend/.env to send real email.")


def ok_message() -> str:
    return GENERIC_OK if smtp_configured() else GENERIC_OK + DEV_NOTE


def public_url() -> str:
    return os.environ.get("PUBLIC_URL", "http://127.0.0.1:8000").rstrip("/")


def token_ok(kind: str, sub, given: str | None) -> bool:
    """Links carry a random per-row token stored in the database (no signing secret, no secret file)."""
    if sub is None:
        return False
    expected = sub["verify_token"] if kind == "verify" else sub["unsub_token"]
    return bool(expected) and hmac.compare_digest(str(expected), given or "")


def today_str() -> str:
    return datetime.now(ZoneInfo(os.environ.get("ALERT_TZ", "America/New_York"))).strftime("%Y-%m-%d")


def band_of(P: float) -> str:
    """Same bands as the visualizer and chat: cutoffs come from model.json, not a second hard-coded copy."""
    from app.artifacts_loader import load_model
    from app.visualizer_engine import band_of_probability
    return band_of_probability(P, load_model())


def verify_message(sub):
    link = f"{public_url()}/alerts/verify?id={sub['id']}&t={sub['verify_token']}"
    return ("Confirm your Stormfront outage alerts",
            f"Hello,\n\nSomeone (hopefully you) asked for outage alerts for:\n  {sub['address']}\n\n"
            f"To turn alerts on, confirm your email by opening this link:\n  {link}\n\n"
            "If you did not ask for this, ignore this message. You will not be emailed again unless you confirm.\n")


def alert_message(sub, P: float):
    unsub = f"{public_url()}/alerts/unsubscribe?id={sub['id']}&t={sub['unsub_token']}"
    return (f"Outage likelihood reached {round(P * 100)}% for your area",
            f"The modeled chance of an outage for the area around:\n  {sub['address']}\nhas reached {round(P * 100)}% (risk band: {band_of(P)}).\n\n"
            "This is a model estimate from forecast and recent weather, not a confirmed outage. "
            "Treat downed lines as live and stay 30+ feet away; call 911 for danger to life. For confirmed outage information use your utility's outage map or phone line.\n\n"
            "You will get at most one of these emails per day.\n"
            f"Stop alerts: {unsub}\n")


async def subscribe(con, email: str, address: str, resolve, send=send_email) -> tuple[int, str]:
    """Returns (http_status, message). `resolve(address)` -> (premise_idx, premise_id) or raises ValueError.
    A verification email is sent only when the address is new to the table (verified or not)."""
    email, address = (email or "").strip(), " ".join((address or "").split())
    if not EMAIL_RE.match(email) or len(email) > 254:
        return 400, "Please enter a valid email address."
    if len(address) < 8 or len(address) > 200:
        return 400, "Please enter the full street address to alert for (8 to 200 characters)."
    exists = con.execute("SELECT 1 FROM subscribers WHERE email = ?", (email,)).fetchone()
    if exists:   # already present, verified or not: never email again, and do not reveal which
        return 200, GENERIC_OK
    try:
        idx, pid = await asyncio.to_thread(resolve, address)
    except OutOfArea:
        return 422, "That address is outside the area this demo covers (the Roanoke, VA area)."
    except ValueError:
        return 404, "We couldn't find that address. Check the street number, street name, city, state and ZIP, then try again."
    except Exception:
        return 502, "We could not look up that address right now. Please try again later."
    sid = db.add_subscriber(con, email, address, idx, pid)
    if sid is None:
        return 200, GENERIC_OK
    sub = db.get(con, sid)
    try:
        await asyncio.to_thread(send, email, *verify_message(sub))
    except Exception as e:
        db.delete(con, sid)   # let the person retry; otherwise they could never be emailed
        detail = f" [{type(e).__name__}: {e}]" if os.environ.get("ALERT_DEBUG", "").strip() in ("1", "true", "yes") else ""
        return 502, "We could not send the confirmation email. Please try again later." + detail
    return 200, ok_message()


async def run_check(con, get_probability, send=send_email, today: str | None = None, threshold: float | None = None) -> int:
    """One pass: email each verified subscriber at/above the threshold, at most once per calendar day. Returns the count sent.
    `get_probability(premise_idx)` -> current outage probability (0-1) for that premise."""
    today, sent, cache = today or today_str(), 0, {}
    limit = alert_threshold() if threshold is None else threshold
    for sub in db.verified_due(con, today):
        try:
            if sub["premise_idx"] not in cache:
                cache[sub["premise_idx"]] = await get_probability(sub["premise_idx"])
            P = cache[sub["premise_idx"]]
        except Exception as e:
            print("alert risk lookup failed for", sub["premise_id"], e)
            continue
        if P is None or P < limit:
            continue
        prev = sub["last_sent_date"]
        if not db.claim_today(con, sub["id"], today):
            continue
        try:
            await asyncio.to_thread(send, sub["email"], *alert_message(sub, P))
            sent += 1
        except Exception as e:
            print("alert send failed", e)
            db.release_claim(con, sub["id"], prev)
    return sent
