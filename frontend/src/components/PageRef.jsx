// The highlighter mark that links any claim back to its page in the PDF.
// With a snippet, hovering or focusing it previews the passage the claim came from.
export default function PageRef({ page, label, snippet, onOpenPage }) {
  return (
    <span className={`page-ref-wrap ${snippet ? "has-peek" : ""}`}>
      <button
        type="button"
        className="page-ref"
        onClick={() => onOpenPage(page)}
        title={snippet ? undefined : `Open page ${page}`}
        aria-label={`Open page ${page} of the PDF`}
      >
        {label ?? `p.${page}`}
      </button>
      {snippet && (
        <span className="peek" role="tooltip">
          <span className="peek__head">From page {page}</span>
          <span className="peek__text">{snippet}</span>
          <span className="peek__foot">Click to open the page</span>
        </span>
      )}
    </span>
  );
}
