import json

from app import summarizer

PAGES = ["Page one text " * 20, "Page two text " * 20, "Page three text " * 20]

FULL = {
    "title": "LiteSpeech", "authors": ["A. Perera"], "tldr": "A small speech model.",
    "abstract": {"content": "Abstract text", "pages": [1]},
    "problem_statement": {"content": "Problem text", "pages": [1]},
    "methodology": {"content": "Method text", "pages": [2]},
    "key_results": {"content": "Results text", "pages": [3]},
    "conclusion": {"content": "Conclusion text", "pages": [3]},
    "limitations": {"content": "Limits text", "pages": [3]},
}


def test_sections_in_other_shapes_are_still_found():
    raw = {
        "title": "LiteSpeech",
        "sections": {                                            # nested under "sections"
            "Abstract": {"text": "Abstract text", "pages": [1]},  # "text" instead of "content"
            "Problem Statement": "Problem text",                  # plain string, title case
            "Methods": {"content": "Method text", "pages": [2]},  # another name
            "key-results": {"content": ["18.2% WER", "3.1x faster"], "pages": [3, 99]},  # list, bad page
            "Conclusions": {"summary": "Conclusion text"},
        },
    }
    s = summarizer._normalize(raw, page_count=3)["sections"]
    assert s["abstract"]["content"] == "Abstract text"
    assert s["problem_statement"]["content"] == "Problem text"
    assert s["methodology"]["pages"] == [2]
    assert s["key_results"]["content"] == "- 18.2% WER\n- 3.1x faster"
    assert s["key_results"]["pages"] == [3]                      # page 99 doesn't exist, so it's dropped
    assert s["conclusion"]["content"] == "Conclusion text"
    assert s["limitations"]["content"] == ""


class FakeLLM:
    def __init__(self, replies):
        self.replies, self.calls, self.last_model = list(replies), 0, "fake"

    def complete(self, *args, **kwargs):
        self.calls += 1
        return json.dumps(self.replies.pop(0))


def test_a_summary_with_empty_sections_is_asked_for_again(monkeypatch):
    only_abstract = {"title": "LiteSpeech", "abstract": {"content": "Abstract text", "pages": [1]}}
    llm = FakeLLM([only_abstract, FULL])
    monkeypatch.setattr(summarizer, "get_llm", lambda: llm)

    s = summarizer.generate_summary(PAGES, max_chars=120_000)
    assert llm.calls == 2
    assert s["sections"]["methodology"]["content"] == "Method text"


def test_a_complete_summary_is_not_asked_for_twice(monkeypatch):
    llm = FakeLLM([FULL])
    monkeypatch.setattr(summarizer, "get_llm", lambda: llm)

    summarizer.generate_summary(PAGES, max_chars=120_000)
    assert llm.calls == 1
