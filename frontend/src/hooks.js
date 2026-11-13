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
