# Evaluación Técnica y Hoja de Ruta: Módulo de Caja (POS y Turnos)

**Fecha de evaluación:** 2026-11-02  
**Alcance:** Terminal de Venta (`frontend/src/screens/PosScreen.tsx`), Gestión de Turnos (`frontend/src/screens/ShiftsScreen.tsx`), Shell Principal (`frontend/src/App.tsx`), Servicios de Catálogo/Tasa (`catalog.service.ts`, `bcv-exchange.service.ts`) y Repositorios SQLite (`invoice.repository.ts`, `shift.repository.ts`, `balance.repository.ts`).

---

## 1. ¿Cómo funciona actualmente el Módulo de Caja?

El módulo de Caja está dividido funcionalmente en dos vistas acopladas sobre SQLite local: **Caja (POS)** para facturación y **Turnos** para el control de efectivo en gaveta.

### Flujo operativo actual paso a paso:
1. **Apertura de Sesión (`ShiftsScreen.tsx`):**
   * `openShift` valida que no exista otro turno `OPEN` para el `terminalId`, genera un `UUIDv7` y registra el nombre del cajero, la tasa aplicada (`exchange_rate_applied`) y los fondos iniciales separados en dólares (`initial_cash_usd`) y bolívares (`initial_cash_ves`).
2. **Carga de Catálogo y Tasa (`PosScreen.tsx`):**
   * Al montar la vista, `getCatalogWithBimonetaryPrices` lee los productos activos de la tabla `products` y la tasa más reciente de `exchange_rates`, calculando el precio equivalente en VES en tiempo real sin modificar el precio base en USD.
3. **Armado del Ticket (`PosScreen.tsx`):**
   * Los productos ingresan al ticket tocando su tarjeta en la grilla de 2 columnas o escaneando su código con una pistola USB/Bluetooth HID (`useBarcodeScanner`).
   * Cada línea ajusta cantidades en pasos enteros (`+1` / `-1`) mediante `TouchStepper` y recalcula subtotales bimoneda con `decimal.js`.
4. **Emisión de Factura e Inmutabilidad (`invoice.repository.ts`):**
   * `createInvoice` verifica primero el estado de la licencia (`ACTIVE`/`GRACE`) y el reloj monótono (`LicenseValidatorService.verifyMonotonicClock`).
   * Dentro de una transacción atómica (`db.transaction`), verifica que el turno siga `OPEN`, genera el correlativo local (`TERM01-000001`), congela permanentemente la tasa y los montos en USD y VES en `invoices` e `invoice_items`, e inserta un movimiento conmutativo negativo (`SALE`) en `stock_movements` por cada ítem vendido.
5. **Arqueo X y Cierre Z (`shift.repository.ts`):**
   * **Arqueo X (`performArqueoX`):** totaliza las facturas del turno por método de pago y muestra el efectivo esperado en gaveta (`fondo inicial + ventas en efectivo`) sin cerrar el turno.
   * **Cierre Z (`performCierreZ`):** recibe el conteo físico ciego del cajero en USD y VES, calcula `difference_usd` y `difference_ves` (`declarado - esperado`), determina `isSquare` y cambia el estado del turno a `CLOSED`.

---

## 2. Veredicto: ¿Es suficiente con lo que está en este momento?

**Veredicto Ejecutivo:** El módulo **sí es sólido en su núcleo transaccional de base de datos** (cumple UUIDv7, `decimal.js` a 4 decimales, congelamiento cambiario en factura y descuento de Kardex por deltas), pero **NO es suficiente todavía para operar en un comercio real en producción**, ni alcanza la madurez que ya tiene el módulo de Inventario tras la Fase 6 (PR-13 a PR-16).

