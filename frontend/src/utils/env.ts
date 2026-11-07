/**
 * Utilidades para detección y control del entorno de ejecución (Development, Production, Test).
 * Permite aislar comportamientos como migraciones automáticas y semillas de prueba
 * para que no impacten instalaciones de producción.
 */

export type AppEnvironment = "development" | "production" | "test";

let envOverride: AppEnvironment | null = null;

/**
 * Permite forzar el entorno manualmente (útil para tests unitarios y suites de integración).
 */
export function setEnvironmentOverride(env: AppEnvironment | null): void {
  envOverride = env;
}

/**
 * Retorna el entorno activo de la aplicación.
 * Prioridad de resolución:
 * 1. Override manual en runtime (`setEnvironmentOverride`)
 * 2. Variable `process.env.APP_ENV`
 * 3. Variable `process.env.EXPO_PUBLIC_APP_ENV`
 * 4. Variable `process.env.NODE_ENV`
 * 5. Global `__DEV__` (provisto por Metro / React Native)
 */
export function getAppEnvironment(): AppEnvironment {
  if (envOverride) {
    return envOverride;
  }

  // Comprobar variables de entorno explícitas
  const rawEnv =
    (typeof process !== "undefined" && process.env
      ? process.env.APP_ENV || process.env.EXPO_PUBLIC_APP_ENV || process.env.NODE_ENV
      : undefined) || "";

  const normalized = rawEnv.trim().toLowerCase();

  if (normalized === "production" || normalized === "prod") {
    return "production";
  }

  if (normalized === "test") {
    return "test";
  }

  if (normalized === "development" || normalized === "dev") {
    return "development";
  }

  // Detección React Native / Metro (__DEV__ booleano global)
  // En React Native __DEV__ es true en desarrollo y false en builds de producción
  if (typeof __DEV__ !== "undefined") {
    return __DEV__ ? "development" : "production";
  }

  return "development";
}

export function isDevEnvironment(): boolean {
  return getAppEnvironment() === "development";
}

export function isProdEnvironment(): boolean {
  return getAppEnvironment() === "production";
}

export function isTestEnvironment(): boolean {
  return getAppEnvironment() === "test";
}

/**
 * Determina si se deben ejecutar migraciones DDL automáticas o seeds experimentales.
 * Por política del sistema, las migraciones automáticas SOLO se corren en entorno de desarrollo
 * o pruebas, previniendo alteraciones imprevistas en bases de datos de producción.
 */
export function shouldRunMigrations(opts?: { force?: boolean }): boolean {
  if (opts?.force) {
    return true;
  }
  return isDevEnvironment() || isTestEnvironment();
}
