"""Hybrid retrieval logic, without a database or embedding model."""
import numpy as np

from app.retriever import Embedder, HybridRetriever

CHUNKS = [
    {"id": 0, "page": 1, "text": "We introduce LiteSpeech for Sinhala speech recognition."},
    {"id": 1, "page": 4, "text": "Training used 400 hours of unlabelled audio."},
    {"id": 2, "page": 7, "text": "The word error rate drops to 18.2 percent on the test set."},
]


def test_keyword_search_finds_exact_terms():
    hits = HybridRetriever(CHUNKS).search("word error rate", k=1)
    assert hits[0]["page"] == 7


def test_vector_search_callable_is_fused_with_keywords(monkeypatch):
    monkeypatch.setattr(Embedder, "embed_query", classmethod(lambda cls, q: np.ones(3, dtype=np.float32)))
    calls = []

    def vector_search(q_vec, limit):
        calls.append(limit)
        return [1, 0]  # chunk ids, best first

    hits = HybridRetriever(CHUNKS, vector_search=vector_search).search("how much data did they train on", k=2)
    assert calls and hits[0]["page"] == 4


def test_falls_back_to_opening_chunks_when_nothing_matches():
    hits = HybridRetriever(CHUNKS).search("zzz qqq", k=2)
    assert [h["page"] for h in hits] == [1, 4]
