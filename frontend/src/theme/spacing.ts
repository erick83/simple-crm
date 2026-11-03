export const spacing = {
  // Touch Targets estrictos (AGENTS.md & bisync-pos-design-guide.md)
  touchTargetMin: 48, // Mínimo para controles secundarios, steppers y filtros
  touchTargetHero: 64, // Mínimo para botón de cobro maestro, cierre Z y teclas numpad

  // Dimensiones fijas de layout Landscape (1280x800) y responsive
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

