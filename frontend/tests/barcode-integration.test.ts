import { describe, it, expect, vi } from "vitest";
import { createTestDb } from "./helpers";
import { insertProduct, getProductByBarcode } from "../src/database/repositories/product.repository";
import { uuidv7 } from "../src/utils/uuid7";
import {
  createBarcodeListener,
  attachBarcodeListener,
  findProductByBarcode,
  Cart,
  scanToCart,
} from "../src/services/barcode-scanner.service";
import type { KeyEventTargetLike } from "../src/services/barcode-scanner.service";

class MockKeyEventTarget implements KeyEventTargetLike {
  private listeners: Array<(e: { key: string; timeStamp: number }) => void> = [];

  addEventListener(eventType: "keydown", cb: (e: { key: string; timeStamp: number }) => void): void {
    this.listeners.push(cb);
  }

  removeEventListener(eventType: "keydown", cb: (e: { key: string; timeStamp: number }) => void): void {
    this.listeners = this.listeners.filter((l) => l !== cb);
  }

  emitKey(key: string, timeStamp: number): void {
    for (const l of this.listeners) {
      l({ key, timeStamp });
    }
  }

  emitBurst(barcode: string, gapMs = 5, startTs = 1000): number {
    let t = startTs;
    for (const char of barcode) {
      this.emitKey(char, t);
      t += gapMs;
    }
    this.emitKey("Enter", t);
    return t;
  }
}

describe("PR-15: Integración Reactiva del Lector de Código de Barras (HID) en Inventario y POS", () => {
  const TENANT = uuidv7();

  it("el listener global intercepta ráfagas HID (<30 ms) y rechaza tecleo humano lento (>30 ms)", () => {
    const target = new MockKeyEventTarget();
    const scans: string[] = [];

    const off = attachBarcodeListener(target, {
      onScan: (code) => scans.push(code),
      maxGapMs: 30,
      minLength: 4,
    });

    // 1. Ráfaga rápida típica de lector USB/Bluetooth (5 ms por tecla)
    target.emitBurst("75910001", 5, 1000);
    expect(scans).toEqual(["75910001"]);

    // 2. Tecleo humano lento (100 ms entre teclas): no debe disparar onScan
    scans.length = 0;
    target.emitBurst("75910001", 100, 2000);
    expect(scans).toHaveLength(0);

    off();
  });

  it("en POS: el escaneo por lector HID busca en SQLite y añade el producto al carrito en <10 ms", () => {
    const db = createTestDb();
    const target = new MockKeyEventTarget();
    const cart = new Cart();

    insertProduct(db, {
      tenantId: TENANT,
      sku: "HAR-01",
      barcode: "75910001",
      name: "Harina PAN 1kg",
      priceUsd: "1.2500",
      costUsd: "0.9500",
    });

    // Conectar el listener del POS al target de teclado
    const off = attachBarcodeListener(target, {
      onScan: (scannedCode) => {
        scanToCart(db, cart, scannedCode);
      },
    });

    // Simular ráfaga de escaneo del lector HID
    const t0 = performance.now();
    target.emitBurst("75910001", 3);
    const elapsed = performance.now() - t0;

    expect(elapsed).toBeLessThan(10);
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]?.sku).toBe("HAR-01");
    expect(cart.lines[0]?.name).toBe("Harina PAN 1kg");
    expect(cart.lines[0]?.quantity).toBe("1");

    // Segundo escaneo del mismo producto acumula cantidad reactivamente
    target.emitBurst("75910001", 3, 2000);
    expect(cart.lines[0]?.quantity).toBe("2");

    off();
  });

  it("en Inventario: el escaneo por lector HID autocompleta el campo de código de barras en el formulario o busca el producto", () => {
    const db = createTestDb();
    const target = new MockKeyEventTarget();

    insertProduct(db, {
      tenantId: TENANT,
      sku: "ARR-02",
      barcode: "75910002",
      name: "Arroz Primor 1kg",
      priceUsd: "1.5000",
      costUsd: "1.1000",
    });

    // Estado simulado de la pantalla de Inventario
    let isModalOpen = false;
    let formBarcode = "";
    let searchFilter = "";

    const off = attachBarcodeListener(target, {
      onScan: (scannedCode) => {
        if (isModalOpen) {
          // (1) Si el modal está abierto: asigna directamente el código al formulario
          formBarcode = scannedCode;
        } else {
          // (2) Si está en la lista: filtra y busca el producto
          searchFilter = scannedCode;
        }
      },
    });

    // Escenario 1: Usuario en la lista escanea un producto existente
    isModalOpen = false;
    target.emitBurst("75910002", 4);
    expect(searchFilter).toBe("75910002");
    const found = getProductByBarcode(db, searchFilter);
    expect(found?.name).toBe("Arroz Primor 1kg");

    // Escenario 2: Usuario abre el modal de Crear/Editar Producto y usa la pistola para capturar el código
    isModalOpen = true;
    target.emitBurst("75999999", 4, 3000);
    expect(formBarcode).toBe("75999999");

    off();
  });

  it("descarta códigos demasiado cortos (<4 caracteres) o ráfagas interrumpidas por teclas de control", () => {
    const target = new MockKeyEventTarget();
    const scans: string[] = [];

    const off = attachBarcodeListener(target, {
      onScan: (code) => scans.push(code),
      minLength: 4,
    });

    // Código de 2 caracteres: ignorado
    target.emitBurst("12", 5, 1000);
    expect(scans).toHaveLength(0);

    // Secuencia interrumpida con tecla Escape o Shift
    target.emitKey("1", 2000);
    target.emitKey("2", 2005);
    target.emitKey("Escape", 2010);
    target.emitKey("3", 2015);
    target.emitKey("4", 2020);
    target.emitKey("Enter", 2025);
    expect(scans).toHaveLength(0);

    // Nueva ráfaga limpia
    target.emitBurst("987654", 5, 3000);
    expect(scans).toEqual(["987654"]);

    off();
  });
});
