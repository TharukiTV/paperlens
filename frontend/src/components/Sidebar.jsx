import { useState } from "react";
import { FileText, LogOut, Search, Trash2, X } from "lucide-react";
import UploadZone from "./UploadZone";

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export default function Sidebar({ docs, activeId, health, open, onClose, onSelect, onUpload, onDelete, onHome, busy, user, onSignOut }) {
  const [query, setQuery] = useState("");
  const offline = health?.status === "offline";
  const q = query.trim().toLowerCase();
  const shown = q ? docs.filter((d) => `${d.title} ${d.filename || ""}`.toLowerCase().includes(q)) : docs;

  return (
    <>
      <div className={`scrim ${open ? "is-open" : ""}`} onClick={onClose} aria-hidden="true" />
      <nav className={`sidebar ${open ? "is-open" : ""}`} aria-label="Library">
        <div className="sidebar__top">
          <button className="brand" onClick={onHome} aria-label="PaperLens home">
            <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
              <rect x="4" y="2" width="22" height="28" rx="5" fill="var(--accent)" />
              <rect x="9" y="10" width="12" height="4" rx="1.5" fill="var(--highlight)" />
              <rect x="9" y="17" width="9" height="2.2" rx="1.1" fill="var(--on-accent)" opacity=".85" />
              <rect x="9" y="21.5" width="11" height="2.2" rx="1.1" fill="var(--on-accent)" opacity=".85" />
            </svg>
            <span>PaperLens</span>
          </button>
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
