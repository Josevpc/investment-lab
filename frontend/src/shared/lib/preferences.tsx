import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type ThemeChoice = "dark" | "light" | "system";

const THEME_KEY = "il-theme";
const PRIVACY_KEY = "il-privacy";
const NAME_KEY = "il-name";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Sem armazenamento disponível: a preferência vale só para esta sessão.
  }
}

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(choice: ThemeChoice) {
  const dark = choice === "dark" || (choice === "system" && systemPrefersDark());
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

interface Preferences {
  theme: ThemeChoice;
  setTheme: (theme: ThemeChoice) => void;
  /** true quando os valores estão ocultos (desfocados) na tela. */
  hidden: boolean;
  setHidden: (hidden: boolean) => void;
  toggleHidden: () => void;
  /** Como a pessoa quer ser chamada na saudação (vazio = sem nome). */
  name: string;
  setName: (name: string) => void;
}

const PreferencesContext = createContext<Preferences | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeChoice>(() => {
    const stored = read(THEME_KEY);
    return stored === "light" || stored === "system" || stored === "dark" ? stored : "dark";
  });
  const [hidden, setHiddenState] = useState(() => read(PRIVACY_KEY) === "hidden");
  const [name, setNameState] = useState(() => read(NAME_KEY) ?? "");

  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => applyTheme("system");
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, [theme]);

  useEffect(() => {
    if (hidden) document.documentElement.dataset.privacy = "hidden";
    else delete document.documentElement.dataset.privacy;
  }, [hidden]);

  const setTheme = useCallback((next: ThemeChoice) => {
    write(THEME_KEY, next);
    setThemeState(next);
  }, []);

  const setHidden = useCallback((next: boolean) => {
    write(PRIVACY_KEY, next ? "hidden" : "visible");
    setHiddenState(next);
  }, []);

  const setName = useCallback((next: string) => {
    write(NAME_KEY, next);
    setNameState(next);
  }, []);

  const value = useMemo<Preferences>(
    () => ({ theme, setTheme, hidden, setHidden, toggleHidden: () => setHidden(!hidden), name, setName }),
    [theme, setTheme, hidden, setHidden, name, setName],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): Preferences {
  const context = useContext(PreferencesContext);
  if (!context) throw new Error("usePreferences precisa estar dentro de PreferencesProvider.");
  return context;
}

/** Tema efetivo (resolvendo "system") para quem precisa pintar gráficos. */
export function useIsDark(): boolean {
  const { theme } = usePreferences();
  return theme === "dark" || (theme === "system" && systemPrefersDark());
}

/** Aviso que a pessoa pode dispensar; a escolha fica no navegador (chave "il-dismissed-<key>"). Não precisa do provider. */
export function useDismissed(key: string): [boolean, () => void] {
  const storageKey = `il-dismissed-${key}`;
  const [dismissed, setDismissed] = useState(() => read(storageKey) === "1");
  const dismiss = useCallback(() => {
    write(storageKey, "1");
    setDismissed(true);
  }, [storageKey]);
  return [dismissed, dismiss];
}
