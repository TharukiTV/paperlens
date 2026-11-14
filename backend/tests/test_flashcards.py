from conftest import register, upload


def test_flashcards_are_generated_once_and_saved(client, sample_pdf, monkeypatch):
    import app.main as main

    calls = []

    def fake_flashcards(pages, max_chars):
        calls.append(len(pages))
        return {"cards": [{"id": 1, "question": "What WER did LiteSpeech reach?", "answer": "18.2%.",
                           "page": 3, "kind": "result"}], "model": "fake"}

    monkeypatch.setattr(main, "generate_flashcards", fake_flashcards)
    register(client)
    doc = upload(client, sample_pdf)
    url = f"/api/documents/{doc['id']}/flashcards"

    first = client.post(url).json()
    assert first["cards"][0]["page"] == 3
    assert client.post(url).json() == first          # served from the database
    assert calls == [3]

    client.post(url, params={"regenerate": "true"})   # regenerate asks the model again
    assert calls == [3, 3]


def test_empty_deck_is_an_error_and_not_saved(client, sample_pdf, monkeypatch):
    import app.main as main

    monkeypatch.setattr(main, "generate_flashcards", lambda pages, max_chars: {"cards": []})
    register(client)
    doc = upload(client, sample_pdf)
    assert client.post(f"/api/documents/{doc['id']}/flashcards").status_code == 502


def test_model_output_is_cleaned_up():
    from app.flashcards import _normalize

    raw = {"cards": [
        {"question": "What is CTC?", "answer": "A loss for unaligned sequences.", "page": "2", "kind": "Concept"},
        {"question": "", "answer": "no question"},                     # dropped
        {"question": "Why convolutions?", "answer": "Speed.", "page": 99, "kind": "odd"},
        "not a card",                                                  # dropped
        {"question": "Extra", "answer": "Over the limit", "page": 1},  # beyond count
    ]}
    cards = _normalize(raw, page_count=3, count=2)
    assert [c["id"] for c in cards] == [1, 2]
    assert cards[0] == {"id": 1, "question": "What is CTC?", "answer": "A loss for unaligned sequences.",
                        "page": 2, "kind": "concept"}
    assert cards[1]["page"] is None and cards[1]["kind"] == "concept"  # out-of-range page, unknown kind


def test_long_papers_keep_every_page():
    from app.flashcards import _paper_text

    text = _paper_text(["a" * 1000, "b" * 1000, "c" * 1000], max_chars=900)
    assert "[Page 1]" in text and "[Page 3]" in text
    assert "a" * 300 in text and "a" * 301 not in text  # each page trimmed to its share (900 / 3)
