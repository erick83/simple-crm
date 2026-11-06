-- =============================================================================
-- ESQUEMA COMPLETO SQLITE: SISTEMA POS LOCAL-FIRST P2P (VENEZUELA READY)
-- Compatible con SQLite 3.38+ / op-sqlite / react-native-quick-sqlite
-- =============================================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- -----------------------------------------------------------------------------
-- 1. CONTROL DE LICENCIAMIENTO, IDENTIDAD Y HARDWARE (OFFLINE-FIRST)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS license_state (
    id TEXT PRIMARY KEY,                       -- Constante: 'current_license'
    tenant_id TEXT NOT NULL,                   -- UUIDv7 del comercio
    branch_id TEXT NOT NULL,                   -- UUIDv7 de la sede
    terminal_id TEXT NOT NULL,                 -- Identificador asignado a la caja
    hwid TEXT NOT NULL,                        -- Hash Hardware ID (Motherboard + CPU)
    raw_license_token TEXT NOT NULL,           -- JSON completo firmado
    issued_at INTEGER NOT NULL,                -- Timestamp Unix de emisión
    valid_until INTEGER NOT NULL,              -- Timestamp Unix de expiración pagada
    grace_period_days INTEGER NOT NULL DEFAULT 3,
    last_recorded_timestamp INTEGER NOT NULL,  -- Guardia de reloj monótono anti-fraude
    p2p_sync_enabled INTEGER NOT NULL DEFAULT 1, -- 1=Habilitado, 0=Bloqueado
    status TEXT NOT NULL DEFAULT 'ACTIVE'      -- 'ACTIVE', 'GRACE', 'EXPIRED', 'TAMPERED'
);

-- -----------------------------------------------------------------------------
-- 2. HISTÓRICO DE TASAS DE CAMBIO (EXCLUSIVO VENEZUELA / BIMONEDA)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exchange_rates (
    id TEXT PRIMARY KEY,                       -- UUIDv7
    rate_date TEXT NOT NULL,                   -- Fecha ISO: 'YYYY-MM-DD'
    currency_code TEXT NOT NULL DEFAULT 'USD', -- Moneda base de referencia
    rate_to_ves TEXT NOT NULL,                 -- Tasa en string decimal (ej. '36.5000')
    source TEXT NOT NULL,                      -- 'BCV_AUTO', 'MANUAL'
    fetched_at INTEGER NOT NULL,               -- Timestamp Unix de captura
    notes TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE(rate_date, currency_code)
);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_date ON exchange_rates(rate_date);

-- -----------------------------------------------------------------------------
-- 3. CATÁLOGO DE PRODUCTOS E IMÁGENES
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,                       -- UUIDv7
    name TEXT NOT NULL UNIQUE,                 -- Nombre de la categoría
    created_at INTEGER NOT NULL                -- Timestamp Unix
);

-- Metadatos de la app (country_code, terminal_id, versión de esquema, etc.)
CREATE TABLE IF NOT EXISTS app_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,                       -- UUIDv7
    tenant_id TEXT NOT NULL,                   -- UUIDv7 de aislamiento
    category_id TEXT REFERENCES categories(id) ON DELETE SET NULL, -- Categoría opcional
    barcode TEXT UNIQUE,                       -- EAN-13, UPC o Code128 (Lectores HID)
    sku TEXT UNIQUE NOT NULL,                  -- Código interno del producto
    name TEXT NOT NULL,                        -- Descripción comercial
    price_usd TEXT NOT NULL,                   -- Precio base en string decimal (ej. '12.50')
    cost_usd TEXT NOT NULL,                    -- Costo de reposición en USD (decimal)
    tax_rate TEXT NOT NULL DEFAULT '0.16',     -- Alícuota de impuesto (ej. '0.16' para 16%)
    image_path TEXT,                           -- Ruta relativa al filesystem local (WebP <80KB)
    unit TEXT NOT NULL DEFAULT 'und',          -- Unidad de medida ('und', 'kg', 'g', 'l', 'caja', 'paq')
    min_stock TEXT NOT NULL DEFAULT '5.0000',  -- Umbral para alerta de agotamiento
    tracks_inventory INTEGER NOT NULL DEFAULT 1, -- 1=Kardex/valorización, 0=Rubro sin inventario (sin costo, sin alerta)
    is_active INTEGER NOT NULL DEFAULT 1,      -- 1=Activo, 0=Deshabilitado
    created_at INTEGER NOT NULL,               -- Timestamp Unix
    updated_at INTEGER NOT NULL                -- Timestamp Unix para reconciliación
);

CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_updated ON products(updated_at);

-- -----------------------------------------------------------------------------
-- 4. KARDEX DE INVENTARIO POR DELTAS CONMUTATIVOS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_movements (
    id TEXT PRIMARY KEY,                       -- UUIDv7
    product_id TEXT NOT NULL,                  -- UUIDv7 referenciando a products
    terminal_id TEXT NOT NULL,                 -- Caja que originó el movimiento
    quantity_delta TEXT NOT NULL               -- Delta con signo y 4 decimales exactos (ej. '-1.0000', '10.0000')
        CHECK (quantity_delta NOT GLOB '*[^0-9.+-]*' AND quantity_delta GLOB '*[0-9].[0-9][0-9][0-9][0-9]'),
    movement_type TEXT NOT NULL,               -- 'SALE', 'RETURN', 'RESTOCK', 'ADJUSTMENT'
    reference_id TEXT,                         -- UUID de factura o ajuste
    created_at INTEGER NOT NULL,               -- Timestamp Unix
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_created ON stock_movements(created_at);

-- -----------------------------------------------------------------------------
-- 5. GESTIÓN DE TURNOS DE CAJA (ARQUEO X Y CIERRE Z BIMONEDA)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cash_shifts (
    id TEXT PRIMARY KEY,                       -- UUIDv7
    terminal_id TEXT NOT NULL,                 -- Identificador de la caja
    cashier_name TEXT NOT NULL,                -- Nombre del operador
    opened_at INTEGER NOT NULL,                -- Timestamp Unix de apertura
    closed_at INTEGER,                         -- Timestamp Unix de cierre (NULL si abierto)
    exchange_rate_applied TEXT NOT NULL,       -- Tasa de cambio fijada para el turno
    initial_cash_usd TEXT NOT NULL DEFAULT '0.0000', -- Fondo inicial en USD
    initial_cash_ves TEXT NOT NULL DEFAULT '0.0000', -- Fondo inicial en Bolívares
    expected_cash_usd TEXT,                    -- Calculado por el sistema
    expected_cash_ves TEXT,
    declared_cash_usd TEXT,                    -- Declarado por cajero (Arqueo ciego)
    declared_cash_ves TEXT,
    difference_usd TEXT,                       -- declared - expected
    difference_ves TEXT,
    status TEXT NOT NULL DEFAULT 'OPEN'        -- 'OPEN', 'CLOSED'
);

CREATE INDEX IF NOT EXISTS idx_shifts_status ON cash_shifts(status);

-- -----------------------------------------------------------------------------
-- 5.1 MOVIMIENTOS DE GAVETA (SANGRÍAS / RETIROS Y ENTRADAS DE EFECTIVO)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cash_movements (
    id TEXT PRIMARY KEY,                       -- UUIDv7
    shift_id TEXT NOT NULL,                    -- Turno asociado
    terminal_id TEXT NOT NULL,                 -- Terminal donde ocurrió el movimiento
    movement_type TEXT NOT NULL CHECK (movement_type IN ('DROP', 'INFLOW')), -- 'DROP'=Sangría, 'INFLOW'=Entrada
    currency TEXT NOT NULL CHECK (currency IN ('USD', 'VES')),
    amount TEXT NOT NULL,                      -- Monto con 4 decimales
    reason TEXT NOT NULL,                      -- Motivo obligatorio auditado
    cashier_name TEXT NOT NULL,                -- Cajero que ejecuta el movimiento
    created_at INTEGER NOT NULL,               -- Timestamp Unix
    FOREIGN KEY(shift_id) REFERENCES cash_shifts(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_cash_movements_shift ON cash_movements(shift_id);

-- -----------------------------------------------------------------------------
-- 6. FACTURACIÓN Y DETALLE (INMUTABILIDAD CAMBIARIA)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,                       -- UUIDv7
    shift_id TEXT NOT NULL,                    -- Turno al que pertenece la venta
    terminal_id TEXT NOT NULL,                 -- Caja emisora
    invoice_number TEXT NOT NULL,              -- Consecutivo local (ej. 'C01-000125')
    exchange_rate TEXT NOT NULL,               -- Tasa congelada en el segundo de cobro
    subtotal_usd TEXT NOT NULL,                -- Base imponible en USD
    tax_usd TEXT NOT NULL,                     -- Impuesto en USD
    total_usd TEXT NOT NULL,                   -- Total legal equivalente en USD
    subtotal_ves TEXT NOT NULL,                -- Base imponible en VES
    tax_ves TEXT NOT NULL,                     -- Impuesto en VES
    total_ves TEXT NOT NULL,                   -- Total legal en Bolívares (VES)
    payment_method TEXT NOT NULL,              -- 'CASH_USD', 'CASH_VES', 'PAGO_MOVIL', 'CARD_VES', 'SPLIT'
    payment_breakdown TEXT,                    -- JSON detallando montos por método
    status TEXT NOT NULL DEFAULT 'COMPLETED',  -- 'COMPLETED', 'VOID'
    voided_at INTEGER,                         -- Timestamp Unix de anulación
    void_reason TEXT,                          -- Motivo auditado de anulación
    created_at INTEGER NOT NULL,               -- Timestamp Unix de cobro
    FOREIGN KEY(shift_id) REFERENCES cash_shifts(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_invoices_shift ON invoices(shift_id);
CREATE INDEX IF NOT EXISTS idx_invoices_created ON invoices(created_at);

CREATE TABLE IF NOT EXISTS invoice_items (
    id TEXT PRIMARY KEY,                       -- UUIDv7
    invoice_id TEXT NOT NULL,                  -- UUIDv7 de la factura
    product_id TEXT NOT NULL,                  -- UUIDv7 del producto
    quantity TEXT NOT NULL,                    -- Cantidad vendida (decimal string)
    unit_price_usd TEXT NOT NULL,              -- Precio unitario en USD
    line_total_usd TEXT NOT NULL,              -- Subtotal línea USD
    unit_price_ves TEXT NOT NULL,              -- Precio unitario congelado en VES
    line_total_ves TEXT NOT NULL,              -- Subtotal línea VES
    tax_rate TEXT NOT NULL,                    -- Alícuota aplicada
    FOREIGN KEY(invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);

-- -----------------------------------------------------------------------------
-- 7. COLA DE REPLICACIÓN P2P Y RESPALDO MUTUO (OUTBOX / LOG)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS peer_sync_outbox (
    id TEXT PRIMARY KEY,                       -- UUIDv7 del evento
    origin_terminal_id TEXT NOT NULL,          -- Caja creadora
    entity_type TEXT NOT NULL,                 -- 'PRODUCT', 'STOCK_MOVEMENT', 'INVOICE'
    entity_id TEXT NOT NULL,                   -- UUIDv7 del registro mutado
    action TEXT NOT NULL,                      -- 'UPSERT', 'DELETE'
    payload TEXT NOT NULL,                     -- Serialización JSON del registro
    created_at INTEGER NOT NULL,               -- Timestamp de la mutación
    replicated_peers TEXT DEFAULT '[]'         -- Lista JSON de terminales confirmados
);

CREATE INDEX IF NOT EXISTS idx_sync_outbox_created ON peer_sync_outbox(created_at);

-- -----------------------------------------------------------------------------
-- 8. VISTA DE CONSULTA RÁPIDA: STOCK ACTUAL POR MOVIMIENTOS
-- -----------------------------------------------------------------------------
-- Aritmética 100% entera: cada delta tiene exactamente 4 decimales (CHECK), por lo que
-- quitar el punto lo convierte en diezmilésimas enteras. Sin REAL. Dividir entre 10000 en la app (decimal.js).
DROP VIEW IF EXISTS v_product_current_stock;
CREATE VIEW v_product_current_stock AS
SELECT 
    p.id AS product_id,
    p.sku,
    p.barcode,
    p.name,
    p.category_id,
    p.price_usd,
    p.cost_usd,
    p.min_stock,
    p.tracks_inventory,
    p.image_path,
    p.unit,
    -- Los rubros sin control de inventario no arrastran stock: el kardex los ignora.
    CASE
        WHEN p.tracks_inventory = 1
        THEN COALESCE(SUM(CAST(REPLACE(sm.quantity_delta, '.', '') AS INTEGER)), 0)
        ELSE 0
    END AS current_stock_e4
FROM products p
LEFT JOIN stock_movements sm ON p.id = sm.product_id
WHERE p.is_active = 1
GROUP BY p.id;