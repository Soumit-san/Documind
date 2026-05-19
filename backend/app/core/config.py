"""
DocuMind AI — Backend Configuration
Loads environment variables and provides typed settings via Pydantic.
"""

from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # --- App ---
    app_env: str = "development"
    cors_origins: str = "http://localhost:3000"
    max_upload_size_mb: int = 50

    # --- Supabase ---
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    supabase_db_url: str = ""

    # --- LLM API Keys ---
    gemini_api_key: str = ""
    groq_api_key: str = ""
    groq_api_key_2: str = ""

    # --- Ollama ---
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "mistral"

    # --- Gemini ---
    gemini_model: str = "gemini-2.0-flash"

    # --- Groq ---
    groq_model: str = "llama-3.3-70b-versatile"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",")]

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
