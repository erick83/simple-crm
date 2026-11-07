// Planifica o acumula cambios en el Release Candidate PR
// Uso: node scripts/plan-release.mjs --label release:minor --title "Agregar backup" --pr 15 --author "erick83"

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const frontendDir = resolve(here, "..");
const rootDir = resolve(frontendDir, "..");

function parseArgs() {
  const args = process.argv.slice(2);
  const params = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace(/^--/, "");
    const val = args[i + 1];
    if (key && val) params[key] = val;
  }
  return params;
}

const args = parseArgs();
const label = args.label?.trim() || "";
const prNumber = args.pr || "";
const prTitle = args.title || "Cambios varios";
const prAuthor = args.author || "colaborador";
const prUrl = args.url || "";

// 1. Determinar el impacto de versión
let impact = "patch"; // Fallback por defecto (Opción 2)
if (label === "skip-release") {
  console.log("Etiqueta 'skip-release' detectada. Omitiendo incremento de versión.");
  process.exit(0);
} else if (label === "release:major") {
  impact = "major";
} else if (label === "release:minor") {
  impact = "minor";
} else if (label === "release:patch") {
  impact = "patch";
} else {
  console.log("No se detectó etiqueta de versión. Aplicando fallback por defecto a: patch");
  impact = "patch";
}

// 2. Leer versión actual de package.json
const pkgPath = resolve(frontendDir, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const currentVersion = pkg.version || "0.1.0";

const [majStr = "0", minStr = "1", patStr = "0"] = currentVersion.split("-")[0].split(".");
let major = parseInt(majStr, 10);
let minor = parseInt(minStr, 10);
let patch = parseInt(patStr, 10);

if (impact === "major") {
  major += 1;
  minor = 0;
  patch = 0;
} else if (impact === "minor") {
  minor += 1;
  patch = 0;
} else {
  patch += 1;
}

const targetVersion = `${major}.${minor}.${patch}`;
console.log(`Versión calculada: ${currentVersion} ➔ ${targetVersion} (${impact.toUpperCase()})`);

// 3. Sincronizar todos los archivos con sync-version.mjs
const syncScriptPath = resolve(here, "sync-version.mjs");
const { spawnSync } = await import("node:child_process");
const syncResult = spawnSync(process.execPath, [syncScriptPath, targetVersion], {
  cwd: frontendDir,
  stdio: "inherit",
});

if (syncResult.status !== 0) {
  console.error("Error ejecutando sync-version.mjs");
  process.exit(syncResult.status || 1);
}

// 4. Actualizar CHANGELOG.md en la raíz del repositorio
const changelogPath = resolve(rootDir, "CHANGELOG.md");
const dateIso = new Date().toISOString().split("T")[0];
const entryLine = `* ${prTitle} ([#${prNumber}](${prUrl})) por @${prAuthor}`;

let changelogContent = existsSync(changelogPath)
  ? readFileSync(changelogPath, "utf8")
  : "# Registro de Cambios (Changelog)\n\n";

const versionHeader = `## [v${targetVersion}] - ${dateIso}`;

if (changelogContent.includes(`## [v${targetVersion}]`)) {
  // Agregar la línea bajo el encabezado existente
  changelogContent = changelogContent.replace(
    new RegExp(`(## \\[v${targetVersion}\\][^\\n]*\\n)`),
    `$1${entryLine}\n`
  );
} else {
  // Insertar nueva sección al inicio del changelog
  changelogContent = changelogContent.replace(
    /(# Registro de Cambios[^\n]*\n\n?)/,
    `$1${versionHeader}\n\n${entryLine}\n\n`
  );
}

writeFileSync(changelogPath, changelogContent);
console.log(`[CHANGELOG.md] Entrada agregada para v${targetVersion}: "${prTitle}"`);
