"""Paper storage in Postgres. Every lookup is scoped to the owning user.

Functions that take `user_id` enforce ownership and raise FileNotFoundError for papers that don't
exist *or* belong to someone else, so the API answers 404 either way and never reveals other
users' paper ids. Functions that take only `doc_id` are for code that already checked ownership.
"""
import threading
from collections import OrderedDict

import numpy as np
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from .db import ChatMessage, Chunk, Document, DocumentFile, SessionLocal
from .retriever import HybridRetriever

MAX_CHAT_MESSAGES = 100
_CACHE_SIZE = 64  # papers whose keyword index is kept in memory

_lock = threading.Lock()
_retrievers: "OrderedDict[str, HybridRetriever]" = OrderedDict()


# ---------------------------------------------------------------- documents

def create_document(db: Session, user_id: str, pdf_bytes: bytes, filename: str, meta: dict,
                    chunks: list[dict], embeddings: np.ndarray | None) -> dict:
    doc = Document(
        user_id=user_id, filename=filename[:255], title=meta["title"], pages=meta["pages"],
        chunk_count=meta["chunks"], words=meta["words"], size_bytes=len(pdf_bytes),
        retrieval="hybrid" if embeddings is not None else "keyword", pdf_metadata=meta.get("pdf_metadata") or {},
    )
    db.add(doc)
    db.flush()  # assigns doc.id
    db.add(DocumentFile(document_id=doc.id, data=pdf_bytes))
    db.add_all(
        Chunk(document_id=doc.id, position=c["id"], page=c["page"], text=c["text"],
              embedding=embeddings[i].tolist() if embeddings is not None else None)
        for i, c in enumerate(chunks)
    )
    db.commit()
    return doc.to_public()


def count_documents(db: Session, user_id: str) -> int:
    return db.scalar(select(func.count()).select_from(Document).where(Document.user_id == user_id)) or 0


def list_documents(db: Session, user_id: str) -> list[dict]:
    rows = db.scalars(select(Document).where(Document.user_id == user_id).order_by(Document.created_at.desc()))
    return [d.to_public() for d in rows]


def get_document(db: Session, user_id: str, doc_id: str) -> Document:
    doc = db.get(Document, doc_id) if doc_id.isalnum() else None
    if doc is None or doc.user_id != user_id:
        raise FileNotFoundError(doc_id)
    return doc


def get_pdf(db: Session, doc_id: str) -> bytes:
    file = db.get(DocumentFile, doc_id)
    if file is None:
        raise FileNotFoundError(doc_id)
    return file.data


def update_document(db: Session, doc: Document, **fields) -> None:
    for key, value in fields.items():
        setattr(doc, key, value)
    db.commit()


def delete_document(db: Session, doc: Document) -> None:
    doc_id = doc.id
    db.delete(doc)  # chunks, file and chat go with it (ON DELETE CASCADE)
    db.commit()
    with _lock:
        _retrievers.pop(doc_id, None)


def get_summary(doc_id: str) -> dict | None:
    with SessionLocal() as db:
        return db.scalar(select(Document.summary).where(Document.id == doc_id))


# ---------------------------------------------------------------- retrieval

def _vector_search(doc_id: str):
    """Nearest chunks by cosine distance, computed inside Postgres by pgvector."""
    def search(query_vec: np.ndarray, limit: int) -> list[int]:
        with SessionLocal() as db:
            return list(db.scalars(
                select(Chunk.position)
                .where(Chunk.document_id == doc_id, Chunk.embedding.is_not(None))
                .order_by(Chunk.embedding.cosine_distance(query_vec.tolist()))
                .limit(limit)
            ))
    return search


def get_retriever(doc_id: str) -> HybridRetriever:
    with _lock:
        if doc_id in _retrievers:
            _retrievers.move_to_end(doc_id)
            return _retrievers[doc_id]
    with SessionLocal() as db:
        rows = db.execute(
            select(Chunk.position, Chunk.page, Chunk.text, Chunk.embedding.is_not(None))
            .where(Chunk.document_id == doc_id).order_by(Chunk.position)
        ).all()
    chunks = [{"id": r.position, "page": r.page, "text": r.text} for r in rows]
    has_vectors = any(r[3] for r in rows)
    retriever = HybridRetriever(chunks, _vector_search(doc_id) if has_vectors else None)
    with _lock:
        _retrievers[doc_id] = retriever
        while len(_retrievers) > _CACHE_SIZE:
            _retrievers.popitem(last=False)
    return retriever


# ---------------------------------------------------------------- chat

def get_chat(db: Session, doc_id: str) -> list[dict]:
    rows = db.scalars(
        select(ChatMessage).where(ChatMessage.document_id == doc_id)
        .order_by(ChatMessage.id.desc()).limit(MAX_CHAT_MESSAGES)
    ).all()
    return [m.to_public() for m in reversed(rows)]


def add_chat_turn(doc_id: str, question: str, answer: str, sources: list[dict], style: str) -> None:
    # Called from the streaming response, after the request's own session is gone.
    with SessionLocal() as db:
        db.add_all([
            ChatMessage(document_id=doc_id, role="user", content=question),
            ChatMessage(document_id=doc_id, role="assistant", content=answer, sources=sources, style=style),
        ])
        db.commit()


def clear_chat(db: Session, doc_id: str) -> None:
    db.execute(delete(ChatMessage).where(ChatMessage.document_id == doc_id))
    db.commit()
