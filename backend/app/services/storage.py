"""
Supabase Storage Service
Handles file uploads and reads from the 'documents' bucket.

IMPORTANT — RLS Policy:
  The bucket uses folder-based RLS:
    (bucket_id = 'documents') AND (storage.foldername(name))[1] = auth.uid()::text
  
  Therefore ALL file paths MUST be: {user_id}/{filename}
  e.g. "a1b2c3d4-e5f6-7890-abcd-ef1234567890/report.pdf"
"""

import logging
from typing import Optional

from app.core.supabase_client import get_supabase_admin_client

logger = logging.getLogger("documind.storage")

BUCKET_NAME = "documents"


def upload_document_to_storage(
    user_id: str,
    filename: str,
    file_bytes: bytes,
    content_type: str = "application/octet-stream",
) -> dict:
    """
    Upload a file to Supabase Storage under the user's folder.
    Path format: {user_id}/{filename}  (required by RLS policy).

    Returns:
        {"path": str, "public_url": str}
    """
    # Build the RLS-compliant path
    storage_path = f"{user_id}/{filename}"

    supabase = get_supabase_admin_client()

    # Upload (upsert to allow re-uploads of same filename)
    result = supabase.storage.from_(BUCKET_NAME).upload(
        path=storage_path,
        file=file_bytes,
        file_options={
            "content-type": content_type,
            "upsert": "true",
        },
    )

    logger.info("Uploaded '%s' to storage bucket '%s'", storage_path, BUCKET_NAME)

    # Build the public URL
    public_url = supabase.storage.from_(BUCKET_NAME).get_public_url(storage_path)

    return {
        "path": storage_path,
        "public_url": public_url,
    }


def download_document_from_storage(user_id: str, filename: str) -> Optional[bytes]:
    """
    Download a file from Supabase Storage.
    Path format: {user_id}/{filename}
    """
    storage_path = f"{user_id}/{filename}"
    supabase = get_supabase_admin_client()

    try:
        data = supabase.storage.from_(BUCKET_NAME).download(storage_path)
        logger.info("Downloaded '%s' from storage", storage_path)
        return data
    except Exception as e:
        logger.error("Failed to download '%s': %s", storage_path, str(e))
        return None


def list_user_documents(user_id: str) -> list[dict]:
    """
    List all files in a user's storage folder.
    """
    supabase = get_supabase_admin_client()

    try:
        files = supabase.storage.from_(BUCKET_NAME).list(path=user_id)
        logger.info("Listed %d files for user %s", len(files), user_id)
        return files
    except Exception as e:
        logger.error("Failed to list files for user %s: %s", user_id, str(e))
        return []


def delete_document_from_storage(user_id: str, filename: str) -> bool:
    """
    Delete a file from Supabase Storage.
    """
    storage_path = f"{user_id}/{filename}"
    supabase = get_supabase_admin_client()

    try:
        supabase.storage.from_(BUCKET_NAME).remove([storage_path])
        logger.info("Deleted '%s' from storage", storage_path)
        return True
    except Exception as e:
        logger.error("Failed to delete '%s': %s", storage_path, str(e))
        return False
