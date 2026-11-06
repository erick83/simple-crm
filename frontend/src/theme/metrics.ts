/**
 * Sistema de métricas fluidas.
 *
 * Lienzos de referencia (docs/skills/bisync-pos-design-guide.md):
 *   - PC y Tablet (landscape): 1280×800. En el lienzo completo los tokens valen
 *     exactamente lo de SPACING_BASE / TYPE_SIZES_BASE (px/rem fijos, condición 2).
 *   - Ventanas PC pequeñas y tablets angostas: la UI se aprieta con factores
 *     derivados del viewport (condición 3) para que nada crucial salga de pantalla.
 *   - Móvil (portrait, 390×844): el alto hace scroll vertical, así que sólo el
 *     ancho manda; la tipografía y los targets táctiles conservan sus pisos legales.
 */
import { SPACING_BASE, spacing } from "./spacing";
import type { SpacingKey } from "./spacing";
import { TYPE_SIZES_BASE, typography } from "./typography";
import type { TypeSizeKey } from "./typography";

export type ScreenTier = "pc" | "tablet" | "movil";

const CANVAS: Record<ScreenTier, { w: number; h: number }> = {
  pc: { w: 1280, h: 800 },
  tablet: { w: 1280, h: 800 }, // el estándar del guide es landscape en ambos
  movil: { w: 390, h: 844 },
};

// Cortes de dispositivo (condición 1), fuente única para theme/responsive.ts.
export const TIER_MOBILE_MAX = 720; // < 720 px: móvil
export const TIER_DESKTOP_MIN = 1024; // ≥ 1024 px: PC; entre ambos: tablet

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

export interface Metrics {
  tier: ScreenTier;
  width: number;
  height: number;
  /** Densidad de espaciados, radios y tarjetas: 0.7–1 en PC/Tablet, 0.85–1 en Móvil. */
  scale: number;
  /** Tipografía: cede menos que la densidad; nunca bajo el piso de legibilidad. */
  fontScale: number;
  /** Teclas del numpad y botón maestro de cobro: 48–64 px según el alto real. */
  heroTouch: number;
  /** Ancho de la columna del numpad en el cobro a dos columnas. */
  checkoutRight: number;
  /** Ancho mínimo de una ficha del catálogo; define cuántas columnas caben. */
  catalogCard: number;
  /** Cobro a dos columnas solo si el tier lo permite y hay alto suficiente (≥560 px). */
  twoPaneCheckout: boolean;
  /** Clave de cuantización: los estilos sólo se reconstruyen cuando cambia. */
  bucket: string;
}

export function screenTierFor(width: number): ScreenTier {
  if (width < TIER_MOBILE_MAX) return "movil";
  if (width < TIER_DESKTOP_MIN) return "tablet";
  return "pc";
}

export function computeMetrics(width: number, height: number): Metrics {
  const tier = screenTierFor(width);
  const canvas = CANVAS[tier];
  const fitW = width / canvas.w;
  const fitH = height / canvas.h;

  let scale: number;
  let fontScale: number;
  if (tier === "movil") {
    scale = clamp(fitW, 0.85, 1);
    fontScale = clamp(0.92 + fitW * 0.08, 0.92, 1);
  } else {
    // Landscape: aprieta el lado más corto; una PC 1024×600 se comprime ~25%.
    const fit = Math.min(fitW, fitH);
    scale = clamp(fit, 0.7, 1);
    fontScale = clamp(0.82 + fit * 0.18, 0.86, 1);
  }

  // Pisos legales (AGENTS.md): 48 px mínimo táctil. Los 64 px del cobro/numpad se
  // conservan en el lienzo completo y ceden primero cuando el viewport no los
  // admite, para que CONFIRMAR COBRO nunca quede fuera de pantalla.
  const heroTouch = clamp(Math.round(64 * Math.min(1, fitH)), 48, 64);
  const checkoutRight = clamp(8 * Math.round((width * 0.28) / 8), 224, 360);
  const catalogCard = clamp(Math.round(190 * Math.max(scale, 0.8)), 144, 190);
  const twoPaneCheckout = tier !== "movil" && height >= 560;

  // Cuantización: arrastrar la ventana no dispara una reconstrucción por píxel.
  const bucket = [
    tier,
    Math.round(scale * 20),
    Math.round(fontScale * 20),
    heroTouch,
    checkoutRight,
    catalogCard,
    twoPaneCheckout ? "2p" : "1p",
  ].join("|");

  return {
    tier,
    width,
    height,
    scale,
    fontScale,
    heroTouch,
    checkoutRight,
    catalogCard,
    twoPaneCheckout,
    bucket,
  };
}

/** Escribe las métricas del viewport en los tokens globales spacing/typography. */
export function applyMetrics(m: Metrics): void {
  for (const key of Object.keys(SPACING_BASE) as SpacingKey[]) {
    const base = SPACING_BASE[key];
    if (key === "touchTargetMin" || key === "radiusFull" || key === "sidebarRailWidth") {
      spacing[key] = base; // pisos legales e irreductibles
    } else if (key === "touchTargetHero") {
      spacing[key] = m.heroTouch;
    } else if (
      key === "sidebarWidth" ||
      key === "topHeaderHeight" ||
      key === "bottomNavHeight" ||
      key === "bottomBarHeight"
    ) {
      spacing[key] = clamp(Math.round(base * m.scale), 48, base);
    } else {
      spacing[key] = Math.max(2, Math.round(base * m.scale));
    }
  }
  for (const key of Object.keys(TYPE_SIZES_BASE) as TypeSizeKey[]) {
    typography.sizes[key] = Math.max(10, Math.round(TYPE_SIZES_BASE[key] * m.fontScale));
  }
}
