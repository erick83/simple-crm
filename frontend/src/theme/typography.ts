import { Platform, TextStyle } from "react-native";

export const typography = {
  // Plus Jakarta Sans aún no se empaqueta (falta expo-font + .ttf): en nativo se usa la
  // sans del sistema (Roboto / SF Pro); en web se intenta Jakarta con fallback a sistema.
  // shortcut: cargar Jakarta con expo-font cuando se quiera la marca tipográfica exacta.
  fontFamily: Platform.select({
    web: "Plus Jakarta Sans, -apple-system, Roboto, sans-serif",
    default: undefined,
  }),
  monoFamily: "monospace",

  sizes: {
    heroTotal: 40,
    titleLg: 24,
    titleMd: 20,
    numpadDigit: 28,
    body: 16,
    subText: 14,
    caption: 12,
  },

  weights: {
    regular: "400" as TextStyle["fontWeight"],
    medium: "500" as TextStyle["fontWeight"],
    semibold: "600" as TextStyle["fontWeight"],
    bold: "700" as TextStyle["fontWeight"],
    extraBold: "800" as TextStyle["fontWeight"],
  },

  // Estilo reutilizable para importes monetarios y cantidades exactas.
  // tnum alinea los 4 decimales con la sans de la app (el monospace se ve tosco en montos).
  tabularNumeric: {
    fontVariant: ["tabular-nums"] as TextStyle["fontVariant"],
  },
} as const;

