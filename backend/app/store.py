"""File-based document store: one folder per paper under DATA_DIR.

data/<doc_id>/
    paper.pdf        original upload
    meta.json        filename, page count, timestamps ...
    chunks.json      text chunks with page numbers
    embeddings.npy   chunk vectors (when embeddings are enabled)
    summary.json     cached structured summary
    chat.json        conversation history
No database needed, and papers survive a server restart.
"""
import json
import shutil
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from .config import get_settings
from .retriever import HybridRetriever

_lock = threading.Lock()
_retrievers: dict[str, HybridRetriever] = {}


def _root() -> Path:
    return get_settings().data_path


def doc_dir(doc_id: str) -> Path:
    # doc ids are uuid hex: reject anything else to prevent path traversal
    if not doc_id.isalnum():
        raise FileNotFoundError(doc_id)
    path = _root() / doc_id
    if not path.is_dir():
        raise FileNotFoundError(doc_id)
    return path


def _write_json(path: Path, data) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def _read_json(path: Path, default=None):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def create_document(pdf_bytes: bytes, filename: str, meta: dict, chunks: list[dict],
                    embeddings: np.ndarray | None) -> dict:
    doc_id = uuid.uuid4().hex
    path = _root() / doc_id
    path.mkdir(parents=True)
    (path / "paper.pdf").write_bytes(pdf_bytes)
    _write_json(path / "chunks.json", chunks)
    if embeddings is not None:
        np.save(path / "embeddings.npy", embeddings)
    record = {
        "id": doc_id,
        "filename": filename,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "size_bytes": len(pdf_bytes),
        "retrieval": "hybrid" if embeddings is not None else "keyword",
        **meta,
    }
    _write_json(path / "meta.json", record)
    return record


def get_meta(doc_id: str) -> dict:
    return _read_json(doc_dir(doc_id) / "meta.json")


def update_meta(doc_id: str, **fields) -> dict:
    with _lock:
        meta = get_meta(doc_id)
        meta.update(fields)
        _write_json(doc_dir(doc_id) / "meta.json", meta)
        return meta


def list_documents() -> list[dict]:
    docs = []
    for meta_file in _root().glob("*/meta.json"):
        try:
            docs.append(json.loads(meta_file.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError):
            continue
    return sorted(docs, key=lambda d: d.get("created_at", ""), reverse=True)


def pdf_path(doc_id: str) -> Path:
    return doc_dir(doc_id) / "paper.pdf"


def get_chunks(doc_id: str) -> list[dict]:
    return _read_json(doc_dir(doc_id) / "chunks.json", [])


def get_retriever(doc_id: str) -> HybridRetriever:
    with _lock:
        if doc_id not in _retrievers:
            path = doc_dir(doc_id)
            emb_file = path / "embeddings.npy"
            embeddings = np.load(emb_file) if emb_file.exists() else None
            _retrievers[doc_id] = HybridRetriever(get_chunks(doc_id), embeddings)
        return _retrievers[doc_id]


def get_summary(doc_id: str) -> dict | None:
    return _read_json(doc_dir(doc_id) / "summary.json")


def save_summary(doc_id: str, summary: dict) -> None:
    _write_json(doc_dir(doc_id) / "summary.json", summary)


def get_chat(doc_id: str) -> list[dict]:
    return _read_json(doc_dir(doc_id) / "chat.json", [])


def save_chat(doc_id: str, messages: list[dict]) -> None:
    _write_json(doc_dir(doc_id) / "chat.json", messages[-100:])


def delete_document(doc_id: str) -> None:
    path = doc_dir(doc_id)
    with _lock:
        _retrievers.pop(doc_id, None)
    shutil.rmtree(path)