import asyncio
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import alerts, chat, status

@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Background task: email verified subscribers when the modeled outage likelihood reaches the threshold (at most once a day).
    from app import alerts_service
    print("[alerts] email delivery:", "SMTP configured" if alerts_service.smtp_configured() else "SMTP_HOST not set - emails are saved to backend/outbox/ and NOT sent")
    task = asyncio.create_task(alerts.checker_loop())
    try:
        yield
    finally:
        task.cancel()


app = FastAPI(
    lifespan=lifespan,
    title="AI Outage Concierge API",
    description="Bedrock-powered chat backend for storm outage assistance.",
    version="0.1.0",
)

# Only the local demo origins by default. Set CORS_ORIGINS="https://your-site.example,https://other.example" to change.
# No cookies or auth headers are used, so credentials stay off.
_origins = [o.strip() for o in os.getenv(
    "CORS_ORIGINS",
    "http://127.0.0.1:8080,http://localhost:8080,http://127.0.0.1:8000,http://localhost:8000",
).split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

app.include_router(chat.router)
app.include_router(status.router)
app.include_router(alerts.router)


@app.get("/health")
def health():
    return {"status": "ok"}
