export const colors = {
  // Dark Mode Principal (POS Nativo)
  dark: {
    primary: "#1D61E0", // Cobalt Blue
    primaryGlow: "#3B82F6",
    hero: "#00B074", // Emerald Green (Botón Maestro de Cobro)
    heroLight: "#10B981",
    accentGradient: ["#1D61E0", "#00B074"] as const,

    surfaceBase: "#061426", // Fondo principal de la aplicación
    surfaceDim: "#020E21", // Backdrop y zonas periféricas
    surfaceContainerLow: "#0E1C2F", // Paneles laterales y barra superior
    surfaceContainer: "#14243B", // Tarjetas de producto e items
    surfaceContainerHigh: "#1E314B", // Teclas del numpad e inputs
    surfaceContainerHighest: "#283F5E", // Bordes de selección activa

    border: "rgba(255, 255, 255, 0.08)",
    borderSolid: "#1E293B",

    textPrimary: "#FFFFFF",
    textSecondary: "#94A3B8",
    textMuted: "#64748B",

    warning: "#F59E0B",
    warningDark: "#D97706",
    error: "#EF4444",
    errorDark: "#DC2626",
  },

  // Light Mode (Alto contraste exterior)
  light: {
    primary: "#1550BC",
    hero: "#059669",
    surfaceBase: "#F8FAFC",
    surfaceContainerLow: "#FFFFFF",
    surfaceContainer: "#F1F5F9",
    surfaceContainerHigh: "#E2E8F0",
    border: "#CBD5E1",
    textPrimary: "#0F172A",
    textSecondary: "#475569",
    textMuted: "#94A3B8",
    warning: "#D97706",
    error: "#DC2626",
  },
} as const;

export type ColorTheme = typeof colors.dark;

