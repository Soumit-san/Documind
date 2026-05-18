"""
LLM Service — F-02 + F-03: Document Summarization & Conversational Q&A
Handles summary generation and RAG-based Q&A answer generation.

LLM Routing Chain:
  1. Google Gemini (primary — fast, free tier, 1M token context)
  2. Groq (fallback — fast inference, free tier)
  3. Ollama (local fallback — completely free, no API key)
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

    # Try finding the first { ... } block (greedy — outermost braces)
    brace_match = re.search(r"\{.*\}", raw, re.DOTALL)
    if brace_match:
        try:
            return json.loads(brace_match.group(0))
        except json.JSONDecodeError:
            pass

    # Last resort: strip any leading/trailing non-JSON text and retry
    cleaned = raw.strip()
    # Remove common LLM prefixes like "Here is the JSON:" etc.
    cleaned = re.sub(r'^[^{]*', '', cleaned, count=1)
    cleaned = re.sub(r'[^}]*$', '', cleaned, count=1)
    if cleaned:
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            pass

    # Give up — return raw text as summary, but clean it first
    # Strip any JSON artifacts that leaked into the text
    text = raw.strip()
    text = re.sub(r'^\s*\{?\s*"summary"\s*:\s*"?', '', text)  # Remove leading {"summary":
    text = re.sub(r'"?\s*,\s*"citations".*$', '', text, flags=re.DOTALL)  # Remove trailing ,"citations"...
    text = text.strip(' "}')
    return {"summary": text or raw.strip(), "citations": []}


# ---------------------------------------------------------------------------
# LLM Call Abstraction — Provider Implementations
# ---------------------------------------------------------------------------

def _call_gemini(prompt: str, system: str = "") -> str:
    """Call Google Gemini API (primary LLM) via the google-genai SDK."""
    settings = get_settings()
    if not settings.gemini_api_key or settings.gemini_api_key.startswith("your-"):
        raise RuntimeError("Gemini API key not configured")

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=settings.gemini_api_key)

        config = types.GenerateContentConfig(
            system_instruction=system if system else None,
            temperature=0.3,
            max_output_tokens=4096,
        )

        response = client.models.generate_content(
            model=settings.gemini_model,
            contents=prompt,
            config=config,
        )

        return response.text or ""
    except Exception as e:
        logger.warning("Gemini call failed: %s — falling back to Groq", str(e))
        raise


def _call_groq(prompt: str, system: str = "") -> str:
    """Fallback: call Groq API (free tier — fast inference)."""
    settings = get_settings()
    if not settings.groq_api_key or settings.groq_api_key.startswith("your-"):
        raise RuntimeError("Groq API key not configured")

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
        logger.warning("Groq call failed: %s", str(e))
        raise


def _call_ollama(prompt: str, system: str = "") -> str:
    """Local fallback: call Ollama instance. Raises on failure."""
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


def _call_llm(prompt: str, system: str = "") -> str:
    """
    Route to the best available LLM with automatic fallback.
    Chain: Gemini → Groq → Ollama
    """
    # 1. Try Gemini (primary)
    try:
        result = _call_gemini(prompt, system)
        logger.info("[Gemini] Response received successfully")
        return result
    except Exception as e:
        logger.warning("[Gemini] Failed: %s — trying Groq", str(e)[:100])

    # 2. Try Groq (secondary)
    try:
        result = _call_groq(prompt, system)
        logger.info("[Groq] Response received successfully")
        return result
    except Exception as e:
        logger.warning("[Groq] Failed: %s — trying Ollama", str(e)[:100])

    # 3. Try Ollama (last resort)
    try:
        result = _call_ollama(prompt, system)
        logger.info("[Ollama] Response received successfully")
        return result
    except Exception as e:
        raise RuntimeError(
            f"All LLM providers failed. Last error (Ollama): {str(e)}"
        )


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
# RAG Answer Generation — F-03
# ---------------------------------------------------------------------------
QA_SYSTEM_PROMPT = """You are DocuMind AI, an intelligent document Q&A assistant.
Your primary knowledge comes from the provided document context chunks.

