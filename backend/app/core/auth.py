"""
Auth Middleware — Validates Supabase JWT tokens from the Authorization header.
"""

import logging

from fastapi import HTTPException

from app.core.config import get_settings
from app.core.supabase_client import get_supabase_client

logger = logging.getLogger("documind.auth")

# Dev-mode fake user (extension MVP — no login required locally)
_DEV_USER = {"id": "dev-user-00000000", "email": "dev@local", "role": "authenticated"}


async def get_user_from_token(authorization: str | None) -> dict:
    """
    Validate a Supabase JWT from the Authorization header and return user info.

    In development mode (APP_ENV=development), if the token is missing or
    is the literal string 'dummy-dev-token', returns a fake dev user so the
    Chrome extension can call the API without a real login session.

    Expected header format: "Bearer <jwt_token>"
    """
    settings = get_settings()

    # --- Dev bypass ---
    if settings.app_env == "development":
        if not authorization or "dummy-dev-token" in authorization:
            logger.info("[DEV MODE] Auth bypassed — using dev user")
            return _DEV_USER

    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header.")

    # Strip "Bearer " prefix
    token = authorization
    if token.lower().startswith("bearer "):
        token = token[7:]

    if not token:
        raise HTTPException(status_code=401, detail="Empty token.")

    try:
        supabase = get_supabase_client()
        user_response = supabase.auth.get_user(token)

        if not user_response or not user_response.user:
            raise HTTPException(status_code=401, detail="Invalid or expired token.")

        user = user_response.user
        logger.info("Authenticated user: %s", user.id)

        return {
            "id": user.id,
            "email": user.email or "",
            "role": user.role or "authenticated",
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Token validation failed: %s", str(e))
        raise HTTPException(status_code=401, detail="Authentication failed.")
