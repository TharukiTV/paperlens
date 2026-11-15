# PaperLens

A research assistant for PDFs. Upload a research paper and PaperLens writes a structured summary
(problem, method, results, conclusion, limitations) with page references. You can then ask
questions about the paper, and every answer cites the page it came from.

![PaperLens: a paper's structured summary with page references, and the chat panel beside it](docs/screenshots/summary.png)

**Contents:** [Features](#features) · [Screenshots](#screenshots) · [Tech stack](#tech-stack) ·
[Prerequisites](#prerequisites) · [Setup](#setup) · [How to use](#how-to-use) ·
[AI tools used](#ai-tools-used) · [Tests](#running-the-tests) · [How it works](#how-it-works) ·
[Configuration](#configuration) · [Known limitations](#known-limitations)

## Features

### Core features (from the brief)

| Requirement | How PaperLens does it |
| --- | --- |
| **Upload a research paper (PDF)** | Click **Upload a paper** or drag a PDF onto the page. The file is checked first: it must be a real PDF (the server checks the file's contents, not only its name), 25 MB or smaller, not password-protected, and not a scanned image. |
| **Structured summary on upload** | Written automatically as soon as the upload finishes. It has **Title & Authors, Abstract, Problem statement, Methodology, Key results and Conclusion**. |
| **Readable summary** | Each section has its own heading. A one-sentence "In short" box sits at the top, and a contents list lets you jump between sections. |
| **Question-answering chatbot (RAG)** | Ask questions in plain language. PaperLens finds the most relevant passages in the paper and the LLM answers **only from those passages**. |

### Extra features ⭐

**Trust and accuracy**
- ⭐ **Page citations everywhere.** Every summary section and every answer shows page marks
  such as `p.3`. Click one to open the PDF at that page, or hover it to preview the exact passage.
- ⭐ **Limitations and future work** as an extra summary section, plus **keywords**.
- ⭐ **Hybrid search.** Keyword search (BM25) and meaning-based vector search (pgvector),
  merged with Reciprocal Rank Fusion. Questions find the right passage even when they use
  different words from the paper.
- ⭐ **Long papers** are summarised in parts first (map-reduce), so papers of any length work.
- ⭐ **Formulas** in answers are drawn as real maths (KaTeX).

**Studying**
- ⭐ **Flashcards.** 12 question-and-answer cards made from the paper, each linked to its page.
  Flip, mark "I knew it" or "Still learning", shuffle, and review only the cards you're still
  learning. Keyboard: <kbd>Space</kbd> flips, <kbd>←</kbd>/<kbd>→</kbd> move,
  <kbd>1</kbd>/<kbd>2</kbd> mark.
- ⭐ **Three answer styles.** Standard, Simple (plain language for beginners) and Reviewer (a
  critical peer-review tone).
- ⭐ **Suggested questions** written for each paper, so you know where to start.
- ⭐ **Explain a selection.** Select any text in the summary to have it explained or to ask
  about it.
- ⭐ **Export the summary** as a Markdown file.

**Conversations**
- ⭐ **Conversation history.** Each paper keeps any number of conversations. Start a new one
  without losing the old ones, and reopen or delete (with undo) earlier ones.
- ⭐ **Streaming answers.** Answers appear word by word, and you can stop one halfway.

**Accounts**
- ⭐ **Multiple users.** Email and password accounts with a private library each. Passwords are
  hashed, sessions use an HttpOnly cookie, sign-in attempts are rate-limited, and no one can
  open another user's papers.

**Layout**
- ⭐ **Adjustable workspace.** Drag to resize the library and chat panels, fold the library
  into a slim icon bar, close and reopen the chat, and switch the chat or flashcards to full
  screen.
- ⭐ **Built-in PDF viewer** with page jumps, a **dark mode**, drag-and-drop upload, and a
  layout that adapts to phones and tablets.

**Reliability**
- ⭐ **Model fallback.** If the Gemini model is busy or slow, PaperLens retries and then
  switches to a backup model automatically.
- ⭐ **Saved results.** Summaries and flashcards are generated once and saved, so reopening a
  paper is instant.
- ⭐ **Automated tests** with pytest, which need no API key.

## Screenshots

| | |
| --- | --- |
| ![Home screen with the upload area and library](docs/screenshots/home.png) **Home:** upload a paper and see your library | ![Reading your paper progress screen](docs/screenshots/processing.png) **Processing:** progress steps with a timer |
| ![Chat answer with page citations and a passage preview](docs/screenshots/chat.png) **Ask the paper:** answers cite pages, hover to preview | ![Full-screen chat with the conversation history sidebar](docs/screenshots/history.png) **Full-screen chat** with conversation history |
| ![Flashcard showing its answer](docs/screenshots/flashcards.png) **Flashcards** made from the paper | ![PDF viewer opened at a cited page](docs/screenshots/pdf.png) **PDF viewer** opened at the cited page |

## Tech stack

| Part | Technology |
| --- | --- |
| Frontend | React 19, Vite 6, react-markdown, KaTeX, lucide-react icons |
| Backend | Python, FastAPI, SQLAlchemy 2 |
| Database | PostgreSQL 17 with the pgvector extension (runs in Docker) |
| PDF parsing | PyMuPDF |
| Embeddings | fastembed with `BAAI/bge-small-en-v1.5` (runs locally on the CPU, no API key needed) |
| LLM | Google Gemini (default) or any OpenAI-compatible API |
| Tests | pytest |

## Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| **Python** | 3.11 or newer | Tested with 3.12 |
| **Node.js** | 18 or newer, with npm | Tested with Node 24 |
| **Docker Desktop** | any recent version | Runs the Postgres database |
| **Git** | any | To clone the repository |
| **Gemini API key** | | Free at <https://aistudio.google.com/apikey> (or a key for an OpenAI-compatible provider) |

## Setup

You'll need **two terminals**: one for the backend and one for the frontend.

### 1. Clone the repository

```bash
git clone https://github.com/TharukiTV/paperlens.git
cd paperlens
```

### 2. Start the database

Open **Docker Desktop** and wait until it says it is running, then:

```bash
docker compose up -d
```

This starts Postgres with pgvector on **localhost:5433** (5433, not 5432, so it doesn't clash with
a Postgres you may already have installed). Data is kept in a Docker volume between restarts.

### 3. Set up the backend (terminal 1)

```bash
cd backend
python -m venv .venv

# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
```

> **Windows PowerShell:** if activating fails with "running scripts is disabled on this system",
> run `Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned` and activate again. This
> only applies to the current terminal window.

Installing takes a few minutes the first time. Create your settings file from the template and add your API key:

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

On the first start, the backend also downloads the embedding model (about 130 MB) into
`backend/data/models`. Wait for `Embedding model ready` in the terminal before uploading. Later
starts load the model from that folder in a couple of seconds.

### 4. Set up the frontend (terminal 2)

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>. In development, Vite forwards `/api` requests to the backend.

## How to use

1. Open <http://localhost:5173> and choose **Create account**.
2. **Upload a paper.** Click **Upload a paper** or drag a text-based PDF (up to 25 MB) onto the
   page. A progress screen shows each step. The first upload also downloads the small embedding
   model, so it takes a little longer.
3. **Read the summary.** Use the contents list to jump between sections. Click a yellow page mark
   such as `p.3` to open the PDF at that page.
4. **Ask questions** in the **Ask the paper** panel, or click a suggested question. Pick an
   answer style (Standard, Simple or Reviewer) under the box. Hover a page mark in an answer to
   preview the passage it came from.
5. **Keep several conversations.** Click the pen icon for a new conversation and the clock icon to
   see earlier ones. The expand icon opens the chat in full screen, with the history on the left.
6. **Study with flashcards.** Open the **Flashcards** tab, flip each card and mark it. At the end,
   review only the cards you're still learning.
7. **Check that users are separate.** Sign out, create a second account and confirm its library
   is empty.

## AI tools used

**Inside the app**
- **Google Gemini** (`gemini-3.5-flash-lite`, with `gemini-3.5-flash` as a backup) writes the
  summaries, the flashcards and the chat answers.
- **fastembed** (`BAAI/bge-small-en-v1.5`) turns passages into vectors for meaning-based search.
  It runs locally.

**During development**

I used Claude Code as my coding assistant throughout this project. It helped me generate code for the backend (PDF parsing, summary generation and the RAG chat) and the React frontend, which I then reviewed, tested and adjusted. I also used it to find and fix bugs, to explain parts of the code I didn't understand, such as how the paper is split into chunks and how hybrid search works, and to help write the tests and this README.

I decided which features to build. The flashcards, the resizable layout, the close button for the chat and folding the library when a PDF opens all came from problems I noticed while using the app. When the chat answers were too slow for a demo, I compared different Gemini models with Claude Code and then applied the speed fixes step by step.

I tested every change in the browser and reviewed the code before committing. Some AI suggestions caused errors, such as an indentation error in `main.py`, and I fixed them through testing. Testing the setup on a fresh copy also found a bug in `requirements.txt` that would have stopped anyone from installing the app.

Through this project, I learned how RAG works in practice: splitting a document into chunks, turning them into embeddings, and searching them to give the LLM the right context to answer questions.

## Running the tests

The tests need the database from step 2 to be running. They use a separate `paperlens_test`
database, which they create automatically, and replace the LLM with fakes, so they need no API
key.

```bash
cd backend
python -m pytest
```

(`python -m pytest` also works from the project root.)

They cover:
- sign-up, sign-in, sessions and login throttling
- user isolation on every paper route
- upload and chat retrieval
- conversations: separate histories, deletion, privacy, and moving chats saved before
  conversations existed
- caching of summaries and flashcards
- reading summaries that the model returns in a slightly different shape, and asking again when
  sections come back empty
- deletion and retrieval ranking

## How it works

```
Upload:    PDF ─► page text ─► chunks (never cross pages) ─► embeddings ─► Postgres
Summary:   page text with [Page N] markers ─► LLM (JSON) ─► checked ─► saved on the paper
Cards:     page text with [Page N] markers ─► LLM (JSON) ─► 12 cards with pages ─► saved on the paper
Question:  question ─► BM25 + pgvector search ─► top 6 passages ─► LLM ─► streamed answer with [n] citations
```

- **Why chunks never cross pages:** each passage belongs to exactly one page, so every citation
  points to the right page.
- **Why hybrid search:** keyword search finds exact terms such as "WER" or dataset names. Vector
  search finds passages with the same meaning but different words. Combining the two works better
  than either one alone.
- **Why the answers stay grounded:** the LLM is told to answer only from the numbered passages it
  is given and to cite them. The page numbers in a summary are checked, and any page the paper
  doesn't have is removed.

## Configuration

All settings live in `backend/.env` (see `backend/.env.example`).

| Setting | Default | Meaning |
| --- | --- | --- |
| `LLM_PROVIDER` | `gemini` | `gemini` or `openai` (any OpenAI-compatible API: OpenAI, Groq, Ollama) |
| `GEMINI_API_KEY` | | Your Gemini key |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` (in `.env.example`) | Main model; `GEMINI_FALLBACK_MODELS` are tried if it's busy |
| `LLM_TIMEOUT_SECONDS` | `45` | A model that hasn't answered by then is skipped for the next one |
| `DATABASE_URL` | `postgresql+psycopg://paperlens:paperlens@localhost:5433/paperlens` | Postgres connection |
| `SESSION_DAYS` | `30` | How long a sign-in lasts |
| `COOKIE_SECURE` | `false` | Set to `true` when serving over HTTPS |
| `MAX_PAPERS_PER_USER` | `100` | Library size limit per account |
| `USE_EMBEDDINGS` | `true` | Set to `false` for keyword-only search |
| `CHUNK_SIZE` / `CHUNK_OVERLAP` | `1200` / `200` | Chunk length and overlap in characters |
| `TOP_K` | `6` | Passages retrieved per question |
| `MAX_UPLOAD_MB` | `25` | Largest PDF accepted |

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
├── docs/screenshots/         images used in this README
└── frontend/
    └── src/
        ├── App.jsx           app shell, layout and sign-in gate
        ├── api.js            API client
        └── components/       reader, chat, flashcards, sidebar, sign-in, ...
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

## Known limitations

- **Scanned PDFs** (images of pages) are rejected, because they contain no text to read. Running
  OCR on them first would fix this.
- **Figures and tables** are read only as text. Charts and images are not analysed.
- Answers can only be as good as the passages found. A very general question ("summarise
  everything") works better on the Summary tab than in the chat.
- The app runs locally. Putting it online would need a hosted Postgres with pgvector, and
  `COOKIE_SECURE=true` behind HTTPS.
