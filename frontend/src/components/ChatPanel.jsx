import { useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowDown, ArrowRight, Check, Copy, RotateCcw, SendHorizontal, Sparkles, Square, SquarePen } from "lucide-react";
import { api, streamChat } from "../api";
import Markdown from "./Markdown";
import PageRef from "./PageRef";
import { useToast } from "./Toast";

const STYLES = [
  ["default", "Standard", "Clear, technical answers"],
  ["simple", "Simple", "Plain words, jargon explained"],
  ["critical", "Reviewer", "Weighs the evidence like a peer reviewer"],
];
const STYLE_LABEL = Object.fromEntries(STYLES.map(([k, l]) => [k, l]));

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

export default function ChatPanel({ doc, onOpenPage, suggestions, request, onRequestHandled }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [style, setStyle] = useState("default");
  const [busy, setBusy] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [copied, setCopied] = useState(null);
  const abortRef = useRef(null);
  const logRef = useRef(null);
  const inputRef = useRef(null);
  const handledRef = useRef(null);
  const toast = useToast();

  // Load history. Prepend, so a question asked while it loads isn't lost.
  useEffect(() => {
    let live = true;
    api.getChat(doc.id).then((history) => live && setMessages((prev) => [...(history || []), ...prev])).catch(() => {});
    return () => { live = false; abortRef.current?.abort(); };
  }, [doc.id]);

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
    setInput("");
    setBusy(true);
    setAtBottom(true);
    setMessages((prev) => [...prev, { role: "user", content: question }, { role: "assistant", content: "", sources: [], pending: true, style: useStyle }]);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamChat(doc.id, question, useStyle, {
        onSources: (sources) => updateLast((m) => ({ ...m, sources })),
        onToken: (t) => updateLast((m) => ({ ...m, content: m.content + t })),
        onError: (error) => updateLast((m) => ({ ...m, error })),
        onDone: () => {},
      }, controller.signal);
    } catch (err) {
      updateLast((m) => ({ ...m, error: err.message }));
    } finally {
      updateLast((m) => ({ ...m, pending: false, stopped: controller.signal.aborted }));
      setBusy(false);
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

  const clear = async () => {
    abortRef.current?.abort();
    await api.clearChat(doc.id).catch(() => {});
    setMessages([]);
    toast("Started a new conversation", { tone: "success" });
  };

  const onScroll = () => {
    const el = logRef.current;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
  };

  const asked = new Set(messages.filter((m) => m.role === "user").map((m) => m.content));
  const remaining = suggestions.filter((q) => !asked.has(q)).slice(0, 3);
  const activeHint = STYLES.find(([k]) => k === style)[2];

  return (
    <div className="chat">
      <header className="chat__head">
        <div>
          <h2>Ask the paper</h2>
          <p>Answers cite the pages they use</p>
        </div>
        {messages.length > 0 && (
          <button className="icon-button" onClick={clear} aria-label="Start a new conversation" title="New conversation">
            <SquarePen size={17} />
          </button>
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
                  {i === messages.length - 1 && !busy && (
                    <button className="chip-button" onClick={retry}><RotateCcw size={13} aria-hidden="true" />Retry</button>
                  )}
                </div>
              )}
              {!m.pending && <Sources sources={m.sources} onOpenPage={onOpenPage} />}
            </div>
          )
        ))}
      </div>

      {!atBottom && (
        <button className="jump-latest" onClick={() => setAtBottom(true)}>
          <ArrowDown size={14} aria-hidden="true" />Latest
        </button>
      )}

      <form className="composer" onSubmit={(e) => { e.preventDefault(); ask(input); }}>
        {messages.length > 0 && remaining.length > 0 && !busy && (
          <div className="followups" aria-label="Suggested follow-ups">
            {remaining.map((q) => <button key={q} type="button" className="followup" onClick={() => ask(q)}>{q}</button>)}
          </div>
        )}
        <div className="composer__box">
          <div className="segmented" role="radiogroup" aria-label="Answer style">
            {STYLES.map(([key, label, hint]) => (
              <button key={key} type="button" role="radio" aria-checked={style === key} title={hint}
                className={`segmented__option ${style === key ? "is-active" : ""}`} onClick={() => setStyle(key)}>
                {label}
              </button>
            ))}
          </div>
          <label htmlFor="question" className="visually-hidden">Your question</label>
          <textarea
            id="question"
            ref={inputRef}
            rows={2}
            value={input}
            placeholder="Ask about methods, results, or limitations…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(input); }
            }}
          />
          <div className="composer__foot">
            <span className="composer__hint">{activeHint}</span>
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
        <p className="composer__keys"><kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line · <kbd>/</kbd> to focus</p>
      </form>
    </div>
  );
}
