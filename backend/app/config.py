"""Application settings, loaded from environment variables / backend/.env."""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    llm_provider: str = "gemini"  # "gemini" | "openai"

    gemini_api_key: str = ""
    gemini_model: str = "gemini-flash-latest"
    gemini_fallback_models: str = ""  # comma-separated, tried in order if the main model is busy
    llm_timeout_seconds: int = 45  # give up on a model after this long and try the next one

    openai_api_key: str = ""
    openai_base_url: str = ""
    openai_model: str = "gpt-4o-mini"

    # Postgres with the pgvector extension (see docker-compose.yml)
    database_url: str = "postgresql+psycopg://paperlens:paperlens@localhost:5433/paperlens"

    # Accounts
    session_days: int = 30
    cookie_secure: bool = False  # set true when serving over HTTPS
    max_papers_per_user: int = 100

    use_embeddings: bool = True
    embedding_model: str = "BAAI/bge-small-en-v1.5"
    embedding_dim: int = 384  # must match the embedding model (bge-small = 384)
    chunk_size: int = 1200
    chunk_overlap: int = 200
    top_k: int = 6

    summary_max_chars: int = 120_000
    max_upload_mb: int = 25
    data_dir: str = "data"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    @property
    def data_path(self) -> Path:
        path = Path(self.data_dir)
        if not path.is_absolute():
            path = BACKEND_DIR / path
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()