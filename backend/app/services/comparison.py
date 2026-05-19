"""
Comparative Analysis Service — F-07
Handles document text diffing and LLM-powered change/risk analysis.

Diff Strategy:
  - Paragraph-level diffing (split on double newlines) for meaningful granularity
  - Uses Python stdlib difflib — no extra dependencies
"""

import difflib
import logging
from typing import Optional

logger = logging.getLogger("documind.comparison")


# ---------------------------------------------------------------------------
# Text Diff Engine
# ---------------------------------------------------------------------------

def _split_paragraphs(text: str) -> list[str]:
    """Split text into non-empty paragraphs."""
    paragraphs = [p.strip() for p in text.split("\n\n")]
    return [p for p in paragraphs if p]


def compute_diff(text_a: str, text_b: str) -> dict:
    """
    Compute a structured paragraph-level diff between two document texts.

    Returns:
        {
            "similarity_score": float (0-1),
            "diff_blocks": [
                {"type": "added"|"removed"|"changed"|"unchanged", "content": str, "content_b": str|None, "location": str}
            ],
            "stats": {"added": int, "removed": int, "changed": int, "unchanged": int}
        }
    """
    paras_a = _split_paragraphs(text_a)
    paras_b = _split_paragraphs(text_b)

    # Compute overall similarity score
    matcher = difflib.SequenceMatcher(None, text_a, text_b)
    similarity = round(matcher.ratio(), 4)

    # Use SequenceMatcher at paragraph level for structural diff
    para_matcher = difflib.SequenceMatcher(None, paras_a, paras_b)
    opcodes = para_matcher.get_opcodes()

    diff_blocks = []
    stats = {"added": 0, "removed": 0, "changed": 0, "unchanged": 0}

    for tag, i1, i2, j1, j2 in opcodes:
        if tag == "equal":
            for k in range(i1, i2):
                diff_blocks.append({
                    "type": "unchanged",
                    "content": paras_a[k],
                    "content_b": None,
                    "location": f"Paragraph {k + 1}",
                })
            stats["unchanged"] += (i2 - i1)

        elif tag == "delete":
            for k in range(i1, i2):
                diff_blocks.append({
                    "type": "removed",
                    "content": paras_a[k],
                    "content_b": None,
                    "location": f"Document A — Paragraph {k + 1}",
                })
            stats["removed"] += (i2 - i1)

        elif tag == "insert":
            for k in range(j1, j2):
                diff_blocks.append({
                    "type": "added",
                    "content": paras_b[k],
                    "content_b": None,
                    "location": f"Document B — Paragraph {k + 1}",
                })
            stats["added"] += (j2 - j1)

        elif tag == "replace":
            # Pair up replaced paragraphs
            old_paras = paras_a[i1:i2]
            new_paras = paras_b[j1:j2]
            max_len = max(len(old_paras), len(new_paras))
            for k in range(max_len):
                old = old_paras[k] if k < len(old_paras) else None
                new = new_paras[k] if k < len(new_paras) else None
                if old and new:
                    diff_blocks.append({
                        "type": "changed",
                        "content": old,
                        "content_b": new,
                        "location": f"Paragraph {i1 + k + 1}",
                    })
                    stats["changed"] += 1
                elif old:
                    diff_blocks.append({
                        "type": "removed",
                        "content": old,
                        "content_b": None,
                        "location": f"Document A — Paragraph {i1 + k + 1}",
                    })
                    stats["removed"] += 1
                elif new:
                    diff_blocks.append({
                        "type": "added",
                        "content": new,
                        "content_b": None,
                        "location": f"Document B — Paragraph {j1 + k + 1}",
                    })
                    stats["added"] += 1

    logger.info(
        "Diff computed: similarity=%.2f, +%d -%d ~%d =%d",
        similarity, stats["added"], stats["removed"], stats["changed"], stats["unchanged"],
    )

    return {
        "similarity_score": similarity,
        "diff_blocks": diff_blocks,
        "stats": stats,
    }


# ---------------------------------------------------------------------------
# LLM-Powered Comparison Analysis
# ---------------------------------------------------------------------------

COMPARISON_SYSTEM_PROMPT = """You are DocuMind AI, an expert document analyst specializing in comparative analysis.
You are given two versions of a document and a structured diff between them.
Your job is to analyze the changes and provide a comprehensive comparison report.
IMPORTANT: You MUST respond in valid JSON format ONLY. No markdown code blocks. No extra text outside the JSON."""


def generate_comparison_analysis(
    text_a: str,
    text_b: str,
    diff_result: dict,
    filename_a: str = "Document A",
    filename_b: str = "Document B",
) -> dict:
    """
    Use the LLM to generate a comprehensive comparison analysis.

    Returns:
        {
            "change_summary": str,
            "risk_delta": str,
            "key_changes": [{"change": str, "severity": "high"|"medium"|"low", "section": str}],
            "recommendation": str
        }
    """
    from app.services.llm import _call_llm, _extract_json

    # Build a concise diff summary for the LLM (truncate to fit context)
    diff_summary_parts = []
    for block in diff_result["diff_blocks"]:
        if block["type"] == "unchanged":
            continue  # Skip unchanged blocks to save tokens
        entry = f"[{block['type'].upper()}] ({block['location']}): "
        if block["type"] == "changed":
            entry += f"OLD: {block['content'][:300]} → NEW: {block['content_b'][:300]}"
        else:
            entry += block["content"][:400]
        diff_summary_parts.append(entry)

    # Truncate diff to ~8000 chars for context window
    diff_text = "\n\n".join(diff_summary_parts)
    if len(diff_text) > 8000:
        diff_text = diff_text[:8000] + "\n\n[... diff truncated for length ...]"

    # Truncate document texts for additional context
    text_a_truncated = text_a[:6000]
    text_b_truncated = text_b[:6000]

    stats = diff_result["stats"]
    similarity = diff_result["similarity_score"]

    user_prompt = f"""Compare these two documents and provide a detailed analysis of the changes.

DOCUMENT A ("{filename_a}") — ORIGINAL:
{text_a_truncated}

DOCUMENT B ("{filename_b}") — REVISED:
{text_b_truncated}

STRUCTURED DIFF (similarity: {similarity:.1%}, +{stats['added']} added, -{stats['removed']} removed, ~{stats['changed']} modified):
{diff_text}

Analyze the changes between Document A and Document B. Respond in this exact JSON format:
{{"change_summary": "A comprehensive 3-5 sentence summary of what changed between the two versions. Mention specific sections, clauses, or topics that were added, removed, or modified.",
"risk_delta": "Describe any NEW risks, liabilities, obligations, or concerns introduced in the newer version (Document B) that were not present in the original (Document A). If no new risks, say so explicitly.",
"key_changes": [{{"change": "Description of a specific change", "severity": "high or medium or low", "section": "Where in the document this change occurs"}}],
"recommendation": "Overall assessment: is the revised version an improvement? Are there concerns the user should be aware of? Provide a brief, actionable recommendation."}}"""

    raw_response = _call_llm(user_prompt, COMPARISON_SYSTEM_PROMPT)
    result = _extract_json(raw_response)

    # Ensure required keys exist with fallbacks
    if "change_summary" not in result:
        result["change_summary"] = raw_response.strip()
    if "risk_delta" not in result:
        result["risk_delta"] = "Could not determine risk changes."
    if "key_changes" not in result:
        result["key_changes"] = []
    if "recommendation" not in result:
        result["recommendation"] = "Please review the diff details above for a manual assessment."

    logger.info("Comparison analysis generated: %d key changes identified", len(result.get("key_changes", [])))
    return result
