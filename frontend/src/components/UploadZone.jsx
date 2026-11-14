import { useRef } from "react";
import { FileUp, Plus } from "lucide-react";

// Dropping files is handled once for the whole window in App.jsx; `dragging` only styles the zone.
export default function UploadZone({ onUpload, large = false, compact = false, disabled = false, dragging = false }) {
  const input = useRef(null);

  const pick = (files) => {
    if (files?.[0] && !disabled) onUpload(files[0]);
  };

  const fileInput = (
    <input
      ref={input}
      type="file"
      accept="application/pdf,.pdf"
      hidden
      onChange={(e) => { pick(e.target.files); e.target.value = ""; }}
    />
  );

  if (compact) {
    return (
      <>
        {fileInput}
        <button type="button" className="rail__upload" disabled={disabled} onClick={() => input.current?.click()}
          aria-label="Upload a paper" title="Upload a paper">
          <Plus size={20} aria-hidden="true" />
        </button>
      </>
    );
  }

  if (!large) {
    return (
      <div className="upload-zone">
        {fileInput}
        <button type="button" className="button button--primary button--block" disabled={disabled} onClick={() => input.current?.click()}>
          <Plus size={18} aria-hidden="true" />
          Upload a paper
        </button>
      </div>
    );
  }

  return (
    <>
      {fileInput}
      <button
        type="button"
        className={`upload-zone upload-zone--large ${dragging ? "is-dragging" : ""}`}
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        <span className="upload-zone__icon" aria-hidden="true"><FileUp size={24} /></span>
        <span className="upload-zone__text">
          <span className="upload-zone__title">{dragging ? "Drop it here" : "Drop a PDF here, or click to choose one"}</span>
          <span className="upload-zone__hint">Research papers up to 25 MB</span>
        </span>
        <span className="button button--primary upload-zone__cta" aria-hidden="true">Choose file</span>
      </button>
    </>
  );
}
