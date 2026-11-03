import type { SqlDriver, SqlValue } from "./connection";
import { migrateDatabase } from "./migrations";
import { insertProduct, addStockMovement, createCategory } from "./repositories/product.repository";
import { insertRate, getLatestRate } from "./repositories/exchange.repository";
import { openShift, getOpenShift } from "./repositories/shift.repository";

interface RelationalStore {
  license_state: Record<string, SqlValue>[];
  exchange_rates: Record<string, SqlValue>[];
  categories: Record<string, SqlValue>[];
  app_metadata: Record<string, SqlValue>[];
  products: Record<string, SqlValue>[];
  stock_movements: Record<string, SqlValue>[];
  cash_shifts: Record<string, SqlValue>[];
  invoices: Record<string, SqlValue>[];
  invoice_items: Record<string, SqlValue>[];
  peer_sync_outbox: Record<string, SqlValue>[];
}

function createEmptyStore(): RelationalStore {
  return {
    license_state: [],
    exchange_rates: [],
    categories: [],
    app_metadata: [],
    products: [],
    stock_movements: [],
    cash_shifts: [],
    invoices: [],
    invoice_items: [],
    peer_sync_outbox: [],
  };
}

function cloneStore(store: RelationalStore): RelationalStore {
  return JSON.parse(JSON.stringify(store)) as RelationalStore;
}

