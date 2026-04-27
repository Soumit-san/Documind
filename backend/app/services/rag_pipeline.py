"""
RAG Pipeline Service
Handles chunking, embedding, vector indexing, and context retrieval using ChromaDB.
"""

import hashlib
import logging
from typing import Optional

import chromadb
from chromadb.config import Settings as ChromaSettings

logger = logging.getLogger("documind.rag")

# ---------------------------------------------------------------------------
# ChromaDB Client (Singleton)
# ---------------------------------------------------------------------------
_chroma_client: Optional[chromadb.ClientAPI] = None
_collection_name = "documind_documents"

# In-memory store for full document text (keyed by doc_id)
_document_store: dict[str, str] = {}


def _get_chroma_client() -> chromadb.ClientAPI:
    global _chroma_client
    if _chroma_client is None:
        _chroma_client = chromadb.Client(ChromaSettings(anonymized_telemetry=False))
        logger.info("ChromaDB client initialized (in-memory for dev)")
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
def index_document(text: str, metadata: dict) -> dict:
    """
    Chunk text, generate IDs, and upsert into ChromaDB.
    ChromaDB uses its built-in default embedding function (all-MiniLM-L6-v2).
    """
    doc_id = hashlib.sha256(text[:1000].encode()).hexdigest()[:16]
    chunks = chunk_text(text)

    if not chunks:
        raise ValueError("Document produced no text chunks.")

    # Store full text for later retrieval
    _document_store[doc_id] = text

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
# Get Full Document Text
# ---------------------------------------------------------------------------
def get_document_text(document_id: str) -> Optional[str]:
    """Retrieve the full text of a previously indexed document."""
    return _document_store.get(document_id)
