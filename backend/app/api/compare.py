"""
Comparative Analysis API — F-07
Endpoint for uploading two documents and receiving a structured diff + LLM analysis.
"""

import logging
from typing import Annotated

from fastapi import APIRouter, File, UploadFile, HTTPException, Header
from pydantic import BaseModel

from app.core.config import get_settings
from app.core.auth import get_user_from_token
from app.services.parser import parse_document
from app.services.comparison import compute_diff, generate_comparison_analysis

router = APIRouter(tags=["compare"])
logger = logging.getLogger("documind.compare")

SUPPORTED_EXTENSIONS = {
    ".pdf", ".docx", ".doc", ".pptx", ".ppt",
    ".txt", ".md", ".csv", ".json", ".yaml",
    ".epub", ".odt", ".odp", ".ods", ".wps",
}


# ── Response Models ──────────────────────────────────────────

class FileInfo(BaseModel):
    filename: str
    page_count: int
    file_type: str
    char_count: int


class DiffBlock(BaseModel):
    type: str          # "added" | "removed" | "changed" | "unchanged"
    content: str
    content_b: str | None = None
    location: str


class KeyChange(BaseModel):
    change: str
    severity: str      # "high" | "medium" | "low"
    section: str


class ComparisonAnalysis(BaseModel):
    change_summary: str
    risk_delta: str
    key_changes: list[KeyChange]
    recommendation: str


class CompareResponse(BaseModel):
    file_a: FileInfo
    file_b: FileInfo
    similarity_score: float
    diff_blocks: list[DiffBlock]
    stats: dict
    analysis: ComparisonAnalysis


# ── Endpoint ─────────────────────────────────────────────────

@router.post("/compare", response_model=CompareResponse)
async def compare_documents(
    file_a: Annotated[UploadFile, File(description="Original / older document")],
    file_b: Annotated[UploadFile, File(description="Revised / newer document")],
    authorization: str = Header(None),
):
    """
    Upload two documents and receive a comparative analysis:
    - Structured text diff (paragraph-level)
    - Similarity score
    - LLM-generated change summary, risk delta, and recommendations

    Both files are parsed on-the-fly — they don't need to be pre-uploaded
    to the document library.
    """
    settings = get_settings()
    max_bytes = settings.max_upload_size_mb * 1024 * 1024

    # --- Authenticate ---
    user = await get_user_from_token(authorization)

    # --- Validate & read files ---
    results = {}
    for label, file_obj in [("a", file_a), ("b", file_b)]:
        filename = file_obj.filename or "unknown"
        ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        if ext not in SUPPORTED_EXTENSIONS:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type '{ext}' for file_{label}. Supported: {', '.join(sorted(SUPPORTED_EXTENSIONS))}",
            )

        contents = await file_obj.read()
        if len(contents) > max_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"File {label.upper()} exceeds {settings.max_upload_size_mb}MB limit.",
            )

        try:
            parsed = parse_document(contents, filename)
        except Exception as e:
            logger.error("Parsing failed for file_%s (%s): %s", label, filename, str(e))
            raise HTTPException(
                status_code=422,
                detail=f"Could not parse file {label.upper()} ({filename}): {str(e)}",
            )

        results[label] = {"parsed": parsed, "filename": filename}

    parsed_a = results["a"]["parsed"]
    parsed_b = results["b"]["parsed"]

    logger.info(
        "Comparing documents for user %s: '%s' (%d chars) vs '%s' (%d chars)",
        user["id"],
        results["a"]["filename"], len(parsed_a["text"]),
        results["b"]["filename"], len(parsed_b["text"]),
    )

    # --- Compute structural diff ---
    try:
        diff_result = compute_diff(parsed_a["text"], parsed_b["text"])
    except Exception as e:
        logger.error("Diff computation failed: %s", str(e))
        raise HTTPException(status_code=500, detail=f"Diff failed: {str(e)}")

    # --- LLM analysis ---
    try:
        analysis = generate_comparison_analysis(
            text_a=parsed_a["text"],
            text_b=parsed_b["text"],
            diff_result=diff_result,
            filename_a=results["a"]["filename"],
            filename_b=results["b"]["filename"],
        )
    except Exception as e:
        logger.error("LLM comparison analysis failed: %s", str(e))
        # Return diff without LLM analysis rather than failing entirely
        analysis = {
            "change_summary": f"LLM analysis unavailable: {str(e)}. See the diff blocks below for details.",
            "risk_delta": "Could not analyze risks — LLM unavailable.",
            "key_changes": [],
            "recommendation": "Please review the diff manually.",
        }

    # --- Build response ---
    # Filter out unchanged blocks from the response (keep only meaningful diffs)
    meaningful_blocks = [b for b in diff_result["diff_blocks"] if b["type"] != "unchanged"]

    return CompareResponse(
        file_a=FileInfo(
            filename=results["a"]["filename"],
            page_count=parsed_a["metadata"].get("page_count", 1),
            file_type=parsed_a["metadata"].get("file_type", "unknown"),
            char_count=len(parsed_a["text"]),
        ),
        file_b=FileInfo(
            filename=results["b"]["filename"],
            page_count=parsed_b["metadata"].get("page_count", 1),
            file_type=parsed_b["metadata"].get("file_type", "unknown"),
            char_count=len(parsed_b["text"]),
        ),
        similarity_score=diff_result["similarity_score"],
        diff_blocks=[
            DiffBlock(
                type=b["type"],
                content=b["content"],
                content_b=b.get("content_b"),
                location=b["location"],
            )
            for b in meaningful_blocks
        ],
        stats=diff_result["stats"],
        analysis=ComparisonAnalysis(
            change_summary=analysis.get("change_summary", ""),
            risk_delta=analysis.get("risk_delta", ""),
            key_changes=[
                KeyChange(
                    change=kc.get("change", ""),
                    severity=kc.get("severity", "medium"),
                    section=kc.get("section", ""),
                )
                for kc in analysis.get("key_changes", [])
            ],
            recommendation=analysis.get("recommendation", ""),
        ),
    )
