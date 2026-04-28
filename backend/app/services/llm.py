"""
LLM Service — F-02: Instant Document Summarization
Handles summary generation and RAG-based Q&A answer generation.
Uses Ollama (local Mistral) as primary, with Groq as free-tier cloud fallback.
"""

import json
import logging
import re
from typing import Optional

import httpx

from app.core.config import get_settings

logger = logging.getLogger("documind.llm")


# ---------------------------------------------------------------------------
# JSON Extraction Helper
# ---------------------------------------------------------------------------
def _extract_json(raw: str) -> dict:
    """
    Robustly extract JSON from LLM output that may be wrapped in
    markdown code blocks (```json ... ```) or contain preamble text.
    """
    # Try direct parse first
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass

    # Try extracting from markdown code block
    match = re.search(r"```(?:json)?\s*\n?(.*?)\n?\s*```", raw, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1).strip())
        except json.JSONDecodeError:
            pass

    # Try finding the first { ... } block
    brace_match = re.search(r"\{.*\}", raw, re.DOTALL)
    if brace_match:
        try:
            return json.loads(brace_match.group(0))
        except json.JSONDecodeError:
            pass

    # Give up — return raw text as summary
    return {"summary": raw.strip(), "citations": []}


# ---------------------------------------------------------------------------
# LLM Call Abstraction
# ---------------------------------------------------------------------------
def _call_ollama(prompt: str, system: str = "") -> str:
    """Call a local Ollama instance (primary LLM) via the /api/chat endpoint."""
    settings = get_settings()
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    try:
        response = httpx.post(
            f"{settings.ollama_base_url}/api/chat",
            json={
                "model": settings.ollama_model,
                "messages": messages,
                "stream": False,
                "options": {
                    "temperature": 0.3,
                    "num_predict": 4096,
                },
            },
            timeout=300.0,  # 5 min — Mistral 7B can be slow on first cold request
        )
        response.raise_for_status()
        return response.json().get("message", {}).get("content", "")
    except (httpx.HTTPError, httpx.TimeoutException, Exception) as e:
        logger.warning("Ollama call failed: %s — falling back to Groq", str(e))
        return _call_groq(prompt, system)


def _call_groq(prompt: str, system: str = "") -> str:
    """Fallback: call Groq API (free tier — fast inference)."""
    settings = get_settings()
    if not settings.groq_api_key or settings.groq_api_key.startswith("your-"):
        raise RuntimeError(
            "No LLM available: Ollama unreachable and GROQ_API_KEY not set."
        )

    try:
        from groq import Groq

        client = Groq(api_key=settings.groq_api_key)

        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        chat_completion = client.chat.completions.create(
            messages=messages,
            model=settings.groq_model,
            temperature=0.3,
            max_tokens=4096,
        )

        return chat_completion.choices[0].message.content or ""
    except Exception as e:
        logger.error("Groq call failed: %s", str(e))
        raise RuntimeError(f"All LLM providers failed. Groq error: {str(e)}")


def _call_llm(prompt: str, system: str = "") -> str:
    """Route to the best available LLM: Groq (fast cloud) → Ollama (local fallback)."""
    return _call_groq_primary(prompt, system)


def _call_groq_primary(prompt: str, system: str = "") -> str:
    """Primary: Groq API (fast, free tier). Falls back to Ollama if unavailable."""
    settings = get_settings()
    if not settings.groq_api_key or settings.groq_api_key.startswith("your-"):
        logger.info("No Groq API key configured — trying Ollama")
        return _call_ollama_standalone(prompt, system)

    try:
        from groq import Groq

        client = Groq(api_key=settings.groq_api_key)

        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        chat_completion = client.chat.completions.create(
            messages=messages,
            model=settings.groq_model,
            temperature=0.3,
            max_tokens=4096,
        )

        return chat_completion.choices[0].message.content or ""
    except Exception as e:
        logger.warning("Groq call failed: %s — falling back to Ollama", str(e))
        return _call_ollama_standalone(prompt, system)


def _call_ollama_standalone(prompt: str, system: str = "") -> str:
    """Standalone Ollama call (no further fallback). Raises on failure."""
    settings = get_settings()
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    try:
        response = httpx.post(
            f"{settings.ollama_base_url}/api/chat",
            json={
                "model": settings.ollama_model,
                "messages": messages,
                "stream": False,
                "options": {
                    "temperature": 0.3,
                    "num_predict": 4096,
                },
            },
            timeout=300.0,
        )
        response.raise_for_status()
        return response.json().get("message", {}).get("content", "")
    except Exception as e:
        raise RuntimeError(f"Ollama also failed: {str(e)}")


# ---------------------------------------------------------------------------
# Summary Generation — F-02
# ---------------------------------------------------------------------------
SUMMARY_SYSTEM_PROMPT = """You are DocuMind AI, an expert document analyst.
You analyze the ACTUAL CONTENT of documents — the real text, ideas, facts, arguments, and data.
NEVER describe metadata, file properties, or the structure of the document itself.
Focus exclusively on WHAT THE DOCUMENT SAYS — the substance.
Generate summaries with inline citations referencing specific pages or sections.
Always cite your sources like: (Page X) or (Section Y).
Return your response as valid JSON. Do NOT wrap it in markdown code blocks."""


