"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

// Scaffold UI text — centralisé en #14 (i18n).
const LABEL_LIGHT = "Mode clair";
const LABEL_DARK = "Mode sombre";
const LABEL_TOGGLE = "Basculer le thème";

// Exporté pour les tests unitaires — logique pure, sans dépendance React.
export function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const stored = document.documentElement.dataset.theme;
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  // Met à jour le data-theme sur <html> (système externe au sens React).
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <button
      type="button"
      aria-label={LABEL_TOGGLE}
      aria-pressed={theme === "dark"}
      onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
      className="mz-theme-toggle"
      suppressHydrationWarning
      style={{
        minWidth: "var(--tap-target-min)",
        minHeight: "var(--tap-target-min)",
        padding: "var(--space-2) var(--space-5)",
        borderRadius: "var(--border-radius-full)",
        backgroundColor: "var(--color-accent-primary)",
        color: "var(--color-text-inverse)",
        border: "none",
        cursor: "pointer",
        fontFamily: "var(--font-family-body)",
        fontSize: "var(--font-size-sm)",
        fontWeight: "var(--font-weight-semibold)",
        transition: "background-color var(--duration-normal) var(--easing-default)",
      }}
    >
      {theme === "dark" ? LABEL_LIGHT : LABEL_DARK}
    </button>
  );
}
