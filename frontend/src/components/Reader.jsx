import { useEffect, useRef, useState } from "react";
import {
  AlertCircle, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, Copy, Download,
  ExternalLink, Lightbulb, Loader2, MessageSquareText, RefreshCw, Sparkles,
} from "lucide-react";
import { api } from "../api";
import Markdown from "./Markdown";
import PageRef from "./PageRef";
import { useToast } from "./Toast";

const SECTIONS = [
  ["abstract", "Abstract"],
  ["problem_statement", "Problem statement"],
  ["methodology", "Methodology"],
  ["key_results", "Key results"],
  ["conclusion", "Conclusion"],
  ["limitations", "Limitations and future work"],
];

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function SummarySkeleton() {
  return (
    <div className="skeleton" aria-label="Writing the summary">
      <p className="skeleton__label"><Loader2 size={16} className="spin" aria-hidden="true" /> Writing the summary…</p>
      <span className="skeleton__block" />
      {[90, 75, 95, 60, 85, 70].map((w, i) => <span key={i} className="skeleton__line" style={{ width: `${w}%` }} />)}
    </div>
  );
}

/** Floating toolbar that appears when the reader selects text in the summary. */
function SelectionToolbar({ containerRef, scrollRef, onAsk }) {
  const [sel, setSel] = useState(null);
  const toast = useToast();

  useEffect(() => {
    const read = () => setTimeout(() => {
      const s = window.getSelection();
      const text = s?.toString().trim();
      if (!text || text.length < 3 || !s.rangeCount || !containerRef.current?.contains(s.anchorNode)) {
        setSel(null);
        return;
      }
      const r = s.getRangeAt(0).getBoundingClientRect();
      setSel({ text: text.slice(0, 600), x: r.left + r.width / 2, y: r.top, bottom: r.bottom });
    }, 0);
    const hide = () => setSel(null);
    const scroller = scrollRef.current;
    document.addEventListener("mouseup", read);
    document.addEventListener("keyup", read);
    scroller?.addEventListener("scroll", hide);
    return () => {
      document.removeEventListener("mouseup", read);
      document.removeEventListener("keyup", read);
      scroller?.removeEventListener("scroll", hide);
    };
  }, [containerRef, scrollRef]);

  if (!sel) return null;
  const done = () => { window.getSelection()?.removeAllRanges(); setSel(null); };
  const below = sel.y < 70;
  const style = {
    left: Math.min(Math.max(sel.x, 150), window.innerWidth - 150),
    top: below ? sel.bottom + 10 : sel.y - 10,
    transform: below ? "translateX(-50%)" : "translate(-50%, -100%)",
  };

  return (
    <div className="selection-bar" style={style} role="toolbar" aria-label="Selected text" onMouseDown={(e) => e.preventDefault()}>
      <button onClick={() => { onAsk(`Explain this passage in plain words: "${sel.text}"`, { style: "simple" }); done(); }}>
        <Lightbulb size={14} aria-hidden="true" />Explain
      </button>
      <button onClick={() => { onAsk(`About this passage: "${sel.text}"\n\n`, { send: false }); done(); }}>
        <MessageSquareText size={14} aria-hidden="true" />Ask about this
      </button>
      <button onClick={async () => { toast(await copyText(sel.text) ? "Copied" : "Couldn't copy", { tone: "success" }); done(); }}>
        <Copy size={14} aria-hidden="true" />Copy
      </button>
    </div>
  );
}

