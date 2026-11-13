import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import PageRef from "./PageRef";

// Turn "[3]" citations into links we can render as page marks. Skip real links like [3](url).
const CITE = /\[(\d{1,2})\](?!\()/g;

export default function Markdown({ text, sources = [], onOpenPage }) {
  const prepared = sources.length ? text.replace(CITE, (m, n) => `[${n}](#cite-${n})`) : text;
  return (
    <div className="prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href = "", children }) {
            if (href.startsWith("#cite-")) {
              const n = Number(href.slice(6));
              const src = sources.find((s) => s.n === n);
              if (!src) return <sup>[{n}]</sup>;
              const snippet = src.text.length > 280 ? `${src.text.slice(0, 280)}…` : src.text;
              return <PageRef page={src.page} snippet={snippet} onOpenPage={onOpenPage} />;
            }
            return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
          },
          table({ children }) {
            return <div className="table-wrap"><table>{children}</table></div>;
          },
        }}
      >
        {prepared}
      </ReactMarkdown>
    </div>
  );
}
