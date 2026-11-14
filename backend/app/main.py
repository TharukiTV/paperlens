"""PaperLens API: upload a research paper, get a structured summary, chat with it.

Each user has their own library. Every /api/documents route requires a signed-in user and
answers 404 for papers that belong to someone else.
"""
import json
import logging
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from . import auth, qa, store
from .chunker import chunk_pages
from .config import get_settings
from .db import Document, User, engine, get_db, init_db
from .flashcards import generate_flashcards
from .llm import LLMError, model_label
from .pdf_parser import PDFError, parse_pdf, read_pages
from .retriever import Embedder
from .summarizer import generate_summary, summary_to_markdown

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(name)s  %(message)s")
log = logging.getLogger("paperlens")
settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    # Load the embedding model now (in the background), not on the first upload or question.
    threading.Thread(target=Embedder.get, daemon=True).start()
    yield


app = FastAPI(title="PaperLens API", version="2.0.0", lifespan=lifespan,
              description="Research assistant for PDFs: structured summaries and cited Q&A, per user.")
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_list, allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])
app.include_router(auth.router)


def _not_found(doc_id: str) -> HTTPException:
    return HTTPException(404, f"No paper with id {doc_id}. It may have been deleted.")


def owned_document(doc_id: str, user: User = Depends(auth.current_user), db: Session = Depends(get_db)) -> Document:
    """Dependency: the paper, if it exists and belongs to the signed-in user."""
    try:
        return store.get_document(db, user.id, doc_id)
    except FileNotFoundError:
        raise _not_found(doc_id)


# ---------------------------------------------------------------- health


@app.get("/api/health")
def health():
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        database = "ok"
    except Exception:
        database = "unreachable"
    return {
        "status": "ok" if database == "ok" else "degraded",
        "database": database,
        "provider": settings.llm_provider,
        "model": model_label(),
        "retrieval": "hybrid" if settings.use_embeddings else "keyword",
    }


# ---------------------------------------------------------------- documents


@app.post("/api/documents", status_code=201)
def upload_document(file: UploadFile = File(...), user: User = Depends(auth.current_user),
                    db: Session = Depends(get_db)):
    """Upload one PDF: extract text, chunk it, embed the chunks and store everything."""
    if store.count_documents(db, user.id) >= settings.max_papers_per_user:
        raise HTTPException(409, f"Your library is full ({settings.max_papers_per_user} papers). Delete a paper to upload a new one.")

    name = file.filename or "paper.pdf"
    if not name.lower().endswith(".pdf") and file.content_type != "application/pdf":
        raise HTTPException(415, "Only PDF files are supported. Choose a .pdf file.")

    data = file.file.read()
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"This file is larger than {settings.max_upload_mb} MB.")
    if not data.startswith(b"%PDF"):
        raise HTTPException(415, "This file isn't a valid PDF.")

    try:
        parsed = parse_pdf(data)
    except PDFError as exc:
        raise HTTPException(422, str(exc)) from exc

    chunks = [c.to_dict() for c in chunk_pages(parsed.pages, settings.chunk_size, settings.chunk_overlap)]
    embeddings = Embedder.embed_passages([c["text"] for c in chunks])

    meta_title = parsed.metadata.get("title", "")
    title = meta_title if 10 < len(meta_title) < 300 else Path(name).stem.replace("_", " ")
    record = store.create_document(
        db, user.id, data, name,
        {"title": title, "pages": parsed.page_count, "chunks": len(chunks),
         "words": len(parsed.full_text.split()), "pdf_metadata": parsed.metadata},
        chunks, embeddings,
    )
    log.info("User %s indexed %s: %d pages, %d chunks (%s)", user.id, name, parsed.page_count, len(chunks), record["retrieval"])
    return record


@app.get("/api/documents")
def list_documents(user: User = Depends(auth.current_user), db: Session = Depends(get_db)):
    return store.list_documents(db, user.id)


@app.get("/api/documents/{doc_id}")
def get_document(doc: Document = Depends(owned_document)):
    return {**doc.to_public(), "summary": doc.summary}


@app.get("/api/documents/{doc_id}/file")
def get_document_file(doc: Document = Depends(owned_document), db: Session = Depends(get_db)):
    try:
        data = store.get_pdf(db, doc.id)
    except FileNotFoundError:
        raise _not_found(doc.id)
    safe_name = doc.filename.replace('"', "")
    # inline so the browser's PDF viewer can open it in an <iframe> at #page=N
    return Response(data, media_type="application/pdf", headers={
        "Content-Disposition": f'inline; filename="{safe_name}"',
        "Cache-Control": "private, max-age=3600",
    })


@app.delete("/api/documents/{doc_id}", status_code=204)
def delete_document(doc: Document = Depends(owned_document), db: Session = Depends(get_db)):
    store.delete_document(db, doc)


