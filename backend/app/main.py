"""
DocuMind AI — FastAPI Application Entry Point
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.api import health, documents, summarize, chat

# ---------------------------------------------------------------------------
# Security: Never log document content (PRD §7.4 Phase 1)
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
)
# Suppress request body logging from uvicorn / starlette
logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
logger = logging.getLogger("documind")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown lifecycle hook."""
    logger.info("DocuMind AI backend starting up …")
    yield
    logger.info("DocuMind AI backend shutting down …")


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="DocuMind AI",
        description="Intelligent Document Assistant — RAG-powered API",
        version="0.1.0",
        lifespan=lifespan,
    )

    # --- CORS -----------------------------------------------------------
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # --- Request body size limit (PRD §7.4 Phase 1) ----------------------
    # FastAPI / Starlette: enforced at the endpoint level via UploadFile limits.

    # --- Routers ---------------------------------------------------------
    app.include_router(health.router)
    app.include_router(documents.router, prefix="/api")
    app.include_router(summarize.router, prefix="/api")
    app.include_router(chat.router, prefix="/api")

    return app


app = create_app()
