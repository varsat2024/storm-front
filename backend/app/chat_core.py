"""Chat orchestration with injected dependencies so it can be tested without FastAPI, boto3 or the network.

Order of operations (each step can end the request safely):
  1. validate / clean the conversation            -> ValueError (router returns 400)
  2. resolve the customer's location              -> Abstain  (decline to estimate; the LLM is never called)
  3. build the status snapshot + vetted guidance
  4. call the LLM                                 -> LLMUnavailable (deterministic fallback reply from the snapshot)
  5. write an audit record (decisions only, no message text, no address)
"""
from __future__ import annotations

import asyncio
from typing import Any, Awaitable, Callable

from app import audit, guards
from app.safety_guidance import deterministic_reply, format_guidance_for_llm


class LLMUnavailable(RuntimeError):
    """The language model could not be reached or returned something unusable."""


def _generic_fallback() -> str:
    return (
        "I'm not able to look up your outage estimate right now. For confirmed outage information, use "
        + guards.OFFICIAL_CHANNELS + ". If anyone is in danger, call 911. Treat any downed power line as live and "
        "stay at least 30 feet away."
    )


async def run_chat(
    messages: list[dict],
    customer: Any | None,
    *,
    build_context: Callable[[Any], Awaitable[tuple[str, dict | None]]],
    call_llm: Callable[[list[dict], str], dict],
    model_id: str,
) -> dict[str, Any]:
    rid = audit.new_request_id()
    msgs = guards.validate_messages(messages)
    last = msgs[-1]["content"]
    event: dict[str, Any] = {
        "request_id": rid,
        "kind": "chat",
        "last_message_hash": audit.fingerprint(last),
        "messages": len(msgs),
        "injection_suspected": guards.looks_like_injection(last),
        "model": model_id,
    }
    needs = list(getattr(customer, "declared_needs", None) or [])

    status_block, status = "", None
    if customer is not None:
        try:
            status_block, status = await build_context(customer)
        except guards.Abstain as e:
            audit.record({**event, "outcome": "abstained", "reason": e.reason})
            return {"reply": e.message, "model": "none (declined before any model call)", "input_tokens": 0,
                    "output_tokens": 0, "visualizer_status": None, "abstained": True, "abstain_reason": e.reason,
                    "fallback": False, "request_id": rid}

    if status:
        event.update(premise_id=status.get("premise_id"), band=status["outage_risk"]["band"],
                     confidence=status["outage_risk"]["confidence"])
        system_extra = status_block + "\n\n" + format_guidance_for_llm(status, needs)
    else:
        system_extra = status_block

    try:
        out = await asyncio.to_thread(call_llm, msgs, system_extra)
    except LLMUnavailable as e:
        reply = deterministic_reply(status, needs) if status else _generic_fallback()
        audit.record({**event, "outcome": "fallback", "error": type(e).__name__})
        return {"reply": reply, "model": "none (deterministic fallback)", "input_tokens": 0, "output_tokens": 0,
                "visualizer_status": status, "abstained": False, "abstain_reason": None, "fallback": True,
                "request_id": rid}

    audit.record({**event, "outcome": "answered", "input_tokens": out.get("input_tokens"),
                  "output_tokens": out.get("output_tokens")})
    return {"reply": out["reply"], "model": model_id, "input_tokens": out.get("input_tokens", 0),
            "output_tokens": out.get("output_tokens", 0), "visualizer_status": status, "abstained": False,
            "abstain_reason": None, "fallback": False, "request_id": rid}
