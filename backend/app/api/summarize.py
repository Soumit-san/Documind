"""
Summarization endpoint — generates tiered summaries for uploaded documents.
"""

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Any

from app.services.rag_pipeline import get_document_data
from app.services.llm import generate_summary, generate_tiered_summary

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
    summary: str | dict | list  # Handle flexible returns for entities/sections
    citations: list[Citation] = []


class AutoSummarizeResponse(BaseModel):
    document_id: str
    results: dict[str, Any]  # Contains 'executive', 'sections', 'entities', 'errors'


@router.post("/summarize", response_model=SummarizeResponse)
async def summarize_document(req: SummarizeRequest):
    """
    Generate a single tiered summary for a previously indexed document.
    Levels: executive, section, entities.
    """
    doc_data = get_document_data(req.document_id)
    if not doc_data:
        raise HTTPException(status_code=404, detail="Document not found. Upload it first.")

    logger.info("Summarizing document %s at level '%s'", req.document_id, req.level)

    try:
        result = generate_summary(doc_data["text"], level=req.level, pages=doc_data.get("pages"))
    except Exception as e:
        logger.error("Summary generation failed: %s", str(e))
        raise HTTPException(status_code=500, detail="Summary generation failed.")

    # Depending on the level, the "summary" might be the raw summary text or a structured dict (sections, entities)
    # We pass the entire result back appropriately
    summary_content = result.get("summary", "")
    if req.level == "section" and "sections" in result:
        summary_content = result["sections"]
    elif req.level == "entities" and "entities" in result:
        summary_content = result["entities"]

    return SummarizeResponse(
        document_id=req.document_id,
        level=req.level,
        summary=summary_content,
        citations=[Citation(**c) for c in result.get("citations", [])],
    )


@router.post("/summarize/auto", response_model=AutoSummarizeResponse)
async def auto_summarize_document(req: SummarizeRequest):
    """
    Generate all summary tiers (executive, section, entities) at once.
    Used by the extension sidebar on document detection.
    """
    doc_data = get_document_data(req.document_id)
    if not doc_data:
        raise HTTPException(status_code=404, detail="Document not found. Upload it first.")

    logger.info("Auto-summarizing all tiers for document %s", req.document_id)

    results = generate_tiered_summary(doc_data["text"], pages=doc_data.get("pages"))

    return AutoSummarizeResponse(
        document_id=req.document_id,
        results=results,
    )
