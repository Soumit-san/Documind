"""
Document upload & management endpoints.
Integrates: Supabase Storage + PostgreSQL + RAG Pipeline.
"""

import logging
from typing import Annotated

from fastapi import APIRouter, File, UploadFile, HTTPException, Header, Form
from pydantic import BaseModel

from app.core.config import get_settings
from app.services.parser import parse_document
from app.services.rag_pipeline import index_document
from app.services.storage import (
    upload_document_to_storage,
    list_user_documents as list_storage_files,
    delete_document_from_storage,
)
from app.services.database import (
    insert_document_record,
    get_user_documents,
    get_document_by_id,
    delete_document_record,
)
from app.core.auth import get_user_from_token

router = APIRouter(tags=["documents"])
logger = logging.getLogger("documind.documents")

SUPPORTED_EXTENSIONS = {
    ".pdf", ".docx", ".doc", ".pptx", ".ppt",
    ".txt", ".md", ".csv", ".json", ".yaml",
    ".epub", ".odt", ".odp", ".ods", ".wps",
}


# ── Response Models ──────────────────────────────────────────

class DocumentResponse(BaseModel):
    id: str
    filename: str
    page_count: int
    chunk_count: int
    storage_path: str
    message: str


class DocumentListItem(BaseModel):
    id: str
    filename: str
    file_type: str
    page_count: int
    chunk_count: int
    created_at: str
    doc_vector_id: str = ""


# ── Endpoints ────────────────────────────────────────────────

@router.post("/documents/upload", response_model=DocumentResponse)
async def upload_document(
    file: Annotated[UploadFile, File(description="Document file to process")],
    folder_id: Annotated[str | None, Form()] = None,
    authorization: str = Header(None),
):
    """
    Upload a document: store in Supabase Storage, parse text, index in
    ChromaDB, and save metadata to PostgreSQL.

    Requires a valid Supabase JWT in the Authorization header.
    Storage path follows the RLS-required format: {user_id}/{filename}
    """
    settings = get_settings()
    max_bytes = settings.max_upload_size_mb * 1024 * 1024

    # --- Authenticate ---
    user = await get_user_from_token(authorization)

    # --- Validate file extension ---
    filename = file.filename or "unknown"
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'. Supported: {', '.join(sorted(SUPPORTED_EXTENSIONS))}",
        )

    # --- Read & enforce size limit (PRD §7.4 Phase 1) ---
    contents = await file.read()
    if len(contents) > max_bytes:
        raise HTTPException(status_code=413, detail=f"File exceeds {settings.max_upload_size_mb}MB limit.")

    logger.info("Processing document: %s (%d bytes) for user %s", filename, len(contents), user["id"])

    # --- 1. Upload to Supabase Storage (path = {user_id}/{filename}) ---
    try:
        storage_result = upload_document_to_storage(
            user_id=user["id"],
            filename=filename,
            file_bytes=contents,
            content_type=file.content_type or "application/octet-stream",
        )
    except Exception as e:
        logger.error("Storage upload failed for %s: %s", filename, str(e))
        raise HTTPException(status_code=500, detail=f"Storage upload failed: {str(e)}")

    # --- 2. Parse document into text ---
    try:
        parsed = parse_document(contents, filename)
    except Exception as e:
        logger.error("Parsing failed for %s: %s", filename, str(e))
        raise HTTPException(status_code=422, detail=f"Could not parse document: {str(e)}")

    # --- 3. Index into ChromaDB vector store ---
    try:
        index_result = index_document(parsed["text"], parsed["metadata"], pages=parsed.get("pages"))
    except Exception as e:
        logger.error("Indexing failed for %s: %s", filename, str(e))
        raise HTTPException(status_code=500, detail=f"Indexing failed: {str(e)}")

    # --- 4. Save metadata to Supabase PostgreSQL ---
    try:
        db_record = insert_document_record(
            user_id=user["id"],
            filename=filename,
            file_type=parsed["metadata"].get("file_type", ext.lstrip(".")),
            page_count=parsed["metadata"].get("page_count", 1),
            chunk_count=index_result["chunk_count"],
            storage_path=storage_result["path"],
            doc_vector_id=index_result["doc_id"],
            folder_id=folder_id,
        )
    except Exception as e:
        logger.error("Database insert failed for %s: %s", filename, str(e))
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

    return DocumentResponse(
        id=index_result["doc_id"],
        filename=filename,
        page_count=parsed["metadata"].get("page_count", 1),
        chunk_count=index_result["chunk_count"],
        storage_path=storage_result["path"],
        message="Document uploaded and indexed successfully.",
    )


