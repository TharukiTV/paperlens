import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import PageRef from "./PageRef";

// Formulas written as $...$ or $$...$$ are drawn with KaTeX. A formula it can't parse is shown as plain text, never an error.
const KATEX = { throwOnError: false, strict: false };
// "$5 and $10" is money, not a formula: escape a $ that starts a plain number ("$2^n$" and "$5$" are still maths).
const CURRENCY = /(^|[\s(])\$(?=\d[\d,.]*(?:\s?(?:[kKmMbB]|million|billion|thousand))?(?:[\s.,;:!?)]|$))/g;
const escapeCurrency = (text) => text.replace(CURRENCY, "$1\\$");

// Turn "[3]" citations into links we can render as page marks. Skip real links like [3](url).
const CITE = /\[(\d{1,2})\](?!\()/g;
// Models sometimes write "[2, 5]", "[Overview, 2]" or "[Overview]". Keep only the excerpt numbers.
const LOOSE_CITE = /\s?\[((?:overview|excerpt\s*\d{0,2}|\d{1,2})(?:\s*[,;]\s*(?:overview|excerpt\s*\d{0,2}|\d{1,2}))*)\](?!\()/gi;

function tidyCitations(text) {
  return text.replace(LOOSE_CITE, (match, inner) => {
    const numbers = inner.match(/\d{1,2}/g) || [];
    if (!numbers.length) return "";
    return `${match.startsWith(" ") ? " " : ""}${numbers.map((n) => `[${n}]`).join("")}`;
  });
}

export default function Markdown({ text, sources = [], onOpenPage }) {
  const cleaned = escapeCurrency(text);
  const prepared = sources.length ? tidyCitations(cleaned).replace(CITE, (m, n) => `[${n}](#cite-${n})`) : cleaned;
  return (
    <div className="prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, KATEX]]}
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
