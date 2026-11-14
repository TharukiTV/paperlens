# PaperLens

A research assistant for PDFs. Upload a research paper and PaperLens writes a structured summary
(problem, method, results, limitations) with page references, then answers your questions about
the paper. Every answer cites the page it came from.

Each user has their own account and private library.

## Features

- **Structured summaries**: abstract, problem statement, methodology, key results, conclusion and
  limitations, each linked to the pages it was drawn from. Long papers are summarised in parts
  (map-reduce).
- **Cited Q&A (RAG)**: answers are generated only from passages retrieved from the paper and cite
  them like `[2]`, shown as page marks that open the PDF at that page.
- **Hybrid retrieval**: BM25 keyword search plus vector search in Postgres (pgvector), merged
  with Reciprocal Rank Fusion.
- **Study flashcards**: question-and-answer cards made from the paper, each linked to its page.
  Flip a card to see the answer, mark it "I knew it" or "Still learning", then review only the
  ones you're still learning. Keyboard shortcuts: <kbd>Space</kbd> flips, <kbd>←</kbd>/<kbd>→</kbd>
  move, <kbd>1</kbd>/<kbd>2</kbd> mark the card.
- **Conversation history**: each paper keeps any number of conversations. "New conversation"
  starts a fresh one without deleting anything; earlier ones can be reopened or deleted (with undo)
  from the history list.
- **Answer styles**: Standard, Simple (plain-language explanations) and Reviewer (critical
  peer-review tone).
- **Multi-user**: email and password accounts, server-side sessions in an HttpOnly cookie, and
  every paper scoped to its owner.
- **Reader UI**: section outline, collapsible sections, select any text to have it explained,
  citation previews on hover, streaming answers, dark mode and drag-and-drop upload.

## Tech stack

| Part | Technology |
| --- | --- |
| Backend | Python, FastAPI, SQLAlchemy 2 |
| Database | PostgreSQL 17 with the pgvector extension (Docker) |
| PDF parsing | PyMuPDF |
| Embeddings | fastembed, `BAAI/bge-small-en-v1.5` (runs locally on the CPU, no API key) |
| LLM | Google Gemini (default) or any OpenAI-compatible API |
| Frontend | React 19, Vite |
| Tests | pytest |

## Prerequisites