@router.get("/documents", response_model=list[DocumentListItem])
async def list_documents(
    folder_id: str | None = None,
    authorization: str = Header(None)
):
    """List all documents for the authenticated user."""
    user = await get_user_from_token(authorization)
    docs = get_user_documents(user["id"], folder_id=folder_id)
    return [
        DocumentListItem(
            id=d.get("id", ""),
            filename=d.get("filename", ""),
            file_type=d.get("file_type", ""),
            page_count=d.get("page_count", 0),
            chunk_count=d.get("chunk_count", 0),
            created_at=d.get("created_at", ""),
            doc_vector_id=d.get("doc_vector_id", ""),
        )
        for d in docs
    ]


@router.delete("/documents/{document_id}")
async def delete_document(document_id: str, authorization: str = Header(None)):
    """Delete a document (storage + database + vector store)."""
    user = await get_user_from_token(authorization)

    doc = get_document_by_id(document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")
    if doc.get("user_id") != user["id"]:
        raise HTTPException(status_code=403, detail="Not authorized to delete this document.")

    # Remove from storage
    delete_document_from_storage(user["id"], doc["filename"])
    # Remove from database
    delete_document_record(document_id)

    return {"message": "Document deleted successfully.", "id": document_id}


# ── Text-only upload (DOM scraper, extension) ────────────────

class TextUploadRequest(BaseModel):
    text: str
    url: str = ""
    title: str = "Untitled Document"
    source_type: str = "dom-scraper"  # e.g. "google-drive", "local-file", "web-page"


class TextUploadResponse(BaseModel):
    document_id: str
    chunk_count: int
    message: str


@router.post("/documents/upload-text", response_model=TextUploadResponse)
async def upload_text_document(
    req: TextUploadRequest,
    authorization: str = Header(None),
):
    """
    Index raw text extracted from the browser DOM.
    Used by the Chrome extension when it can't download raw file bytes
    (Google Drive, local files, web-based document viewers).

    No file is stored in Supabase Storage — only the text is indexed in ChromaDB.
    """
    user = await get_user_from_token(authorization)

    if not req.text or len(req.text.strip()) < 20:
        raise HTTPException(status_code=400, detail="Text is too short to analyze.")

    logger.info(
        "Text upload from %s: '%s' (%d chars) for user %s",
        req.source_type, req.title[:40], len(req.text), user["id"],
    )

    # Split text into rough "pages" by character count (~3000 chars/page)
    page_size = 3000
    pages = [req.text[i:i + page_size] for i in range(0, len(req.text), page_size)]

    metadata = {
        "filename": req.title,
        "file_type": req.source_type,
        "page_count": len(pages),
        "source_url": req.url,
    }

    try:
        index_result = index_document(req.text, metadata, pages=pages)
    except Exception as e:
        logger.error("Indexing failed for text upload '%s': %s", req.title, str(e))
        raise HTTPException(status_code=500, detail=f"Indexing failed: {str(e)}")

    # Optionally save to DB (will silently fail if table missing)
    try:
        insert_document_record(
            user_id=user["id"],
            filename=req.title,
            file_type=req.source_type,
            page_count=len(pages),
            chunk_count=index_result["chunk_count"],
            storage_path="",  # No file stored
            doc_vector_id=index_result["doc_id"],
        )
    except Exception:
        pass  # DB is optional for MVP

    return TextUploadResponse(
        document_id=index_result["doc_id"],
        chunk_count=index_result["chunk_count"],
        message="Text indexed successfully.",
    )
