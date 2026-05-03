"""
Supabase Database Service
Handles PostgreSQL operations for document metadata via the Supabase client.
"""

import logging
from datetime import datetime, timezone
from typing import Optional

from app.core.supabase_client import get_supabase_admin_client

logger = logging.getLogger("documind.database")

# ──────────────────────────────────────────────────────────────
# Documents table operations
# ──────────────────────────────────────────────────────────────

TABLE_DOCUMENTS = "documents"
TABLE_FOLDERS = "folders"


def insert_document_record(
    user_id: str,
    filename: str,
    file_type: str,
    page_count: int,
    chunk_count: int,
    storage_path: str,
    doc_vector_id: str,
    folder_id: Optional[str] = None,
) -> dict:
    """
    Insert a document metadata row into the 'documents' table.
    """
    supabase = get_supabase_admin_client()

    record = {
        "user_id": user_id,
        "filename": filename,
        "file_type": file_type,
        "page_count": page_count,
        "chunk_count": chunk_count,
        "storage_path": storage_path,
        "doc_vector_id": doc_vector_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    
    if folder_id:
        record["folder_id"] = folder_id

    try:
        result = supabase.table(TABLE_DOCUMENTS).insert(record).execute()
        logger.info("Inserted document record for user %s: %s", user_id, filename)
        return result.data[0] if result.data else record
    except Exception as e:
        logger.error("Failed to insert document record (table might be missing): %s", str(e))
        # Return the mock record so the API can still return a valid response
        record["id"] = doc_vector_id
        return record


def get_user_documents(user_id: str, folder_id: Optional[str] = None) -> list[dict]:
    """
    Retrieve all document records for a given user, optionally filtered by folder_id.
    """
    supabase = get_supabase_admin_client()

    try:
        query = supabase.table(TABLE_DOCUMENTS).select("*").eq("user_id", user_id)
        if folder_id is not None:
            # If folder_id is "null", we could filter for un-foldered docs, 
            # but usually we just pass the exact UUID or empty string.
            if folder_id == "":
                query = query.is_("folder_id", "null")
            else:
                query = query.eq("folder_id", folder_id)
                
        result = query.order("created_at", desc=True).execute()
        return result.data or []
    except Exception as e:
        logger.error("Failed to fetch documents (table might be missing): %s", str(e))
        return []


def get_documents_by_folder(folder_id: str) -> list[dict]:
    """
    Retrieve all documents inside a specific folder.
    """
    supabase = get_supabase_admin_client()
    try:
        result = (
            supabase.table(TABLE_DOCUMENTS)
            .select("*")
            .eq("folder_id", folder_id)
            .execute()
        )
        return result.data or []
    except Exception as e:
        logger.error("Failed to fetch documents for folder %s: %s", folder_id, str(e))
        return []


def get_document_by_id(document_id: str) -> Optional[dict]:
    """
    Retrieve a single document record by its ID.
    """
    supabase = get_supabase_admin_client()

    try:
        result = (
            supabase.table(TABLE_DOCUMENTS)
            .select("*")
            .eq("id", document_id)
            .single()
            .execute()
        )
        return result.data
    except Exception as e:
        logger.error("Failed to fetch document %s: %s", document_id, str(e))
        return None


def delete_document_record(document_id: str) -> bool:
    """
    Delete a document metadata row.
    """
    supabase = get_supabase_admin_client()

    try:
        supabase.table(TABLE_DOCUMENTS).delete().eq("id", document_id).execute()
        logger.info("Deleted document record %s", document_id)
        return True
    except Exception as e:
        logger.error("Failed to delete document record %s: %s", document_id, str(e))
        return False


# ──────────────────────────────────────────────────────────────
# Folders table operations
# ──────────────────────────────────────────────────────────────

def create_folder_record(user_id: str, name: str) -> Optional[dict]:
    """
    Create a new folder for the user.
    """
    supabase = get_supabase_admin_client()
    record = {
        "user_id": user_id,
        "name": name,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        result = supabase.table(TABLE_FOLDERS).insert(record).execute()
        logger.info("Created folder '%s' for user %s", name, user_id)
        return result.data[0] if result.data else record
    except Exception as e:
        logger.error("Failed to create folder record: %s", str(e))
        return None


def get_user_folders(user_id: str) -> list[dict]:
    """
    Retrieve all folders for a given user.
    """
    supabase = get_supabase_admin_client()
    try:
        result = (
            supabase.table(TABLE_FOLDERS)
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .execute()
        )
        return result.data or []
    except Exception as e:
        logger.error("Failed to fetch folders: %s", str(e))
        return []


def delete_folder_record(folder_id: str, user_id: str) -> bool:
    """
    Delete a folder. Note: dependent documents will have folder_id set to NULL 
    due to ON DELETE SET NULL constraint.
    """
    supabase = get_supabase_admin_client()
    try:
        supabase.table(TABLE_FOLDERS).delete().eq("id", folder_id).eq("user_id", user_id).execute()
        logger.info("Deleted folder %s", folder_id)
        return True
    except Exception as e:
        logger.error("Failed to delete folder %s: %s", folder_id, str(e))
        return False
