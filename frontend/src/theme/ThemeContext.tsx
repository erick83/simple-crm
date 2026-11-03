import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { useColorScheme } from "react-native";
import { palettes } from "./tokens";
import type { Palette, ThemeMode } from "./tokens";

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
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const systemScheme = useColorScheme();
  const [mode, setMode] = useState<ThemeMode>(
    () => readStoredMode() ?? (systemScheme === "light" ? "light" : "dark"),
  );

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
    () => ({ colors: palettes[mode], mode, toggleMode }),
    [mode, toggleMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme requiere <ThemeProvider>");
  return context;
}

// Un juego de estilos por fábrica y por tema: montar el árbol no reconstruye StyleSheets.
const stylesCache = new WeakMap<object, Map<ThemeMode, object>>();

export function useThemedStyles<T extends object>(factory: (colors: Palette) => T): T {
  const { colors, mode } = useTheme();
  return useMemo(() => {
    let byMode = stylesCache.get(factory);
    if (!byMode) {
      byMode = new Map();
      stylesCache.set(factory, byMode);
    }
    const cached = byMode.get(mode);
    if (cached) return cached as T;
    const created = factory(colors);
    byMode.set(mode, created);
    return created;
  }, [factory, mode, colors]);
}
