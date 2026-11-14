import { useState } from "react";
import { FileText, LogOut, PanelLeftClose, PanelLeftOpen, Search, Trash2, X } from "lucide-react";
import UploadZone from "./UploadZone";

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

const Logo = () => (
  <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
    <rect x="4" y="2" width="22" height="28" rx="5" fill="var(--accent)" />
    <rect x="9" y="10" width="12" height="4" rx="1.5" fill="var(--highlight)" />
    <rect x="9" y="17" width="9" height="2.2" rx="1.1" fill="var(--on-accent)" opacity=".85" />
    <rect x="9" y="21.5" width="11" height="2.2" rx="1.1" fill="var(--on-accent)" opacity=".85" />
  </svg>
);

/** The folded library: a slim strip with upload, one button per paper and a button to unfold. */
function Rail({ docs, activeId, health, onSelect, onUpload, onHome, busy, user, onToggleCollapse }) {
  const [tip, setTip] = useState(null); // { title, top } of the paper being hovered
  const showTip = (e, title) => {
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ title, top: r.top + r.height / 2 });
  };
  const offline = health?.status === "offline" || health?.database === "unreachable";
  return (
    <nav className="sidebar sidebar--rail" aria-label="Library">
      <button className="brand brand--rail" onClick={onHome} aria-label="PaperLens home" title="Home"><Logo /></button>
      <UploadZone onUpload={onUpload} compact disabled={busy || health?.status === "offline"} />
      <ul className="rail__papers">
        {docs.map((d) => (
          <li key={d.id}>
            <button className={`rail__paper ${d.id === activeId ? "is-active" : ""}`} onClick={() => onSelect(d.id)}
              aria-current={d.id === activeId ? "true" : undefined} aria-label={d.title}
              onMouseEnter={(e) => showTip(e, d.title)} onFocus={(e) => showTip(e, d.title)}
              onMouseLeave={() => setTip(null)} onBlur={() => setTip(null)}>
              <FileText size={18} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {tip && <span className="rail-tip" style={{ top: tip.top }} aria-hidden="true">{tip.title}</span>}
      <button className="icon-button" onClick={onToggleCollapse} aria-label="Show the library" title="Show the library">
        <PanelLeftOpen size={18} />
      </button>
      {user && <span className="account__avatar rail__avatar" title={user.email} aria-hidden="true">{(user.name || user.email)[0].toUpperCase()}</span>}
      <span className={`status-dot ${offline ? "is-offline" : ""}`} title={offline ? "Not connected" : `${health?.model || ""} connected`} />
    </nav>
  );
}

export default function Sidebar(props) {
  const { docs, activeId, health, open, onClose, onSelect, onUpload, onDelete, onHome, busy, user, onSignOut,
    collapsed = false, canCollapse = false, onToggleCollapse } = props;
  const [query, setQuery] = useState("");
  if (collapsed) return <Rail {...props} />;
  const offline = health?.status === "offline";
  const q = query.trim().toLowerCase();
  const shown = q ? docs.filter((d) => `${d.title} ${d.filename || ""}`.toLowerCase().includes(q)) : docs;

  return (
    <>
      <div className={`scrim ${open ? "is-open" : ""}`} onClick={onClose} aria-hidden="true" />
      <nav className={`sidebar ${open ? "is-open" : ""}`} aria-label="Library">
        <div className="sidebar__top">
          <button className="brand" onClick={onHome} aria-label="PaperLens home">
            <Logo />
            <span>PaperLens</span>
          </button>
          {canCollapse && (
            <button className="icon-button" onClick={onToggleCollapse} aria-label="Hide the library" title="Hide the library">
              <PanelLeftClose size={18} />
            </button>
          )}
          <button className="icon-button sidebar__close" onClick={onClose} aria-label="Close library">
            <X size={18} />
          </button>
        </div>

        <UploadZone onUpload={onUpload} disabled={busy || offline} />

        <div className="sidebar__heading">
          <h2>Your papers</h2>
          {docs.length > 0 && <span className="count">{docs.length}</span>}
        </div>

        {docs.length >= 3 && (
          <label className="search">
            <Search size={15} aria-hidden="true" />
            <span className="visually-hidden">Search your papers</span>
            <input id="library-search" type="search" placeholder="Search papers" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
        )}

        {docs.length === 0 ? (
          <p className="sidebar__empty">Papers you upload stay here, so you can come back to them.</p>
        ) : shown.length === 0 ? (
          <p className="sidebar__empty">No papers match “{query}”.</p>
        ) : (
          <ul className="library">
            {shown.map((d) => (
              <li key={d.id} className={`library__item ${d.id === activeId ? "is-active" : ""}`}>
                <button className="library__open" onClick={() => onSelect(d.id)} aria-current={d.id === activeId ? "true" : undefined}>
                  <span className="library__title">{d.title}</span>
                  <span className="library__meta">
                    <FileText size={12} aria-hidden="true" />
                    {d.pages} pages · added {formatDate(d.created_at)}
                  </span>
                </button>
                <button className="icon-button library__delete" onClick={() => onDelete(d)} aria-label={`Delete ${d.title}`} title="Delete (you can undo)">
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {user && (
          <div className="account">
            <span className="account__avatar" aria-hidden="true">{(user.name || user.email)[0].toUpperCase()}</span>
            <span className="account__text">
              <span className="account__name">{user.name || user.email.split("@")[0]}</span>
              <span className="account__email">{user.email}</span>
            </span>
            <button className="icon-button" onClick={onSignOut} aria-label="Sign out" title="Sign out">
              <LogOut size={16} />
            </button>
          </div>
        )}

        <div className={`sidebar__status ${offline || health?.database === "unreachable" ? "is-offline" : ""}`}>
          <span className="status-dot" aria-hidden="true" />
          {offline
            ? "Server not reachable"
            : health?.database === "unreachable"
              ? "Database not reachable"
              : health
              ? `${health.model} · ${health.retrieval === "hybrid" ? "hybrid search" : "keyword search"}`
              : "Connecting…"}
        </div>
      </nav>
    </>
  );
}
