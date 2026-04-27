"""
Supabase Client — Singleton factory for Supabase Python clients.

Two clients are provided:
  • `get_supabase_client()`      → uses the ANON key (respects RLS, used for user-scoped ops)
  • `get_supabase_admin_client()` → uses the SERVICE_ROLE key (bypasses RLS, admin-only ops)
"""

import logging
from functools import lru_cache

from supabase import create_client, Client

from app.core.config import get_settings

logger = logging.getLogger("documind.supabase")


@lru_cache
def get_supabase_client() -> Client:
    """Return a Supabase client using the anon (public) key — RLS-aware."""
    settings = get_settings()
    client = create_client(settings.supabase_url, settings.supabase_anon_key)
    logger.info("Supabase anon client initialized for %s", settings.supabase_url)
    return client


@lru_cache
def get_supabase_admin_client() -> Client:
    """Return a Supabase client using the service_role key — bypasses RLS."""
    settings = get_settings()
    client = create_client(settings.supabase_url, settings.supabase_service_role_key)
    logger.info("Supabase admin client initialized for %s", settings.supabase_url)
    return client
