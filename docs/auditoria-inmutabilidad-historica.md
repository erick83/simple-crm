# Auditoría de inmutabilidad histórica — POS Local-First

**Fecha:** 2026-11-05 · **Alcance:** todo lo que un hecho comercial ya registrado puede cambiar con el tiempo.

**Método:** para cada dato que un ticket, una anulación o un reporte muestra, se verificó si se **lee de la fila histórica** (inmutable) o si se **resuelve contra las tablas vivas** `products` / `categories` / `exchange_rates` (retroactivo). Las referencias `archivo:línea` son del árbol actual.

Regla de trabajo: *un hecho pasado no se recalcula, se consulta*. Si un valor entra en una factura, su derivación deja de ser una función del presente.

---

## 1. Lo que ya es inmutable (verificado, no tocar)

| Hecho | Dónde está congelado | Evidencia |
|---|---|---|
| Tasa de cambio de la venta | `invoices.exchange_rate` | DDL `docs/database_schema.sql`; `invoice.repository.ts:272` escribe `formatFixed4(rate)` |
| Importes en ambas monedas | `invoices.subtotal/tax/total_usd` y `_ves` | `invoice.repository.ts:273-278` (se guardan, no se recalculan) |
| Precio unitario y total de línea | `invoice_items.unit_price_usd/ves`, `line_total_usd/ves` | `invoice.repository.ts:295-309` |
| Alícuota de IVA aplicada | `invoice_items.tax_rate` | `invoice.repository.ts:308` |
| Kardex | `stock_movements` solo admite `INSERT` de deltas; no existe `UPDATE` sobre la tabla en `src/` | grep confirmado; CHECK de 4 decimales en DDL |
| Tasa y efectivo del turno | `cash_shifts.exchange_rate_applied`, `expected/declared/difference_*` | `shift.repository.ts:334-344` (sellado al cierre Z) |
| Anulación | `invoices.status='VOID'`, `voided_at`, `void_reason` | `invoice.repository.ts:478`; VOID excluido en `balance.repository.ts:80` y `shift.repository.ts:196` |
| IVA sugerido global | solo prellena el formulario de producto nuevo | `tests/settings-tax.test.ts` |
| Una tasa por día | `exchange_rates UNIQUE(rate_date, currency_code)` | DDL; `exchange.repository.ts:58` |

---

## 2. Fugas de retroactividad (hay que congelar)

### F1 — El costo de reposición reescribe el margen histórico · **CERRADO (PR-27)**

`generatePeriodicBalance()` calcula el COGS con `p.cost_usd` **de hoy** (`balance.repository.ts:212`, JOIN a `products`). Editar el costo de un producto recalcula el margen de facturas de meses pasados. Es el mismo principio que `AGENTS.md` §3.2 ya exige para la tasa, aplicado a la otra mitad de la ecuación de rentabilidad.

**Fix:** `invoice_items.unit_cost_usd TEXT NOT NULL DEFAULT '0.0000'` congelado en la emisión; el balance lo usa con fallback a `products.cost_usd` para las filas anteriores a la migración. Viaja en el payload `INVOICE` del outbox.

*Indicio adicional:* `addStockMovement()` ya declara un parámetro `costUsdSnapshot` (`product.repository.ts:643`) que **nunca se persiste ni se lee**. El kardex tampoco guarda costo, así que cualquier valorización de movimientos históricos usa el costo vivo.

**Implementado:** `unit_cost_usd TEXT` (nullable; `NULL` = línea anterior a la migración, nunca un `0.0000` disfrazado). `createInvoice` copia `products.cost_usd` en la línea al cobrar, con override por `InvoiceItemInput.unitCostUsd`. El snapshot viaja en `payload.items` del outbox (reemplazando el input crudo) y el motor Web lo persiste. `generatePeriodicBalance` usa `ii.unit_cost_usd` con fallback al costo vivo; test `tests/migration-legacy-db.test.ts` prueba la migración sobre dos generaciones de esquema.

### F2 — Identidad del producto en documentos fiscales · **CERRADO (PR-28)**

`invoice_items` no guarda nombre, SKU ni unidad. Se resuelven contra `products` en tiempo de lectura:

- Reimpresión de ticket y envío ESC/POS: `PosScreen.tsx:359 receiptItemName()` (busca en el catálogo vivo y cae en `getProductById`), usado por `buildReceiptModel({ resolveItemName })` en `PosScreen.tsx:906`.
- Ranking de productos del balance: JOIN `p.sku, p.name` (`balance.repository.ts:212`).

