import { useCallback, useEffect, useRef, useState } from "react";
import { FileUp, Loader2, Menu, Moon, Sun } from "lucide-react";
import { api, UNAUTHORIZED } from "./api";
import { useMediaQuery, useTheme } from "./hooks";
import Sidebar from "./components/Sidebar";
import Welcome from "./components/Welcome";
import Processing from "./components/Processing";
import Reader from "./components/Reader";
import ChatPanel from "./components/ChatPanel";
import AuthScreen from "./components/AuthScreen";
import { useToast } from "./components/Toast";

const MAX_MB = 25;
const UNDO_MS = 5000;

const shorten = (t, n = 40) => (t.length > n ? `${t.slice(0, n)}…` : t);

/** The signed-in app. Keyed by user id, so signing in as someone else starts from a clean state. */
function Workspace({ user, onSignOut }) {
  const [docs, setDocs] = useState([]);
  const [health, setHealth] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [doc, setDoc] = useState(null);
  const [summaryStatus, setSummaryStatus] = useState({ state: "idle", error: "" });
  const [processing, setProcessing] = useState(null); // { name, stage: "upload" | "summary", error }
  const [view, setView] = useState("summary");
  const [pdfPage, setPdfPage] = useState(1);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState([]); // ids hidden while the undo toast is up
  const [askRequest, setAskRequest] = useState(null);
  const [dragging, setDragging] = useState(false);
  const narrow = useMediaQuery("(max-width: 1180px)");
  const [theme, toggleTheme] = useTheme();
  const toast = useToast();
  const deleteTimers = useRef({});

  const refreshDocs = useCallback(() => api.listDocuments().then(setDocs).catch(() => {}), []);

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth({ status: "offline" }));
    refreshDocs();
  }, [refreshDocs]);

  useEffect(() => {
    if (!narrow && view === "chat") setView("summary");
  }, [narrow, view]);

  const summarize = useCallback(async (id, regenerate = false) => {
    setSummaryStatus({ state: "loading", error: "" });
    try {
      const summary = await api.summarize(id, regenerate);
      setDoc((d) => (d && d.id === id ? { ...d, summary, title: summary.title } : d));
      setSummaryStatus({ state: "idle", error: "" });
      refreshDocs();
      if (regenerate) toast("Summary regenerated", { tone: "success" });
      return true;
    } catch (err) {
      setSummaryStatus({ state: "error", error: err.message });
      return false;
    }
  }, [refreshDocs, toast]);

  const openDocument = useCallback(async (id) => {
    setSidebarOpen(false);
    setProcessing(null);
    setActiveId(id);
    setView("summary");
    setPdfPage(1);
    setSummaryStatus({ state: "idle", error: "" });
    try {
      const data = await api.getDocument(id);
      setDoc(data);
      if (!data.summary) summarize(id);
    } catch (err) {
      setDoc(null);
      setActiveId(null);
      setSummaryStatus({ state: "error", error: err.message });
      refreshDocs();
    }
  }, [summarize, refreshDocs]);

  const handleUpload = useCallback(async (file) => {
    setSidebarOpen(false);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      setProcessing({ name: file.name, stage: "upload", error: "Only PDF files are supported. Choose a .pdf file." });
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      setProcessing({ name: file.name, stage: "upload", error: `This file is larger than ${MAX_MB} MB.` });
      return;
    }
    setActiveId(null);
    setDoc(null);
    setProcessing({ name: file.name, stage: "upload", error: "" });
    let record;
    try {
      record = await api.upload(file);
    } catch (err) {
      setProcessing({ name: file.name, stage: "upload", error: err.message });
      return;
    }
    refreshDocs();
    setProcessing({ name: file.name, stage: "summary", error: "", pages: record.pages });
    setSummaryStatus({ state: "loading", error: "" });
    let summary = null;
    try {
      summary = await api.summarize(record.id);
      setSummaryStatus({ state: "idle", error: "" });
    } catch (err) {
      setSummaryStatus({ state: "error", error: err.message });
    }
    setProcessing(null);
    setActiveId(record.id);
    setDoc({ ...record, summary, title: summary?.title || record.title });
    setView("summary");
    setPdfPage(1);
    refreshDocs();
    if (summary) toast("Your summary is ready", { tone: "success" });
  }, [refreshDocs, toast]);

  const goHome = useCallback(() => {
    setActiveId(null);
    setDoc(null);
    setProcessing(null);
    setSidebarOpen(false);
  }, []);

  // Delete with a short undo window: hide the paper now, delete it on the server after the toast closes.
  const handleDelete = useCallback((d) => {
    setPendingDelete((ids) => [...ids, d.id]);
    if (d.id === activeId) goHome();
    deleteTimers.current[d.id] = setTimeout(async () => {
      delete deleteTimers.current[d.id];
      try { await api.deleteDocument(d.id); } catch { /* already gone */ }
      setPendingDelete((ids) => ids.filter((x) => x !== d.id));
      refreshDocs();
    }, UNDO_MS);
    toast(`Deleted “${shorten(d.title)}”`, {
      duration: UNDO_MS,
      action: {
        label: "Undo",
        onClick: () => {
          clearTimeout(deleteTimers.current[d.id]);
          delete deleteTimers.current[d.id];
          setPendingDelete((ids) => ids.filter((x) => x !== d.id));
        },
      },
    });
  }, [activeId, goHome, refreshDocs, toast]);

  // If the tab closes during the undo window, finish the delete anyway.
  useEffect(() => {
    const flush = () => Object.keys(deleteTimers.current).forEach((id) => api.deleteDocument(id, { keepalive: true }).catch(() => {}));
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  const openPage = useCallback((page) => {
    setPdfPage(page);
    setView("pdf");
  }, []);

  // Send a question to the chat from anywhere in the reader.
  const askPaper = useCallback((text, { send = true, style } = {}) => {
    setAskRequest({ text, send, style, nonce: Date.now() + Math.random() });
    if (narrow) setView("chat");
  }, [narrow]);

  // Drop a PDF anywhere in the window to upload it.
  const uploadRef = useRef(handleUpload);
  uploadRef.current = handleUpload;
  const busy = !!processing && !processing.error;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes("Files");
    const enter = (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth += 1; setDragging(true); };
    const over = (e) => { if (hasFiles(e)) e.preventDefault(); };
    const leave = (e) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) setDragging(false); };
    const drop = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file && !busyRef.current) uploadRef.current(file);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);

  const visibleDocs = docs.filter((d) => !pendingDelete.includes(d.id));
  const offline = health?.status === "offline";

  const chat = doc && (
    <ChatPanel
      key={doc.id}
      doc={doc}
      onOpenPage={openPage}
      suggestions={doc.summary?.suggested_questions || []}
      request={askRequest}
      onRequestHandled={() => setAskRequest(null)}
    />
  );

  let main;
  if (processing) {
    main = <Processing {...processing} onRetry={goHome} />;
  } else if (doc) {
    main = (
      <Reader
        doc={doc}
        view={view}
        setView={setView}
        pdfPage={pdfPage}
        onOpenPage={openPage}
        summaryStatus={summaryStatus}
        onRegenerate={() => summarize(doc.id, true)}
        onAsk={askPaper}
        chat={narrow ? chat : null}
      />
    );
  } else {
    main = (
      <Welcome
        onUpload={handleUpload}
        offline={offline}
        error={summaryStatus.error}
        dragging={dragging}
        recent={visibleDocs.slice(0, 3)}
        onOpen={openDocument}
      />
    );
  }

  return (
    <div className={`app ${doc && !narrow ? "has-chat" : ""}`}>
      <Sidebar
        docs={visibleDocs}
        activeId={activeId}
        health={health}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onSelect={openDocument}
        onUpload={handleUpload}
        onDelete={handleDelete}
        onHome={goHome}
        busy={busy}
        user={user}
        onSignOut={onSignOut}
      />
      <main className="main" id="main">
        <button className="menu-button" onClick={() => setSidebarOpen(true)} aria-label="Open library">
          <Menu size={20} />
        </button>
        <button className="icon-button theme-toggle" onClick={toggleTheme}
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} title={theme === "dark" ? "Light mode" : "Dark mode"}>
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        {main}
      </main>
      {doc && !narrow && <aside className="chat-column" aria-label="Ask the paper">{chat}</aside>}

      {dragging && !busy && !offline && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-overlay__card">
            <FileUp size={30} />
            <strong>Drop your PDF to read it</strong>
            <span>Up to {MAX_MB} MB</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(undefined); // undefined while checking, null when signed out

  useEffect(() => {
    api.me().then(setUser).catch(() => setUser(null));
    const signedOut = () => setUser(null);
    window.addEventListener(UNAUTHORIZED, signedOut);
    return () => window.removeEventListener(UNAUTHORIZED, signedOut);
  }, []);

  const signOut = useCallback(async () => {
    await api.logout().catch(() => {});
    setUser(null);
  }, []);

  if (user === undefined) {
    return <div className="boot" aria-label="Loading"><Loader2 size={22} className="spin" /></div>;
  }
  if (!user) return <AuthScreen onAuthed={setUser} />;
  return <Workspace key={user.id} user={user} onSignOut={signOut} />;
}
