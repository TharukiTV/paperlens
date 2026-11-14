import { useCallback, useEffect, useState } from "react";

export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

const THEME_KEY = "paperlens-theme";

/** Light/dark theme: follows the system until the user picks one, then remembers it. */
export function useTheme() {
  const systemDark = useMediaQuery("(prefers-color-scheme: dark)");
  const [choice, setChoice] = useState(() => {
    try { return localStorage.getItem(THEME_KEY); } catch { return null; }
  });
  const theme = choice || (systemDark ? "dark" : "light");

  useEffect(() => {
    const root = document.documentElement;
    if (choice) root.dataset.theme = choice;
    else delete root.dataset.theme;
    try {
      if (choice) localStorage.setItem(THEME_KEY, choice);
      else localStorage.removeItem(THEME_KEY);
    } catch { /* storage blocked */ }
  }, [choice]);

  const toggle = useCallback(() => setChoice(theme === "dark" ? "light" : "dark"), [theme]);
  return [theme, toggle];
}

const LAYOUT_KEY = "paperlens-layout";
export const PANEL_LIMITS = {
  sidebar: { min: 220, max: 420, initial: 300 },
  chat: { min: 340, max: 820, initial: 440 },
};
const clampWidth = (panel, w) => Math.round(Math.min(PANEL_LIMITS[panel].max, Math.max(PANEL_LIMITS[panel].min, w)));

/** Panel widths and the folded sidebar, remembered in this browser. */
export function usePanelLayout() {
  const [layout, setLayout] = useState(() => {
    const fallback = { sidebar: PANEL_LIMITS.sidebar.initial, chat: PANEL_LIMITS.chat.initial, collapsed: false, chatHidden: false };
    try {
      const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) || "{}");
      return {
        sidebar: clampWidth("sidebar", Number(saved.sidebar) || fallback.sidebar),
        chat: clampWidth("chat", Number(saved.chat) || fallback.chat),
        collapsed: !!saved.collapsed,
        chatHidden: !!saved.chatHidden,
      };
    } catch {
      return fallback;
    }
  });

  useEffect(() => {
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch { /* storage blocked */ }
  }, [layout]);

  const resize = useCallback((panel, width) => setLayout((l) => ({ ...l, [panel]: clampWidth(panel, width) })), []);
  const reset = useCallback((panel) => setLayout((l) => ({ ...l, [panel]: PANEL_LIMITS[panel].initial })), []);
  const toggleCollapsed = useCallback(() => setLayout((l) => ({ ...l, collapsed: !l.collapsed })), []);
  const setCollapsed = useCallback((collapsed) => setLayout((l) => (l.collapsed === collapsed ? l : { ...l, collapsed })), []);
  const setChatHidden = useCallback((chatHidden) => setLayout((l) => (l.chatHidden === chatHidden ? l : { ...l, chatHidden })), []);
  return { layout, resize, reset, toggleCollapsed, setCollapsed, setChatHidden };
}
