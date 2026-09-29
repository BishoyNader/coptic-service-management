"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

/**
 * Wraps the application in next-themes so that dark / light mode can be
 * toggled from any component via `useTheme()`. Defaults to "system" so
 * first-time visitors follow their OS preference, and persists the choice
 * in localStorage.
 *
 * Mirrors the pattern used by the samaanshaaban.vercel.app portfolio.
 */
export function ThemeProvider({
  children,
  ...props
}: {
  children: ReactNode;
} & React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      enableSystem
      defaultTheme="system"
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
