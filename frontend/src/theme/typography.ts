import { TextStyle } from "react-native";

export const typography = {
  fontFamily: "Plus Jakarta Sans, -apple-system, Roboto, sans-serif",
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

  // Estilo reutilizable para importes monetarios y cantidades exactas
  tabularNumeric: {
    fontVariant: ["tabular-nums"] as TextStyle["fontVariant"],
    fontFamily: "monospace",
  },
} as const;

