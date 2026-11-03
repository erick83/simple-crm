import { palettes } from "./tokens";

/** Alias histórico; la fuente de verdad son los tokens semánticos. */
export const colors = {
  dark: palettes.dark,
  light: palettes.light,
} as const;

export type ColorTheme = typeof palettes.dark;
