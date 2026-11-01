// Genera src/database/schema.generated.ts desde docs/database_schema.sql (fuente única del DDL).
// Metro no importa .sql, por eso el esquema se embebe como string TypeScript.
// Uso: npm run gen:schema   (tests/schema.test.ts verifica que esté sincronizado)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(resolve(here, "../../docs/database_schema.sql"), "utf8").replace(/\r\n/g, "\n");
const out = `// AUTO-GENERADO por scripts/gen-schema.mjs desde docs/database_schema.sql. No editar.\nexport const SCHEMA_SQL = ${JSON.stringify(sql)};\n`;
writeFileSync(resolve(here, "../src/database/schema.generated.ts"), out);

