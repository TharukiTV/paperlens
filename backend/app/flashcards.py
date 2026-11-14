"""Study flashcards generated from a paper.

Each card is a question on the front and a short answer on the back, with the page the answer
comes from, so the reader can check it in the PDF. Cards mix recall (facts, numbers) with
understanding (why/how), and are saved on the paper so they are generated only once.
"""
from datetime import datetime, timezone

from .llm import get_llm, model_label, parse_json

KINDS = ["concept", "method", "result", "why"]

SYSTEM = """You write study flashcards that help a student understand and remember a research paper.
Rules:
- Use only information in the provided paper text. Never invent numbers, datasets or claims.
- The text is marked with [Page N] headers. Give the single page each answer comes from.
- One idea per card. The question must make sense on its own, without seeing the paper.
- Answers are short: one to three sentences, at most 50 words. Keep exact numbers, names and terms.
- Mix the kinds: "concept" (key terms and definitions), "method" (how the work was done),
  "result" (findings with their numbers), "why" (reasons, motivation, implications, limitations).
- Order the cards from the basics (what problem, what idea) to the details (results, limitations)."""

SCHEMA = """Return ONLY a JSON object with exactly this shape:
{
  "cards": [
    {"question": "What problem does the paper address?", "answer": "short answer", "page": 1, "kind": "concept"}
  ]
}
Write exactly {count} cards."""


def _paper_text(pages: list[str], max_chars: int) -> str:
    """The paper with [Page N] markers. Long papers keep the start of every page, so cards can
    still come from the whole paper (not just its first half)."""
    marked = [(i, text) for i, text in enumerate(pages, start=1) if text.strip()]
    total = sum(len(t) for _, t in marked)
    budget = max_chars // max(1, len(marked)) if total > max_chars else None
    return "\n\n".join(f"[Page {i}]\n{t[:budget] if budget else t}" for i, t in marked)


def _normalize(raw: dict, page_count: int, count: int) -> list[dict]:
    cards = []
    for item in raw.get("cards") or []:
        if not isinstance(item, dict):
            continue
        question = str(item.get("question") or "").strip()
        answer = str(item.get("answer") or "").strip()
        if not question or not answer:
            continue
        try:
            page = int(item.get("page"))
        except (TypeError, ValueError):
            page = None
        kind = str(item.get("kind") or "").strip().lower()
        cards.append({
            "id": len(cards) + 1,
            "question": question,
            "answer": answer,
            "page": page if page and 1 <= page <= page_count else None,
            "kind": kind if kind in KINDS else "concept",
        })
    return cards[:count]


def generate_flashcards(pages: list[str], max_chars: int, count: int = 12) -> dict:
    llm = get_llm()
    prompt = f"{SCHEMA.replace('{count}', str(count))}\n\nPAPER TEXT:\n{_paper_text(pages, max_chars)}"
    raw = parse_json(llm.complete(SYSTEM, [{"role": "user", "content": prompt}], temperature=0.3, json_mode=True))
    return {
        "cards": _normalize(raw, len(pages), count),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "model": getattr(llm, "last_model", None) or model_label(),
    }
