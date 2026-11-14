import json

from conftest import register, upload


def ask(client, doc_id, question, conversation_id=None):
    """Ask a question; returns the conversation it went into."""
    body = {"question": question}
    if conversation_id:
        body["conversation_id"] = conversation_id
    r = client.post(f"/api/documents/{doc_id}/chat", json=body)
    assert r.status_code == 200, r.text
    first = [b for b in r.text.split("\n\n") if b][0]
    assert first.startswith("event: conversation")
    return json.loads(first.split("data: ", 1)[1])


def fake_answers(monkeypatch):
    from app import qa

    def fake_stream(doc_id, question, history, sources, style="default"):
        yield f"Answer to: {question} (history {len(history)})"

    monkeypatch.setattr(qa, "answer_stream", fake_stream)


def test_new_conversation_keeps_the_old_one(client, sample_pdf, monkeypatch):
    fake_answers(monkeypatch)
    register(client)
    doc = upload(client, sample_pdf)

    first = ask(client, doc["id"], "What is the WER?")
    again = ask(client, doc["id"], "And on Tamil?", first["id"])
    assert again["id"] == first["id"]                      # follow-up stays in the same conversation
    second = ask(client, doc["id"], "Explain the method simply")
    assert second["id"] != first["id"]                     # no id: a new conversation

    listed = client.get(f"/api/documents/{doc['id']}/conversations").json()
    assert [c["id"] for c in listed] == [second["id"], first["id"]]  # most recent first
    assert [c["title"] for c in listed] == ["Explain the method simply", "What is the WER?"]

    old = client.get(f"/api/documents/{doc['id']}/conversations/{first['id']}").json()
    assert [m["content"] for m in old["messages"] if m["role"] == "user"] == ["What is the WER?", "And on Tamil?"]
    assert old["messages"][-1]["content"] == "Answer to: And on Tamil? (history 2)"  # saw its own history only
    new = client.get(f"/api/documents/{doc['id']}/conversations/{second['id']}").json()
    assert new["messages"][-1]["content"] == "Answer to: Explain the method simply (history 0)"


def test_delete_one_conversation(client, sample_pdf, monkeypatch):
    fake_answers(monkeypatch)
    register(client)
    doc = upload(client, sample_pdf)
    keep = ask(client, doc["id"], "Keep me")
    drop = ask(client, doc["id"], "Delete me")

    assert client.delete(f"/api/documents/{doc['id']}/conversations/{drop['id']}").status_code == 204
    assert [c["id"] for c in client.get(f"/api/documents/{doc['id']}/conversations").json()] == [keep["id"]]
    assert client.get(f"/api/documents/{doc['id']}/conversations/{drop['id']}").status_code == 404
    r = client.post(f"/api/documents/{doc['id']}/chat", json={"question": "Hi", "conversation_id": drop["id"]})
    assert r.status_code == 404


def test_failed_first_question_leaves_no_empty_conversation(client, sample_pdf, monkeypatch):
    from app import qa
    from app.llm import LLMError

    def failing_stream(*args, **kwargs):
        raise LLMError("The model is busy.")
        yield  # pragma: no cover

    monkeypatch.setattr(qa, "answer_stream", failing_stream)
    register(client)
    doc = upload(client, sample_pdf)
    r = client.post(f"/api/documents/{doc['id']}/chat", json={"question": "Hello?"})
    assert "event: error" in r.text
    assert client.get(f"/api/documents/{doc['id']}/conversations").json() == []


def test_conversations_are_private(client, make_client, sample_pdf, monkeypatch):
    fake_answers(monkeypatch)
    register(client, email="ada@example.com")
    doc = upload(client, sample_pdf)
    other_doc = upload(client, sample_pdf)
    conv = ask(client, doc["id"], "Private question")

    bob = make_client()
    register(bob, email="bob@example.com")
    base = f"/api/documents/{doc['id']}"
    assert bob.get(f"{base}/conversations").status_code == 404
    assert bob.get(f"{base}/conversations/{conv['id']}").status_code == 404
    assert bob.delete(f"{base}/conversations/{conv['id']}").status_code == 404
    r = bob.post(f"{base}/chat", json={"question": "Sneaky", "conversation_id": conv["id"]})
    assert r.status_code == 404

    # Ada can't reach a conversation through a different paper either.
    assert client.get(f"/api/documents/{other_doc['id']}/conversations/{conv['id']}").status_code == 404
    assert len(client.get(f"{base}/conversations/{conv['id']}").json()["messages"]) == 2


def test_old_chats_are_moved_into_a_conversation(client, sample_pdf):
    from sqlalchemy import select

    from app.db import ChatMessage, Conversation, SessionLocal, init_db

    register(client)
    doc = upload(client, sample_pdf)
    with SessionLocal() as db:  # messages saved the old way, before conversations existed
        db.add_all([
            ChatMessage(document_id=doc["id"], role="user", content="An old question from before"),
            ChatMessage(document_id=doc["id"], role="assistant", content="An old answer", sources=[]),
        ])
        db.commit()

    init_db()  # runs on every server start

    listed = client.get(f"/api/documents/{doc['id']}/conversations").json()
    assert [c["title"] for c in listed] == ["An old question from before"]
    with SessionLocal() as db:
        assert db.scalar(select(ChatMessage.id).where(ChatMessage.conversation_id.is_(None))) is None
        assert len(db.scalars(select(Conversation)).all()) == 1
    init_db()  # running it again changes nothing
    assert len(client.get(f"/api/documents/{doc['id']}/conversations").json()) == 1
