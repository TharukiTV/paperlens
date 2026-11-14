import { useRef } from "react";

/**
 * A drag handle on the edge of a panel. Drag (or use the arrow keys) to change the panel's width;
 * double-click to reset it. `side` is the edge the handle sits on: "right" grows the panel when
 * dragged right (the library), "left" grows it when dragged left (the chat).
 */
export default function Resizer({ side, width, min, max, label, onResize, onReset }) {
  const start = useRef(null);

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    start.current = { x: e.clientX, width };
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.classList.add("is-resizing");
  };
  const onPointerMove = (e) => {
    if (!start.current) return;
    const dx = e.clientX - start.current.x;
    onResize(start.current.width + (side === "right" ? dx : -dx));
  };
  const stop = () => {
    start.current = null;
    document.body.classList.remove("is-resizing");
  };
  const onKeyDown = (e) => {
    const step = e.shiftKey ? 64 : 16;
    const grow = side === "right" ? "ArrowRight" : "ArrowLeft";
    const shrink = side === "right" ? "ArrowLeft" : "ArrowRight";
    if (e.key === grow) onResize(width + step);
    else if (e.key === shrink) onResize(width - step);
    else if (e.key === "Home") onResize(min);
    else if (e.key === "End") onResize(max);
    else return;
    e.preventDefault();
  };

  return (
    <div
      className={`resizer resizer--${side}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title={`${label}. Drag to resize, double-click to reset.`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    />
  );
}
