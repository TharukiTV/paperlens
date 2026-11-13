"""Structured summary generation.

Every section carries the page numbers it was drawn from, so the UI can link each part of
the summary back to the PDF. Short papers are summarised in one call; long ones use
map-reduce (notes per page window, then one final structured pass).
"""
import logging
from datetime import datetime, timezone

from .llm import get_llm, model_label, parse_json

log = logging.getLogger(__name__)

SECTIONS = ["abstract", "problem_statement", "methodology", "key_results", "conclusion", "limitations"]

SYSTEM = """You are an expert research analyst who writes precise, faithful summaries of academic papers.
Rules:
- Use only information in the provided paper text. Never invent numbers, datasets or claims.
- Keep the authors' terminology, model names, dataset names and metric values.
- The text is marked with [Page N] headers. For every section, list the pages its content comes from.
- Write section content in Markdown. Use short paragraphs; use bullet lists where they help (results, steps).
- If the paper genuinely doesn't cover a section, say so in one sentence and use an empty pages list."""

SCHEMA = """Return ONLY a JSON object with exactly this shape:
{
  "title": "paper title",
  "authors": ["Author One", "Author Two"],
  "tldr": "one plain-English sentence (max 35 words) saying what the paper does and found",
  "abstract": {"content": "the abstract, faithfully condensed to 80-150 words", "pages": [1]},
  "problem_statement": {"content": "the gap or problem, why it matters, and the research questions or objectives", "pages": []},
  "methodology": {"content": "approach, model/architecture, data, experimental setup and evaluation metrics", "pages": []},
  "key_results": {"content": "bulleted findings with the concrete numbers and baselines they are compared to", "pages": []},
  "conclusion": {"content": "main conclusions and contributions", "pages": []},
  "limitations": {"content": "limitations and future work stated by the authors", "pages": []},
  "keywords": ["5-8 key technical terms"],
  "suggested_questions": ["4 specific, interesting questions a reader might ask about this paper"]
}"""

MAP_SYSTEM = """You take dense research notes. From the paper excerpt, extract every fact relevant to:
title/authors, abstract, problem statement, methodology, key results (keep all numbers), conclusion,
limitations. Prefix each note with its page, like "(p.4) ...". Be thorough but terse. Plain text only."""


def _with_page_markers(pages: list[str]) -> list[str]:
    return [f"[Page {i}]\n{text}" for i, text in enumerate(pages, start=1) if text.strip()]


def _windows(marked_pages: list[str], max_chars: int) -> list[str]:
    windows, current = [], ""
    for page in marked_pages:
        if current and len(current) + len(page) > max_chars:
            windows.append(current)
            current = ""
        current += page[:max_chars] + "\n\n"
    if current:
        windows.append(current)
    return windows


def _normalize(raw: dict, page_count: int) -> dict:
    def pages(value) -> list[int]:
        out = []
        for p in value if isinstance(value, list) else []:
            try:
                p = int(p)
            except (TypeError, ValueError):
                continue
            if 1 <= p <= page_count and p not in out:
                out.append(p)
        return sorted(out)

    def str_list(value) -> list[str]:
        if isinstance(value, str):
            value = [v.strip() for v in value.split(",")]
        return [str(v).strip() for v in (value or []) if str(v).strip()]

    summary = {
        "title": str(raw.get("title") or "Untitled paper").strip(),
        "authors": str_list(raw.get("authors")),
        "tldr": str(raw.get("tldr") or "").strip(),
        "keywords": str_list(raw.get("keywords"))[:8],
        "suggested_questions": str_list(raw.get("suggested_questions"))[:5],
        "sections": {},
    }
    for key in SECTIONS:
        value = raw.get(key) or {}
        if isinstance(value, str):
            value = {"content": value, "pages": []}
        content = value.get("content", "")
        if isinstance(content, list):
            content = "\n".join(f"- {c}" for c in content)
        summary["sections"][key] = {"content": str(content).strip(), "pages": pages(value.get("pages"))}
    return summary


def generate_summary(pages: list[str], max_chars: int, hint: dict | None = None) -> dict:
    llm = get_llm()
    marked = _with_page_markers(pages)
    full = "\n\n".join(marked)
    hint_text = ""
    if hint and (hint.get("title") or hint.get("author")):
        hint_text = (f"\nPDF metadata (may be incomplete or wrong; trust the text first): "
                     f"title={hint.get('title', '')!r}, author={hint.get('author', '')!r}\n")

    if len(full) <= max_chars:
        strategy = "single-pass"
        prompt = f"{SCHEMA}\n{hint_text}\nPAPER TEXT:\n{full}"
    else:
        strategy = "map-reduce"
        windows = _windows(marked, max_chars)
        log.info("Long paper: map-reduce over %d windows", len(windows))
        notes = [
            llm.complete(MAP_SYSTEM, [{"role": "user", "content": f"EXCERPT {i + 1}/{len(windows)}:\n{w}"}])
            for i, w in enumerate(windows)
        ]
        opening = marked[0][:4000] if marked else ""
        prompt = (f"{SCHEMA}\n{hint_text}\nThe paper was too long to read at once, so here is its first page "
                  f"followed by research notes covering the whole paper (page refs like (p.4)).\n\n"
                  f"FIRST PAGE:\n{opening}\n\nNOTES:\n" + "\n\n".join(notes))

    raw = parse_json(llm.complete(SYSTEM, [{"role": "user", "content": prompt}], temperature=0.1, json_mode=True))
    summary = _normalize(raw, len(pages))
    summary["generated_at"] = datetime.now(timezone.utc).isoformat()
    summary["model"] = getattr(llm, "last_model", None) or model_label()
    summary["strategy"] = strategy
    return summary


def summary_to_markdown(summary: dict) -> str:
    titles = {
        "abstract": "Abstract", "problem_statement": "Problem statement", "methodology": "Methodology",
        "key_results": "Key results", "conclusion": "Conclusion", "limitations": "Limitations and future work",
    }
    lines = [f"# {summary['title']}", ""]
    if summary["authors"]:
        lines += [f"**Authors:** {', '.join(summary['authors'])}", ""]
    if summary.get("tldr"):
        lines += [f"> **In short:** {summary['tldr']}", ""]
    for key in SECTIONS:
        section = summary["sections"].get(key, {})
        if not section.get("content"):
            continue
        pages = section.get("pages") or []
        ref = f" _(pp. {', '.join(map(str, pages))})_" if pages else ""
        lines += [f"## {titles[key]}{ref}", "", section["content"], ""]
    if summary.get("keywords"):
        lines += ["## Keywords", "", ", ".join(summary["keywords"]), ""]
    lines += ["---", f"_Generated by PaperLens with {summary.get('model', 'an LLM')}._"]
    return "\n".join(lines)