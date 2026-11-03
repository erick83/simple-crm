/**
 * Tokens semánticos BISync POS.
 *
 * Superficies neutras (grafito / porcelana) y el cobalto reservado a la acción
 * primaria y a la selección activa: el acento no tiñe la interfaz entera.
 * Cada rol de texto usa la variante `*Text` para cumplir AA sobre superficies.
 */
export const palettes = {
  dark: {
    surfaceBase: "#0A0D12",
    surfaceDim: "#05070A",
    surfaceContainerLow: "#10141A",
    surfaceContainer: "#161B23",
    surfaceContainerHigh: "#1E242D",
    surfaceContainerHighest: "#2B3340",

    border: "rgba(255, 255, 255, 0.08)",
    borderSolid: "#232A34",

    textPrimary: "#F3F6F9",
    textSecondary: "#A3ADBA",
    textMuted: "#7E8A99",

    // Logo: isotipo fijo de marca, wordmark legible sobre la superficie del tema.
    brandMarkGreen: "#11A87A",
    brandMarkBlue: "#1E4FC9",
    brandInk: "#FFFFFF",

    primary: "#1D61E0",
    primaryGlow: "#6EA8FF",
    primarySoft: "rgba(29, 97, 224, 0.18)",
    onPrimary: "#FFFFFF",

    hero: "#00B074",
    heroLight: "#10B981",
    heroSoft: "rgba(0, 176, 116, 0.16)",
    onHero: "#04170F",
    heroText: "#34D8A4",

    warning: "#F5A524",
    warningText: "#F7B955",
    warningSoft: "rgba(245, 165, 36, 0.16)",
    warningSurface: "#2A1B06",
    onWarning: "#1A1206",

    error: "#DC2626",
    errorText: "#FF7A7A",
    errorSoft: "rgba(220, 38, 38, 0.16)",

    neutralSoft: "rgba(148, 163, 184, 0.14)",
    overlay: "rgba(4, 6, 9, 0.72)",
    shadow: "#000000",
  },

  light: {
    surfaceBase: "#F4F6F8",
    surfaceDim: "#E8EBEF",
    surfaceContainerLow: "#FFFFFF",
    surfaceContainer: "#EFF2F5",
    surfaceContainerHigh: "#E3E7EC",
    surfaceContainerHighest: "#D5DBE3",

    border: "#DFE4EA",
    borderSolid: "#CBD2DB",

    textPrimary: "#0C1116",
    textSecondary: "#46505D",
    textMuted: "#6A7583",

    // Logo: isotipo fijo de marca, wordmark legible sobre la superficie del tema.
    brandMarkGreen: "#11A87A",
    brandMarkBlue: "#1E4FC9",
    brandInk: "#0E1A36",

    primary: "#1550BC",
    primaryGlow: "#1A56C4",
    primarySoft: "rgba(21, 80, 188, 0.10)",
    onPrimary: "#FFFFFF",

    hero: "#047857",
    heroLight: "#059669",
    heroSoft: "rgba(4, 120, 87, 0.12)",
    onHero: "#FFFFFF",
    heroText: "#046C4E",

    warning: "#B45309",
    warningText: "#92400E",
    warningSoft: "rgba(180, 83, 9, 0.10)",
    warningSurface: "#FEF3C7",
    onWarning: "#FFFFFF",

    error: "#DC2626",
    errorText: "#B91C1C",
    errorSoft: "rgba(220, 38, 38, 0.08)",

    neutralSoft: "rgba(100, 116, 139, 0.10)",
    overlay: "rgba(12, 17, 22, 0.45)",
    shadow: "#0C1116",
  },
} as const;

export type Palette = { [K in keyof typeof palettes.dark]: string };
export type ThemeMode = keyof typeof palettes;
