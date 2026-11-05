import { useWindowDimensions } from "react-native";
import { screenTierFor } from "./metrics";

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

/** Corte de dispositivo: la fuente única de tiers es theme/metrics.ts. */
export function useBreakpoint(): BreakpointInfo {
  const { width, height } = useWindowDimensions();
  const tier = screenTierFor(width);
  const layout: Layout = tier === "movil" ? "mobile" : tier === "tablet" ? "tablet" : "desktop";
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
