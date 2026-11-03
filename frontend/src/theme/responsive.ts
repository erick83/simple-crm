import { useWindowDimensions } from "react-native";

/** Cortes por contenido, no por dispositivo: el layout se rompe en estos anchos. */
export const breakpoints = {
  mobile: 720, // debajo: una sola columna + navegación inferior
  desktop: 1024, // encima: barra lateral completa
} as const;

export type Layout = "mobile" | "tablet" | "desktop";

export interface BreakpointInfo {
  width: number;
  height: number;
  layout: Layout;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  /** Dos paneles lado a lado (catálogo + ticket) solo caben desde aquí. */
  isTwoPane: boolean;
}

export function useBreakpoint(): BreakpointInfo {
  const { width, height } = useWindowDimensions();
  const layout: Layout =
    width < breakpoints.mobile ? "mobile" : width < breakpoints.desktop ? "tablet" : "desktop";
  return {
    width,
    height,
    layout,
    isMobile: layout === "mobile",
    isTablet: layout === "tablet",
    isDesktop: layout === "desktop",
    isTwoPane: width >= 960,
  };
}
