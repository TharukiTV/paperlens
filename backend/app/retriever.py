"""Hybrid retrieval: BM25 keyword search + dense embeddings, merged with Reciprocal Rank Fusion.

Keyword search catches exact terms (dataset names, metric names, acronyms); embeddings catch
paraphrases ("how did they test it" -> "evaluation"). RRF combines both rankings without
having to tune score scales. If the embedding model can't load, retrieval falls back to BM25.
"""
import logging
import re
import threading

import numpy as np
from rank_bm25 import BM25Okapi

from .config import get_settings

log = logging.getLogger(__name__)
_TOKEN = re.compile(r"[a-z0-9]+(?:[-_.][a-z0-9]+)*")
_STOP = set(
    "a an the of to in on for and or is are was were be been by with as at from that this these those "
    "it its into than then there their they we our you your what which who how why when does do did "
    "can could would should paper study authors".split()
)


def tokenize(text: str) -> list[str]:
    return [t for t in _TOKEN.findall(text.lower()) if t not in _STOP]


class Embedder:
    """Lazy, thread-safe singleton around a local fastembed model (ONNX, CPU, no API key)."""

    _model = None
    _failed = False
    _lock = threading.Lock()

    @classmethod
    def get(cls):
        settings = get_settings()
        if not settings.use_embeddings or cls._failed:
            return None
        if cls._model is None:
            with cls._lock:
                if cls._model is None and not cls._failed:
                    try:
                        from fastembed import TextEmbedding

                        log.info("Loading embedding model %s ...", settings.embedding_model)
                        cls._model = TextEmbedding(settings.embedding_model)
                    except Exception:  # network, disk, unsupported platform
                        log.exception("Embedding model unavailable; using keyword search only.")
                        cls._failed = True
        return cls._model

    @classmethod
    def available(cls) -> bool:
        return cls.get() is not None

    @classmethod
    def embed_passages(cls, texts: list[str]) -> np.ndarray | None:
        model = cls.get()
        if model is None or not texts:
            return None
        vectors = np.array(list(model.passage_embed(texts)), dtype=np.float32)
        return _normalize(vectors)

    @classmethod
    def embed_query(cls, text: str) -> np.ndarray | None:
        model = cls.get()
        if model is None:
            return None
        return _normalize(np.array(list(model.query_embed([text])), dtype=np.float32))[0]


def _normalize(m: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(m, axis=1, keepdims=True)
    return m / np.clip(norms, 1e-12, None)


class HybridRetriever:
    """BM25 runs in memory over the paper's chunks. Vector search is delegated to `vector_search`
    (pgvector in production), a callable (query_vector, limit) -> chunk ids in best-first order.
    Passing a plain `embeddings` matrix instead searches it in memory (handy for tests)."""

    def __init__(self, chunks: list[dict], vector_search=None, embeddings: np.ndarray | None = None):
        self.chunks = chunks
        self.vector_search = vector_search
        self.embeddings = embeddings
        self._index_of = {c["id"]: i for i, c in enumerate(chunks)}
        corpus = [tokenize(c["text"]) or ["_"] for c in chunks]
        self.bm25 = BM25Okapi(corpus) if chunks else None

    def _dense_ranking(self, query: str, candidates: int) -> list[int]:
        if self.vector_search is None and (self.embeddings is None or len(self.embeddings) != len(self.chunks)):
            return []
        q_vec = Embedder.embed_query(query)
        if q_vec is None:
            return []
        if self.vector_search is not None:
            return [self._index_of[cid] for cid in self.vector_search(q_vec, candidates) if cid in self._index_of]
        sims = self.embeddings @ q_vec
        return [int(i) for i in np.argsort(-sims)[:candidates]]

    def search(self, query: str, k: int = 6, rrf_k: int = 60) -> list[dict]:
        if not self.chunks:
            return []
        candidates = max(k * 4, 20)
        rankings: list[list[int]] = []

        q_tokens = tokenize(query)
        if q_tokens and self.bm25 is not None:
            scores = self.bm25.get_scores(q_tokens)
            order = [i for i in np.argsort(-scores)[:candidates] if scores[i] > 0]
            if order:
                rankings.append(order)

        dense = self._dense_ranking(query, candidates)
        if dense:
            rankings.append(dense)

        if not rankings:  # nothing matched at all: return the opening chunks (title/abstract)
            return [dict(c, score=0.0) for c in self.chunks[:k]]

        fused: dict[int, float] = {}
        for ranking in rankings:
            for rank, idx in enumerate(ranking):
                fused[int(idx)] = fused.get(int(idx), 0.0) + 1.0 / (rrf_k + rank + 1)

        best = sorted(fused.items(), key=lambda kv: kv[1], reverse=True)[:k]
        return [dict(self.chunks[i], score=round(s, 5)) for i, s in best]