import { AlertCircle, ArrowRight, FileText, FileUp, MessageSquareText, ScrollText } from "lucide-react";
import UploadZone from "./UploadZone";

const STEPS = [
  { icon: FileUp, title: "Upload a PDF", text: "Any research paper. PaperLens reads every page and indexes it." },
  { icon: ScrollText, title: "Read the summary", text: "Problem, method, results and limitations, each linked to its pages." },
  { icon: MessageSquareText, title: "Ask follow-ups", text: "Answers quote the paper and show exactly which page they came from." },
];

export default function Welcome({ onUpload, offline, error, dragging, recent = [], onOpen }) {
  return (
    <section className="welcome">
      <p className="eyebrow">Research paper assistant</p>
      <h1 className="welcome__title">Read the paper in five minutes. Then ask it anything.</h1>
      <p className="welcome__lede">
        Upload a paper and get a structured summary with page references. Then ask questions,
        and every answer points to the page it came from.
      </p>

      <UploadZone onUpload={onUpload} large disabled={offline} dragging={dragging} />

      {offline && (
        <p className="notice notice--error" role="alert">
          <AlertCircle size={16} aria-hidden="true" />
          <span>The server isn't running. Run <code>docker compose up -d</code> in the project folder, then <code>uvicorn app.main:app --reload</code> in the backend folder, and refresh.</span>
        </p>
      )}
      {error && !offline && <p className="notice notice--error" role="alert"><AlertCircle size={16} aria-hidden="true" />{error}</p>}

      {recent.length > 0 && (
        <div className="welcome__block">
          <h2 className="welcome__heading">Continue reading</h2>
          <ul className="recent">
            {recent.map((d) => (
              <li key={d.id}>
                <button className="recent__card" onClick={() => onOpen(d.id)}>
                  <FileText size={18} aria-hidden="true" className="recent__icon" />
                  <span className="recent__title">{d.title}</span>
                  <span className="recent__meta">{d.pages} pages <ArrowRight size={14} aria-hidden="true" /></span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="welcome__block">
        <h2 className="welcome__heading">How it works</h2>
        <ol className="how">
          {STEPS.map(({ icon: Icon, title, text }, i) => (
            <li key={title} className="how__step">
              <span className="how__icon" aria-hidden="true"><Icon size={18} /></span>
              <span className="how__n">Step {i + 1}</span>
              <strong>{title}</strong>
              <span>{text}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
