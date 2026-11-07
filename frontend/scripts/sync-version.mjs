// Sincroniza la versión de la aplicación en todas las plataformas y empaquetadores:
// - package.json (fuente canónica)
// - app.json (Expo / Android APK / versionCode)
// - src-tauri/tauri.conf.json (Instalador PC Windows .msi y -setup.exe)
// - src-tauri/Cargo.toml (Binario Rust)
// - src/version.ts (UI / Pantallas)
//
// Uso:
//   node scripts/sync-version.mjs 0.2.0     (asigna versión explícita)
//   node scripts/sync-version.mjs           (sincroniza desde package.json)
//   npm version patch | minor | major       (automático vía hook)

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const frontendDir = resolve(here, "..");

const targetVersion = process.argv[2]?.trim();

// 1. Leer package.json
const pkgPath = resolve(frontendDir, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

const newVersion = targetVersion || pkg.version;
if (!/^\d+\.\d+\.\d+.*$/.test(newVersion)) {
  console.error(`Formato de versión semver inválido: "${newVersion}". Ejemplo válido: 0.2.0`);
  process.exit(1);
}

pkg.version = newVersion;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
console.log(`[package.json] -> versión: ${newVersion}`);

// 2. Sincronizar app.json (Expo / Android)
const appJsonPath = resolve(frontendDir, "app.json");
try {
  const appJson = JSON.parse(readFileSync(appJsonPath, "utf8"));
  if (appJson.expo) {
    appJson.expo.version = newVersion;
    if (!appJson.expo.android) appJson.expo.android = {};
    
    // Generar versionCode incremental derivado de semver (ej: 0.1.0 -> 100, 1.2.3 -> 10203)
    const [maj = 0, min = 0, pat = 0] = newVersion.split("-")[0].split(".").map(Number);
    const code = maj * 10000 + min * 100 + pat;
    appJson.expo.android.versionCode = Math.max(code, 1);
  }
  writeFileSync(appJsonPath, JSON.stringify(appJson, null, 2) + "\n");
  console.log(`[app.json] -> versión: ${newVersion} (versionCode: ${appJson.expo?.android?.versionCode})`);
} catch (err) {
  console.warn("No se pudo actualizar app.json:", err.message);
}

// 3. Sincronizar src-tauri/tauri.conf.json (Windows .msi / -setup.exe)
const tauriConfPath = resolve(frontendDir, "src-tauri/tauri.conf.json");
try {
  const tauriConf = JSON.parse(readFileSync(tauriConfPath, "utf8"));
  tauriConf.version = newVersion;
  writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + "\n");
  console.log(`[tauri.conf.json] -> versión: ${newVersion}`);
} catch (err) {
  console.warn("No se pudo actualizar tauri.conf.json:", err.message);
}

// 4. Sincronizar src-tauri/Cargo.toml (Rust crate)
const cargoTomlPath = resolve(frontendDir, "src-tauri/Cargo.toml");
try {
  let cargoContent = readFileSync(cargoTomlPath, "utf8");
  cargoContent = cargoContent.replace(
    /(\[package\][\s\S]*?version\s*=\s*")[^"]+(")/,
    `$1${newVersion}$2`
  );
  writeFileSync(cargoTomlPath, cargoContent);
  console.log(`[Cargo.toml] -> versión: ${newVersion}`);
} catch (err) {
  console.warn("No se pudo actualizar Cargo.toml:", err.message);
}

// 5. Generar src/version.ts para la UI
const versionTsPath = resolve(frontendDir, "src/version.ts");
const versionTsContent = `// AUTO-GENERADO por scripts/sync-version.mjs. No editar manualmente.
export const APP_VERSION = "${newVersion}";
`;
writeFileSync(versionTsPath, versionTsContent);
console.log(`[src/version.ts] -> APP_VERSION = "${newVersion}"`);

console.log(`\n¡Sincronización completada! Versión actual del proyecto: v${newVersion}\n`);
