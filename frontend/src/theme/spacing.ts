/**
 * Tokens de espaciado y layout.
 *
 * SPACING_BASE es el contrato de diseño del lienzo de referencia 1280×800
 * (AGENTS.md y bisync-pos-design-guide.md). `spacing` son los tokens VIVOS que
 * consumen los factories de estilos: theme/metrics.ts (applyMetrics) los reescribe
 * según el viewport, manteniendo la relación de la UI en cualquier dispositivo.
 */
export const SPACING_BASE = {
  // Touch Targets estrictos (AGENTS.md & bisync-pos-design-guide.md)
  touchTargetMin: 48, // Mínimo para controles secundarios, steppers y filtros (piso legal)
  touchTargetHero: 64, // Mínimo para botón de cobro maestro, cierre Z y teclas numpad

  // Dimensiones de layout (1280×800) y responsive
  sidebarWidth: 240,
  sidebarRailWidth: 88,
  bottomNavHeight: 64,
  topHeaderHeight: 64,
  bottomBarHeight: 80,

  // Espaciados estándar
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,

  // Radios de esquinas
  radiusSm: 8,
  radiusMd: 12,
  radiusLg: 16,
  radiusXl: 20,
  radiusFull: 9999,
} as const;

export type SpacingKey = keyof typeof SPACING_BASE;

/** Tokens vivos: mutan con applyMetrics(); leer dentro de factories/renders, no al importar. */
export const spacing: Record<SpacingKey, number> = { ...SPACING_BASE };
