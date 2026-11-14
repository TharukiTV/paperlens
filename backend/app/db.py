"""Postgres + pgvector: users, sessions, papers, chunks (with embeddings) and chat history.

Every paper belongs to one user, and everything else hangs off the paper with ON DELETE CASCADE,
so deleting a user or a paper removes all of its data.
"""
import uuid
from datetime import datetime, timezone

from pgvector.sqlalchemy import Vector
from sqlalchemy import (BigInteger, DateTime, ForeignKey, Integer, LargeBinary, String, Text,
                        create_engine, text)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker

from .config import get_settings

settings = get_settings()

engine = create_engine(settings.database_url, pool_pre_ping=True, pool_size=10, max_overflow=20)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def _uuid() -> str:
    return uuid.uuid4().hex


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120), default="")
    password_hash: Mapped[str] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    def to_public(self) -> dict:
        return {"id": self.id, "email": self.email, "name": self.name, "created_at": self.created_at.isoformat()}


class AuthSession(Base):
    """A signed-in browser. Only a SHA-256 of the cookie token is stored, so a DB leak can't be replayed."""
    __tablename__ = "auth_sessions"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)

    user: Mapped[User] = relationship(lazy="joined")


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    filename: Mapped[str] = mapped_column(String(255))
    title: Mapped[str] = mapped_column(Text)
    authors: Mapped[list] = mapped_column(JSONB, default=list)
    pages: Mapped[int] = mapped_column(Integer)
    chunk_count: Mapped[int] = mapped_column(Integer)
    words: Mapped[int] = mapped_column(Integer)
    size_bytes: Mapped[int] = mapped_column(Integer)
    retrieval: Mapped[str] = mapped_column(String(16))  # "hybrid" | "keyword"
    pdf_metadata: Mapped[dict] = mapped_column(JSONB, default=dict)
    summary: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    flashcards: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)

    def to_public(self) -> dict:
        return {
            "id": self.id, "filename": self.filename, "title": self.title, "authors": self.authors or [],
            "pages": self.pages, "chunks": self.chunk_count, "words": self.words, "size_bytes": self.size_bytes,
            "retrieval": self.retrieval, "pdf_metadata": self.pdf_metadata or {},
            "created_at": self.created_at.isoformat(),
        }


class DocumentFile(Base):
    """The original PDF, kept apart from `documents` so listing papers never loads file bytes."""
    __tablename__ = "document_files"

    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), primary_key=True)
    data: Mapped[bytes] = mapped_column(LargeBinary)


class Chunk(Base):
    __tablename__ = "chunks"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer)  # order within the paper
    page: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(settings.embedding_dim), nullable=True)


class Conversation(Base):
    """One chat thread about a paper. A paper can have many; "New conversation" starts another."""
    __tablename__ = "conversations"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200), default="New conversation")  # the first question
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)

    def to_public(self) -> dict:
        return {"id": self.id, "title": self.title, "created_at": self.created_at.isoformat(),
                "updated_at": self.updated_at.isoformat()}


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    conversation_id: Mapped[str | None] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), index=True, nullable=True)
    role: Mapped[str] = mapped_column(String(16))  # "user" | "assistant"
    content: Mapped[str] = mapped_column(Text)
    sources: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    style: Mapped[str | None] = mapped_column(String(16), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    def to_public(self) -> dict:
        msg = {"role": self.role, "content": self.content}
        if self.role == "assistant":
            msg.update(sources=self.sources or [], style=self.style or "default")
        return msg


def init_db() -> None:
    """Create the pgvector extension and any missing tables. Safe to run on every start."""
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    Base.metadata.create_all(engine)
    # create_all doesn't add columns to tables that already exist, so add later columns here.
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE documents ADD COLUMN IF NOT EXISTS flashcards JSONB"))
        conn.execute(text("ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS conversation_id VARCHAR(32) "
                          "REFERENCES conversations(id) ON DELETE CASCADE"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_chat_messages_conversation_id ON chat_messages (conversation_id)"))
    _move_old_chats_into_conversations()


def _move_old_chats_into_conversations() -> None:
    """Chats saved before conversations existed become one conversation per paper, so none are lost."""
    with engine.begin() as conn:
        papers = conn.execute(text(
            "SELECT document_id, MIN(created_at), MAX(created_at) FROM chat_messages "
            "WHERE conversation_id IS NULL GROUP BY document_id")).all()
        for doc_id, first_at, last_at in papers:
            first_question = conn.execute(text(
                "SELECT content FROM chat_messages WHERE document_id = :d AND conversation_id IS NULL "
                "AND role = 'user' ORDER BY id LIMIT 1"), {"d": doc_id}).scalar()
            conv_id = _uuid()
            conn.execute(text(
                "INSERT INTO conversations (id, document_id, title, created_at, updated_at) "
                "VALUES (:id, :d, :title, :first, :last)"),
                {"id": conv_id, "d": doc_id, "title": conversation_title(first_question or ""),
                 "first": first_at, "last": last_at})
            conn.execute(text("UPDATE chat_messages SET conversation_id = :c "
                              "WHERE document_id = :d AND conversation_id IS NULL"), {"c": conv_id, "d": doc_id})


def conversation_title(question: str) -> str:
    """A conversation is named after its first question, shortened to fit the history list."""
    title = " ".join(question.split())
    return (title[:77] + "...") if len(title) > 80 else (title or "New conversation")


def get_db():
    """FastAPI dependency: one session per request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
