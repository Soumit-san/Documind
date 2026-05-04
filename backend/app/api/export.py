"""
Export API — PDF/DOCX download endpoints for analysis data.
"""

import logging

from fastapi import APIRouter, Header
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
import io
import re

from app.core.auth import get_user_from_token
from app.services.export import generate_pdf, generate_docx

router = APIRouter(tags=["export"])
logger = logging.getLogger("documind.export")


class ExportContent(BaseModel):
    """Content payload sent from the frontend."""
    title: str = "Document Analysis"
    executive_summary: str = ""
    sections: Optional[list[dict]] = None
    entities: Optional[dict] = None
    citations: Optional[list[dict]] = None
    chat_messages: Optional[list[dict]] = None


@router.post("/export/pdf")
async def export_pdf(content: ExportContent, authorization: str = Header(None)):
    """
    Generate a PDF from the provided analysis content and return it as a download.
    """
    await get_user_from_token(authorization)

    logger.info("Generating PDF export: %s", content.title)
    pdf_bytes = generate_pdf(
        title=content.title,
        executive_summary=content.executive_summary,
        sections=content.sections,
        entities=content.entities,
        citations=content.citations,
        chat_messages=content.chat_messages,
    )

    safe_title = re.sub(r'[^\w\-\.]', '_', content.title)
    safe_filename = f"{safe_title[:50]}_analysis.pdf"

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{safe_filename}"'},
    )


@router.post("/export/docx")
async def export_docx(content: ExportContent, authorization: str = Header(None)):
    """
    Generate a DOCX from the provided analysis content and return it as a download.
    """
    await get_user_from_token(authorization)

    logger.info("Generating DOCX export: %s", content.title)
    docx_bytes = generate_docx(
        title=content.title,
        executive_summary=content.executive_summary,
        sections=content.sections,
        entities=content.entities,
        citations=content.citations,
        chat_messages=content.chat_messages,
    )

    safe_title = re.sub(r'[^\w\-\.]', '_', content.title)
    safe_filename = f"{safe_title[:50]}_analysis.docx"

    return StreamingResponse(
        io.BytesIO(docx_bytes),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{safe_filename}"'},
    )
