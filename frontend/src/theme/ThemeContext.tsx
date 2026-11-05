import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { useColorScheme, useWindowDimensions } from "react-native";
import { palettes } from "./tokens";
import type { Palette, ThemeMode } from "./tokens";
import { applyMetrics, computeMetrics } from "./metrics";
import type { Metrics } from "./metrics";

const STORAGE_KEY = "bisync.theme-mode";

// shortcut: la preferencia se persiste solo en web (localStorage); en nativo vuelve
// al tema del sistema al reiniciar. Migrar a la tabla de ajustes de SQLite si molesta.
function readStoredMode(): ThemeMode | null {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : null;
  } catch {
    return null;
  }
}

interface ThemeContextValue {
  colors: Palette;
  mode: ThemeMode;
  toggleMode: () => void;
  /** Métricas fluidas del viewport actual; ver theme/metrics.ts. */
  metrics: Metrics;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const systemScheme = useColorScheme();
  const { width, height } = useWindowDimensions();
  const [mode, setMode] = useState<ThemeMode>(
    () => readStoredMode() ?? (systemScheme === "light" ? "light" : "dark"),
  );

  // Las métricas se reconstruyen solo cuando cambia la cubeta cuántica (bucket),
  // no en cada píxel de un arrastre de ventana. applyMetrics reescribe los tokens
  // globales ANTES de que los hijos rendericen sus factories de estilos.
  const computed = computeMetrics(width, height);
  const metrics = useMemo(() => {
    applyMetrics(computed);
    return computed;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computed.bucket]);

  const toggleMode = useCallback(() => {
    setMode((previous) => {
      const next: ThemeMode = previous === "dark" ? "light" : "dark";
      try {
        globalThis.localStorage?.setItem(STORAGE_KEY, next);
      } catch {
        // Sin almacenamiento disponible: el cambio vive solo en memoria
      }
      return next;
    });
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ colors: palettes[mode], mode, toggleMode, metrics }),
    [mode, toggleMode, metrics],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme requiere <ThemeProvider>");
  return context;
}

/** Métricas del viewport (densidad, targets táctiles, columnas) para cálculos propios. */
export function useMetrics(): Metrics {
  return useTheme().metrics;
}

// Un juego de estilos por fábrica, tema y cubeta de viewport: montar el árbol no
// reconstruye StyleSheets y el arrastre de ventana solo regenera al cambiar de bucket.
const stylesCache = new WeakMap<object, Map<string, object>>();

export function useThemedStyles<T extends object>(
  factory: (colors: Palette, metrics: Metrics) => T,
): T {
  const { colors, mode, metrics } = useTheme();
  return useMemo(() => {
    const cacheKey = `${mode}|${metrics.bucket}`;
    let byKey = stylesCache.get(factory);
    if (!byKey) {
      byKey = new Map();
      stylesCache.set(factory, byKey);
    }
    const cached = byKey.get(cacheKey);
    if (cached) return cached as T;
    const created = factory(colors, metrics);
    byKey.set(cacheKey, created);
    return created;
  }, [factory, mode, metrics]);
}
