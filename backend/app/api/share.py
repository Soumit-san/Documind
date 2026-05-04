"""
Share API — Create and retrieve shareable analysis links with optional password protection.
"""

import logging
from typing import Optional

import bcrypt
from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel

from app.core.auth import get_user_from_token
from app.core.supabase_client import get_supabase_admin_client

router = APIRouter(tags=["share"])
logger = logging.getLogger("documind.share")

TABLE = "shared_analyses"


# ── Request / Response Models ────────────────────────────────────────────

class ShareCreateRequest(BaseModel):
    document_id: str
    title: str
    content: dict  # The full analysis payload (summary, entities, chat, etc.)
    password: Optional[str] = None  # plain-text; hashed before storage


class ShareCreateResponse(BaseModel):
    share_id: str
    share_url: str


class SharedContent(BaseModel):
    title: str
    content: dict
    created_at: str


# ── Endpoints ────────────────────────────────────────────────────────────

@router.post("/share", response_model=ShareCreateResponse)
async def create_share(req: ShareCreateRequest, authorization: str = Header(None)):
    """
    Create a shareable link for an analysis.
    Optionally password-protect it.
    """
    user = await get_user_from_token(authorization)
    supabase = get_supabase_admin_client()

    password_hash = None
    if req.password and req.password.strip():
        password_hash = bcrypt.hashpw(
            req.password.strip().encode("utf-8"),
            bcrypt.gensalt(),
        ).decode("utf-8")

    record = {
        "user_id": user["id"],
        "document_id": req.document_id,
        "title": req.title,
        "content": req.content,
        "password_hash": password_hash,
    }

    try:
        result = supabase.table(TABLE).insert(record).execute()
        share = result.data[0]
        share_id = share["id"]
        logger.info("Created share %s for user %s", share_id, user["id"])
        return ShareCreateResponse(
            share_id=share_id,
            share_url=f"/share/{share_id}",
        )
    except Exception as e:
        logger.error("Failed to create share: %s", str(e))
        raise HTTPException(status_code=500, detail="Failed to create share.")


@router.get("/share/{share_id}", response_model=SharedContent)
async def get_share(share_id: str, password: Optional[str] = Query(None)):
    """
    Retrieve a shared analysis. If password-protected, the correct password
    must be provided as a query parameter.
    """
    supabase = get_supabase_admin_client()

    try:
        result = (
            supabase.table(TABLE)
            .select("*")
            .eq("id", share_id)
            .single()
            .execute()
        )
    except Exception:
        raise HTTPException(status_code=404, detail="Share not found.")

    share = result.data
    if not share:
        raise HTTPException(status_code=404, detail="Share not found.")

    # Check password if protected
    if share.get("password_hash"):
        if not password:
            raise HTTPException(status_code=401, detail="This share is password-protected.")
        if not bcrypt.checkpw(password.encode("utf-8"), share["password_hash"].encode("utf-8")):
            raise HTTPException(status_code=403, detail="Incorrect password.")

    return SharedContent(
        title=share["title"],
        content=share["content"],
        created_at=share["created_at"],
    )


@router.delete("/share/{share_id}")
async def delete_share(share_id: str, authorization: str = Header(None)):
    """
    Delete a shared analysis link. Owner-only.
    """
    user = await get_user_from_token(authorization)
    supabase = get_supabase_admin_client()

    try:
        supabase.table(TABLE).delete().eq("id", share_id).eq("user_id", user["id"]).execute()
        logger.info("Deleted share %s", share_id)
        return {"status": "ok"}
    except Exception as e:
        logger.error("Failed to delete share %s: %s", share_id, str(e))
        raise HTTPException(status_code=500, detail="Failed to delete share.")
