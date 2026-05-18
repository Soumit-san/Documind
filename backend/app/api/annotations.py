from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import Optional
import logging

from app.services.llm import generate_annotation

logger = logging.getLogger("documind.api.annotations")

router = APIRouter(tags=["Annotations"])


class AnnotationRequest(BaseModel):
    text: str = Field(..., description="The highlighted text to process.")
    action: str = Field(..., description="The action to perform: explain, translate, suggest.")
    language: Optional[str] = Field(None, description="Target language for translation.")


class AnnotationResponse(BaseModel):
    result: str


@router.post("/annotations", response_model=AnnotationResponse)
async def create_annotation(request: AnnotationRequest):
    """
    Perform a smart annotation action (explain, translate, suggest) on the provided text.
    """
    if request.action not in ["explain", "translate", "suggest"]:
        raise HTTPException(status_code=400, detail="Invalid action. Must be 'explain', 'translate', or 'suggest'.")

    if request.action == "translate" and not request.language:
        raise HTTPException(status_code=400, detail="Language is required for translation action.")

    try:
        result_dict = generate_annotation(
            text=request.text,
            action=request.action,
            language=request.language
        )
        return AnnotationResponse(result=result_dict.get("result", ""))
    except Exception as e:
        logger.error(f"Annotation failed: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to generate annotation.")