Rules:
1. ALWAYS answer the user's question as helpfully and thoroughly as possible.
2. Use the document context chunks as your PRIMARY source. Cite filenames and pages when referencing specific document content.
3. If the document mentions a topic (e.g. a person's name, a term, an organization), use what the document says AND supplement with relevant general knowledge to give a complete answer.
4. If the document does NOT contain information about the topic at all, say so clearly but still try to give a helpful general answer if you can.
5. NEVER refuse to answer. Always provide the best response you can.
6. When citing document content, use inline references like (Filename.pdf, Page 3).
7. Suggest 2-3 relevant follow-up questions the user might ask about the documents.

Respond in this JSON format (no markdown code blocks):
{"answer": "Your detailed answer here with inline citations like (Filename.pdf, Page 3).", "citations": [{"text": "quoted excerpt", "filename": "Filename.pdf", "page": 3, "section": "relevant section"}], "follow_up_questions": ["Question 1?", "Question 2?", "Question 3?"]}"""


def generate_answer(
    question: str,
    context_chunks: list[dict],
    chat_history: Optional[list[dict]] = None,
) -> dict:
    """
    Generate a grounded, cited answer using retrieved context chunks.
    """
    # Format context with page numbers and filenames
    context_str = ""
    for i, chunk in enumerate(context_chunks):
        page_info = f", page: {chunk['page']}" if chunk.get('page') else ""
        file_info = f", file: {chunk.get('filename', 'Unknown')}"
        context_str += f"\n--- Chunk {i + 1} (relevance: {chunk.get('score', 'N/A')}{file_info}{page_info}) ---\n{chunk['text']}\n"

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


# ---------------------------------------------------------------------------
# Smart Annotations — F-06
# ---------------------------------------------------------------------------
ANNOTATION_SYSTEM_PROMPT = """You are DocuMind AI, an intelligent document assistant.
Your task is to help the user understand, translate, or improve a specific highlighted passage from a document.
Provide concise, accurate, and helpful responses.
IMPORTANT: You MUST respond in valid JSON format ONLY. No markdown code blocks. No extra text outside the JSON."""


def generate_annotation(text: str, action: str, language: str = None) -> dict:
    """
    Generate an annotation action (explain, translate, suggest) for a selected text.
    """
    if action == "explain":
        user_prompt = f"""Explain the following text in plain, easy-to-understand language. Clarify any complex terms or jargon. Keep your explanation concise (2-4 sentences).

Respond in this exact JSON format:
{{"result": "Your plain language explanation here."}}

TEXT TO EXPLAIN:
{text}"""

    elif action == "translate":
        target_lang = language or "English"
        user_prompt = f"""Translate the following text into {target_lang}.

CRITICAL RULES:
- You MUST output the translated text written in the native script of {target_lang}.
- For Hindi, use Devanagari script (e.g., "नमस्ते").
- For Japanese, use Japanese script (Kanji/Hiragana/Katakana).
- For Chinese, use Chinese characters (Hanzi).
- For French, German, Spanish, etc., use their standard Latin-based scripts with proper accents.
- Do NOT transliterate into English letters. Use the actual native script.
- Maintain the original professional tone and meaning.

Respond in this exact JSON format:
{{"result": "The full translated text in {target_lang} native script here."}}

TEXT TO TRANSLATE:
{text}"""

    elif action == "suggest":
        user_prompt = f"""Review the following text. Suggest alternative phrasings to make it clearer, more concise, or more professional. If it contains ambiguous legal or technical language, flag it and offer a better alternative. Keep suggestions concise.

Respond in this exact JSON format:
{{"result": "Your suggested improvements and alternative phrasings here."}}

TEXT TO REVIEW:
{text}"""

    else:
        raise ValueError(f"Unknown annotation action: {action}")

    raw_response = _call_llm(user_prompt, ANNOTATION_SYSTEM_PROMPT)
    result = _extract_json(raw_response)

    if "result" not in result:
        result["result"] = raw_response.strip()

    return result
