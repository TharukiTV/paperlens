import json

from conftest import register, upload


def test_papers_require_sign_in(client):
    assert client.get("/api/documents").status_code == 401
    assert client.post("/api/documents", files={"file": ("a.pdf", b"%PDF-1.4", "application/pdf")}).status_code == 401


def test_upload_list_and_read(client, sample_pdf):
    register(client)
    doc = upload(client, sample_pdf)
    assert doc["pages"] == 3 and doc["chunks"] >= 1

    assert [d["id"] for d in client.get("/api/documents").json()] == [doc["id"]]
    assert client.get(f"/api/documents/{doc['id']}").json()["summary"] is None

    pdf = client.get(f"/api/documents/{doc['id']}/file")
    assert pdf.status_code == 200 and pdf.content == sample_pdf


def test_users_cannot_see_each_others_papers(client, make_client, sample_pdf):
    register(client, email="ada@example.com")
    doc = upload(client, sample_pdf)

    bob = make_client()
    register(bob, email="bob@example.com")
    assert bob.get("/api/documents").json() == []
    for method, path in [
        ("get", f"/api/documents/{doc['id']}"),
        ("get", f"/api/documents/{doc['id']}/file"),
        ("get", f"/api/documents/{doc['id']}/chat"),
        ("delete", f"/api/documents/{doc['id']}/chat"),
        ("post", f"/api/documents/{doc['id']}/summary"),
        ("post", f"/api/documents/{doc['id']}/flashcards"),
        ("delete", f"/api/documents/{doc['id']}"),
    ]:
        assert getattr(bob, method)(path).status_code == 404, (method, path)
    r = bob.post(f"/api/documents/{doc['id']}/chat", json={"question": "What is the WER?"})
    assert r.status_code == 404

    # Ada's paper survived Bob's attempts
    assert client.get(f"/api/documents/{doc['id']}").status_code == 200


def test_chat_retrieves_from_the_paper_and_saves_history(client, sample_pdf, monkeypatch):
    from app import qa

    seen = {}

    def fake_stream(doc_id, question, history, sources, style="default"):
        seen["sources"] = sources
        yield "The WER is 18.2% [1]."

    monkeypatch.setattr(qa, "answer_stream", fake_stream)
    register(client)
    doc = upload(client, sample_pdf)

    r = client.post(f"/api/documents/{doc['id']}/chat", json={"question": "What word error rate did LiteSpeech reach?"})
    events = [block for block in r.text.split("\n\n") if block]
    assert events[0].startswith("event: sources")
    sources = json.loads(events[0].split("data: ", 1)[1])
    assert sources[0]["page"] == 3  # the results page ranks first
    assert events[-1].startswith("event: done")

    history = client.get(f"/api/documents/{doc['id']}/chat").json()
    assert [m["role"] for m in history] == ["user", "assistant"]
    assert history[1]["content"] == "The WER is 18.2% [1]."

    assert client.delete(f"/api/documents/{doc['id']}/chat").status_code == 204
    assert client.get(f"/api/documents/{doc['id']}/chat").json() == []


def test_summary_is_cached(client, sample_pdf, monkeypatch):
    import app.main as main

    calls = []

    def fake_summary(pages, max_chars, metadata):
        calls.append(len(pages))
        return {"title": "LiteSpeech", "authors": ["A. Perera"], "tldr": "Small and good.", "sections": {}, "keywords": []}

    monkeypatch.setattr(main, "generate_summary", fake_summary)
    register(client)
    doc = upload(client, sample_pdf)
    assert client.post(f"/api/documents/{doc['id']}/summary").json()["title"] == "LiteSpeech"
    client.post(f"/api/documents/{doc['id']}/summary")
    assert calls == [3]
    assert client.get("/api/documents").json()[0]["title"] == "LiteSpeech"


def test_delete_removes_everything(client, sample_pdf):
    from sqlalchemy import func, select

    from app.db import ChatMessage, Chunk, DocumentFile, SessionLocal

    register(client)
    doc = upload(client, sample_pdf)
    assert client.delete(f"/api/documents/{doc['id']}").status_code == 204
    assert client.get(f"/api/documents/{doc['id']}").status_code == 404
    with SessionLocal() as db:
        for model in (Chunk, DocumentFile, ChatMessage):
            assert db.scalar(select(func.count()).select_from(model)) == 0


def test_library_limit(client, sample_pdf, monkeypatch):
    import app.main as main

    monkeypatch.setattr(main.settings, "max_papers_per_user", 1)
    register(client)
    upload(client, sample_pdf)
    r = client.post("/api/documents", files={"file": ("b.pdf", sample_pdf, "application/pdf")})
    assert r.status_code == 409
