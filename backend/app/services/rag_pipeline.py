"""
RAG Pipeline Service
Handles chunking, embedding, vector indexing, and context retrieval using ChromaDB.
All data is persisted to disk so documents survive server restarts.
"""

import hashlib
import json
import logging
import os
from pathlib import Path
from typing import Optional

import chromadb
from chromadb.config import Settings as ChromaSettings

logger = logging.getLogger("documind.rag")

# ---------------------------------------------------------------------------
# Persistence paths (inside backend/ directory)
# ---------------------------------------------------------------------------
_PERSIST_DIR = Path(__file__).resolve().parent.parent.parent / ".chroma_data"
_DOC_STORE_PATH = _PERSIST_DIR / "document_store.json"

# ---------------------------------------------------------------------------
# ChromaDB Client (Singleton — persistent)
# ---------------------------------------------------------------------------
_chroma_client: Optional[chromadb.ClientAPI] = None
_collection_name = "documind_documents"

# Persistent store for full document data (keyed by doc_id)
_document_store: dict[str, dict] = {}
_store_loaded = False


def _ensure_persist_dir():
    _PERSIST_DIR.mkdir(parents=True, exist_ok=True)


def _load_document_store():
    """Load the document store from disk on first access."""
    global _document_store, _store_loaded
    if _store_loaded:
        return
    _ensure_persist_dir()
    if _DOC_STORE_PATH.exists():
        try:
            with open(_DOC_STORE_PATH, "r", encoding="utf-8") as f:
                _document_store = json.load(f)
            logger.info("Loaded %d documents from persistent store", len(_document_store))
        except Exception as e:
            logger.error("Failed to load document store: %s", str(e))
            _document_store = {}
    _store_loaded = True


def _save_document_store():
    """Save the document store to disk."""
    _ensure_persist_dir()
    try:
        with open(_DOC_STORE_PATH, "w", encoding="utf-8") as f:
            json.dump(_document_store, f, ensure_ascii=False)
    except Exception as e:
        logger.error("Failed to save document store: %s", str(e))


def _get_chroma_client() -> chromadb.ClientAPI:
    global _chroma_client
    if _chroma_client is None:
        _ensure_persist_dir()
        _chroma_client = chromadb.PersistentClient(
            path=str(_PERSIST_DIR / "chromadb"),
            settings=ChromaSettings(anonymized_telemetry=False),
        )
        logger.info("ChromaDB persistent client initialized at %s", _PERSIST_DIR / "chromadb")
    return _chroma_client


def _get_collection():
    client = _get_chroma_client()
    return client.get_or_create_collection(
        name=_collection_name,
        metadata={"hnsw:space": "cosine"},
    )


# ---------------------------------------------------------------------------
# Chunking (512 tokens ≈ ~2048 chars, 64 token overlap ≈ ~256 chars)
# ---------------------------------------------------------------------------
CHUNK_SIZE = 2000   # characters (approx 512 tokens)
CHUNK_OVERLAP = 250  # characters (approx 64 tokens)


def chunk_text(text: str) -> list[str]:
    """Split text into overlapping chunks."""
    chunks = []
    start = 0
    while start < len(text):
        end = start + CHUNK_SIZE
        chunk = text[start:end]
        if chunk.strip():
            chunks.append(chunk.strip())
        start += CHUNK_SIZE - CHUNK_OVERLAP
    return chunks


