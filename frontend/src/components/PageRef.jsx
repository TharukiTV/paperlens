import { useRef, useState } from "react";

// The highlighter mark that links any claim back to its page in the PDF.
// With a snippet, hovering or focusing it previews the passage the claim came from.
export default function PageRef({ page, label, snippet, onOpenPage }) {
  const wrapRef = useRef(null);
  const [place, setPlace] = useState({ shift: 0, below: false });

  // Keep the preview inside the panel it's in: slide it sideways near an edge, and open it
  // below the mark when there isn't room above.
  const position = () => {
    const wrap = wrapRef.current;
    const peek = wrap?.querySelector(".peek");
    if (!peek) return;
    const area = wrap.closest(".chat__log, .reader__body")?.getBoundingClientRect()
      ?? { left: 0, top: 0, right: window.innerWidth };
    const mark = wrap.getBoundingClientRect();
    const width = peek.offsetWidth;
    const left = mark.left + mark.width / 2 - width / 2;
    const gap = 8;
    let shift = 0;
    if (left < area.left + gap) shift = area.left + gap - left;
    else if (left + width > area.right - gap) shift = area.right - gap - (left + width);
    setPlace({ shift: Math.round(shift), below: mark.top - peek.offsetHeight - 14 < area.top });
  };

  // Focusing the mark (clicking it) can make the browser scroll the panel sideways to show the
  // preview, which cuts off the text. Panels only scroll up and down, so put it straight back.
  const onFocus = () => {
    position();
    const panel = wrapRef.current?.closest(".chat__log, .reader__body");
    if (panel) requestAnimationFrame(() => { panel.scrollLeft = 0; });
  };

  return (
    <span
      ref={wrapRef}
      className={`page-ref-wrap ${snippet ? "has-peek" : ""} ${place.below ? "peek-below" : ""}`}
      style={snippet ? { "--peek-shift": `${place.shift}px` } : undefined}
      onMouseEnter={snippet ? position : undefined}
      onFocus={snippet ? onFocus : undefined}
    >
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