| Dimensión Evaluada | Estado Actual | Nivel de Suficiencia |
|---|---|---|
| **Integridad Matemática y Bimoneda (SQLite)** | `decimal.js` estricto a 4 decimales, tasa congelada por factura, reloj monótono activo. | **Alto (90%)** — Falta cálculo real de IVA (`tax_rate`) y sincronización P2P de facturas. |
| **Catálogo y Búsqueda en Caja (`PosScreen`)** | Grilla básica sin buscador, sin filtro de categorías, sin fotos locales y sin stock visible. | **Bajo (35%)** — Insuficiente para catálogos de más de 15 productos o ítems sin código de barras. |
| **Flujo de Cobro y Métodos de Pago** | Solo permite 1 método de pago por venta; sin pagos mixtos (`SPLIT`), sin cálculo de vuelto ni IGTF. | **Medio-Bajo (45%)** — Incumple el requisito de pagos combinados de `AGENTS.md`. |
| **Manejo del Ticket (Cantidades y Pesables)** | Solo permite `+1` / `-1` enteros; `Numpad.tsx` existe pero no está conectado. | **Bajo (40%)** — Imposibilita vender productos por peso (`kg`, `g`, `l`) o grandes volúmenes rápido. |
| **Gestión de Turnos y Gaveta (`ShiftsScreen`)** | Apertura, Arqueo X y Cierre Z básicos funcionan, pero sin retiros/ingresos de efectivo ni historial. | **Medio (60%)** — Cualquier retiro parcial de efectivo o gasto menor descuadra el Cierre Z. |

---

## 3. Análisis Detallado de Brechas y Problemas Detectados

### A. Brechas Críticas (Bloqueantes para operación comercial real)

#### 1. Pagos Combinados (`SPLIT`) y Calculadora de Vuelto Bimoneda inexistentes en la UI
* **Requisito en `AGENTS.md`:** *"Terminal de venta con soporte para múltiples métodos de pago combinados."*
* **Estado en código:** Aunque `invoice.repository.ts` y `shift.repository.ts` soportan `paymentMethod = "SPLIT"` y leen el JSON `payment_breakdown` (`cash_usd`, `cash_ves`, `pago_movil`, `card_ves`), en `PosScreen.tsx` solo existen 4 botones excluyentes.
* **Impacto real (Venezuela):** Es sumamente frecuente que un cliente pague una parte con un billete en efectivo USD (ej. `$10.0000`) y complete el resto por Pago Móvil o Punto de Venta en Bolívares, o que pague con un billete de `$20.0000` una compra de `$14.5000` y requiera vuelto mixto (en USD y/o en Bs. o Pago Móvil).
* **Efecto colateral en reportes:** En `balance.repository.ts`, las facturas `SPLIT` se acumulan en un bloque genérico `"SPLIT"` sin desglosar su `payment_breakdown` hacia cada método real recaudado.

#### 2. Impuestos (IVA) cableados a `"0.0000"` durante el cobro
* **Estado en código:** En `PosScreen.tsx`, al invocar `createInvoice`, se envían valores fijos `taxRate: "0.0000"`, `taxUsd: "0.0000"` y `taxVes: "0.0000"`, ignorando la columna `tax_rate` configurada en cada producto en `InventoryScreen` (ej. `0.1600` para 16% o `0.0000` para exentos).
* **Impacto:** Todas las facturas quedan registradas sin impuesto discriminado y el reporte de `totalTaxUsd` / `totalTaxVes` en `MonthlyBalanceScreen` resulta en cero para las ventas emitidas desde la pantalla de Caja.

#### 3. Catálogo de Caja desconectado de `v_product_current_stock`, Imágenes, Búsqueda y Categorías
* **Estado en código:** Mientras `InventoryScreen.tsx` usa `listInventoryWithStock` (que consulta `v_product_current_stock` + `categories` + `FileStore`), `PosScreen.tsx` sigue usando `getCatalogWithBimonetaryPrices`.
* **Consecuencias directas:**
  1. **Sin control ni visualización de stock:** El cajero no ve cuántas unidades quedan (`● 24 en stock` vs `● Agotado`) y puede facturar productos con stock `0.0000` o negativo sin alerta.
  2. **Sin buscador ni filtro por categorías:** No hay barra de búsqueda por texto (nombre/SKU/código) ni pestañas de categorías en `PosScreen`.
  3. **Sin imágenes de producto ni unidad de medida:** Las tarjetas del POS no renderizan la miniatura WebP/JPEG optimizada en PR-14 ni indican si el precio es por `kg`, `und`, `l` o `caja`.