function SummaryView({ doc, status, onOpenPage, onRegenerate, onAsk, scrollRef }) {
  const s = doc.summary;
  const toast = useToast();
  const articleRef = useRef(null);
  const [collapsed, setCollapsed] = useState({});
  const [active, setActive] = useState(null);

  const present = s ? SECTIONS.filter(([key]) => s.sections?.[key]?.content) : [];
  const presentKeys = present.map(([k]) => k).join(",");

  // Highlight the outline chip for whichever section is at the top of the reading area.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !presentKeys) return;
    const obs = new IntersectionObserver((entries) => {
      const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (top) setActive(top.target.dataset.key);
    }, { root, rootMargin: "-90px 0px -55% 0px" });
    presentKeys.split(",").forEach((k) => {
      const el = document.getElementById(`sec-${k}`);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, [presentKeys, scrollRef]);

  if (status.state === "loading" && !s) return <SummarySkeleton />;
  if (!s) {
    return (
      <div className="summary-error">
        <p className="notice notice--error" role="alert"><AlertCircle size={16} aria-hidden="true" />{status.error || "The summary isn't ready yet."}</p>
        <button className="button button--primary" onClick={onRegenerate}><RefreshCw size={16} aria-hidden="true" />Try again</button>
      </div>
    );
  }

  const allCollapsed = present.length > 0 && present.every(([k]) => collapsed[k]);
  const toggleAll = () => setCollapsed(allCollapsed ? {} : Object.fromEntries(present.map(([k]) => [k, true])));
  const jump = (key) => {
    setCollapsed((c) => ({ ...c, [key]: false }));
    requestAnimationFrame(() => document.getElementById(`sec-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const copyAll = async () => {
    const md = await api.summaryMarkdown(doc.id);
    toast(await copyText(md) ? "Summary copied as Markdown" : "Couldn't copy. Try Download instead.", { tone: "success" });
  };
  const download = async () => {
    const md = await api.summaryMarkdown(doc.id);
    const url = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${s.title.slice(0, 60).replace(/[^\w\- ]+/g, "")} summary.md` });
    a.click();
    URL.revokeObjectURL(url);
    toast("Summary downloaded", { tone: "success" });
  };

  return (
    <>
      <nav className="outline" aria-label="Summary sections">
        <div className="outline__chips">
          {present.map(([key, label]) => (
            <button key={key} className={`outline__chip ${active === key ? "is-active" : ""}`} onClick={() => jump(key)}>
              {label.replace(" and future work", "")}
            </button>
          ))}
        </div>
        <button className="outline__toggle" onClick={toggleAll}>
          <ChevronsUpDown size={14} aria-hidden="true" />{allCollapsed ? "Expand all" : "Collapse all"}
        </button>
      </nav>

      <article className="summary" ref={articleRef}>
        {status.state === "error" && <p className="notice notice--error" role="alert"><AlertCircle size={16} aria-hidden="true" />{status.error}</p>}
        {s.tldr && (
          <div className="tldr">
            <h2 className="tldr__label"><Sparkles size={15} aria-hidden="true" />In short</h2>
            <p>{s.tldr}</p>
          </div>
        )}

        <p className="summary__tip"><Lightbulb size={14} aria-hidden="true" />Tip: select any text to get it explained or ask about it.</p>

        {present.map(([key, label]) => {
          const section = s.sections[key];
          const isCollapsed = !!collapsed[key];
          return (
            <section key={key} id={`sec-${key}`} data-key={key} className={`summary__section ${isCollapsed ? "is-collapsed" : ""}`}>
              <header className="summary__section-head">
                <h2>
                  <button className="section-toggle" aria-expanded={!isCollapsed} aria-controls={`body-${key}`}
                    onClick={() => setCollapsed((c) => ({ ...c, [key]: !isCollapsed }))}>
                    <ChevronDown size={18} aria-hidden="true" className="section-toggle__chev" />
                    {label}
                  </button>
                </h2>
                <div className="section-tools">
                  <button className="icon-button" title="Ask a follow-up about this section" aria-label={`Ask about ${label}`}
                    onClick={() => onAsk(`Tell me more about the ${label.toLowerCase()} in this paper.`)}>
                    <MessageSquareText size={15} />
                  </button>
                  <button className="icon-button" title="Copy this section" aria-label={`Copy ${label}`}
                    onClick={async () => toast(await copyText(`## ${label}\n\n${section.content}`) ? `${label} copied` : "Couldn't copy", { tone: "success" })}>
                    <Copy size={15} />
                  </button>
                  {section.pages.length > 0 && (
                    <span className="summary__refs">
                      {section.pages.map((p) => <PageRef key={p} page={p} onOpenPage={onOpenPage} />)}
                    </span>
                  )}
                </div>
              </header>
              {!isCollapsed && <div id={`body-${key}`} className="summary__body"><Markdown text={section.content} /></div>}
            </section>
          );
        })}

        {s.keywords?.length > 0 && (
          <section className="summary__section summary__section--keywords">
            <h2 className="summary__plain-h">Keywords</h2>
            <p className="summary__hint">Click a keyword to ask what the paper says about it.</p>
            <ul className="keywords">
              {s.keywords.map((k) => (
                <li key={k}><button onClick={() => onAsk(`What does the paper say about ${k}?`)}>{k}</button></li>
              ))}
            </ul>
          </section>
        )}

        <footer className="summary__footer">
          <p>Summary by {s.model}{s.strategy === "map-reduce" ? ", read in parts because the paper is long" : ""}. Check important details against the PDF.</p>
          <div className="summary__actions">
            <button className="button" onClick={copyAll}><Copy size={16} aria-hidden="true" />Copy as Markdown</button>
            <button className="button" onClick={download}><Download size={16} aria-hidden="true" />Download .md</button>
            <button className="button" onClick={onRegenerate} disabled={status.state === "loading"}>
              <RefreshCw size={16} aria-hidden="true" className={status.state === "loading" ? "spin" : ""} />
              {status.state === "loading" ? "Regenerating…" : "Regenerate"}
            </button>
          </div>
        </footer>
      </article>

      <SelectionToolbar containerRef={articleRef} scrollRef={scrollRef} onAsk={onAsk} />
    </>
  );
}

function PdfView({ doc, page, onOpenPage }) {
  const total = doc.pages || 1;
  const [draft, setDraft] = useState(String(page));
  useEffect(() => setDraft(String(page)), [page]);
  const go = (p) => onOpenPage(Math.min(Math.max(1, p), total));

  return (
    <div className="pdf">
      <div className="pdf__bar">
        <button className="icon-button" onClick={() => go(page - 1)} disabled={page <= 1} aria-label="Previous page"><ChevronLeft size={18} /></button>
        <form className="pdf__jump" onSubmit={(e) => { e.preventDefault(); go(Number(draft) || 1); }}>
          <label htmlFor="pdf-page">Page</label>
          <input id="pdf-page" type="number" min={1} max={total} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => go(Number(draft) || page)} />
          <span>of {total}</span>
        </form>
        <button className="icon-button" onClick={() => go(page + 1)} disabled={page >= total} aria-label="Next page"><ChevronRight size={18} /></button>
        <a className="button button--ghost pdf__open" href={api.fileUrl(doc.id, page)} target="_blank" rel="noreferrer">
          <ExternalLink size={15} aria-hidden="true" />Open in new tab
        </a>
      </div>
      {/* keyed by page so the browser viewer reopens at the cited page */}
      <iframe key={`${doc.id}-${page}`} className="pdf-frame" src={api.fileUrl(doc.id, page)} title={`PDF of ${doc.title}`} />
    </div>
  );
}