# ---------------------------------------------------------------- summary


@app.post("/api/documents/{doc_id}/summary")
def create_summary(regenerate: bool = False, doc: Document = Depends(owned_document), db: Session = Depends(get_db)):
    """Generate (or return the cached) structured summary."""
    if not regenerate and doc.summary:
        return doc.summary
    pages = read_pages(store.get_pdf(db, doc.id))
    try:
        summary = generate_summary(pages, settings.summary_max_chars, doc.pdf_metadata)
    except LLMError as exc:
        raise HTTPException(502, str(exc)) from exc
    store.update_document(db, doc, summary=summary, title=summary["title"], authors=summary["authors"])
    return summary


@app.get("/api/documents/{doc_id}/summary.md", response_class=PlainTextResponse)
def export_summary(doc: Document = Depends(owned_document)):
    if not doc.summary:
        raise HTTPException(404, "Generate the summary first.")
    return PlainTextResponse(summary_to_markdown(doc.summary), media_type="text/markdown")


# ---------------------------------------------------------------- flashcards

_flashcard_locks: dict[str, threading.Lock] = {}


@app.post("/api/documents/{doc_id}/flashcards")
def create_flashcards(regenerate: bool = False, doc: Document = Depends(owned_document),
                      db: Session = Depends(get_db)):
    """Generate (or return the saved) study flashcards: question, answer and source page."""
    # One generation per paper at a time: a second request waits, then gets the saved cards.
    with _flashcard_locks.setdefault(doc.id, threading.Lock()):
        db.refresh(doc)  # pick up cards another request saved while we waited
        if not regenerate and doc.flashcards:
            return doc.flashcards
        pages = read_pages(store.get_pdf(db, doc.id))
        try:
            deck = generate_flashcards(pages, settings.summary_max_chars)
        except LLMError as exc:
            raise HTTPException(502, str(exc)) from exc
        if not deck["cards"]:
            raise HTTPException(502, "The model didn't return any flashcards. Try again.")
        store.update_document(db, doc, flashcards=deck)
        return deck



# ---------------------------------------------------------------- chat


class ChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    style: str = "default"  # default | simple | critical
    conversation_id: str | None = None  # empty: start a new conversation


def _sse(event: str, data) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _conversation(doc: Document, conv_id: str, db: Session):
    try:
        return store.get_conversation(db, doc.id, conv_id)
    except FileNotFoundError:
        raise HTTPException(404, "That conversation doesn't exist. It may have been deleted.")


@app.get("/api/documents/{doc_id}/conversations")
def list_conversations(doc: Document = Depends(owned_document), db: Session = Depends(get_db)):
    """The paper's conversations, most recently used first."""
    return store.list_conversations(db, doc.id)


@app.get("/api/documents/{doc_id}/conversations/{conv_id}")
def get_conversation(conv_id: str, doc: Document = Depends(owned_document), db: Session = Depends(get_db)):
    conv = _conversation(doc, conv_id, db)
    return {**conv.to_public(), "messages": store.get_messages(db, conv.id)}


@app.delete("/api/documents/{doc_id}/conversations/{conv_id}", status_code=204)
def delete_conversation(conv_id: str, doc: Document = Depends(owned_document), db: Session = Depends(get_db)):
    store.delete_conversation(db, _conversation(doc, conv_id, db))


@app.post("/api/documents/{doc_id}/chat")
def chat(body: ChatRequest, doc: Document = Depends(owned_document), db: Session = Depends(get_db)):
    """Answer a question with Server-Sent Events: `conversation`, `sources`, then `token`s, then `done`
    (or `error`). Without a conversation_id, the question starts a new conversation."""
    doc_id = doc.id
    if body.conversation_id:
        conv = _conversation(doc, body.conversation_id, db)
        history = store.get_messages(db, conv.id)
    else:
        conv = store.create_conversation(db, doc_id, body.question)
        history = []
    conv_id, conv_public = conv.id, conv.to_public()
    sources = qa.retrieve(doc_id, body.question, history)
    public_sources = [{"n": i, "page": s["page"], "text": s["text"], "score": s["score"]}
                      for i, s in enumerate(sources, start=1)]

    def events():
        yield _sse("conversation", conv_public)
        yield _sse("sources", public_sources)
        answer = ""
        try:
            for token in qa.answer_stream(doc_id, body.question, history, sources, body.style):
                answer += token
                yield _sse("token", token)
        except LLMError as exc:
            yield _sse("error", str(exc))
            return
        store.add_chat_turn(doc_id, conv_id, body.question, answer, public_sources, body.style)
        yield _sse("done", {"length": len(answer)})

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------------------------------------------------------------- frontend (optional)
# If the React app has been built (npm run build), serve it from the same server.
_dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if _dist.is_dir():
    app.mount("/", StaticFiles(directory=_dist, html=True), name="frontend")