#### 4. Bug al actualizar la tasa manual más de una vez en el mismo día
* **Estado en código:** En `PosScreen.tsx`, el modal de *"Actualizar Tasa BCV / Moneda"* llama a `registerManualRate`. Sin embargo, `registerManualRate` verifica `if (getRateForDate(db, args.rateDate)) throw new RateError("Ya existe una tasa para ...")`.
* **Impacto:** Si ya se registró una tasa en la mañana (automática BCV o manual al abrir turno) y en la tarde el BCV actualiza la tasa o el operador necesita corregirla desde `PosScreen`, el modal falla con error y no permite guardar la nueva tasa en SQLite.

#### 5. Las facturas (`INVOICE`) no se encolan en `peer_sync_outbox`
* **Estado en código:** En `invoice.repository.ts`, al crear una factura se encolan los descuentos de inventario (`STOCK_MOVEMENT`) a través de `addStockMovement`, pero **nunca se encola el evento `entityType: "INVOICE"`** en `peer_sync_outbox` ni se procesa en `p2p-http.service.ts`.
* **Impacto:** En una tienda con 2 cajas sincronizadas por Wi-Fi LAN, el stock sí se descuenta en ambas cajas, pero el Balance Consolidado (`MonthlyBalanceScreen`) de la Caja 1 no conoce las facturas cobradas en la Caja 2.

---

### B. Brechas Funcionales y de Ergonomía Táctil (UX/UI)

#### 6. Teclado Numérico (`Numpad.tsx`) sin integrar y falta de soporte para productos pesables
* El componente `Numpad.tsx` (con teclas de `64×64 px`) está implementado pero no se usa en `PosScreen` ni en `ShiftsScreen`.
* En el ticket (`PosScreen.tsx`), `TouchStepper` formatea la cantidad con `.toFixed(0)` y solo incrementa de `1` en `1`. No es posible tocar la cantidad de un ítem para digitar `0.4500` kg de charcutería o `24` unidades de un solo toque, ni hay botón rápido para eliminar la línea o vaciar el ticket completo.

#### 7. Desconexión de Estado de Turno entre `App.tsx`, `PosScreen.tsx` y `ShiftsScreen.tsx`
* En `App.tsx`, el pie de la barra lateral muestra texto estático (`"Erick (C01)"` / `"Turno Activo #402"` con punto verde fijo) aunque el turno esté cerrado en SQLite.
* En `PosScreen.tsx`, si no hay turno abierto, la pantalla no muestra ningún banner preventivo ni botón directo para abrir turno: el cajero escanea todos los productos del cliente y recién recibe el error `"No hay un turno de caja abierto"` al pulsar **Confirmar Cobro**.

#### 8. Ausencia de Movimientos de Efectivo en Gaveta (Ingresos / Egresos / Sangrías)
* En `shift.repository.ts`, el efectivo esperado se calcula únicamente como `initialCash + salesCash`.
* En operación real existen retiros parciales de efectivo por seguridad (*sangrías*), ingresos de sencillo para dar vuelto o pagos menores en efectivo autorizados desde caja. Sin registrar estos movimientos de gaveta, el Cierre Z reportará falsos faltantes o sobrantes.

#### 9. Falta de Historial de Facturas del Turno, Anulaciones (`RETURN`) y Recibo Digital
* Una vez cobrada una venta en `PosScreen`, no existe una vista o pestaña en Caja/Turnos para ver las facturas emitidas en el turno actual, revisar el detalle de una factura, generar una vista de recibo/comprobante, o ejecutar una **devolución/anulación auditada** que revierta el stock mediante un movimiento `'RETURN'` en `stock_movements`.

