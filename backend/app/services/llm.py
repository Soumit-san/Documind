"""
LLM Service
Handles summary generation and RAG-based Q&A answer generation.
Uses Ollama (local) as default, with Gemini/Groq as free-tier fallbacks.
"""

import json
import logging
from typing import Optional

import httpx

from app.core.config import get_settings

logger = logging.getLogger("documind.llm")


# ---------------------------------------------------------------------------
# LLM Call Abstraction
# ---------------------------------------------------------------------------
def _call_ollama(prompt: str, system: str = "", model: str = "mistral") -> str:
    """Call a local Ollama instance."""
    settings = get_settings()
    try:
        response = httpx.post(
            f"{settings.ollama_base_url}/api/generate",
            json={
                "model": model,
                "prompt": prompt,
                "system": system,
                "stream": False,
            },
            timeout=120.0,
        )
        response.raise_for_status()
        return response.json().get("response", "")
    except httpx.HTTPError as e:
        logger.warning("Ollama call failed: %s — falling back to cloud LLM", str(e))
        return _call_gemini(prompt, system)


def _call_gemini(prompt: str, system: str = "") -> str:
    """Fallback: call Google Gemini 1.5 Flash (free tier)."""
    settings = get_settings()
    if not settings.gemini_api_key:
        raise RuntimeError("No LLM available: Ollama unreachable and GEMINI_API_KEY not set.")

    full_prompt = f"{system}\n\n{prompt}" if system else prompt

    response = httpx.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={settings.gemini_api_key}",
        json={
            "contents": [{"parts": [{"text": full_prompt}]}],
        },
        timeout=60.0,
    )
    response.raise_for_status()
    data = response.json()
    return data["candidates"][0]["content"]["parts"][0]["text"]


def _call_llm(prompt: str, system: str = "") -> str:
    """Route to the best available LLM."""
    return _call_ollama(prompt, system)


# ---------------------------------------------------------------------------
# Summary Generation
# ---------------------------------------------------------------------------
SUMMARY_SYSTEM_PROMPT = """You are DocuMind AI, an expert document analyst.
Generate summaries with inline citations referencing specific pages or sections.
Always cite your sources like: (Page X) or (Section Y).
If you cannot determine the page, cite the approximate location in the text.
Return your response as valid JSON."""


def generate_summary(text: str, level: str = "executive") -> dict:
    """
    Generate a tiered summary of the document.
    """
    if level == "executive":
        user_prompt = f"""Summarize the following document in 3-5 concise sentences.
Include inline citations.

Respond in this JSON format:
{{"summary": "...", "citations": [{{"text": "...", "page": 1, "section": "..."}}]}}

DOCUMENT:
{text[:8000]}"""
    elif level == "section":
        user_prompt = f"""Provide a section-by-section breakdown summary of this document.
Include inline citations for each section.

Respond in this JSON format:
{{"summary": "...", "citations": [{{"text": "...", "page": 1, "section": "..."}}]}}

DOCUMENT:
{text[:12000]}"""
    elif level == "entities":
        user_prompt = f"""Extract all key entities from this document:
- People / Organizations
- Dates / Deadlines
- Monetary amounts
- Key terms and clauses

Respond in this JSON format:
{{"summary": "...", "citations": [{{"text": "...", "page": 1, "section": "..."}}]}}

DOCUMENT:
{text[:10000]}"""
    else:
        raise ValueError(f"Unknown summary level: {level}")

    raw_response = _call_llm(user_prompt, SUMMARY_SYSTEM_PROMPT)

    # Try to parse as JSON, fallback to plain text
    try:
        result = json.loads(raw_response)
    except json.JSONDecodeError:
        result = {"summary": raw_response, "citations": []}

    return result


# ---------------------------------------------------------------------------
# RAG Answer Generation
# ---------------------------------------------------------------------------
QA_SYSTEM_PROMPT = """You are DocuMind AI, an expert document Q&A assistant.
Answer the user's question based ONLY on the provided context chunks.
If the answer is not in the context, say "I couldn't find this information in the document."
NEVER hallucinate or make up information.
Always cite which chunk/section your answer comes from.
Suggest 2-3 relevant follow-up questions the user might ask.

Respond in this JSON format:
{"answer": "...", "citations": [{"text": "...", "page": null, "section": "chunk N"}], "follow_up_questions": ["...", "..."]}"""


def generate_answer(
    question: str,
    context_chunks: list[dict],
    chat_history: Optional[list[dict]] = None,
) -> dict:
    """
    Generate a grounded, cited answer using retrieved context chunks.
    """
    # Format context
    context_str = ""
    for i, chunk in enumerate(context_chunks):
        context_str += f"\n--- Chunk {i + 1} (relevance: {chunk.get('score', 'N/A')}) ---\n{chunk['text']}\n"

    # Format chat history
    history_str = ""
    if chat_history:
        for msg in chat_history[-6:]:  # Keep last 6 messages for context window
            history_str += f"\n{msg['role'].upper()}: {msg['content']}"

    user_prompt = f"""CONTEXT FROM DOCUMENT:
{context_str}

{f'CONVERSATION HISTORY:{history_str}' if history_str else ''}

USER QUESTION: {question}"""

    raw_response = _call_llm(user_prompt, QA_SYSTEM_PROMPT)

    # Try to parse as JSON, fallback to plain text
    try:
        result = json.loads(raw_response)
    except json.JSONDecodeError:
        result = {
            "answer": raw_response,
            "citations": [],
            "follow_up_questions": [],
        }

    return result