export default function Reader({ doc, view, setView, pdfPage, onOpenPage, summaryStatus, onRegenerate, onAsk, chat }) {
  const s = doc.summary;
  const scrollRef = useRef(null);
  const [progress, setProgress] = useState(0);
  const tabs = [["summary", "Summary"], ["pdf", "PDF"], ...(chat ? [["chat", "Ask"]] : [])];

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const max = el.scrollHeight - el.clientHeight;
      setProgress(max > 0 ? Math.min(1, el.scrollTop / max) : 0);
    };
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [view, doc.id]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }); }, [doc.id]);

  return (
    <div className="reader">
      <header className="reader__head">
        <h1 className="reader__title">{s?.title || doc.title}</h1>
        {s?.authors?.length > 0 && <p className="reader__authors">{s.authors.join(", ")}</p>}
        <p className="reader__meta">
          <span>{doc.filename}</span>
          <span>{doc.pages} pages</span>
          <span>{Number(doc.words || 0).toLocaleString()} words</span>
          <span>about {Math.max(1, Math.round((doc.words || 0) / 230))} min to read in full</span>
        </p>
        <div className="tabs" role="tablist" aria-label="Paper views">
          {tabs.map(([key, label]) => (
            <button key={key} role="tab" aria-selected={view === key} className={`tab ${view === key ? "is-active" : ""}`} onClick={() => setView(key)}>
              {label}
              {key === "pdf" && pdfPage > 1 && <span className="tab__badge">p.{pdfPage}</span>}
            </button>
          ))}
        </div>
        {view === "summary" && s && <span className="read-progress" style={{ transform: `scaleX(${progress})` }} aria-hidden="true" />}
      </header>

      <div className="reader__body" ref={scrollRef}>
        {view === "summary" && (
          <SummaryView doc={doc} status={summaryStatus} onOpenPage={onOpenPage} onRegenerate={onRegenerate} onAsk={onAsk} scrollRef={scrollRef} />
        )}
        {view === "pdf" && <PdfView doc={doc} page={pdfPage} onOpenPage={onOpenPage} />}
        {view === "chat" && chat}
      </div>
    </div>
  );
}
