"""
Summarization endpoint — generates tiered summaries for uploaded documents.
"""

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.rag_pipeline import get_document_text
from app.services.llm import generate_summary

router = APIRouter(tags=["summarize"])
logger = logging.getLogger("documind.summarize")


class SummarizeRequest(BaseModel):
    document_id: str
    level: str = "executive"  # "executive" | "section" | "entities"


class Citation(BaseModel):
    text: str
    page: int | None = None
    section: str | None = None


class SummarizeResponse(BaseModel):
    document_id: str
    level: str
    summary: str
    citations: list[Citation] = []


@router.post("/summarize", response_model=SummarizeResponse)
async def summarize_document(req: SummarizeRequest):
    """
    Generate a tiered summary for a previously indexed document.
    Levels: executive (3-5 sentences), section (per-section), entities (key entities).
    """
    # Retrieve full document text from the vector store
    doc_text = get_document_text(req.document_id)
    if doc_text is None:
        raise HTTPException(status_code=404, detail="Document not found. Upload it first.")

    logger.info("Summarizing document %s at level '%s'", req.document_id, req.level)

    try:
        result = generate_summary(doc_text, level=req.level)
    except Exception as e:
        logger.error("Summary generation failed: %s", str(e))
        raise HTTPException(status_code=500, detail="Summary generation failed.")

    return SummarizeResponse(
        document_id=req.document_id,
        level=req.level,
        summary=result["summary"],
        citations=[Citation(**c) for c in result.get("citations", [])],
    )
