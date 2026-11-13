import { createContext, useCallback, useContext, useRef, useState } from "react";
import { AlertCircle, Check, Info, X } from "lucide-react";

const ToastContext = createContext(() => {});

export const useToast = () => useContext(ToastContext);

const ICONS = { success: Check, error: AlertCircle, info: Info };

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef({});

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current[id]);
    delete timers.current[id];
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  // toast("Copied", { tone: "success", action: { label: "Undo", onClick }, duration })
  const push = useCallback((message, { tone = "info", action, duration = 3200 } = {}) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((list) => [...list.slice(-3), { id, message, tone, action }]);
    timers.current[id] = setTimeout(() => dismiss(id), duration);
    return id;
  }, [dismiss]);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => {
          const Icon = ICONS[t.tone] || Info;
          return (
            <div key={t.id} className={`toast toast--${t.tone}`}>
              <Icon size={16} aria-hidden="true" className="toast__icon" />
              <span className="toast__text">{t.message}</span>
              {t.action && (
                <button className="toast__action" onClick={() => { t.action.onClick(); dismiss(t.id); }}>
                  {t.action.label}
                </button>
              )}
              <button className="toast__close" onClick={() => dismiss(t.id)} aria-label="Dismiss">
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
