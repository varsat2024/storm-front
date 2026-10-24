from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from typing import List
from botocore.exceptions import ClientError

from app.bedrock_client import get_client
from app.config import MODEL_ID, MAX_TOKENS
from app.system_prompt import SYSTEM_PROMPT

router = APIRouter(prefix="/chat", tags=["chat"])


class Message(BaseModel):
    role: str = Field(..., pattern="^(user|assistant)$")
    content: str


class ChatRequest(BaseModel):
    messages: List[Message]
    """
    Full conversation history. Each item has 'role' (user|assistant) and 'content'.
    The frontend maintains and sends the full history each turn.
    """


class ChatResponse(BaseModel):
    reply: str
    model: str
    input_tokens: int
    output_tokens: int


def _call_bedrock(messages: list[dict]) -> ChatResponse:
    """Shared logic for calling Bedrock Converse API."""
    client = get_client()

    bedrock_messages = [
        {"role": msg["role"], "content": [{"text": msg["content"]}]}
        for msg in messages
    ]

    try:
        response = client.converse(
            modelId=MODEL_ID,
            system=[{"text": SYSTEM_PROMPT}],
            messages=bedrock_messages,
            inferenceConfig={
                "maxTokens": MAX_TOKENS,
                "temperature": 0.7,
            },
        )
    except ClientError as e:
        code = e.response["Error"]["Code"]
        message = e.response["Error"]["Message"]
        if code == "AccessDeniedException":
            raise HTTPException(status_code=403, detail=f"Bedrock access denied: {message}")
        elif code == "ValidationException":
            raise HTTPException(status_code=422, detail=f"Bedrock validation error: {message}")
        elif code == "ThrottlingException":
            raise HTTPException(status_code=429, detail=f"Bedrock throttled: {message}")
        else:
            raise HTTPException(status_code=500, detail=f"Bedrock error ({code}): {message}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unexpected error: {str(e)}")

    reply_text = response["output"]["message"]["content"][0]["text"]
    usage = response.get("usage", {})

    return ChatResponse(
        reply=reply_text,
        model=MODEL_ID,
        input_tokens=usage.get("inputTokens", 0),
        output_tokens=usage.get("outputTokens", 0),
    )


@router.post("", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """
    Multi-turn chat via POST body.
    Send full conversation history each request.
    """
    if not request.messages:
        raise HTTPException(status_code=400, detail="messages list cannot be empty.")

    messages = [{"role": m.role, "content": m.content} for m in request.messages]
    return _call_bedrock(messages)


@router.get("/query", response_model=ChatResponse)
async def chat_query(
    q: str = Query(..., description="Your question for the Outage Concierge", min_length=1),
):
    """
    Single-turn chat via GET query parameter.
    Example: GET /chat/query?q=Will+I+lose+power+during+the+storm
    """
    return _call_bedrock([{"role": "user", "content": q}])