Renombrar un rubro, o cambiar su SKU, **altera tickets ya impresos y reportes cerrados**. Un ticket que salió con "Picadilla especial $2.50" puede reimprimirse días después diciendo otra cosa.

*Indicio adicional:* `InvoiceItemInput.productName` existe en la interfaz (`invoice.repository.ts:16`) pero no se persiste: el snapshot se planeó y no se cableó.

**Fix:** `invoice_items.product_name`, `product_sku`, `product_unit` congelados al emitir; la impresión y los reportes leen la fila de la factura, con fallback al producto para facturas antiguas.

**Implementado:** las tres columnas nullable se copian en `createInvoice` (nombre: `item.productName` o el del producto; SKU y unidad siempre del producto al cobrar). `buildReceiptModel` ahora imprime `it.productName` cuando existe y solo consulta `resolveItemName` para líneas heredadas — la garantía es estructural del compositor del documento, no del llamador; el POS además prefiere el nombre congelado en `receiptItemName`. El ranking del balance reporta nombre y SKU históricos. El hallazgo lo confirmó el primer run de `tests/invoice-snapshot.test.ts`: sin el cambio en `buildReceiptModel` el ticket reimprimía el nombre nuevo.

### F3 — La tasa del turno no es vinculante · **CERRADO (PR-29)**

Hoy coexisten dos fuentes de tasa en el mismo turno:

1. `cash_shifts.exchange_rate_applied`, fijada al abrir (con fallback manual auditado).
2. `PosScreen.tsx:241` → `setExchangeRate(result.activeRate)`, que toma **la última tasa registrada** (`getLatestRate`) cada vez que se refresca el catálogo.

Y `createInvoice()` valida que el turno exista y esté `OPEN` (`invoice.repository.ts:188`) pero **nunca compara** `input.exchangeRate` con `exchange_rate_applied`. Resultado: si a media jornada se corrige la tasa del día, las ventas posteriores del mismo turno se emiten con otra tasa, y el arqueo Z cuadra Bs. de dos conversiones distintas contra un mismo `exchange_rate_applied`.

**Fix:** el ticket usa `activeShift.exchangeRateApplied` como única fuente; el campo de captura manual de tasa pasa a modificar el **turno** (con motivo obligatorio y solo si aún no hay ventas) en lugar del ticket; `createInvoice` rechaza toda tasa distinta a la del turno.

**Implementado:** `createInvoice` compara la tasa del ticket contra `cash_shifts.exchange_rate_applied` (equivalencia decimal, así `"40"` == `"40.0000"`) y rechaza cualquier diferencia con mensaje que indica el procedimiento. El POS toma la tasa del turno en `checkShift` y en `refreshCatalog` (ya no persigue a `getLatestRate` mientras hay turno abierto). Nuevo `setShiftExchangeRate(db, {shiftId, rate, reason, terminalId})`: exige motivo, rechaza turnos cerrados, tasas idénticas y turnos **con ventas emitidas** (dirige a cerrar Z y abrir uno nuevo). La política adoptada es la restrictiva: la tasa del turno es definitiva mientras el turno tenga dinero dentro; corregir el valor oficial del día sigue siendo posible y no re-tasa nada.

### F4 — La corrección de tasa borra el rastro de la corrección · **CERRADA (PR-30)**

`insertRate()` (`exchange.repository.ts:47-65`) hace `ON CONFLICT DO UPDATE` pisando `rate_to_ves`, `source`, `fetched_at` y `notes`. El valor erróneo desaparece: no queda qué se corrigió, cuándo, quién ni por qué. El servicio ya tiene un semáforo (`bcv-exchange.service.ts:94`: falla si ya existe tasa del día salvo `allowUpdate`), pero al permitir el override se pierde la auditoría.

**Fix:** mantener `UNIQUE(rate_date, currency_code)` como valor **oficial vigente del día** y registrar cada corrección en `exchange_rate_corrections(rate_id, previous_rate_to_ves, new_rate_to_ves, reason, corrected_by, corrected_at)`. Con `invoices.exchange_rate` congelado (tabla §1) y F3, corregir la tasa del día **no** re-tasa ninguna venta: la corrección es un hecho auditable, no un recálculo.

