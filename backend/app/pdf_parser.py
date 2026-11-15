"""PDF text extraction with PyMuPDF, keeping page numbers for citations."""
import re
from dataclasses import dataclass, field

import pymupdf


class PDFError(ValueError):
    """Raised when a file can't be read as a text PDF."""


@dataclass
class ParsedPDF:
    pages: list[str]                      # cleaned text, index 0 = page 1
    metadata: dict = field(default_factory=dict)

    @property
    def full_text(self) -> str:
        return "\n\n".join(self.pages)

    @property
    def page_count(self) -> int:
        return len(self.pages)


def _clean(text: str) -> str:
    text = text.replace("\u00ad", "")                      # soft hyphens
    text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)         # "infor-\nmation" → "information" # re-join hyphenated line breaks
    text = re.sub(r"[ \t]+", " ", text) # many spaces → one space
    text = re.sub(r"\n{3,}", "\n\n", text)    # many blank lines → one blank line
    return text.strip()  


def parse_pdf(data: bytes) -> ParsedPDF:
    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
    except Exception as exc:  # pymupdf raises several error types
        raise PDFError("This file isn't a readable PDF.") from exc

    if doc.needs_pass:
        raise PDFError("This PDF is password-protected. Remove the password and upload it again.")

    pages = [_clean(page.get_text("text", sort=True)) for page in doc]
    meta = {k: v for k, v in (doc.metadata or {}).items() if v}
    doc.close()

    if sum(len(p) for p in pages) < 200:
        raise PDFError(
            "No selectable text was found. This looks like a scanned PDF; "
            "run it through OCR first, then upload it again."
        )
    return ParsedPDF(pages=pages, metadata=meta)


def read_pages(source) -> list[str]:
    """Re-read cleaned page text from a stored PDF (raw bytes or a file path)."""
    if isinstance(source, (bytes, bytearray)):
        opened = pymupdf.open(stream=source, filetype="pdf")
    else:
        opened = pymupdf.open(source)
    with opened as doc:
        return [_clean(page.get_text("text", sort=True)) for page in doc]