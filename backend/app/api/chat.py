"""
Conversational Q&A (RAG Chat) endpoint.
"""

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.rag_pipeline import retrieve_context, resolve_to_vector_id
from app.services.llm import generate_answer
from app.services.database import get_documents_by_folder

router = APIRouter(tags=["chat"])
logger = logging.getLogger("documind.chat")


class ChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    document_id: str | None = None
    folder_id: str | None = None
    question: str
    history: list[ChatMessage] = []


class SourceCitation(BaseModel):
    text: str
    page: int | None = None
    section: str | None = None
    filename: str | None = None
    score: float | None = None


class ChatResponse(BaseModel):
    answer: str
    citations: list[SourceCitation] = []
    follow_up_questions: list[str] = []


@router.post("/chat", response_model=ChatResponse)
async def chat_with_document(req: ChatRequest):
    """
    Ask a natural-language question against an indexed document.
    Uses RAG: semantic search → re-rank → LLM generation with citations.
    """
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty.")

    logger.info("Chat query: [redacted %d chars]", len(req.question))

    document_ids = []
    if req.folder_id:
        docs = get_documents_by_folder(req.folder_id)
        if not docs:
            raise HTTPException(status_code=404, detail="Folder is empty or not found.")
        document_ids = [d["doc_vector_id"] for d in docs if d.get("doc_vector_id")]
        if not document_ids:
            raise HTTPException(status_code=404, detail="No indexed documents found in folder.")
    elif req.document_id:
        resolved_id = resolve_to_vector_id(req.document_id)
        document_ids = [resolved_id]
    else:
        raise HTTPException(status_code=400, detail="Must provide document_id or folder_id.")

    # --- Retrieve relevant context chunks ---
    try:
        context_chunks = retrieve_context(document_ids, req.question, top_k=8)
    except Exception as e:
        logger.error("Context retrieval failed: %s", str(e))
        raise HTTPException(status_code=500, detail="Failed to search document.")

    if not context_chunks:
        # Even without matching chunks, let the LLM try with a general note
        context_chunks = [{
            "text": "No specific matching passages were found in the document for this query. "
                    "Answer based on your general knowledge if possible.",
            "chunk_index": 0,
            "page": None,
            "score": 0,
        }]

    # --- Generate grounded answer ---
    try:
        result = generate_answer(
            question=req.question,
            context_chunks=context_chunks,
            chat_history=[msg.model_dump() for msg in req.history],
        )
    except Exception as e:
        logger.error("Answer generation failed: %s", str(e))
        raise HTTPException(status_code=500, detail="Failed to generate answer.")

    return ChatResponse(
        answer=result["answer"],
        citations=[SourceCitation(**c) for c in result.get("citations", [])],
        follow_up_questions=result.get("follow_up_questions", []),
    )
