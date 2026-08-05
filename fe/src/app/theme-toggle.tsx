"use client";

import { useEffect, useState } from "react";
import { getTheme, setTheme, applyTheme, type Theme } from "@/lib/identity";

// Tombol ganti tema light/dark. `variant` menyesuaikan warna ke latar.
export default function ThemeToggle({
  variant = "light",
}: {
  variant?: "light" | "dark";
}) {
  const [theme, setThemeState] = useState<Theme>("light");

  useEffect(() => {
    const t = getTheme();
    setThemeState(t);
    applyTheme(t);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    setThemeState(next);
  }

  const base =
    variant === "dark"
      ? "border-white/25 text-white/90 hover:bg-white/10"
      : "border-slate-300 text-slate-500 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700";

  return (
    <button
      onClick={toggle}
      aria-label="Ganti tema"
      title={theme === "dark" ? "Mode terang" : "Mode gelap"}
      className={`grid h-9 w-9 place-items-center rounded-lg border text-base transition ${base}`}
    >
      {theme === "dark" ? "☀️" : "🌙"}
    </button>
  );
}
