import { useEffect, useState } from "react";
import { AlertCircle, Check, Loader2 } from "lucide-react";

const STEPS = [
  { key: "upload", label: "Read the PDF and build the search index" },
  { key: "summary", label: "Write the structured summary" },
];

export default function Processing({ name, stage, error, pages, onRetry }) {
  const current = STEPS.findIndex((s) => s.key === stage);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (error) return;
    setElapsed(0);
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [stage, error]);

  return (
    <section className="processing" aria-live="polite">
      <div className="processing__card">
        <p className="processing__file">{name}</p>
        <h1 className="processing__title">{error ? "That upload didn't work" : "Reading your paper"}</h1>
        {!error && <div className="progress-track" aria-hidden="true"><span className="progress-track__bar" style={{ width: current === 0 ? "35%" : "75%" }} /></div>}
        <ol className="steps">
          {STEPS.map((step, i) => {
            const state = i < current ? "done" : i === current ? (error ? "error" : "active") : "waiting";
            return (
              <li key={step.key} className={`steps__item is-${state}`}>
                <span className="steps__marker" aria-hidden="true">
                  {state === "done" ? <Check size={14} /> : state === "active" ? <Loader2 size={14} className="spin" /> : state === "error" ? <AlertCircle size={14} /> : i + 1}
                </span>
                <span className="steps__label">
                  {step.label}
                  {step.key === "upload" && state === "done" && pages ? ` (${pages} pages)` : ""}
                </span>
                {state === "active" && <span className="steps__time">{elapsed}s</span>}
              </li>
            );
          })}
        </ol>
        {error ? (
          <>
            <p className="notice notice--error" role="alert"><AlertCircle size={16} aria-hidden="true" />{error}</p>
            <button className="button button--primary" onClick={onRetry}>Choose another file</button>
          </>
        ) : (
          <p className="processing__note">Summaries usually take 10 to 30 seconds, depending on the paper's length. You can keep this tab open in the background.</p>
        )}
      </div>
    </section>
  );
}