**Implementado:** tabla `exchange_rate_corrections (id, rate_date, context, context_id, previous_rate, new_rate, reason, source, terminal_id, created_at)` con índices por día y por turno. `recordRateCorrection` exige motivo y rechaza correcciones sin cambio real; `listRateCorrections` filtra por `rateDate` o `shiftId`. `registerManualRate` registra la corrección cuando el valor del día cambia (contexto `EXCHANGE_RATE`, fuente `MANUAL`) y `setShiftExchangeRate` hace lo propio (contexto `SHIFT`, fuente `SHIFT_OVERRIDE`). `resolveDailyRate` no toca una tasa ya publicada del día. Vista de la bitácora en pantalla queda como mejora posterior: el dato ya es consultable desde el repositorio.

### F5 — Secuencia de factura sin garantía de unicidad · **CERRADA (PR-30)**

`generateNextInvoiceNumber()` (`invoice.repository.ts:148`) es `COUNT(*) + 1` por terminal, y `invoices.invoice_number` **no tiene `UNIQUE`** (`docs/database_schema.sql:150`). Mientras solo exista la ruta actual (un escritor por caja, borrado lógico) funciona; pero un `DELETE` físico, una migración o un replay P2P que reordene el conteo puede producir números duplicados o reutilizados, que en un documento fiscal es más grave que un salto de número.

**Fix originally propuesto:** `UNIQUE(terminal_id, invoice_number)` + generación por `MAX(secuencia numérica)+1`.

**Implementado (y por qué cambió):** al probar el escenario, `MAX(...)+1` **también** reutiliza el número si se borra físicamente la factura más alta — el test lo demostró. La corrección real exige un contador que no retrocede: tabla `invoice_sequences (terminal_id PRIMARY KEY, last_number, updated_at)` con `allocateInvoiceNumber(db, terminalId, now)`, que siembra su máximo histórico al primer uso (migración de bases existentes), se incrementa **dentro del mismo `transaction()`** de la emisión (un `ROLLBACK` restaura la secuencia: no quema ni duplica números) y devuelve el consecutivo. `generateNextInvoiceNumber` se conserva como lectura sin consumo (`peek`) para vistas previas y auditoría. Se mantiene además el índice `UNIQUE(terminal_id, invoice_number)` como segunda línea de defensa; en una base con duplicados históricos la migración omite el índice en vez de inutilizar la caja.

### F6 — Categoría como atributo vivo en agregaciones · **baja, riesgo latente**

`deleteCategory()` deja `products.category_id = NULL` (`product.repository.ts:584`) y renombrar una categoría cambia su nombre en toda la historia. Hoy **ningún reporte agrupa por rubro**, así que no hay fuga material; pero en cuanto el balance o la carnicería pidan "ventas por categoría", el JOIN vivo hará que los cortes mensuales cambien retroactivamente al reorganizar los rubros.

**Fix (cuando se pida):** snapshot de `category_name` en `invoice_items`, o tabla puente `product_category_history(product_id, category_id, valid_from)`.

---

## 3. Orden propuesto de micro-PRs

| PR | Cubre | Toca esquema | Estado |
|---|---|---|---|
| **PR-27** Congelar costo en la línea de factura | F1 | Sí (`invoice_items.unit_cost_usd`) | ✅ entregado |
| **PR-28** Congelar identidad del producto en la línea | F2 | Sí (`product_name`, `product_sku`, `product_unit`) | ✅ entregado (junto a PR-27, un solo DDL) |
| **PR-29** Tasa del turno vinculante | F3 | No (validación + POS) | ✅ entregado |
| **PR-30** Auditoría de corrección de tasa + secuencia única | F4, F5 | Sí (2 tablas nuevas + constraint) | ✅ entregado |
| PR-31 (opcional, bajo demanda) | F6 | Sí | pendiente |

Dependencias: PR-27 y PR-28 son la misma familia de columnas y pueden salir en un solo DDL; PR-29 es conducta pura y no bloquea a nadie; PR-30 va después porque su premisa ("corregir no re-tasa") solo es cierta cuando F3 y F1 están cerrados.

## 4. Vacío de política que esto deja al descubierto

`AGENTS.md` §3.2 exige inmutabilidad cambiaria en la factura, pero no enuncia el principio general, así que cada módulo decide su propio nivel de congelación (el costo y el nombre, que sí deberían estarlo, no lo están). Se propone añadir a §2 una regla: *"Todo valor monetario, de costo, de identidad de producto o fiscal que intervenga en un documento emitido se copia, no se referencia. Prohibido resolver datos históricos contra `products`, `categories` o la tasa vigente."*
