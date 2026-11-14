import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle, ArrowDown, ArrowRight, Check, Copy, History, Maximize2, Minimize2, PanelLeftClose, PanelRightClose, RotateCcw,
  SendHorizontal, Sparkles, Square, SquarePen, Trash2,
} from "lucide-react";
import { api, streamChat } from "../api";
import Markdown from "./Markdown";
import Resizer from "./Resizer";
import PageRef from "./PageRef";
import { useToast } from "./Toast";

const STYLES = [
  ["default", "Standard", "Clear, technical answers"],
  ["simple", "Simple", "Plain words, jargon explained"],
  ["critical", "Reviewer", "Weighs the evidence like a peer reviewer"],
];
const STYLE_LABEL = Object.fromEntries(STYLES.map(([k, l]) => [k, l]));
const UNDO_MS = 5000;

// The conversation that was open last time, per paper (only a convenience, so failures are ignored).
const savedKey = (docId) => `paperlens-conversation-${docId}`;
const readSaved = (docId) => { try { return localStorage.getItem(savedKey(docId)); } catch { return null; } };
const writeSaved = (docId, convId) => {
  try {
    if (convId) localStorage.setItem(savedKey(docId), convId);
    else localStorage.removeItem(savedKey(docId));
  } catch { /* storage blocked */ }
};

function timeAgo(iso) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  if (hours < 48) return "yesterday";
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
const shorten = (t, n = 40) => (t.length > n ? `${t.slice(0, n)}…` : t);