# ---------------------------------------------------------------------------
# Index a Document
# ---------------------------------------------------------------------------
def index_document(text: str, metadata: dict, pages: list[str] | None = None) -> dict:
    """
    Chunk text, generate IDs, and upsert into ChromaDB.
    ChromaDB uses its built-in default embedding function (all-MiniLM-L6-v2).
    Both vectors and full text are persisted to disk.
    """
    _load_document_store()

    doc_id = hashlib.sha256(text[:1000].encode()).hexdigest()[:16]
    chunks = chunk_text(text)

    if not chunks:
        raise ValueError("Document produced no text chunks.")

    # Store full document data for later retrieval (text + pages + metadata)
    _document_store[doc_id] = {
        "text": text,
        "pages": pages or [text],
        "metadata": metadata,
    }
    _save_document_store()

    collection = _get_collection()
    ids = [f"{doc_id}_chunk_{i}" for i in range(len(chunks))]
    metadatas = [
        {
            "doc_id": doc_id,
            "chunk_index": i,
            "filename": metadata.get("filename", "unknown"),
            "file_type": metadata.get("file_type", "unknown"),
        }
        for i in range(len(chunks))
    ]

    # Upsert in batches of 100
    batch_size = 100
    for i in range(0, len(chunks), batch_size):
        collection.upsert(
            ids=ids[i : i + batch_size],
            documents=chunks[i : i + batch_size],
            metadatas=metadatas[i : i + batch_size],
        )

    logger.info("Indexed document %s: %d chunks", doc_id, len(chunks))
    return {"doc_id": doc_id, "chunk_count": len(chunks)}


# ---------------------------------------------------------------------------
# Retrieve Context
# ---------------------------------------------------------------------------
def retrieve_context(document_id: str, query: str, top_k: int = 8) -> list[dict]:
    """
    Semantic search over indexed chunks for a given document.
    Returns top-k relevant chunks with metadata.
    """
    collection = _get_collection()

    results = collection.query(
        query_texts=[query],
        n_results=top_k,
        where={"doc_id": document_id},
    )

    if not results or not results["documents"] or not results["documents"][0]:
        return []

    context_chunks = []
    for i, doc_text in enumerate(results["documents"][0]):
        chunk_meta = results["metadatas"][0][i] if results["metadatas"] else {}
        distance = results["distances"][0][i] if results["distances"] else None
        context_chunks.append({
            "text": doc_text,
            "chunk_index": chunk_meta.get("chunk_index", i),
            "score": 1 - distance if distance is not None else None,
        })

    logger.info("Retrieved %d context chunks for doc %s", len(context_chunks), document_id)
    return context_chunks


# ---------------------------------------------------------------------------
# Get Full Document Text (backward-compatible)
# ---------------------------------------------------------------------------
def get_document_text(document_id: str) -> Optional[str]:
    """Retrieve the full text of a previously indexed document."""
    _load_document_store()
    data = _document_store.get(document_id)
    if data is None:
        return None
    return data["text"] if isinstance(data, dict) else data


# ---------------------------------------------------------------------------
# Get Full Document Data (text + pages + metadata)
# ---------------------------------------------------------------------------
def get_document_data(document_id: str) -> Optional[dict]:
    """
    Retrieve the full document data including per-page text and metadata.
    Accepts either a ChromaDB hash ID or a Supabase UUID — auto-resolves.
    """
    _load_document_store()

    # Direct lookup (hash ID)
    data = _document_store.get(document_id)
    if data:
        return data

    # If it looks like a UUID (contains dashes), try resolving via Supabase DB
    if "-" in document_id:
        resolved_id = _resolve_uuid_to_vector_id(document_id)
        if resolved_id:
            return _document_store.get(resolved_id)

    return None


def resolve_to_vector_id(document_id: str) -> str:
    """
    Given any document ID (UUID or hash), return the ChromaDB hash ID.
    Returns the input unchanged if it's already a hash or can't be resolved.
    """
    _load_document_store()

    # Already in the store? It's a hash ID
    if document_id in _document_store:
        return document_id

    # Try UUID → hash resolution
    if "-" in document_id:
        resolved = _resolve_uuid_to_vector_id(document_id)
        if resolved:
            return resolved

    return document_id  # return as-is (will fail later with proper error)


def _resolve_uuid_to_vector_id(uuid_id: str) -> Optional[str]:
    """Look up a Supabase UUID in the database and return the doc_vector_id."""
    try:
        from app.services.database import get_document_by_id
        doc = get_document_by_id(uuid_id)
        if doc and doc.get("doc_vector_id"):
            logger.info("Resolved UUID %s → vector ID %s", uuid_id[:8], doc["doc_vector_id"])
            return doc["doc_vector_id"]
    except Exception as e:
        logger.warning("UUID resolution failed for %s: %s", uuid_id[:8], str(e))
    return None
