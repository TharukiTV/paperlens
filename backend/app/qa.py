"""Retrieval-augmented question answering with page-level citations."""
from collections.abc import Iterator

from . import store
from .config import get_settings
from .llm import get_llm

SYSTEM = """You are PaperLens, a research assistant answering questions about ONE research paper.

Ground rules:
- Answer only from the numbered excerpts and the paper overview below. Do not use outside knowledge
  about the paper's results. You may use general knowledge only to explain a concept the paper uses,
  and say when you do.
- Cite every factual claim with the excerpt number in square brackets, e.g. [2] or [1][4].
  Cite only excerpts that actually support the claim. The paper overview is background only:
  never cite it, and never write anything other than excerpt numbers inside the brackets.
- If the excerpts don't contain the answer, say clearly that the paper (or the retrieved parts of it)
  doesn't say, and suggest what the user could ask instead. Never guess numbers.
- Be concise and well structured. Use Markdown: short paragraphs, bullet lists, and tables for comparisons.
{style}"""

STYLES = {
    "default": "- Write for a technically literate reader.",
    "simple": "- Explain like a patient teacher to a first-year undergraduate: plain words, define jargon, use a short analogy if it helps.",
    "critical": "- Act as a critical peer reviewer: weigh the evidence, point out assumptions, threats to validity and missing baselines, still citing excerpts.",
}

MAX_HISTORY_TURNS = 6


def build_retrieval_query(question: str, history: list[dict]) -> str:
    """Short follow-ups ("what about the second one?") need the previous question for context."""
    previous = [m["content"] for m in history if m["role"] == "user"]
    if previous and len(question.split()) < 12:
        return f"{previous[-1]} {question}"
    return question


def build_context(doc_id: str, sources: list[dict]) -> str:
    summary = store.get_summary(doc_id)  # caller has already checked the user owns doc_id
    overview = ""
    if summary:
        abstract = summary["sections"].get("abstract", {}).get("content", "")
        overview = f"PAPER OVERVIEW\nTitle: {summary['title']}\nIn short: {summary.get('tldr', '')}\nAbstract: {abstract}\n\n"
    excerpts = "\n\n".join(f"[{i}] (page {s['page']})\n{s['text']}" for i, s in enumerate(sources, start=1))
    return f"{overview}EXCERPTS\n{excerpts}"


def retrieve(doc_id: str, question: str, history: list[dict]) -> list[dict]:
    retriever = store.get_retriever(doc_id)
    return retriever.search(build_retrieval_query(question, history), k=get_settings().top_k)


def answer_stream(doc_id: str, question: str, history: list[dict], sources: list[dict],
                  style: str = "default") -> Iterator[str]:
    system = SYSTEM.format(style=STYLES.get(style, STYLES["default"]))
    recent = history[-MAX_HISTORY_TURNS * 2:]
    messages = [
        *({"role": m["role"], "content": m["content"]} for m in recent),
        {"role": "user", "content": f"{build_context(doc_id, sources)}\n\nQUESTION: {question}"},
    ]
    yield from get_llm().stream(system, messages, temperature=0.2)