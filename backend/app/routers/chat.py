import logging

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from typing import List
from botocore.exceptions import BotoCoreError, ClientError

from app import guards
from app.bedrock_client import get_client
from app.chat_core import LLMUnavailable, run_chat
from app.config import MODEL_ID, MAX_TOKENS, TEMPERATURE
from app.customer_context import CustomerContext, build_customer_context_block
from app.system_prompt import SYSTEM_PROMPT

log = logging.getLogger("stormfront.chat")
router = APIRouter(prefix="/chat", tags=["chat"])


class Message(BaseModel):
    role: str = Field(..., pattern="^(user|assistant)$")
    content: str = Field(..., max_length=guards.MAX_ASSISTANT_CHARS)


class ChatRequest(BaseModel):
    messages: List[Message] = Field(..., min_length=1, max_length=guards.MAX_MESSAGES * 2)
    """
    Conversation history. Each item has 'role' (user|assistant) and 'content'. It is cleaned and capped on the server;
    the last turn must be from the customer.
    """
    customer: CustomerContext | None = None
    """Optional location + storm/scenario inputs — same fields as the visualizer sidebar."""


class ChatResponse(BaseModel):
    reply: str
    model: str
    input_tokens: int
    output_tokens: int


class ChatResponseWithStatus(ChatResponse):
    visualizer_status: dict | None = None
    abstained: bool = False
    abstain_reason: str | None = None
    fallback: bool = False
    request_id: str | None = None


def _call_bedrock(messages: list[dict], system_extra: str = "") -> dict:
    """Call Bedrock Converse. Any failure becomes LLMUnavailable; details go to the server log, never to the customer."""
    bedrock_messages = [{"role": m["role"], "content": [{"text": m["content"]}]} for m in messages]
    system_text = SYSTEM_PROMPT + ("\n\n---\n" + system_extra if system_extra else "")
    try:
        response = get_client().converse(
            modelId=MODEL_ID,
            system=[{"text": system_text}],
            messages=bedrock_messages,
            inferenceConfig={"maxTokens": MAX_TOKENS, "temperature": TEMPERATURE},
        )
        reply_text = response["output"]["message"]["content"][0]["text"]
        usage = response.get("usage", {})
    except (ClientError, BotoCoreError, KeyError, IndexError, TypeError) as e:
        code = e.response.get("Error", {}).get("Code") if isinstance(e, ClientError) else type(e).__name__
        log.error("Bedrock call failed (%s)", code, exc_info=True)
        raise LLMUnavailable(code) from e
    except Exception as e:  # noqa: BLE001
        log.error("Unexpected assistant error", exc_info=True)
        raise LLMUnavailable(type(e).__name__) from e
    return {"reply": reply_text, "input_tokens": usage.get("inputTokens", 0), "output_tokens": usage.get("outputTokens", 0)}


@router.post("", response_model=ChatResponseWithStatus)
async def chat(request: ChatRequest):
    """
    Multi-turn chat via POST body.

    Declines (without calling the model) when the location is outside the served area, and falls back to a
    deterministic reply built from the computed status if the language model is unavailable.
    """
    try:
        result = await run_chat(
            [m.model_dump() for m in request.messages],
            request.customer,
            build_context=build_customer_context_block,
            call_llm=_call_bedrock,
            model_id=MODEL_ID,
        )
    except ValueError as e:     # validation problems, unknown premise id, bad locator combination
        raise HTTPException(status_code=400, detail=str(e)) from e
    return ChatResponseWithStatus(**result)


@router.get("/query", response_model=ChatResponse)
async def chat_query(
    q: str = Query(..., description="Your question for the Outage Concierge", min_length=1, max_length=guards.MAX_USER_CHARS),
):
    """
    Single-turn chat via GET query parameter (no location context, so no outage numbers are given).
    Example: GET /chat/query?q=Will+I+lose+power+during+the+storm
    """
    try:
        result = await run_chat([{"role": "user", "content": q}], None, build_context=build_customer_context_block,
                                call_llm=_call_bedrock, model_id=MODEL_ID)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return ChatResponse(**{k: result[k] for k in ("reply", "model", "input_tokens", "output_tokens")})
