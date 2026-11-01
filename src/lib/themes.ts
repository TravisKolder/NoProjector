import type { ThemeId } from "./types";

export type Theme = {
  id: ThemeId;
  label: string;
  bg: string;
  fg: string;
  muted: string;
  accent: string;
  rule: string;
  font: string;
};

const sans = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const serif = 'ui-serif, Georgia, "Iowan Old Style", "Times New Roman", serif';

export const THEMES: Record<ThemeId, Theme> = {
  light: { id: "light", label: "Clean", bg: "#ffffff", fg: "#16181d", muted: "#5b6170", accent: "#2f5bea", rule: "#e3e5ea", font: sans },
  dark: { id: "dark", label: "Night", bg: "#111318", fg: "#f2f3f5", muted: "#a3a8b4", accent: "#8ab0ff", rule: "#2a2e37", font: sans },
  warm: { id: "warm", label: "Parchment", bg: "#f6f0e4", fg: "#2b231a", muted: "#6e604d", accent: "#9a4b1d", rule: "#e2d6bf", font: serif },
  bold: { id: "bold", label: "Bold", bg: "#14306b", fg: "#ffffff", muted: "#c5d2f0", accent: "#ffd166", rule: "#2b4a8c", font: sans },
};

export const THEME_IDS = Object.keys(THEMES) as ThemeId[];

export function getTheme(id: string | undefined | null): Theme {
  return THEMES[(id as ThemeId) ?? "light"] ?? THEMES.light;
}