function toScaledIntE4(deltaStr: SqlValue | undefined): number {
  if (deltaStr === null || deltaStr === undefined) return 0;
  const cleaned = String(deltaStr).replace(".", "");
  const parsed = parseInt(cleaned, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Motor relacional SQLite embebido para Web / Windows Desktop (Tauri)
 * cuando el binario JSI móvil (@op-engineering/op-sqlite) no está presente.
 * Implementa la interfaz SqlDriver respetando integridad referencial, transacciones
 * atómicas y cálculo entero e4 de la vista v_product_current_stock.
 */
export function createWebDesktopSqliteDriver(): SqlDriver {
  let store: RelationalStore = createEmptyStore();

  const computeViewProductCurrentStock = (): Record<string, SqlValue>[] => {
    return store.products
      .filter((p) => Number(p.is_active) === 1)
      .map((p) => {
        const movements = store.stock_movements.filter((sm) => sm.product_id === p.id);
        const sumE4 = movements.reduce((acc, sm) => acc + toScaledIntE4(sm.quantity_delta), 0);
        return {
          product_id: p.id ?? null,
          sku: p.sku ?? null,
          barcode: p.barcode ?? null,
          name: p.name ?? null,
          category_id: p.category_id ?? null,
          price_usd: p.price_usd ?? null,
          cost_usd: p.cost_usd ?? null,
          unit: p.unit ?? "und",
          min_stock: p.min_stock ?? null,
          image_path: p.image_path ?? null,
          current_stock_e4: sumE4,
        };
      });
  };

  const driver: SqlDriver = {
    exec(_sql: string): void {
      // El esquema de tablas ya está estructurado en el store relacional
    },

    run(sql: string, params: SqlValue[] = []): void {
      const norm = sql.replace(/\s+/g, " ").trim();

      // 1. INSERT INTO products
      if (/^INSERT INTO products/i.test(norm)) {
        if (norm.includes("image_path, min_stock, is_active")) {
          // Desde P2P sync
          const [
            id,
            tenant_id,
            category_id,
            barcode,
            sku,
            name,
            price_usd,
            cost_usd,
            tax_rate,
            image_path,
            min_stock,
            is_active,
            created_at,
            updated_at,
          ] = params;
          store.products.push({
            id: id ?? null,
            tenant_id: tenant_id ?? "TENANT-001",
            category_id: category_id ?? null,
            barcode: barcode ?? null,
            sku: sku ?? "",
            name: name ?? "",
            price_usd: price_usd ?? "0.0000",
            cost_usd: cost_usd ?? "0.0000",
            tax_rate: tax_rate ?? "0.1600",
            unit: "und",
            image_path: image_path ?? null,
            min_stock: min_stock ?? "5.0000",
            is_active: is_active ?? 1,
            created_at: created_at ?? Date.now(),
            updated_at: updated_at ?? Date.now(),
          });
        } else if (norm.includes("tax_rate, unit, min_stock")) {
          // Desde insertProduct con unit
          const [
            id,
            tenant_id,
            category_id,
            barcode,
            sku,
            name,
            price_usd,
            cost_usd,
            tax_rate,
            unit,
            min_stock,
            created_at,
            updated_at,
          ] = params;
          store.products.push({
            id: id ?? null,
            tenant_id: tenant_id ?? "TENANT-001",
            category_id: category_id ?? null,
            barcode: barcode ?? null,
            sku: sku ?? "",
            name: name ?? "",
            price_usd: price_usd ?? "0.0000",
            cost_usd: cost_usd ?? "0.0000",
            tax_rate: tax_rate ?? "0.1600",
            unit: unit ?? "und",
            image_path: null,
            min_stock: min_stock ?? "5.0000",
            is_active: 1,
            created_at: created_at ?? Date.now(),
            updated_at: updated_at ?? Date.now(),
          });
        } else {
          // Desde insertProduct legado sin unit
          const [
            id,
            tenant_id,
            category_id,
            barcode,
            sku,
            name,
            price_usd,
            cost_usd,
            tax_rate,
            min_stock,
            created_at,
            updated_at,
          ] = params;
          store.products.push({
            id: id ?? null,
            tenant_id: tenant_id ?? "TENANT-001",
            category_id: category_id ?? null,
            barcode: barcode ?? null,
            sku: sku ?? "",
            name: name ?? "",
            price_usd: price_usd ?? "0.0000",
            cost_usd: cost_usd ?? "0.0000",
            tax_rate: tax_rate ?? "0.1600",
            unit: "und",
            image_path: null,
            min_stock: min_stock ?? "5.0000",
            is_active: 1,
            created_at: created_at ?? Date.now(),
            updated_at: updated_at ?? Date.now(),
          });
        }
        return;
      }

      // 2. UPDATE products
      if (/^UPDATE products SET/i.test(norm)) {
        if (/SET image_path = \?, updated_at = \? WHERE id = \?/i.test(norm)) {
          const [image_path, updated_at, id] = params;
          const row = store.products.find((p) => p.id === id);
          if (row) {
            row.image_path = image_path ?? null;
            row.updated_at = updated_at ?? Date.now();
          }
          return;
        }
        if (/SET image_path = NULL, updated_at = \? WHERE id = \?/i.test(norm)) {
          const [updated_at, id] = params;
          const row = store.products.find((p) => p.id === id);
          if (row) {
            row.image_path = null;
            row.updated_at = updated_at ?? Date.now();
          }
          return;
        }
        if (/SET is_active = \?, updated_at = \? WHERE id = \?/i.test(norm)) {
          const [is_active, updated_at, id] = params;
          const row = store.products.find((p) => p.id === id);
          if (row) {
            row.is_active = is_active ?? 1;
            row.updated_at = updated_at ?? Date.now();
          }
          return;
        }
        if (/SET is_active = 0, updated_at = \? WHERE id = \?/i.test(norm)) {
          const [updated_at, id] = params;
          const row = store.products.find((p) => p.id === id);
          if (row) {
            row.is_active = 0;
            row.updated_at = updated_at ?? Date.now();
          }
          return;
        }
        if (/SET category_id = NULL, updated_at = \? WHERE category_id = \?/i.test(norm)) {
          const [updated_at, category_id] = params;
          for (const row of store.products) {
            if (row.category_id === category_id) {
              row.category_id = null;
              row.updated_at = updated_at ?? Date.now();
            }
          }
          return;
        }
        if (/name = \?, sku = \?, barcode = \?/i.test(norm)) {
          if (norm.includes("tax_rate = ?, unit = ?, min_stock = ?")) {
            const [
              name,
              sku,
              barcode,
              category_id,
              price_usd,
              cost_usd,
              tax_rate,
              unit,
              min_stock,
              image_path,
              updated_at,
              id,
            ] = params;
            const row = store.products.find((p) => p.id === id);
            if (row) {
              row.name = name ?? row.name ?? "";
              row.sku = sku ?? row.sku ?? "";
              row.barcode = barcode ?? null;
              row.category_id = category_id ?? null;
              row.price_usd = price_usd ?? row.price_usd ?? "0.0000";
              row.cost_usd = cost_usd ?? row.cost_usd ?? "0.0000";
              row.tax_rate = tax_rate ?? row.tax_rate ?? "0.1600";
              row.unit = unit ?? row.unit ?? "und";
              row.min_stock = min_stock ?? row.min_stock ?? "5.0000";
              row.image_path = image_path ?? null;
              row.updated_at = updated_at ?? Date.now();
            }
          } else {
            const [
              name,
              sku,
              barcode,
              category_id,
              price_usd,
              cost_usd,
              tax_rate,
              min_stock,
              image_path,
              updated_at,
              id,
            ] = params;
            const row = store.products.find((p) => p.id === id);
            if (row) {
              row.name = name ?? row.name ?? "";
              row.sku = sku ?? row.sku ?? "";
              row.barcode = barcode ?? null;
              row.category_id = category_id ?? null;
              row.price_usd = price_usd ?? row.price_usd ?? "0.0000";
              row.cost_usd = cost_usd ?? row.cost_usd ?? "0.0000";
              row.tax_rate = tax_rate ?? row.tax_rate ?? "0.1600";
              row.min_stock = min_stock ?? row.min_stock ?? "5.0000";
              row.image_path = image_path ?? null;
              row.updated_at = updated_at ?? Date.now();
            }
          }
          return;
        }
      }

      // 3. INSERT / DELETE categories
      if (/^INSERT INTO categories/i.test(norm)) {
        const [id, name, created_at] = params;
        store.categories.push({
          id: id ?? null,
          name: name ?? "",
          created_at: created_at ?? Date.now(),
        });
        return;
      }
      if (/^DELETE FROM categories WHERE id = \?/i.test(norm)) {
        const [id] = params;
        store.categories = store.categories.filter((c) => c.id !== id);
        return;
      }

      // 4. INSERT INTO stock_movements
      if (/^INSERT INTO stock_movements/i.test(norm)) {
        const [id, product_id, terminal_id, quantity_delta, movement_type, reference_id, created_at] =
          params;
        store.stock_movements.push({
          id: id ?? null,
          product_id: product_id ?? null,
          terminal_id: terminal_id ?? "TERM-01",
          quantity_delta: quantity_delta ?? "0.0000",
          movement_type: movement_type ?? "ADJUSTMENT",
          reference_id: reference_id ?? null,
          created_at: created_at ?? Date.now(),
        });
        return;
      }

      // 5. INSERT INTO exchange_rates
      if (/^INSERT INTO exchange_rates/i.test(norm)) {
        const [id, rate_date, rate_to_ves, source, fetched_at, notes, created_at] = params;
        const existingIdx = store.exchange_rates.findIndex(
          (r) => r.rate_date === rate_date && r.currency_code === "USD",
        );
        const record = {
          id: id ?? null,
          rate_date: rate_date ?? "",
          currency_code: "USD",
          rate_to_ves: rate_to_ves ?? "36.5000",
          source: source ?? "MANUAL",
          fetched_at: fetched_at ?? Date.now(),
          notes: notes ?? null,
          created_at: created_at ?? Date.now(),
        };
        if (existingIdx >= 0) {
          store.exchange_rates[existingIdx] = record;
        } else {
          store.exchange_rates.push(record);
        }
        return;
      }

      // 6. INSERT INTO cash_shifts
      if (/^INSERT INTO cash_shifts/i.test(norm)) {
        const [id, terminal_id, cashier_name, opened_at, exchange_rate_applied, initial_cash_usd, initial_cash_ves] =
          params;
        store.cash_shifts.push({
          id: id ?? null,
          terminal_id: terminal_id ?? "TERM-01",
          cashier_name: cashier_name ?? "Cajero",
          opened_at: opened_at ?? Date.now(),
          closed_at: null,
          exchange_rate_applied: exchange_rate_applied ?? "36.5000",
          initial_cash_usd: initial_cash_usd ?? "0.0000",
          initial_cash_ves: initial_cash_ves ?? "0.0000",
          expected_cash_usd: null,
          expected_cash_ves: null,
          declared_cash_usd: null,
          declared_cash_ves: null,
          difference_usd: null,
          difference_ves: null,
          status: "OPEN",
        });
        return;
      }

      // 7. UPDATE cash_shifts
      if (/^UPDATE cash_shifts SET/i.test(norm)) {
        const [
          closed_at,
          expected_cash_usd,
          expected_cash_ves,
          declared_cash_usd,
          declared_cash_ves,
          difference_usd,
          difference_ves,
          id,
        ] = params;
        const shift = store.cash_shifts.find((s) => s.id === id);
        if (shift) {
          shift.closed_at = closed_at ?? Date.now();
          shift.status = "CLOSED";
          shift.expected_cash_usd = expected_cash_usd ?? "0.0000";
          shift.expected_cash_ves = expected_cash_ves ?? "0.0000";
          shift.declared_cash_usd = declared_cash_usd ?? "0.0000";
          shift.declared_cash_ves = declared_cash_ves ?? "0.0000";
          shift.difference_usd = difference_usd ?? "0.0000";
          shift.difference_ves = difference_ves ?? "0.0000";
        }
        return;
      }

      // 8. INSERT INTO invoices
      if (/^INSERT INTO invoices/i.test(norm)) {
        const [
          id,
          shift_id,
          terminal_id,
          invoice_number,
          exchange_rate,
          subtotal_usd,
          tax_usd,
          total_usd,
          subtotal_ves,
          tax_ves,
          total_ves,
          payment_method,
          payment_breakdown,
          created_at,
        ] = params;
        store.invoices.push({
          id: id ?? null,
          shift_id: shift_id ?? null,
          terminal_id: terminal_id ?? "TERM-01",
          invoice_number: invoice_number ?? "TERM01-000001",
          exchange_rate: exchange_rate ?? "36.5000",
          subtotal_usd: subtotal_usd ?? "0.0000",
          tax_usd: tax_usd ?? "0.0000",
          total_usd: total_usd ?? "0.0000",
          subtotal_ves: subtotal_ves ?? "0.0000",
          tax_ves: tax_ves ?? "0.0000",
          total_ves: total_ves ?? "0.0000",
          payment_method: payment_method ?? "CASH_USD",
          payment_breakdown: payment_breakdown ?? null,
          status: "COMPLETED",
          voided_at: null,
          void_reason: null,
          created_at: created_at ?? Date.now(),
        });
        return;
      }

      if (/^UPDATE invoices SET status = 'VOID'/i.test(norm)) {
        const [voided_at, void_reason, id] = params;
        const inv = store.invoices.find((i) => i.id === id);
        if (inv) {
          inv.status = "VOID";
          inv.voided_at = voided_at ?? Date.now();
          inv.void_reason = void_reason ?? "";
        }
        return;
      }

      // 9. INSERT INTO invoice_items
      if (/^INSERT INTO invoice_items/i.test(norm)) {
        const [
          id,
          invoice_id,
          product_id,
          quantity,
          unit_price_usd,
          line_total_usd,
          unit_price_ves,
          line_total_ves,
          tax_rate,
        ] = params;
        store.invoice_items.push({
          id: id ?? null,
          invoice_id: invoice_id ?? null,
          product_id: product_id ?? null,
          quantity: quantity ?? "1.0000",
          unit_price_usd: unit_price_usd ?? "0.0000",
          line_total_usd: line_total_usd ?? "0.0000",
          unit_price_ves: unit_price_ves ?? "0.0000",
          line_total_ves: line_total_ves ?? "0.0000",
          tax_rate: tax_rate ?? "0.1600",
        });
        return;
      }

      // 10. INSERT INTO peer_sync_outbox
      if (/^INSERT INTO peer_sync_outbox/i.test(norm)) {
        const [id, origin_terminal_id, entity_type, entity_id, action, payload, created_at] = params;
        store.peer_sync_outbox.push({
          id: id ?? null,
          origin_terminal_id: origin_terminal_id ?? "TERM-01",
          entity_type: entity_type ?? "PRODUCT",
          entity_id: entity_id ?? "",
          action: action ?? "UPSERT",
          payload: payload ?? "{}",
          created_at: created_at ?? Date.now(),
          replicated_peers: "[]",
        });
        return;
      }

      // 11. UPDATE peer_sync_outbox
      if (/^UPDATE peer_sync_outbox SET replicated_peers/i.test(norm)) {
        const [replicated_peers, id] = params;
        const item = store.peer_sync_outbox.find((o) => o.id === id);
        if (item) {
          item.replicated_peers = replicated_peers ?? "[]";
        }
        return;
      }
    },

    all<T = Record<string, SqlValue>>(sql: string, params: SqlValue[] = []): T[] {
      const norm = sql.replace(/\s+/g, " ").trim();

      // 1. Consulta enriquecida listInventoryWithStock (JOIN categories + stock_movements)
      if (norm.includes("FROM products p") && norm.includes("LEFT JOIN stock_movements sm")) {
        let idx = 0;
        const filterTenant = norm.includes("p.tenant_id = ?") ? params[idx++] : undefined;
        const filterCat = norm.includes("p.category_id = ?") ? params[idx++] : undefined;

        const rows = store.products
          .filter((p) => {
            if (Number(p.is_active) !== 1) return false;
            if (filterTenant !== undefined && p.tenant_id !== filterTenant) return false;
            if (filterCat !== undefined && p.category_id !== filterCat) return false;
            return true;
          })
          .map((p) => {
            const cat = store.categories.find((c) => c.id === p.category_id);
            const movements = store.stock_movements.filter((sm) => sm.product_id === p.id);
            const sumE4 = movements.reduce((acc, sm) => acc + toScaledIntE4(sm.quantity_delta), 0);
            return {
              id: p.id,
              tenant_id: p.tenant_id,
              sku: p.sku,
              barcode: p.barcode,
              name: p.name,
              category_id: p.category_id,
              category_name: cat ? cat.name : null,
              price_usd: p.price_usd,
              cost_usd: p.cost_usd,
              tax_rate: p.tax_rate,
              image_path: p.image_path,
              unit: p.unit ?? "und",
              min_stock: p.min_stock,
              is_active: p.is_active,
              updated_at: p.updated_at,
              current_stock_e4: sumE4,
            };
          })
          .sort((a, b) => String(a.name).localeCompare(String(b.name)));

        return rows as unknown as T[];
      }

      // 2. Vista v_product_current_stock
      if (norm.includes("FROM v_product_current_stock")) {
        const viewRows = computeViewProductCurrentStock();
        if (norm.includes("WHERE product_id = ?")) {
          return viewRows.filter((r) => r.product_id === params[0]) as unknown as T[];
        }
        return viewRows as unknown as T[];
      }

      // 3. Consultas sobre products
      if (norm.includes("FROM products")) {
        if (/WHERE sku = \? AND id != \?/i.test(norm)) {
          return store.products.filter(
            (p) => p.sku === params[0] && p.id !== params[1],
          ) as unknown as T[];
        }
        if (/WHERE barcode = \? AND id != \?/i.test(norm)) {
          return store.products.filter(
            (p) => p.barcode === params[0] && p.id !== params[1],
          ) as unknown as T[];
        }
        if (/WHERE barcode = \? AND tenant_id = \? AND is_active = 1/i.test(norm)) {
          return store.products.filter(
            (p) => p.barcode === params[0] && p.tenant_id === params[1] && Number(p.is_active) === 1,
          ) as unknown as T[];
        }
        if (/WHERE barcode = \? AND is_active = 1/i.test(norm)) {
          return store.products.filter(
            (p) => p.barcode === params[0] && Number(p.is_active) === 1,
          ) as unknown as T[];
        }
        if (/WHERE sku = \? AND tenant_id = \? AND is_active = 1/i.test(norm)) {
          return store.products.filter(
            (p) => p.sku === params[0] && p.tenant_id === params[1] && Number(p.is_active) === 1,
          ) as unknown as T[];
        }
        if (/WHERE sku = \? AND is_active = 1/i.test(norm)) {
          return store.products.filter(
            (p) => p.sku === params[0] && Number(p.is_active) === 1,
          ) as unknown as T[];
        }
        if (/WHERE sku = \?/i.test(norm)) {
          return store.products.filter((p) => p.sku === params[0]) as unknown as T[];
        }
        if (/WHERE barcode = \?/i.test(norm)) {
          return store.products.filter((p) => p.barcode === params[0]) as unknown as T[];
        }
        if (/WHERE id = \?/i.test(norm)) {
          return store.products.filter((p) => p.id === params[0]) as unknown as T[];
        }
        if (/WHERE is_active = 1/i.test(norm)) {
          return store.products
            .filter((p) => Number(p.is_active) === 1)
            .sort((a, b) => String(a.name).localeCompare(String(b.name))) as unknown as T[];
        }
      }

      // 4. Categorías
      if (norm.includes("FROM categories")) {
        return [...store.categories].sort((a, b) =>
          String(a.name).localeCompare(String(b.name)),
        ) as unknown as T[];
      }

      // 5. Kardex (stock_movements)
      if (norm.includes("FROM stock_movements")) {
        if (norm.includes("WHERE product_id = ?")) {
          const [productId, limit] = params;
          const filtered = store.stock_movements
            .filter((sm) => sm.product_id === productId)
            .sort((a, b) => Number(b.created_at) - Number(a.created_at));
          return (limit ? filtered.slice(0, Number(limit)) : filtered) as unknown as T[];
        }
        if (norm.includes("WHERE id = ?")) {
          return store.stock_movements.filter((sm) => sm.id === params[0]) as unknown as T[];
        }
      }

      // 6. Tasas de cambio (exchange_rates)
      if (norm.includes("FROM exchange_rates")) {
        if (norm.includes("WHERE rate_date = ?")) {
          return store.exchange_rates.filter((r) => r.rate_date === params[0]) as unknown as T[];
        }

          let list = [...store.exchange_rates];
        if (norm.includes("rate_date >=")) {
          const startVal = params[0] as string;
          list = list.filter((r) => String(r.rate_date) >= startVal);
        }
        if (norm.includes("rate_date <=")) {
          const endParamIdx = norm.includes("rate_date >=") ? 1 : 0;
          const endVal = params[endParamIdx] as string;
          list = list.filter((r) => String(r.rate_date) <= endVal);
        }

        const isAsc = norm.includes("ORDER BY rate_date ASC");
        list.sort((a, b) =>
          isAsc
            ? String(a.rate_date).localeCompare(String(b.rate_date))
            : String(b.rate_date).localeCompare(String(a.rate_date)),
        );

        if (norm.includes("LIMIT 1")) {
          return list.slice(0, 1) as unknown as T[];
        }
        if (norm.includes("LIMIT ?")) {
          const limitVal = Number(params[params.length - 1]);
          if (!isNaN(limitVal)) {
            list = list.slice(0, limitVal);
          }
        }
        return list as unknown as T[];
      }

      // 7. Turnos de caja (cash_shifts)
      if (norm.includes("FROM cash_shifts")) {
        if (norm.includes("WHERE terminal_id = ? AND status = 'OPEN'")) {
          const open = store.cash_shifts
            .filter((s) => s.terminal_id === params[0] && s.status === "OPEN")
            .sort((a, b) => Number(b.opened_at) - Number(a.opened_at));
          return open.slice(0, 1) as unknown as T[];
        }
        if (norm.includes("WHERE id = ?")) {
          return store.cash_shifts.filter((s) => s.id === params[0]) as unknown as T[];
        }
      }

      // 8. Facturas e items (invoices / invoice_items)
      if (norm.includes("FROM invoice_items ii JOIN products p")) {
        const invoiceIdSet = new Set(params.map(String));
        return store.invoice_items
          .filter((ii) => invoiceIdSet.has(String(ii.invoice_id)))
          .map((ii) => {
            const prod = store.products.find((p) => p.id === ii.product_id);
            return {
              product_id: ii.product_id,
              sku: prod?.sku ?? "SKU",
              name: prod?.name ?? "Producto",
              cost_usd: prod?.cost_usd ?? "0.0000",
              quantity: ii.quantity,
              line_total_usd: ii.line_total_usd,
              line_total_ves: ii.line_total_ves,
            };
          }) as unknown as T[];
      }

      if (norm.includes("FROM invoice_items WHERE invoice_id = ?")) {
        return store.invoice_items.filter((ii) => ii.invoice_id === params[0]) as unknown as T[];
      }

      if (norm.includes("SELECT COUNT(*) as count FROM invoices WHERE terminal_id = ?")) {
        const count = store.invoices.filter((i) => i.terminal_id === params[0]).length;
        return [{ count }] as unknown as T[];
      }

      if (norm.includes("FROM invoices")) {
        if (norm.includes("WHERE shift_id = ?")) {
          return store.invoices.filter((i) => i.shift_id === params[0]) as unknown as T[];
        }
        if (norm.includes("WHERE id = ?")) {
          return store.invoices.filter((i) => i.id === params[0]) as unknown as T[];
        }
        let idx = 0;
        const fromTs = norm.includes("created_at >= ?") ? Number(params[idx++]) : undefined;
        const toTs = norm.includes("created_at <= ?") ? Number(params[idx++]) : undefined;
        const termId = norm.includes("terminal_id = ?") ? String(params[idx++]) : undefined;

        return store.invoices
          .filter((inv) => {
            const ts = Number(inv.created_at);
            if (fromTs !== undefined && ts < fromTs) return false;
            if (toTs !== undefined && ts > toTs) return false;
            if (termId !== undefined && inv.terminal_id !== termId) return false;
            return true;
          })
          .sort((a, b) => Number(a.created_at) - Number(b.created_at)) as unknown as T[];
      }

      // 9. Outbox P2P (peer_sync_outbox)
      if (norm.includes("SELECT COUNT(*) as count FROM peer_sync_outbox")) {
        return [{ count: store.peer_sync_outbox.length }] as unknown as T[];
      }

      if (norm.includes("FROM peer_sync_outbox")) {
        if (norm.includes("WHERE id = ?")) {
          return store.peer_sync_outbox.filter((o) => o.id === params[0]) as unknown as T[];
        }
        return [...store.peer_sync_outbox].sort(
          (a, b) => Number(a.created_at) - Number(b.created_at),
        ) as unknown as T[];
      }

      // 10. Licenciamiento (license_state)
      if (norm.includes("FROM license_state")) {
        return store.license_state.filter((l) => l.id === "current_license") as unknown as T[];
      }

      return [];
    },

    transaction<T>(fn: () => T): T {
      const snapshot = cloneStore(store);
      try {
        return fn();
      } catch (err) {
        store = snapshot;
        throw err;
      }
    },
  };

  return driver;
}

/**
 * Inicializa datos semilla por defecto (categorías, productos con Kardex, tasa BCV y turno activo)
 * cuando la base de datos local recién se crea en el dispositivo.
 */
export function seedInitialPosData(
  db: SqlDriver,
  opts: { tenantId?: string; terminalId?: string } = {},
): void {
  const tenantId = opts.tenantId ?? "TENANT-001";
  const terminalId = opts.terminalId ?? "TERM-01";
  const now = Date.now();

  migrateDatabase(db);

  // 1. Semilla de tasa oficial BCV si no hay ninguna
  if (!getLatestRate(db)) {
    const todayIso = new Date(now).toISOString().split("T")[0]!;
    insertRate(db, todayIso, "36.5000", "BCV_AUTO", "Tasa inicial de referencia BCV", now);
  }

  // 2. Semilla de productos e inventario inicial por deltas si el catálogo está vacío
  const existingProducts = db.all<{ id: string }>("SELECT id FROM products WHERE is_active = 1");
  if (existingProducts.length === 0) {
    const catViveres = createCategory(db, "Víveres", now);
    const catGranos = createCategory(db, "Granos", now + 1);
    const catAceites = createCategory(db, "Aceites", now + 2);
    const catBebidas = createCategory(db, "Bebidas", now + 3);

    const initialCatalog = [
      {
        sku: "HAR-01",
        barcode: "75910001",
        name: "Harina PAN 1kg",
        categoryId: catViveres,
        priceUsd: "1.2500",
        costUsd: "0.9500",
        unit: "paq",
        minStock: "5.0000",
        initialStock: "24.0000",
      },
      {
        sku: "ARR-02",
        barcode: "75910002",
        name: "Arroz Primor 1kg",
        categoryId: catGranos,
        priceUsd: "1.5000",
        costUsd: "1.1000",
        unit: "kg",
        minStock: "5.0000",
        initialStock: "4.0000",
      },
      {
        sku: "ACE-03",
        barcode: "75910003",
        name: "Aceite Mazeite 1L",
        categoryId: catAceites,
        priceUsd: "3.8000",
        costUsd: "2.9000",
        unit: "l",
        minStock: "5.0000",
        initialStock: "12.0000",
      },
      {
        sku: "CAF-04",
        barcode: "75910004",
        name: "Café Fama de América 500g",
        categoryId: catBebidas,
        priceUsd: "4.2000",
        costUsd: "3.1000",
        unit: "paq",
        minStock: "5.0000",
        initialStock: "18.0000",
      },
      {
        sku: "PAS-05",
        barcode: "75910005",
        name: "Pasta Primor Corta 1kg",
        categoryId: catViveres,
        priceUsd: "1.7500",
        costUsd: "1.2500",
        unit: "paq",
        minStock: "5.0000",
        initialStock: "30.0000",
      },
      {
        sku: "AZU-06",
        barcode: "75910006",
        name: "Azúcar Montalbán 1kg",
        categoryId: catViveres,
        priceUsd: "1.3500",
        costUsd: "0.9800",
        unit: "kg",
        minStock: "5.0000",
        initialStock: "20.0000",
      },
    ];

    initialCatalog.forEach((item, index) => {
      const prodId = insertProduct(
        db,
        {
          tenantId,
          sku: item.sku,
          barcode: item.barcode,
          name: item.name,
          categoryId: item.categoryId,
          priceUsd: item.priceUsd,
          costUsd: item.costUsd,
          unit: item.unit,
          minStock: item.minStock,
        },
        now + 10 + index,
        terminalId,
      );

      addStockMovement(
        db,
        {
          productId: prodId,
          terminalId,
          delta: item.initialStock,
          type: "RESTOCK",
          referenceId: "Inventario Inicial Apertura",
        },
        now + 50 + index,
      );
    });
  }

  // 3. Semilla de turno abierto por defecto para permitir cobros inmediatos
  if (!getOpenShift(db, terminalId)) {
    openShift(
      db,
      {
        terminalId,
        cashierName: "Erick (C01)",
        exchangeRateApplied: "36.5000",
        initialCashUsd: "50.0000",
        initialCashVes: "1825.0000",
      },
      now + 100,
    );
  }
}