- **Python 3.11+**
- **Node.js 18+** and npm
- **Docker Desktop** (for the Postgres database)
- A **Gemini API key** (free at <https://aistudio.google.com/apikey>), or a key for an
  OpenAI-compatible provider

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/TharukiTV/paperlens.git
cd paperlens
```

### 2. Start the database

```bash
docker compose up -d
```

This starts Postgres with pgvector on **localhost:5433** (5433, not 5432, so it doesn't clash with
a Postgres you may already have installed). Data is kept in a Docker volume between restarts.

### 3. Set up the backend

```bash
cd backend
python -m venv .venv

# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
```

Create your settings file from the template and add your API key:

```bash
# Windows
copy .env.example .env
# macOS / Linux
cp .env.example .env
```

Open `backend/.env` and set `GEMINI_API_KEY=...`. The other defaults work as they are.

Start the API server:

```bash
uvicorn app.main:app --reload
```

The API runs at <http://localhost:8000>. Interactive API docs are at <http://localhost:8000/docs>.
The database tables are created automatically on first start.

### 4. Set up the frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>. In development, Vite forwards `/api` requests to the backend.

## Trying it out

1. Open <http://localhost:5173> and choose **Create account**.
2. Upload a research paper (a text-based PDF up to 25 MB). The first upload also downloads the
   small embedding model, so it takes a little longer.
3. Read the summary. Click a yellow page mark such as `p.3` to open the PDF at that page.
4. Ask a question in the **Ask the paper** panel, or click one of the suggested questions.
   Hover a page mark in the answer to preview the passage it came from.
5. Open the **Flashcards** tab to test yourself on the paper. Flip each card, mark it, and at the
   end review only the cards you're still learning.
6. To check that users are isolated, sign out, create a second account and confirm the library
   is empty.

## Running the tests

The tests need the database from step 2 to be running. They use a separate `paperlens_test`
database, which they create automatically, and replace the LLM with fakes, so they need no API
key.

```bash
cd backend
python -m pytest
```

They cover sign-up and sign-in, session handling, login throttling, user isolation on every paper
route, upload, chat retrieval, conversations (separate histories, deletion, privacy and moving
chats saved before conversations existed), summary and flashcard caching, deletion and retrieval
ranking.

## Configuration

All settings live in `backend/.env` (see `backend/.env.example`).

| Setting | Default | Meaning |
| --- | --- | --- |
| `LLM_PROVIDER` | `gemini` | `gemini` or `openai` (any OpenAI-compatible API: OpenAI, Groq, Ollama) |
| `GEMINI_API_KEY` | | Your Gemini key |
| `GEMINI_MODEL` | | Main model; `GEMINI_FALLBACK_MODELS` are tried if it's busy |
| `DATABASE_URL` | `postgresql+psycopg://paperlens:paperlens@localhost:5433/paperlens` | Postgres connection |
| `SESSION_DAYS` | `30` | How long a sign-in lasts |
| `COOKIE_SECURE` | `false` | Set to `true` when serving over HTTPS |
| `MAX_PAPERS_PER_USER` | `100` | Library size limit per account |
| `USE_EMBEDDINGS` | `true` | Set to `false` for keyword-only search |
| `CHUNK_SIZE` / `CHUNK_OVERLAP` | `1200` / `200` | Chunk length and overlap in characters |
| `TOP_K` | `6` | Passages retrieved per question |
| `MAX_UPLOAD_MB` | `25` | Largest PDF accepted |

## How it works

```
Upload:   PDF ─► page text ─► chunks (never cross pages) ─► embeddings ─► Postgres
Summary:  page text with [Page N] markers ─► LLM (JSON) ─► saved on the paper
Cards:    page text with [Page N] markers ─► LLM (JSON) ─► 12 cards with pages ─► saved on the paper
Question: question ─► BM25 + pgvector search ─► top 6 passages ─► LLM ─► streamed answer with [n] citations
```

## Project structure

```
paperlens/
├── docker-compose.yml        Postgres + pgvector
├── backend/
│   ├── app/
│   │   ├── main.py           API routes
│   │   ├── auth.py           accounts, passwords, sessions
│   │   ├── db.py             database tables
│   │   ├── store.py          database reads and writes, scoped to the user
│   │   ├── pdf_parser.py     PDF to cleaned page text
│   │   ├── chunker.py        page-aware chunking
│   │   ├── retriever.py      embeddings and hybrid search
│   │   ├── qa.py             prompt building and answer streaming
│   │   ├── summarizer.py     structured summaries
│   │   ├── flashcards.py     study flashcards
│   │   ├── llm.py            Gemini / OpenAI client with fallback
│   │   └── config.py         settings
│   └── tests/
└── frontend/
    └── src/
        ├── App.jsx           app shell and sign-in gate
        ├── api.js            API client
        └── components/       reader, chat, sidebar, sign-in, ...
```

## API overview

| Method and path | Purpose |
| --- | --- |
| `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` | Accounts |
| `GET /api/documents`, `POST /api/documents` | List your papers, upload a PDF |
| `GET`, `DELETE /api/documents/{id}` | One paper with its summary, or delete it |
| `GET /api/documents/{id}/file` | The original PDF |
| `POST /api/documents/{id}/summary` | Generate or fetch the summary (`?regenerate=true` to redo) |
| `GET /api/documents/{id}/summary.md` | Summary as Markdown |
| `POST /api/documents/{id}/flashcards` | Generate or fetch the study flashcards (`?regenerate=true` for new ones) |
| `POST /api/documents/{id}/chat` | Ask a question (Server-Sent Events stream). Send `conversation_id` to continue a conversation; leave it out to start a new one |
| `GET /api/documents/{id}/conversations` | The paper's conversations, most recent first |
| `GET`, `DELETE /api/documents/{id}/conversations/{cid}` | One conversation with its messages, or delete it |
| `GET /api/health` | Server, database and model status |

Every `/api/documents` route requires a signed-in user and returns 404 for papers owned by
someone else.
