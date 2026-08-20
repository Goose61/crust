"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    return <span className="h-10 w-[88px] border border-transparent" />;
  }
  const dark = resolvedTheme === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label="Toggle light and dark"
      className="flex h-10 items-center gap-1 border px-1"
      style={{
        borderWidth: "var(--hairline)",
        borderColor: "var(--header-border)",
        borderRadius: "var(--radius)",
        color: "var(--header-fg)",
      }}
    >
      <span
        className={`px-2 py-1 text-[11px] font-semibold tracking-wide ${!dark ? "bg-foreground text-background" : ""}`}
      >
        LIGHT
      </span>
      <span
        className={`px-2 py-1 text-[11px] font-semibold tracking-wide ${dark ? "bg-foreground text-background" : ""}`}
      >
        DARK
      </span>
    </button>
  );
}
