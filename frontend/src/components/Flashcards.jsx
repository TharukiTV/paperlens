import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle, ArrowLeft, ArrowRight, Check, Layers, Loader2, Maximize2, MessageSquareText, Minimize2, RefreshCw, RotateCcw, Shuffle, X,
} from "lucide-react";
import { api } from "../api";
import PageRef from "./PageRef";
import { useToast } from "./Toast";

const KIND_LABELS = { concept: "Concept", method: "Method", result: "Result", why: "Why it matters" };

// Progress ("knew it" / "still learning") is kept in this browser, per paper and per deck.
const progressKey = (docId, deck) => `paperlens-cards-${docId}-${deck.generated_at || "v1"}`;
function loadProgress(key) {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "{}");
    return { known: saved.known || [], learning: saved.learning || [] };
  } catch {
    return { known: [], learning: [] };
  }
}
function saveProgress(key, progress) {
  try { localStorage.setItem(key, JSON.stringify(progress)); } catch { /* storage unavailable */ }
}

const shuffled = (list) => {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

export default function Flashcards({ doc, active = true, focused = false, onToggleFocus, onOpenPage, onAsk }) {
  const toast = useToast();
  const [deck, setDeck] = useState(null);
  const [status, setStatus] = useState({ state: "loading", error: "" });
  const [order, setOrder] = useState([]);       // card ids in the order being studied
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [progress, setProgress] = useState({ known: [], learning: [] });

  const startRound = useCallback((ids) => {
    setOrder(ids);
    setIndex(0);
    setFlipped(false);
  }, []);

  const load = useCallback(async (regenerate = false) => {
    setStatus({ state: "loading", error: "" });
    try {
      const data = await api.flashcards(doc.id, regenerate);
      setDeck(data);
      setProgress(loadProgress(progressKey(doc.id, data)));
      startRound(data.cards.map((c) => c.id));
      setStatus({ state: "ready", error: "" });
      if (regenerate) toast("New flashcards are ready", { tone: "success" });
    } catch (err) {
      setStatus({ state: "error", error: err.message });
    }
  }, [doc.id, startRound, toast]);

  useEffect(() => { load(); }, [load]);

  const byId = useMemo(() => Object.fromEntries((deck?.cards || []).map((c) => [c.id, c])), [deck]);
  const card = byId[order[index]];
  const finished = deck && index >= order.length;
  const total = deck?.cards.length || 0;

  const mark = useCallback((result) => {
    if (!card) return;
    setProgress((p) => {
      const next = {
        known: p.known.filter((id) => id !== card.id),
        learning: p.learning.filter((id) => id !== card.id),
      };
      next[result].push(card.id);
      saveProgress(progressKey(doc.id, deck), next);
      return next;
    });
    setFlipped(false);
    setIndex((i) => i + 1);
  }, [card, deck, doc.id]);

  const go = useCallback((step) => {
    setFlipped(false);
    setIndex((i) => Math.min(Math.max(0, i + step), Math.max(0, order.length - 1)));
  }, [order.length]);

  // Keyboard: Space/Enter flips, arrows move, 1 = still learning, 2 = knew it.
  useEffect(() => {
    if (!active || status.state !== "ready") return undefined;
    const onKey = (e) => {
      if (e.target.closest?.("input, textarea, [contenteditable]") || e.ctrlKey || e.metaKey || e.altKey) return;
      if (!card) return;
      if (e.key === " " || e.key === "Enter") {
        if (e.target.closest?.("button") && e.target.className !== "flashcard") return;
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "1") mark("learning");
      else if (e.key === "2") mark("known");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, status.state, card, go, mark]);

  if (status.state === "loading") {
    return (
      <div className="skeleton" aria-label="Making flashcards">
        <p className="skeleton__label"><Loader2 size={16} className="spin" aria-hidden="true" /> Making flashcards from the paper…</p>
        <span className="skeleton__block flashcards__skeleton-card" />
      </div>
    );
  }

  if (status.state === "error") {
    return (
      <div className="summary-error">
        <p className="notice notice--error" role="alert"><AlertCircle size={16} aria-hidden="true" />{status.error}</p>
        <button className="button button--primary" onClick={() => load(deck ? true : false)}>
          <RefreshCw size={16} aria-hidden="true" />Try again
        </button>
      </div>
    );
  }

  const knownCount = progress.known.length;
  const learningIds = deck.cards.map((c) => c.id).filter((id) => progress.learning.includes(id));
  const reviewing = order.length < total;

  return (
    <div className="flashcards">
      <div className="flashcards__top">
        <div className="flashcards__stats" aria-live="polite">
          <span className="flashcards__stat flashcards__stat--known"><Check size={14} aria-hidden="true" />{knownCount} known</span>
          <span className="flashcards__stat flashcards__stat--learning"><RotateCcw size={14} aria-hidden="true" />{learningIds.length} still learning</span>
          {reviewing && <span className="flashcards__stat">Reviewing {order.length} of {total}</span>}
        </div>
        <div className="flashcards__tools">
          <button className="button button--ghost" onClick={() => startRound(shuffled(order))} disabled={order.length < 2}>
            <Shuffle size={15} aria-hidden="true" />Shuffle
          </button>
          {onToggleFocus && (
            <button className="button button--ghost" onClick={onToggleFocus} aria-pressed={focused} title={focused ? "Exit study mode (Esc)" : "Study mode: cards fill the screen"}>
              {focused ? <Minimize2 size={15} aria-hidden="true" /> : <Maximize2 size={15} aria-hidden="true" />}
              {focused ? "Exit" : "Study mode"}
            </button>
          )}
        </div>
      </div>

      <div className="flashcards__track" aria-hidden="true">
        <span style={{ width: `${(Math.min(index, order.length) / Math.max(1, order.length)) * 100}%` }} />
      </div>

      {finished ? (
        <div className="flashcards__done">
          <span className="flashcards__done-icon" aria-hidden="true"><Layers size={26} /></span>
          <h2>Round finished</h2>
          <p>You knew <strong>{knownCount}</strong> of {total} cards.{learningIds.length > 0 ? " Go through the ones you're still learning again to make them stick." : " Well done!"}</p>
          <div className="flashcards__done-actions">
            {learningIds.length > 0 && (
              <button className="button button--primary" onClick={() => startRound(shuffled(learningIds))}>
                <RotateCcw size={16} aria-hidden="true" />Review {learningIds.length} still learning
              </button>
            )}
            <button className="button" onClick={() => startRound(deck.cards.map((c) => c.id))}>
              <Layers size={16} aria-hidden="true" />Study all {total} again
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="flashcards__count">Card {index + 1} of {order.length}</p>
          <div className={`flashcard-scene ${flipped ? "is-flipped" : ""}`}>
            <button
              type="button"
              className="flashcard"
              onClick={() => setFlipped((f) => !f)}
              aria-label={flipped ? "Showing the answer. Press to see the question." : "Showing the question. Press to see the answer."}
            >
              <span className="flashcard__face flashcard__face--front" aria-hidden={flipped}>
                <span className={`flashcard__kind flashcard__kind--${card.kind}`}>{KIND_LABELS[card.kind] || "Concept"}</span>
                <span className="flashcard__question">{card.question}</span>
                <span className="flashcard__hint">Click or press <kbd>Space</kbd> to see the answer</span>
              </span>
              <span className="flashcard__face flashcard__face--back" aria-hidden={!flipped}>
                <span className="flashcard__label">Answer</span>
                <span className="flashcard__answer">{flipped ? card.answer : ""}</span>
              </span>
            </button>
          </div>

          <div className={`flashcards__answer-tools ${flipped ? "is-visible" : ""}`}>
            {card.page && <span className="flashcards__source">From <PageRef page={card.page} onOpenPage={onOpenPage} /></span>}
            <button className="button button--ghost" onClick={() => onAsk(`Explain this in more detail: ${card.question}`)} disabled={!flipped}>
              <MessageSquareText size={15} aria-hidden="true" />Explain more
            </button>
          </div>

          <div className="flashcards__controls">
            <button className="icon-button" onClick={() => go(-1)} disabled={index === 0} aria-label="Previous card" title="Previous (←)">
              <ArrowLeft size={18} />
            </button>
            <button className="button flashcards__rate flashcards__rate--learning" onClick={() => mark("learning")}>
              <X size={16} aria-hidden="true" />Still learning <kbd>1</kbd>
            </button>
            <button className="button flashcards__rate flashcards__rate--known" onClick={() => mark("known")}>
              <Check size={16} aria-hidden="true" />I knew it <kbd>2</kbd>
            </button>
            <button className="icon-button" onClick={() => go(1)} disabled={index >= order.length - 1} aria-label="Next card" title="Next (→)">
              <ArrowRight size={18} />
            </button>
          </div>
        </>
      )}

      <footer className="flashcards__footer">
        <p>{total} cards made by {deck.model} from the paper. Check the page mark if an answer looks wrong.</p>
        <button className="button" onClick={() => load(true)}>
          <RefreshCw size={16} aria-hidden="true" />Make new cards
        </button>
      </footer>
    </div>
  );
}
