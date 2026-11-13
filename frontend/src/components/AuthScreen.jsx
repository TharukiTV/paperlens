import { useState } from "react";
import { AlertCircle, Eye, EyeOff, Loader2, MessageSquareText, Moon, ScrollText, Sun, Users } from "lucide-react";
import { api } from "../api";
import { useTheme } from "../hooks";

const POINTS = [
  { icon: ScrollText, text: "Structured summaries with page references" },
  { icon: MessageSquareText, text: "Answers that cite the exact page they came from" },
  { icon: Users, text: "Your own private library, on any device" },
];

export default function AuthScreen({ onAuthed }) {
  const [mode, setMode] = useState("signin"); // "signin" | "signup"
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [theme, toggleTheme] = useTheme();
  const signup = mode === "signup";

  const switchMode = (next) => { setMode(next); setError(""); };

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (signup && password.length < 8) {
      setError("Use a password with at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      const user = signup ? await api.register(name, email, password) : await api.login(email, password);
      onAuthed(user);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <button className="icon-button theme-toggle" onClick={toggleTheme}
        aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
        {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
      </button>

      <aside className="auth__intro">
        <div className="brand brand--static">
          <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true">
            <rect x="4" y="2" width="22" height="28" rx="5" fill="var(--accent)" />
            <rect x="9" y="10" width="12" height="4" rx="1.5" fill="var(--highlight)" />
            <rect x="9" y="17" width="9" height="2.2" rx="1.1" fill="var(--on-accent)" opacity=".85" />
            <rect x="9" y="21.5" width="11" height="2.2" rx="1.1" fill="var(--on-accent)" opacity=".85" />
          </svg>
          <span>PaperLens</span>
        </div>
        <h1 className="auth__title">Read the paper in five minutes. Then ask it anything.</h1>
        <ul className="auth__points">
          {POINTS.map(({ icon: Icon, text }) => (
            <li key={text}><span className="how__icon" aria-hidden="true"><Icon size={18} /></span>{text}</li>
          ))}
        </ul>
      </aside>

      <main className="auth__panel">
        <form className="auth__card" onSubmit={submit} noValidate>
          <h2>{signup ? "Create your account" : "Welcome back"}</h2>
          <p className="auth__sub">{signup ? "Your papers and chats are private to your account." : "Sign in to open your library."}</p>

          <div className="segmented auth__switch" role="tablist" aria-label="Account">
            <button type="button" role="tab" aria-selected={!signup} className={`segmented__option ${!signup ? "is-active" : ""}`} onClick={() => switchMode("signin")}>Sign in</button>
            <button type="button" role="tab" aria-selected={signup} className={`segmented__option ${signup ? "is-active" : ""}`} onClick={() => switchMode("signup")}>Create account</button>
          </div>

          {signup && (
            <label className="field">
              <span>Name <em>(optional)</em></span>
              <input id="auth-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            </label>
          )}
          <label className="field">
            <span>Email</span>
            <input id="auth-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
          </label>
          <label className="field">
            <span>Password</span>
            <span className="field__row">
              <input id="auth-password" type={show ? "text" : "password"} required minLength={8}
                autoComplete={signup ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} />
              <button type="button" className="icon-button" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"}>
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </span>
            {signup && <small className="field__hint">At least 8 characters.</small>}
          </label>

          {error && <p className="notice notice--error" role="alert"><AlertCircle size={16} aria-hidden="true" />{error}</p>}

          <button className="button button--primary button--block" disabled={busy || !email || !password}>
            {busy && <Loader2 size={16} className="spin" aria-hidden="true" />}
            {signup ? "Create account" : "Sign in"}
          </button>

          <p className="auth__alt">
            {signup ? "Already have an account? " : "New to PaperLens? "}
            <button type="button" className="link-button" onClick={() => switchMode(signup ? "signin" : "signup")}>
              {signup ? "Sign in" : "Create an account"}
            </button>
          </p>
        </form>
      </main>
    </div>
  );
}