def _build_page_context(pages: list[str], max_chars: int = 12000) -> str:
    """Build page-annotated text for the LLM, truncated to max_chars."""
    parts = []
    total = 0
    for i, page_text in enumerate(pages):
        header = f"\n--- PAGE {i + 1} ---\n"
        remaining = max_chars - total
        if remaining <= 0:
            break
        chunk = page_text[:remaining]
        parts.append(header + chunk)
        total += len(header) + len(chunk)
    return "".join(parts)


def generate_summary(
    text: str,
    level: str = "executive",
    pages: list[str] | None = None,
) -> dict:
    """
    Generate a tiered summary of the document.
    Uses page-level context when available for accurate citations.
    """
    # Build page-aware document context
    if pages and len(pages) > 1:
        doc_context = _build_page_context(pages, max_chars=14000)
    else:
        doc_context = text[:14000]

    if level == "executive":
        user_prompt = f"""Read the following document carefully and write a 3-5 sentence executive summary.
Focus on the ACTUAL CONTENT — what the document is about, its key arguments, findings, and conclusions.
Do NOT describe the file format, metadata, or page structure.
Each sentence should capture a critical takeaway from the real substance of the document.
Include inline citations referencing the page number, e.g. (Page 1).

Respond in this exact JSON format:
{{"summary": "Your executive summary here. Each sentence covers a key point (Page X).", "citations": [{{"text": "quoted phrase from doc", "page": 1, "section": "relevant section"}}]}}

DOCUMENT TEXT:
{doc_context}"""

    elif level == "section":
        user_prompt = f"""Read the following document and identify 3-7 logical topics or sections based on its CONTENT.
For each topic, write a descriptive title and a 2-3 sentence summary of what it covers.
Focus on the substance — real facts, arguments, skills, experience, data — NOT metadata or formatting.

Respond in this exact JSON format:
{{"sections": [{{"title": "Topic Title", "summary": "What this section covers...", "page": 1}}], "summary": "One-line overview of the document's structure.", "citations": [{{"text": "quoted phrase", "page": 1, "section": "Topic Title"}}]}}

DOCUMENT TEXT:
{doc_context}"""

    elif level == "entities":
        user_prompt = f"""Extract all key entities mentioned in the CONTENT of this document.
Categories:
- People: named individuals mentioned
- Organizations: companies, institutions, teams
- Dates: any dates, deadlines, time periods
- Amounts: monetary values, statistics, quantities
- Terms: key technical terms, skills, technologies, concepts

Be thorough. Extract EVERY entity you can find in the actual text.

Respond in this exact JSON format:
{{"entities": {{"people": ["Name 1"], "organizations": ["Org 1"], "dates": ["2024"], "amounts": ["$1M"], "terms": ["Python", "Machine Learning"]}}, "summary": "Brief overview of key entities.", "citations": [{{"text": "entity name", "page": 1, "section": "..."}}]}}

DOCUMENT TEXT:
{doc_context}"""

    else:
        raise ValueError(f"Unknown summary level: {level}")

    raw_response = _call_llm(user_prompt, SUMMARY_SYSTEM_PROMPT)
    result = _extract_json(raw_response)

    # Ensure required keys exist
    if "summary" not in result:
        result["summary"] = raw_response.strip()
    if "citations" not in result:
        result["citations"] = []

    return result


def generate_tiered_summary(text: str, pages: list[str] | None = None) -> dict:
    """
    Generate all three summary tiers for the auto-analyze flow.
    Returns combined results. Continues even if individual tiers fail.
    """
    results = {
        "executive": None,
        "sections": None,
        "entities": None,
        "errors": [],
    }

    # Executive summary
    try:
        results["executive"] = generate_summary(text, level="executive", pages=pages)
    except Exception as e:
        logger.error("Executive summary failed: %s", str(e))
        results["errors"].append(f"Executive summary: {str(e)}")

    # Section breakdown
    try:
        results["sections"] = generate_summary(text, level="section", pages=pages)
    except Exception as e:
        logger.error("Section summary failed: %s", str(e))
        results["errors"].append(f"Section breakdown: {str(e)}")

    # Entity extraction
    try:
        results["entities"] = generate_summary(text, level="entities", pages=pages)
    except Exception as e:
        logger.error("Entity extraction failed: %s", str(e))
        results["errors"].append(f"Entity extraction: {str(e)}")

    return results


# ---------------------------------------------------------------------------
# RAG Answer Generation
# ---------------------------------------------------------------------------
QA_SYSTEM_PROMPT = """You are DocuMind AI, an expert document Q&A assistant.
Answer the user's question based ONLY on the provided context chunks.
If the answer is not in the context, say "I couldn't find this information in the document."
NEVER hallucinate or make up information.
Always cite which chunk/section your answer comes from.
Suggest 2-3 relevant follow-up questions the user might ask.

Respond in this JSON format (no markdown code blocks):
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
    result = _extract_json(raw_response)

    # Ensure required keys
    if "answer" not in result:
        result["answer"] = raw_response.strip()
    if "citations" not in result:
        result["citations"] = []
    if "follow_up_questions" not in result:
        result["follow_up_questions"] = []

    return result