/** The past conversations: a dropdown in the side panel, a resizable sidebar in full screen. */
function HistoryList({ conversations, currentId, busy, onOpen, onNew, onDelete, onHide }) {
  return (
    <>
      <div className="history__head">
        <h3>Conversations</h3>
        <div className="history__tools">
          <button className="icon-button" onClick={onNew} disabled={busy} aria-label="Start a new conversation"
            title={busy ? "Wait for the answer to finish" : "New conversation"}>
            <SquarePen size={17} />
          </button>
          {onHide && (
            <button className="icon-button" onClick={onHide} aria-label="Hide conversations" title="Hide conversations">
              <PanelLeftClose size={17} />
            </button>
          )}
        </div>
      </div>
      {conversations.length === 0 ? (
        <p className="history__empty">No saved conversations yet. Ask a question and it will appear here.</p>
      ) : (
        <ul className="history__list">
          {conversations.map((c) => (
            <li key={c.id} className={`history__item ${c.id === currentId ? "is-current" : ""}`}>
              <button className="history__open" onClick={() => onOpen(c.id)} disabled={busy}
                aria-current={c.id === currentId ? "true" : undefined}>
                <span className="history__title" title={c.title}>{c.title}</span>
                <span className="history__time">{c.id === currentId ? "Open now · " : ""}{timeAgo(c.updated_at)}</span>
              </button>
              <button className="icon-button history__delete" onClick={() => onDelete(c)} aria-label={`Delete “${c.title}”`}
                title="Delete (you can undo)" disabled={busy && c.id === currentId}>
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {busy && <p className="history__note">Wait for the answer to finish before switching.</p>}
    </>
  );
}

/** The dropdown version, opened from the clock button. Closes on Esc or a click outside. */
function HistoryPanel({ onClose, ...props }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    const onDown = (e) => { if (!ref.current?.contains(e.target) && !e.target.closest?.(".history-toggle")) onClose(); };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => { window.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onDown); };
  }, [onClose]);

  return (
    <div className="history" ref={ref} role="dialog" aria-label="Conversations">
      <HistoryList {...props} />
    </div>
  );
}

// Full-screen sidebar: shown or hidden, and its width, remembered in this browser.
const SIDEBAR = { min: 200, max: 420, initial: 270 };
const readPref = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const writePref = (key, value) => { try { localStorage.setItem(key, String(value)); } catch { /* storage blocked */ } };
const clampSidebar = (w) => Math.round(Math.min(SIDEBAR.max, Math.max(SIDEBAR.min, w)));

function Sources({ sources, onOpenPage }) {
  if (!sources?.length) return null;
  return (
    <details className="sources">
      <summary>{sources.length} passages used</summary>
      <ol>
        {sources.map((s) => (
          <li key={s.n}>
            <span className="sources__n">[{s.n}]</span>
            <PageRef page={s.page} onOpenPage={onOpenPage} />
            <span className="sources__text">{s.text.length > 220 ? `${s.text.slice(0, 220)}…` : s.text}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

export default function ChatPanel({ doc, onOpenPage, suggestions, request, onRequestHandled, focused = false, onToggleFocus, onClose }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [style, setStyle] = useState("default");
  const [busy, setBusy] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [copied, setCopied] = useState(null);
  const [conversationId, setConversationId] = useState(null); // null: a new conversation, not saved yet
  const [conversations, setConversations] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false); // the dropdown (side panel)
  const [sidebarShown, setSidebarShown] = useState(() => readPref("paperlens-history-sidebar", "1") === "1");
  const [sidebarWidth, setSidebarWidth] = useState(() => clampSidebar(Number(readPref("paperlens-history-width", SIDEBAR.initial))));
  const [hiddenIds, setHiddenIds] = useState([]); // deleted, waiting for the undo window to pass
  const deleteTimers = useRef({});
  const startedRef = useRef(false); // a question was asked before the last conversation finished loading
  const savedAtOpen = useRef(readSaved(doc.id)); // read before anything below overwrites it
  const abortRef = useRef(null);
  const logRef = useRef(null);
  const inputRef = useRef(null);
  const handledRef = useRef(null);
  const toast = useToast();

  const refreshList = useCallback(
    () => api.listConversations(doc.id).then(setConversations).catch(() => {}), [doc.id]);

  // Open the conversation used last time on this paper (or the most recent one).
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const list = await api.listConversations(doc.id);
        if (!live) return;
        setConversations(list);
        const pick = list.find((c) => c.id === savedAtOpen.current) || list[0];
        if (!pick) return;
        const conv = await api.getConversation(doc.id, pick.id);
        if (!live || startedRef.current) return; // a new question already started its own conversation
        setConversationId(conv.id);
        setMessages(conv.messages);
      } catch { /* the chat still works without history */ }
    })();
    const timers = deleteTimers.current;
    return () => {
      live = false;
      abortRef.current?.abort();
      // Leaving the paper during an undo window: finish those deletes now.
      Object.entries(timers).forEach(([id, t]) => {
        clearTimeout(t);
        api.deleteConversation(doc.id, id, { keepalive: true }).catch(() => {});
      });
    };
  }, [doc.id]);

  useEffect(() => { writeSaved(doc.id, conversationId); }, [doc.id, conversationId]);
  useEffect(() => { writePref("paperlens-history-sidebar", sidebarShown ? "1" : "0"); }, [sidebarShown]);
  useEffect(() => { writePref("paperlens-history-width", sidebarWidth); }, [sidebarWidth]);
  useEffect(() => { setHistoryOpen(false); }, [focused]); // full screen uses the sidebar instead

  // Follow the answer as it streams, unless the reader scrolled up to read something.
  useEffect(() => {
    if (atBottom) logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages, atBottom]);

  // Grow the box with the question, up to a limit.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [input]);

  // Press "/" anywhere to start typing a question.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target.closest?.("input, textarea, select, [contenteditable='true']")) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const updateLast = (fn) => setMessages((prev) => [...prev.slice(0, -1), fn(prev[prev.length - 1])]);

  const ask = async (question, styleOverride) => {
    question = question.trim();
    if (!question || busy) return;
    const useStyle = styleOverride || style;
    startedRef.current = true;
    setInput("");
    setBusy(true);
    setAtBottom(true);
    setMessages((prev) => [...prev, { role: "user", content: question }, { role: "assistant", content: "", sources: [], pending: true, style: useStyle }]);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamChat(doc.id, question, useStyle, {
        onConversation: (conv) => setConversationId(conv.id),
        onSources: (sources) => updateLast((m) => ({ ...m, sources })),
        onToken: (t) => updateLast((m) => ({ ...m, content: m.content + t })),
        onError: (error) => updateLast((m) => ({ ...m, error })),
        onDone: () => {},
      }, controller.signal, conversationId);
    } catch (err) {
      updateLast((m) => ({ ...m, error: err.message }));
    } finally {
      updateLast((m) => ({ ...m, pending: false, stopped: controller.signal.aborted }));
      setBusy(false);
      refreshList(); // new conversations appear, and this one moves to the top
      inputRef.current?.focus();
    }
  };

  // Questions sent from elsewhere: a summary section, a keyword, or selected text.
  useEffect(() => {
    if (!request) return;
    const timer = setTimeout(() => {
      if (handledRef.current === request.nonce) return;
      handledRef.current = request.nonce;
      onRequestHandled?.();
      if (request.send && !busy) {
        ask(request.text, request.style);
      } else {
        setInput(request.text);
        inputRef.current?.focus();
      }
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  const retry = () => {
    const last = messages[messages.length - 1];
    const question = messages[messages.length - 2];
    if (busy || last?.role !== "assistant" || question?.role !== "user") return;
    setMessages((prev) => prev.slice(0, -2));
    ask(question.content, last.style);
  };

  const copy = async (text, i) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(i);
      setTimeout(() => setCopied((c) => (c === i ? null : c)), 1600);
    } catch {
      toast("Couldn't copy. Select the text and copy it instead.", { tone: "error" });
    }
  };

  // Start a new conversation. Nothing is deleted: the current one stays in the history.
  const startNew = ({ keepHistoryOpen = false } = {}) => {
    if (busy) return;
    startedRef.current = true;
    setConversationId(null);
    setMessages([]);
    if (!keepHistoryOpen) {
      setHistoryOpen(false);
      inputRef.current?.focus();
    }
  };

  const openConversation = async (id) => {
    if (busy) return;
    setHistoryOpen(false);
    if (id === conversationId) return;
    startedRef.current = true;
    try {
      const conv = await api.getConversation(doc.id, id);
      setConversationId(conv.id);
      setMessages(conv.messages);
      setAtBottom(true);
    } catch (err) {
      toast(err.message, { tone: "error" });
      refreshList();
    }
  };

  // Delete with a short undo window, like papers.
  const removeConversation = (conv) => {
    setHiddenIds((ids) => [...ids, conv.id]);
    if (conv.id === conversationId) startNew({ keepHistoryOpen: true });
    deleteTimers.current[conv.id] = setTimeout(async () => {
      delete deleteTimers.current[conv.id];
      await api.deleteConversation(doc.id, conv.id).catch(() => {});
      setHiddenIds((ids) => ids.filter((x) => x !== conv.id));
      setConversations((list) => list.filter((c) => c.id !== conv.id));
    }, UNDO_MS);
    toast(`Deleted “${shorten(conv.title)}”`, {
      duration: UNDO_MS,
      action: {
        label: "Undo",
        onClick: () => {
          clearTimeout(deleteTimers.current[conv.id]);
          delete deleteTimers.current[conv.id];
          setHiddenIds((ids) => ids.filter((x) => x !== conv.id));
        },
      },
    });
  };

  const onScroll = () => {
    const el = logRef.current;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
  };

  const visibleConversations = conversations.filter((c) => !hiddenIds.includes(c.id));
  const current = conversations.find((c) => c.id === conversationId);
  const asked = new Set(messages.filter((m) => m.role === "user").map((m) => m.content));
  const remaining = suggestions.filter((q) => !asked.has(q)).slice(0, 3);

  return (
    <div className={`chat ${focused ? "chat--focused" : ""}`}>
      {focused && sidebarShown && (
        <aside className="chat-history" style={{ width: sidebarWidth }} aria-label="Conversations">
          <div className="history history--side">
            <HistoryList
              conversations={visibleConversations}
              currentId={conversationId}
              busy={busy}
              onOpen={openConversation}
              onNew={() => startNew()}
              onDelete={removeConversation}
              onHide={() => setSidebarShown(false)}
            />
          </div>
          <Resizer side="right" label="Conversations width" width={sidebarWidth} min={SIDEBAR.min} max={SIDEBAR.max}
            onResize={(w) => setSidebarWidth(clampSidebar(w))} onReset={() => setSidebarWidth(SIDEBAR.initial)} />
        </aside>
      )}
      <div className="chat__main">
      <header className="chat__head">
        <div className="chat__head-text">
          <h2>Ask the paper</h2>
          <p title={current?.title}>{current ? current.title : messages.length ? "New conversation" : "Answers cite the pages they use"}</p>
        </div>
        <div className="chat__head-tools">
          {messages.length > 0 && (
            <button className="icon-button" onClick={() => startNew()} disabled={busy} aria-label="Start a new conversation"
              title={busy ? "Wait for the answer to finish" : "New conversation (this one is kept in the history)"}>
              <SquarePen size={17} />
            </button>
          )}
          <button className={`icon-button history-toggle ${(focused ? sidebarShown : historyOpen) ? "is-active" : ""}`}
            onClick={() => (focused ? setSidebarShown((s) => !s) : setHistoryOpen((o) => !o))}
            aria-expanded={focused ? sidebarShown : historyOpen} aria-label="Conversation history"
            title={focused ? (sidebarShown ? "Hide conversations" : "Show conversations") : "Conversation history"}>
            <History size={17} />
            {visibleConversations.length > 1 && <span className="history-toggle__count">{visibleConversations.length}</span>}
          </button>
          {onToggleFocus && (
            <button className="icon-button" onClick={onToggleFocus} aria-pressed={focused}
              aria-label={focused ? "Exit full screen chat" : "Full screen chat"} title={focused ? "Exit full screen (Esc)" : "Full screen"}>
              {focused ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
            </button>
          )}
          {onClose && (
            <button className="icon-button" onClick={onClose} aria-label="Hide the chat" title="Hide the chat">
              <PanelRightClose size={17} />
            </button>
          )}
        </div>
        {historyOpen && !focused && (
          <HistoryPanel
            conversations={visibleConversations}
            currentId={conversationId}
            busy={busy}
            onOpen={openConversation}
            onNew={() => startNew()}
            onDelete={removeConversation}
            onClose={() => setHistoryOpen(false)}
          />
        )}
      </header>

      <div className="chat__log" ref={logRef} onScroll={onScroll} aria-live="polite">
        {messages.length === 0 && (
          <div className="chat__intro">
            <span className="chat__intro-icon" aria-hidden="true"><Sparkles size={20} /></span>
            <h3>Ask a question about this paper</h3>
            <p>PaperLens searches the paper first, then answers with page-level citations. Hover a page mark to preview the passage.</p>
            {suggestions.length > 0 && (
              <ul className="suggestions" aria-label="Suggested questions">
                {suggestions.map((q) => (
                  <li key={q}>
                    <button className="suggestion" onClick={() => ask(q)}>
                      <span>{q}</span><ArrowRight size={16} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {messages.map((m, i) => (
          m.role === "user" ? (
            <div key={i} className="msg msg--user"><p>{m.content}</p></div>
          ) : (
            <div key={i} className="msg msg--assistant">
              <p className="msg__who">
                <span className="msg__avatar" aria-hidden="true"><Sparkles size={12} /></span>
                PaperLens
                {m.style && m.style !== "default" && <span className="msg__style">{STYLE_LABEL[m.style]}</span>}
              </p>
              {m.content ? (
                <Markdown text={m.content} sources={m.sources} onOpenPage={onOpenPage} />
              ) : m.pending ? (
                <p className="msg__thinking">
                  <span className="dots" aria-hidden="true"><i /><i /><i /></span>
                  {m.sources?.length ? `Found ${m.sources.length} passages, writing the answer` : "Searching the paper"}
                </p>
              ) : null}
              {m.error && <p className="notice notice--error" role="alert"><AlertCircle size={16} aria-hidden="true" />{m.error}</p>}
              {m.stopped && <p className="msg__stopped">Stopped.</p>}
              {!m.pending && (
                <div className="msg__actions">
                  {m.content && (
                    <button className="chip-button" onClick={() => copy(m.content, i)}>
                      {copied === i ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
                      {copied === i ? "Copied" : "Copy"}
                    </button>
                  )}
                  {i === messages.length - 1 && !busy && (m.error || m.stopped) && (
                    <button className="chip-button" onClick={retry}><RotateCcw size={13} aria-hidden="true" />Retry</button>
                  )}
                </div>
              )}
              {!m.pending && <Sources sources={m.sources} onOpenPage={onOpenPage} />}
            </div>
          )
        ))}
      </div>

      <form className="composer" onSubmit={(e) => { e.preventDefault(); ask(input); }}>
        {!atBottom && (
          <button type="button" className="jump-latest" onClick={() => setAtBottom(true)}>
            <ArrowDown size={14} aria-hidden="true" />Latest
          </button>
        )}
        {messages.length > 0 && remaining.length > 0 && !busy && !input && (
          <div className="followups" aria-label="Suggested follow-ups">
            {remaining.map((q) => <button key={q} type="button" className="followup" onClick={() => ask(q)}>{q}</button>)}
          </div>
        )}
        <div className="composer__box">
          <label htmlFor="question" className="visually-hidden">Your question</label>
          <textarea
            id="question"
            ref={inputRef}
            rows={1}
            title="Enter to send, Shift + Enter for a new line, / to jump here"
            value={input}
            placeholder="Ask about methods, results, or limitations…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(input); }
            }}
          />
          <div className="composer__foot">
            <div className="style-pills" role="radiogroup" aria-label="Answer style">
              {STYLES.map(([key, label, hint]) => (
                <button key={key} type="button" role="radio" aria-checked={style === key} title={hint}
                  className={`style-pill ${style === key ? "is-active" : ""}`} onClick={() => setStyle(key)}>
                  {label}
                </button>
              ))}
            </div>
            {busy ? (
              <button type="button" className="send-button is-stop" onClick={() => abortRef.current?.abort()} aria-label="Stop answering" title="Stop">
                <Square size={14} fill="currentColor" />
              </button>
            ) : (
              <button type="submit" className="send-button" disabled={!input.trim()} aria-label="Send question" title="Send">
                <SendHorizontal size={17} />
              </button>
            )}
          </div>
        </div>
      </form>
      </div>
    </div>
  );
}
