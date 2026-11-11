"""Split page text into overlapping chunks that remember which page they came from."""
import re
from dataclasses import asdict, dataclass

_SENTENCE_END = re.compile(r"(?<=[.!?])\s+")


@dataclass
class Chunk:
    id: int
    page: int     # 1-based page number
    text: str

    def to_dict(self) -> dict:
        return asdict(self)


def _split_long(text: str, size: int) -> list[str]:
    """Break a paragraph longer than `size` on sentence boundaries (hard cut as last resort)."""
    pieces, current = [], ""
    for sentence in _SENTENCE_END.split(text):
        while len(sentence) > size:
            pieces.append(sentence[:size])
            sentence = sentence[size:]
        if len(current) + len(sentence) + 1 > size and current:
            pieces.append(current)
            current = sentence
        else:
            current = f"{current} {sentence}".strip()
    if current:
        pieces.append(current)
    return pieces


def chunk_pages(pages: list[str], size: int = 1200, overlap: int = 200) -> list[Chunk]:
    """Paragraph-aware chunking. Chunks never span pages, so every chunk has an exact page citation."""
    chunks: list[Chunk] = []
    for page_no, page_text in enumerate(pages, start=1):
        paragraphs = [p.strip() for p in re.split(r"\n\s*\n", page_text) if p.strip()]
        units: list[str] = []
        for para in paragraphs:
            para = re.sub(r"\s*\n\s*", " ", para)
            units.extend(_split_long(para, size) if len(para) > size else [para])

        current = ""
        for unit in units:
            if current and len(current) + len(unit) + 1 > size:
                chunks.append(Chunk(len(chunks), page_no, current))
                tail = current[-overlap:] if overlap else ""
                # start the overlap on a word boundary
                tail = tail[tail.find(" ") + 1:] if " " in tail else tail
                current = f"{tail} {unit}".strip()
            else:
                current = f"{current} {unit}".strip()
        if len(current) > 40:  # skip stray page numbers / headers
            chunks.append(Chunk(len(chunks), page_no, current))
    return chunks