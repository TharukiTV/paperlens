"""Test setup: a throwaway `paperlens_test` database on the same Postgres as development.

Start Postgres first (`docker compose up -d` in the project root). Tests that need the database
are skipped if it isn't reachable. Override with TEST_DATABASE_URL.
"""
import os

import pytest

TEST_URL = os.environ.get("TEST_DATABASE_URL", "postgresql+psycopg://paperlens:paperlens@localhost:5433/paperlens_test")
os.environ["DATABASE_URL"] = TEST_URL
os.environ["USE_EMBEDDINGS"] = "false"  # keep tests fast and offline


def _ensure_database() -> bool:
    import psycopg
    from sqlalchemy.engine import make_url

    url = make_url(TEST_URL)
    admin = f"host={url.host} port={url.port or 5432} user={url.username} password={url.password} dbname=postgres"
    try:
        with psycopg.connect(admin, autocommit=True, connect_timeout=3) as conn:
            exists = conn.execute("SELECT 1 FROM pg_database WHERE datname = %s", (url.database,)).fetchone()
            if not exists:
                conn.execute(f'CREATE DATABASE "{url.database}"')
        return True
    except Exception:
        return False


DB_AVAILABLE = _ensure_database()


@pytest.fixture()
def client():
    if not DB_AVAILABLE:
        pytest.skip("Postgres isn't reachable. Run `docker compose up -d` in the project root.")
    from fastapi.testclient import TestClient

    from app import auth
    from app.db import Base, engine, init_db

    init_db()
    with engine.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            conn.execute(table.delete())
    auth.throttle.fails.clear()
    with TestClient(__import__("app.main", fromlist=["app"]).app) as c:
        yield c


@pytest.fixture()
def make_client(client):
    """Extra independent browsers (separate cookie jars) for multi-user tests."""
    from fastapi.testclient import TestClient

    from app.main import app

    clients = []

    def factory():
        c = TestClient(app)
        clients.append(c)
        return c

    yield factory
    for c in clients:
        c.close()


@pytest.fixture()
def sample_pdf() -> bytes:
    import pymupdf

    doc = pymupdf.open()
    pages = [
        "LiteSpeech: Attention-Free Speech Models for Low-Resource Languages. Abstract. "
        "We study speech recognition for Sinhala, where labelled audio is scarce.",
        "Method. A convolutional encoder is pretrained with self-supervised learning on 400 hours "
        "of unlabelled Sinhala audio, then fine-tuned with CTC loss.",
        "Results. LiteSpeech reaches a word error rate of 18.2 percent on the test set, beating "
        "wav2vec 2.0 while using three times fewer parameters.",
    ]
    for text in pages:
        page = doc.new_page()
        page.insert_textbox(pymupdf.Rect(50, 50, 550, 800), text, fontsize=11)
    data = doc.tobytes()
    doc.close()
    return data


def register(c, email="ada@example.com", password="correct horse battery"):
    r = c.post("/api/auth/register", json={"email": email, "password": password, "name": "Ada"})
    assert r.status_code == 201, r.text
    return r.json()


def upload(c, pdf: bytes, name="litespeech.pdf"):
    r = c.post("/api/documents", files={"file": (name, pdf, "application/pdf")})
    assert r.status_code == 201, r.text
    return r.json()
