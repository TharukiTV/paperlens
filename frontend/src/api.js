// Thin client for the PaperLens FastAPI backend.
const BASE = import.meta.env.VITE_API_URL || "";

// Fired when the session has expired or was signed out elsewhere; App returns to the sign-in screen.
export const UNAUTHORIZED = "paperlens:unauthorized";

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, { credentials: "include", ...options });
  } catch {
    throw new Error("Can't reach the server. Start the backend (uvicorn) and try again.");
  }
  if (res.status === 401 && !path.startsWith("/api/auth/")) window.dispatchEvent(new Event(UNAUTHORIZED));
  if (!res.ok) {
    let detail = `Request failed (${res.status}).`;
    try {
      const body = await res.json();
      if (body?.detail) detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch { /* not JSON */ }
    throw new Error(detail);
  }
  if (res.status === 204) return null;
  const type = res.headers.get("content-type") || "";
  return type.includes("application/json") ? res.json() : res.text();
}

const json = (body) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const api = {
  me: () => request("/api/auth/me"),
  login: (email, password) => request("/api/auth/login", json({ email, password })),
  register: (name, email, password) => request("/api/auth/register", json({ name, email, password })),
  logout: () => request("/api/auth/logout", { method: "POST" }),
  health: () => request("/api/health"),
  listDocuments: () => request("/api/documents"),
  getDocument: (id) => request(`/api/documents/${id}`),
  deleteDocument: (id, options = {}) => request(`/api/documents/${id}`, { method: "DELETE", ...options }),
  upload: (file) => {
    const form = new FormData();
    form.append("file", file);
    return request("/api/documents", { method: "POST", body: form });
  },
  summarize: (id, regenerate = false) =>
    request(`/api/documents/${id}/summary${regenerate ? "?regenerate=true" : ""}`, { method: "POST" }),
  summaryMarkdown: (id) => request(`/api/documents/${id}/summary.md`),
  flashcards: (id, regenerate = false) =>
    request(`/api/documents/${id}/flashcards${regenerate ? "?regenerate=true" : ""}`, { method: "POST" }),
  listConversations: (id) => request(`/api/documents/${id}/conversations`),
  getConversation: (id, convId) => request(`/api/documents/${id}/conversations/${convId}`),
  deleteConversation: (id, convId, options = {}) =>
    request(`/api/documents/${id}/conversations/${convId}`, { method: "DELETE", ...options }),
  fileUrl: (id, page) => `${BASE}/api/documents/${id}/file${page ? `#page=${page}` : ""}`,
};

/**
 * Ask a question and stream the answer over Server-Sent Events.
 * Handlers: onConversation({id, title}), onSources(list), onToken(text), onDone(), onError(message).
 * Without a conversationId the question starts a new conversation.
 */
export async function streamChat(id, question, style, handlers, signal, conversationId = null) {
  let res;
  try {
    res = await fetch(`${BASE}/api/documents/${id}/chat`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, style, conversation_id: conversationId }),
      signal,
    });
  } catch (err) {
    if (err.name === "AbortError") return;
    throw new Error("Can't reach the server. Start the backend (uvicorn) and try again.");
  }
  if (res.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED));
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed (${res.status}).`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        let event = "message";
        let data = "";
        for (const line of block.split("\n")) {
          if (line.startsWith("event: ")) event = line.slice(7);
          else if (line.startsWith("data: ")) data += line.slice(6);
        }
        const payload = data ? JSON.parse(data) : null;
        if (event === "conversation") handlers.onConversation?.(payload);
        else if (event === "sources") handlers.onSources?.(payload);
        else if (event === "token") handlers.onToken?.(payload);
        else if (event === "done") handlers.onDone?.();
        else if (event === "error") handlers.onError?.(payload);
      }
    }
  } catch (err) {
    if (err.name !== "AbortError") throw err;
  }
}