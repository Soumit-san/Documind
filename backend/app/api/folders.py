import logging
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from app.core.auth import get_user_from_token
from app.services.database import create_folder_record, get_user_folders, delete_folder_record

router = APIRouter(tags=["folders"])
logger = logging.getLogger("documind.folders")

class FolderCreateRequest(BaseModel):
    name: str

class FolderResponse(BaseModel):
    id: str
    name: str
    created_at: str

@router.post("/folders", response_model=FolderResponse)
async def create_folder(
    req: FolderCreateRequest,
    authorization: str = Header(None)
):
    """
    Create a new folder for the authenticated user.
    """
    user = await get_user_from_token(authorization)
    
    if not req.name.strip():
        raise HTTPException(status_code=400, detail="Folder name cannot be empty.")
        
    folder = create_folder_record(user_id=user["id"], name=req.name.strip())
    if not folder:
        raise HTTPException(status_code=500, detail="Failed to create folder.")
        
    return FolderResponse(
        id=folder.get("id"),
        name=folder.get("name"),
        created_at=folder.get("created_at")
    )

@router.get("/folders", response_model=list[FolderResponse])
async def list_folders(authorization: str = Header(None)):
    """
    List all folders for the authenticated user.
    """
    user = await get_user_from_token(authorization)
    folders = get_user_folders(user_id=user["id"])
    return [
        FolderResponse(
            id=f.get("id"),
            name=f.get("name"),
            created_at=f.get("created_at")
        ) for f in folders
    ]

@router.delete("/folders/{folder_id}")
async def delete_folder(folder_id: str, authorization: str = Header(None)):
    """
    Delete a folder. Associated documents will be orphaned (folder_id set to NULL).
    """
    user = await get_user_from_token(authorization)
    success = delete_folder_record(folder_id=folder_id, user_id=user["id"])
    if not success:
        raise HTTPException(status_code=500, detail="Failed to delete folder.")
    return {"status": "ok"}