---

## 4. Hoja de Ruta de Mejoras Propuestas (Plan de Micro-PRs)

Siguiendo la regla de `AGENTS.md` (Micro-PRs secuenciales de 150 a 300 líneas auditables), se propone estructurar las mejoras del Módulo de Caja en una **Fase 7: Evolución Integral de Caja y Turnos**:

| Micro-PR Propuesto | Prioridad | Componentes Afectados | Qué soluciona específicamente |
|---|---|---|---|
| **PR-17: Catálogo POS Reactivo con Stock, Imágenes, Buscador y Categorías** | **Alta (Crítica)** | `PosScreen.tsx`, `catalog.service.ts` | Conecta `PosScreen` a `listInventoryWithStock` y `FileStore`. Añade barra de búsqueda instantánea, chips de categorías, miniatura de foto en tarjeta, unidad de medida (`und`, `kg`, `l`), badge de stock (`● X en stock` / `● Agotado`) y validación para impedir vender ítems sin stock. |
| **PR-18: Ticket con `Numpad` para Cantidades/Pesables, IVA Real y Acciones Rápidas** | **Alta (Crítica)** | `PosScreen.tsx`, `Numpad.tsx`, `invoice.repository.ts` | Permite tocar cualquier línea del ticket para abrir el `Numpad` táctil e ingresar cantidades decimales (ej. `0.7500 kg`) o enteras rápidas, botón de eliminar línea, botón de vaciar carrito con confirmación, y desglose real de Subtotal + IVA (`tax_rate` por producto) + Total en USD y VES. |
| **PR-19: Cobro Combinado (`SPLIT`) y Calculadora de Vuelto Bimoneda** | **Alta (Crítica)** | `PosScreen.tsx`, `shift.repository.ts`, `balance.repository.ts` | Rediseña el modal de cobro para soportar pago único o **Pago Combinado (`SPLIT`)** asignando montos parciales a Efectivo USD, Efectivo VES, Pago Móvil y Punto. Añade cálculo automático de **Restante por pagar** y **Vuelto a entregar** en USD/VES, y desglosa `SPLIT` en `balance.repository.ts`. |
| **PR-20: Estado Reactivo de Turno en `App.tsx`, Banner de Turno en POS y Upsert de Tasa** | **Media-Alta** | `App.tsx`, `PosScreen.tsx`, `bcv-exchange.service.ts`, `exchange.repository.ts` | Conecta el indicador del sidebar de `App.tsx` al turno real (`getOpenShift`), muestra un banner en `PosScreen` con acceso directo a abrir turno si está cerrado, y permite actualizar/reemplazar la tasa del día (`upsertRate`) con auditoría sin fallar por clave duplicada. |
| **PR-21: Movimientos de Efectivo en Gaveta y Arqueo por Denominaciones** | **Media** | `ShiftsScreen.tsx`, `shift.repository.ts`, `database_schema.sql` | Permite registrar entradas/salidas manuales de efectivo en el turno (sangrías, fondo para vuelto, gastos menores con motivo), incorpora un asistente opcional de conteo de billetes por denominación en el Cierre Z y muestra el historial de turnos cerrados. |
| **PR-22: Historial de Ventas del Turno, Devoluciones (`RETURN`) y Sync P2P de Facturas** | **Media** | `PosScreen.tsx`, `ShiftsScreen.tsx`, `invoice.repository.ts`, `p2p-sync.service.ts` | Añade consulta de facturas emitidas en el turno con vista de comprobante/recibo, opción de anulación/devolución que genera el delta positivo `'RETURN'` en `stock_movements`, y encola `INVOICE` en `peer_sync_outbox` para replicación P2P entre cajas. |

