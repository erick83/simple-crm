import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getAppEnvironment,
  isDevEnvironment,
  isProdEnvironment,
  isTestEnvironment,
  setEnvironmentOverride,
  shouldRunMigrations,
} from "../src/utils/env";
import { BackupService } from "../src/services/backup.service";
import { createWebDesktopSqliteDriver, seedInitialPosData } from "../src/database/web-sqlite-driver";
import { createDefaultSqlDriver } from "../src/database/connection";

describe("Diferenciación de Entornos (Dev vs Prod)", () => {
  afterEach(() => {
    setEnvironmentOverride(null);
  });

  it("detecta entorno de prueba por defecto en ejecución vitest", () => {
    setEnvironmentOverride(null);
    expect(isTestEnvironment()).toBe(true);
    expect(shouldRunMigrations()).toBe(true);
  });

  it("permite forzar entorno de producción y bloquea migraciones automáticas", () => {
    setEnvironmentOverride("production");
    expect(getAppEnvironment()).toBe("production");
    expect(isProdEnvironment()).toBe(true);
    expect(isDevEnvironment()).toBe(false);
    expect(shouldRunMigrations()).toBe(false);
    // Pero si se fuerza explícitamente, debe permitirlo
    expect(shouldRunMigrations({ force: true })).toBe(true);
  });

  it("permite forzar entorno de desarrollo y habilita migraciones automáticas", () => {
    setEnvironmentOverride("development");
    expect(getAppEnvironment()).toBe("development");
    expect(isDevEnvironment()).toBe(true);
    expect(isProdEnvironment()).toBe(false);
    expect(shouldRunMigrations()).toBe(true);
  });

  it("createDefaultSqlDriver respeta runMigrations=false en producción", () => {
    const driver = createDefaultSqlDriver({ runMigrations: false, seedIfEmpty: false });
    expect(driver).toBeDefined();
    // En producción debe existir el schema base pero no los productos semilla de prueba
    const products = driver.all("SELECT * FROM products");
    expect(products.length).toBe(0);
  });
});

describe("Servicio de Copias de Seguridad (BackupService)", () => {
  let db: ReturnType<typeof createWebDesktopSqliteDriver>;

  beforeEach(() => {
    db = createWebDesktopSqliteDriver();
    seedInitialPosData(db);
  });

  it("genera una copia de seguridad válida con metadatos y registros", () => {
    const backup = BackupService.createBackup(db, {
      tenantId: "TENANT-TEST",
      terminalId: "TERM-99",
      createdBy: "Operador Test",
    });

    expect(backup.format).toBe("bisync_pos_backup_v1");
    expect(backup.tenantId).toBe("TENANT-TEST");
    expect(backup.terminalId).toBe("TERM-99");
    expect(backup.createdBy).toBe("Operador Test");
    expect(backup.totalRecords).toBeGreaterThan(0);
    expect(backup.tables.products?.length).toBeGreaterThan(0);
    expect(backup.tables.categories?.length).toBeGreaterThan(0);
  });

  it("restablece la base de datos a valores de fábrica conservando el admin inicial", () => {
    const resetResult = BackupService.resetDatabase(db);
    expect(resetResult.success).toBe(true);

    const products = db.all("SELECT * FROM products");
    expect(products.length).toBe(0);

    const operators = db.all<{ role: string }>("SELECT * FROM operators");
    expect(operators.length).toBe(1);
    expect(operators[0]?.role).toBe("ADMIN");
  });

  it("restaura una copia de seguridad exitosamente reemplazando los datos", () => {
    const originalBackup = BackupService.createBackup(db);
    const initialProductCount = originalBackup.tables.products?.length ?? 0;
    expect(initialProductCount).toBeGreaterThan(0);

    // Vaciamos la BD
    BackupService.resetDatabase(db);
    expect(db.all("SELECT * FROM products").length).toBe(0);

    // Restauramos desde el backup generado
    const restoreResult = BackupService.restoreBackup(db, originalBackup);
    expect(restoreResult.success).toBe(true);
    expect(restoreResult.restoredCount).toBeGreaterThan(0);

    const restoredProducts = db.all("SELECT * FROM products");
    expect(restoredProducts.length).toBe(initialProductCount);
  });

  it("rechaza archivos de respaldo corruptos o con formato inválido", () => {
    const invalidJsonResult = BackupService.restoreBackup(db, "{ esto no es json válido }");
    expect(invalidJsonResult.success).toBe(false);

    const invalidStructureResult = BackupService.restoreBackup(db, JSON.stringify({ format: "invalido" }));
    expect(invalidStructureResult.success).toBe(false);
  });
});
