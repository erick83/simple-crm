# HARNESS_CONTROL.md — Tablero de Control y Bitácora P2P

Archivo de seguimiento y memoria persistente entre sesiones de desarrollo para Antigravity y OpenCode.

---

## 1. Estado de la Última Sesión (Handoff)
* **Fecha:** 2026-11-03
* **Arquitectura:** React Native (Expo SDK 52, Android / Web / Windows) + SQLite local (`op-sqlite`) + P2P LAN Wi-Fi (mDNS/HTTP) + Validador Offline Ed25519. $0 Cloud / Cero Servidores Backend.
* **Look & Feel:** Dark Mode nativo (`#061426`), Touch Targets 48px/64px, Landscape 1280×800 px, aritmética decimal fija a 4 decimales (`tabular-nums`).
* **Estado actual:** PR-24 completado. **Verificación Ed25519 real en la app**: `LicenseValidatorService.verifySignature` ahora valida la firma con `@noble/curves` (`ed25519.js`) en los runtimes sin `node:crypto` (Android/Web), cerrando el stub anterior que solo comprobaba 64 bytes. Se agregó `spkiPemToRawPublicKey` para extraer la llave pública cruda (32 bytes) del PEM SPKI. **Emisor de licencias offline en Go** (`license-issuer/`, módulo Go dentro del repo): comandos `keygen` / `issue` / `verify` con `crypto/ed25519` de stdlib, sin backend. Interop verificada end-to-end (Go firma → noble verifica). Llave pública demo embebida en `DEFAULT_EMBEDDED_PUBLIC_KEY`. 142 tests pasando al 100% (25 suites) y typecheck limpio.
* **Próxima tarea a ejecutar:** Emparejamiento `tenant_id` (quitar el hardcode `TENANT-001`, flujo código/QR) y luego módulo de usuarios/cajeros (login + roles).

---

## 2. Cola Secuencial de Micro-PRs

### Fase 1: Persistencia Local, DDL y Hardware de Entrada
- [x] **PR-01: Inicialización del Monorepo y SQLite con UUIDv7**
  * *Descripción:* Estructurar `/frontend` (React Native; toda la lógica y la base de datos local residen allí). Implementar el motor SQLite local cargando el esquema de `docs/database_schema.sql` y soporte para UUIDv7.
  * *Criterio de éxito:* Tests unitarios de inserción de productos y cálculo de stock mediante la vista `v_product_current_stock`.
- [x] **PR-02: Procesamiento y Almacenamiento Local de Imágenes**
  * *Descripción:* Implementar la compresión de fotos (WebP/JPEG 600x600 px, <80 KB) en el cliente y persistencia de la ruta en SQLite.
  * *Criterio de éxito:* Carga de imagen optimizada asociada correctamente al producto.
- [x] **PR-03: Listener Global para Lector de Código de Barras (HID)**
  * *Descripción:* Hook/servicio global que intercepta pulsaciones de teclado rápidas (<30 ms) que terminen en `Enter` y busque el ítem en SQLite por `barcode`.
  * *Criterio de éxito:* Emulación de escaneo añade el producto al carrito de cobro en <10 ms.

### Fase 2: Módulo Cambiario y Multimoneda (Venezuela)
- [x] **PR-04: Módulo de Tasa BCV y Fallback Manual**
  * *Descripción:* Tabla `exchange_rates`. Extractor HTTP hacia la tasa oficial del BCV con timeout estricto y fallback para registro manual auditado al abrir turno.
  * *Criterio de éxito:* Si hay internet, captura la tasa oficial del día; si está offline, permite el ingreso manual validando precisión decimal.
- [x] **PR-05: Precios Bimoneda Reactivos en Catálogo**
  * *Descripción:* Catálogo con precios base en USD y conversión dinámica en pantalla a VES según la tasa del día.
  * *Criterio de éxito:* Actualizar la tasa del día recalcula los precios mostrados en VES sin alterar los precios base en USD.

### Fase 3: Facturación, Turnos de Caja y Balance Mensual
- [x] **PR-06: Turnos de Caja Bimoneda (Arqueo X y Z)**
  * *Descripción:* Tabla `cash_shifts`, fijación de tasa del turno, conteo ciego discriminado por moneda (USD y VES en efectivo) y cálculo de diferencias.
  * *Criterio de éxito:* Cierre Z bloquea el turno y genera el cuadre de caja exacto por moneda.
- [x] **PR-07: Emisión de Ventas e Inmutabilidad Cambiaria**
  * *Descripción:* Flujo de cobro que persiste `invoices`, `invoice_items` y agrega los deltas correspondientes en `stock_movements`.
  * *Criterio de éxito:* Venta congela la tasa y los totales en ambas monedas de forma inmutable; descuenta el inventario atómicamente.
- [x] **PR-08: Módulo de Balance Periódico y Cierre Mensual**
  * *Descripción:* Consultas agregadas en SQLite para totalizar ingresos por método de pago, volumen y margen para cualquier rango de fechas.
  * *Criterio de éxito:* Reporte mensual calcula exactamente las sumatorias por moneda y método de cobro.

### Fase 4: Licenciamiento Criptográfico Offline-First
- [x] **PR-09: Validador de Licencia en App y Guardia de Reloj Monótono**
  * *Descripción:* Verificación en la app usando la llave pública Ed25519, chequeo de coincidencia con el `HWID` local y bloqueo si `last_recorded_timestamp` detecta atraso de fecha.
  * *Criterio de éxito:* App activa el cobro con licencia válida; se bloquea si el HWID difiere o el reloj es manipulado.

### Fase 5: Red Local y Sincronización Wi-Fi P2P
- [x] **PR-10: Descubrimiento de Cajas por mDNS en Red Wi-Fi**
  * *Descripción:* Anuncio y detección de terminales en la red local (`_cajapos._tcp`).
  * *Criterio de éxito:* Dos cajas en la misma Wi-Fi intercambian sus IPs privadas automáticamente.
- [x] **PR-11: Servidor HTTP P2P Embebido y Aislamiento por Cuenta (`tenant_id`)**
  * *Descripción:* Mini-servidor/transporte HTTP local en la app con validación de misma cuenta (`tenant_id` en cabeceras y `txtRecord` mDNS) para responder endpoints: `GET /p2p/stock?sku=XYZ`, `GET /p2p/exchange-rate` y `GET /p2p/images/:imagePath` (transferencia binaria/base64 de imágenes locales de productos).
  * *Criterio de éxito:* La Caja 2 consulta el inventario e imágenes de la Caja 1 en <15 ms solo si comparten el mismo `tenant_id`; rechaza peticiones de cuentas distintas.
- [x] **PR-12: Replicación Cruzada P2P de Catálogo, Deltas de Kardex e Imágenes**
  * *Descripción:* Endpoint `POST /p2p/sync/deltas` y worker de sincronización que intercambia lotes de `peer_sync_outbox` entre equipos de la misma red y cuenta (`tenant_id`). Aplica `PRODUCT` (UPSERT/DELETE con resolución determinista `updated_at`), `STOCK_MOVEMENT` (deltas conmutativos idempotentes por UUIDv7) y descarga automáticamente en el `FileStore` local las imágenes nuevas/actualizadas de productos.
  * *Criterio de éxito:* Crear/editar un producto con foto o registrar un movimiento de stock en la Caja 1 se replica de forma idempotente (datos + archivo de imagen local) en la Caja 2.

### Fase 6: Inventario Real End-to-End (CRUD, Imágenes Locales y Lector HID)
- [x] **PR-13: Repositorio CRUD Completo de Inventario, Categorías y Kardex con Outbox P2P**
  * *Descripción:* Ampliar `src/database/repositories/product.repository.ts` con operaciones completas: `updateProduct` (nombre, SKU, `barcode`, categoría, `price_usd`, `cost_usd`, `tax_rate`, `min_stock`), `setProductActive` (baja lógica), `getProductById`, `getProductByBarcode`, `getProductBySku`, `listCategories`, `listInventoryWithStock` (consulta enriquecida sobre `v_product_current_stock` con búsqueda por nombre/SKU/`barcode`) y `getProductKardex` (historial de `stock_movements`). Toda mutación de producto o ajuste de stock (`RESTOCK`, `ADJUSTMENT`) encola atómicamente su evento en `peer_sync_outbox`.
  * *Criterio de éxito:* Tests unitarios de creación, edición, validación de unicidad de SKU/`barcode`, ajuste de stock con precisión fija (4 decimales) y generación automática de eventos en `peer_sync_outbox`.
- [x] **PR-14: Almacenamiento Local y Selector de Imágenes de Producto (`FileStore` + Compresor)**
  * *Descripción:* Implementar los adaptadores concretos de `FileStore` (`expo-file-system` con directorio persistente local `images/products/` y fallback para entorno web/tests) e `ImageEncoder` (`expo-image-manipulator`), permitiendo seleccionar una imagen desde el dispositivo, comprimirla a WebP/JPEG (máx. 600×600 px, <80 KB), guardarla localmente, limpiar el archivo anterior al reemplazarla y encolar la actualización del producto en `peer_sync_outbox`.
  * *Criterio de éxito:* Al asociar o cambiar la foto de un producto, el archivo optimizado se guarda en el almacenamiento local del dispositivo, actualiza `image_path` en SQLite y expone la URI local lista para renderizar.
- [x] **PR-15: Integración Reactiva del Lector de Código de Barras (HID) en Inventario y POS**
  * *Descripción:* Crear el hook `useBarcodeScanner` sobre `barcode-scanner.service.ts` (<30 ms entre pulsaciones finalizadas en `Enter`) e integrarlo en `InventoryScreen` y `PosScreen`. En Inventario: (1) si el modal de producto está abierto, asigna el código leído por el lector directamente al campo `barcode`; (2) si está en la lista, busca el código escaneado y abre el producto o propone crear uno nuevo con ese `barcode` precargado. En POS: añade el producto escaneado al ticket al instante.
  * *Criterio de éxito:* Tests de integración simulando ráfagas HID que autocompletan el `barcode` en el alta/edición de producto, filtran en el catálogo o agregan al carrito en <10 ms sin interferir con la escritura manual normal.
- [x] **PR-16: Pantalla de Inventario Conectada a SQLite (UI Táctil CRUD + Carga de Imagen + Ajuste de Kardex)**
  * *Descripción:* Conectar `InventoryScreen.tsx` y `App.tsx` al motor SQLite real y al estado de sincronización P2P. Incorporar: (1) listado reactivo desde `v_product_current_stock` con miniatura de imagen local, código de barras, SKU, precio USD/VES y badge de stock bajo; (2) modal táctil de Crear/Editar Producto con selector de imagen local y captura de `barcode` por lector HID o teclado; (3) modal táctil de Entrada/Ajuste de Stock (`RESTOCK` / `ADJUSTMENT`) con historial de movimientos.
  * *Criterio de éxito:* Flujo completo verificable en tests y UI: crear producto con código de barras e imagen local, editar precios/costos, ajustar existencias por Kardex y visualizar el estado de sincronización P2P.

### Fase 7: Evolución Integral de Caja y Turnos (POS Venezuela Ready)
- [x] **PR-17: Catálogo POS Reactivo con Stock, Imágenes, Buscador y Categorías**
  * *Descripción:* Conectar `PosScreen.tsx` y `catalog.service.ts` a `listInventoryWithStock` (`v_product_current_stock`), soporte de imágenes locales (`FileStore`), buscador reactivo instantáneo por nombre/SKU/código de barras, selector táctil de categorías en carrusel horizontal con contadores y visualización de badges de stock (`● X en stock`, `● Stock bajo`, `● Agotado`) con aviso no bloqueante en modo contingencia.
  * *Criterio de éxito:* Búsqueda y filtrado instantáneo en POS, renderizado de stock y fotos locales verificado con 109 tests pasando al 100% y typecheck limpio.
- [x] **PR-18: Ticket con Numpad para Cantidades/Pesables, IVA Real y Acciones Rápidas**
  * *Descripción:* Integrar `Numpad.tsx` ampliado (con punto decimal para pesables `kg`/`g` y borrado rápido) en el ticket, botón de eliminar línea individual, confirmación táctil para vaciar el ticket y cálculo real de impuestos con desglose de Subtotal Base Imponible + IVA (`tax_rate`) + Total en USD y VES congelados en la factura.
  * *Criterio de éxito:* Tocar una línea permite digitar `0.7500` kg o `24` und; el ticket y la factura computan el IVA exacto según el producto. 112 tests pasando y typecheck limpio.
- [x] **PR-19: Cobro Combinado (SPLIT), Calculadora de Vuelto Bimoneda y Numpad de Pago**
  * *Descripción:* Rediseño del modal de cobro para soportar pagos combinados (`SPLIT`) distribuyendo montos en efectivo USD, efectivo VES, Pago Móvil y Tarjeta/Punto. Teclado numérico táctil en pantalla, botón de autocompletado de saldo restante en un toque, calculadora reactiva en vivo de saldo pendiente y vuelto bimoneda (USD y VES), y desglose contable de métodos de pago en `balance.repository.ts` y en el arqueo Cierre Z.
  * *Criterio de éxito:* Cobro mixto con efectivo USD y Pago Móvil calcula el vuelto correcto y se refleja desglosado en el arqueo y balance. 115 tests pasando al 100% y typecheck limpio.
- [x] **PR-20: Estado Reactivo de Turno en App Shell, Banner de Turno en POS y Upsert de Tasa**
  * *Descripción:* Conectar el indicador del sidebar en `App.tsx` al turno real (`getOpenShift`), banner de alerta en `PosScreen` si no hay turno abierto con acceso directo a abrir sesión, y permitir actualización de la tasa del día (`upsertRate` / `allowUpdate: true`) con auditoría sin fallar por clave duplicada.
  * *Criterio de éxito:* El sidebar refleja el cajero y turno activo; banner avisa si no hay sesión activa; actualizar la tasa múltiples veces en el día no genera error. 119 tests pasando al 100% y typecheck limpio.
- [x] **PR-21: Movimientos de Gaveta (Sangrías/Ingresos) y Conteo por Denominación en Turnos**
  * *Descripción:* Registrar entradas y salidas de efectivo justificadas (sangrías / retiros por seguridad, fondo para vuelto, gastos menores), asistente táctil de arqueo ciego por denominación de billetes y reporte histórico de cierres Z.
  * *Criterio de éxito:* Retiro parcial por seguridad queda registrado y se descuenta del efectivo esperado en el Cierre Z; asistente de conteo de billetes autocompleta el arqueo. 124 tests pasando al 100% y typecheck limpio.
- [x] **PR-22: Historial de Ventas del Turno, Devoluciones (RETURN) y Sync P2P de Facturas**
  * *Descripción:* Pestaña de facturas emitidas en el turno con vista de comprobante/recibo digital, opción de anulación/devolución auditada que genera el delta `'RETURN'` en Kardex conmutativo, exclusión de facturas anuladas en el arqueo del turno (`calculateShiftAuditTotals` y `performCierreZ`), y encolado de `INVOICE` en `peer_sync_outbox` para sincronización Wi-Fi LAN entre cajas.
  * *Criterio de éxito:* Anular una factura restituye el stock de forma conmutativa, excluye su recaudación del turno y encola eventos en outbox para sincronización P2P. 129 tests pasando al 100% (23 suites) y typecheck TypeScript limpio.

### Fase 8: Configuración Operativa
- [x] **PR-23: Módulo de Configuración con IVA General Sugerido**
  * *Descripción:* Crear `SettingsScreen.tsx` (pestaña "Configuración" en `App.tsx`) con repositorio `settings.repository.ts` sobre la tabla `app_metadata` existente (upsert key/value). El IVA general sugerido (%) se configura globalmente y el formulario de producto en Inventario lo trae prellenado con sobrescritura opcional por producto (tasas reducidas 8% o exentas 0%). El badge y el cálculo del ticket ya consumían `products.tax_rate`, sin cambios.
  * *Criterio de éxito:* Cambiar el IVA sugerido afecta solo productos nuevos; productos existentes y facturas emitidas conservan su tasa congelada. 139 tests (24 suites) y typecheck limpio.
- [x] **PR-24: Verificación Ed25519 Real en App + Emisor de Licencias Offline en Go**
  * *Descripción:* Reemplazar el stub de `verifySignature` (que solo comprobaba 64 bytes en runtime sin `node:crypto`) por verificación real con `@noble/curves` (`ed25519.verify`), extrayendo la llave pública cruda del PEM SPKI con `spkiPemToRawPublicKey`. Crear `license-issuer/` (módulo Go dentro del repo) con `keygen`/`issue`/`verify` (stdlib `crypto/ed25519`), flujo de licencia por email sin backend, y llave pública demo embebida.
  * *Criterio de éxito:* Un token emitido por Go verifica en la app vía noble (interop end-to-end confirmada) y un payload adulterado es rechazado. 142 tests (25 suites) y typecheck limpio.
- [x] **PR-25: Rubros sin Control de Inventario (Requisito Carnicería)**
  * *Descripción:* Añadir `products.tracks_inventory` (INTEGER NOT NULL DEFAULT 1, con migración idempotente que corre antes del DDL para no romper las bases existentes) con semántica "rubro sin inventario": no conserva costo de reposición ni stock mínimo (se normalizan a `0.0000`), no genera kardex en ventas ni en anulaciones, no aparece en el semáforo de alertas ni en la valorización, y `v_product_current_stock` lo reporta en `0.0000`. El formulario de producto expone la casilla "Controlar inventario", que oculta costo, umbral y stock inicial; el POS muestra la insignia "Sin inventario" en lugar de Agotado/Bajo y suprime el aviso de stock negativo. La bandera viaja en el payload `PRODUCT` del outbox y en el alta/actualización de `p2p-http`, con default `1` para peers antiguos; el motor relacional Web/Tauri emula la nueva columna y la consulta de kardex por `reference_id`. La anulación restituye solo los ítems que efectivamente descontaron stock, de modo que cambiar la bandera a mitad de historia no descuadra el kardex.
  * *Criterio de éxito:* Suite `tests/inventory-untracked.test.ts` (bandera y normalización de costo, venta sin deltas, anulación conmutativa, exclusión de alertas y valorización, rechazo de ajustes manuales, payload P2P). 175 tests (29 suites) y `npm run typecheck` limpios; `npm run gen:schema` confirma que `SCHEMA_SQL` sigue sincronizado con `docs/database_schema.sql`.
- [x] **PR-26: Margen Bruto Solo sobre Venta con Costo Cargado (Cobertura de Costo)**
  * *Descripción:* `generatePeriodicBalance()` separaba mal: calculaba `margen = facturación_total − COGS`, contando como ingreso el IVA recaudado y declarando como utilidad el 100 % de toda venta cuyo costo de reposición no estaba cargado (rubros sin inventario del PR-25 y productos controlados con `cost_usd = 0.0000`). Ahora las líneas de factura se clasifican en dos canastas sobre venta neta (`costedSales` cuando `tracks_inventory = 1` y `cost_usd > 0`, `uncostedSales` en el resto), se expone `netSalesUsd/Ves`, `costedSalesUsd/Ves`, `uncostedSalesUsd/Ves` y `costCoveragePercent`, y el margen se calcula como `costedSales − COGS` con porcentaje sobre `costedSales` (no sobre la facturación total). `TopProductSale` gana `hasCost` para que un rubro sin costo no aparezca como el más rentable. `MonthlyBalanceScreen` muestra la tarjeta "Venta sin costo cargado", el subtítulo del margen con la base real y una nota al pie del ranking. La venta sin costo se reporta separada y jamás se suma al margen: afirmar utilidad donde no hay costo registrado es un dato falso, no un dato incompleto. La venta neta cuadra por invariante `costedSales + uncostedSales = netSales`. Sin cambios de esquema.
  * *Criterio de éxito:* Suite `tests/balance-margin-coverage.test.ts` (mix de rubro controlado con costo, rubro sin control y controlado con costo 0; cuadre de canastas; caso de cobertura 0 %) y `tests/balance-reports.test.ts` intacto, demostrando que una venta totalmente costuada conserva `COGS $16.0000 / margen $13.0000 / 44.83 %`. 175 tests (29 suites) y typecheck limpios.
- [x] **PR-27/28: Snapshot Congelado de Costo e Identidad en invoice_items**
  * *Descripción:* Cierra F1 y F2 de `docs/auditoria-inmutabilidad-historica.md`. Nuevas columnas nullable en `invoice_items`: `unit_cost_usd`, `product_name`, `product_sku`, `product_unit`, copiadas por `createInvoice` al momento del cobro (con override opcional `InvoiceItemInput.unitCostUsd`). Se usa `NULL` y no `'0.0000'` para que una línea heredada sea distinguible de un costo cero real; `generatePeriodicBalance` toma `ii.unit_cost_usd` con fallback a `products.cost_usd` solo en las filas anteriores a la migración, y el ranking reporta nombre/SKU históricos. `buildReceiptModel` imprime `it.productName` cuando existe y solo invoca `resolveItemName` en líneas heredadas, de modo que la inmutabilidad del documento la garantiza el compositor y no el llamador; `receiptItemName` del POS hace lo propio en pantalla. El evento `INVOICE` del outbox ahora lleva las líneas ya congeladas (antes copiaba el input crudo) y el motor relacional Web/Windows persiste y expone las cuatro columnas. Migración idempotente por `ALTER TABLE` en `migrations.ts`.
  * *Criterio de éxito:* `tests/invoice-snapshot.test.ts` (5 casos: congelamiento al cobrar, COGS y margen inmutables tras editar el costo, ticket y ranking inmutables tras renombrar el rubro, fallback `NULL` contra `products`, payload P2P) y `tests/migration-legacy-db.test.ts` (2 casos: base con `unit` y base anterior a `unit`, ambas migradas sin pérdida y migrables dos veces). 182 tests (31 suites) y typecheck limpios; `gen:schema` idempotente.
- [x] **PR-29/30: Tasa Vinculante del Turno, Bitácora de Correcciones y Secuencia Fiscal**
  * *Descripción:* Cierra F3, F4 y F5 de `docs/auditoria-inmutabilidad-historica.md`. `createInvoice` exige que la tasa del ticket coincida con `cash_shifts.exchange_rate_applied` (comparación decimal, así `40` y `40.0000` son la misma) y el POS deja de perseguir la última tasa del día: `checkShift` y `refreshCatalog` toman la tasa del turno abierto. Nuevo `setShiftExchangeRate`, única vía para corregir la tasa con el turno abierto: motivo obligatorio, turno OPEN y rechazo si ya tiene ventas (dirige a cerrar Z y abrir un turno nuevo), porque las ventas emitidas conservan su tasa congelada. `exchange_rate_corrections` conserva el valor reemplazado, el nuevo, el motivo, la caja, el contexto (`EXCHANGE_RATE` | `SHIFT`) y la fecha; la alimenta `registerManualRate` cuando cambia el valor oficial del día y la corrección del turno. `resolveDailyRate` sigue sin sobreescribir una tasa ya publicada. En el consecutivo, `MAX(...)+1` también reutilizaba número al borrar físicamente la factura más alta (lo demostró el test), así que se agregó `invoice_sequences(terminal_id, last_number, updated_at)` con `allocateInvoiceNumber` dentro del mismo `transaction()` de la emisión (un rollback no quema ni duplica) y sembrando su máximo histórico al primer uso; `generateNextInvoiceNumber` queda como lectura sin consumo y `UNIQUE(terminal_id, invoice_number)` permanece como segunda línea de defensa, omitiéndose en la migración si una base llegara con duplicados. El motor relacional Web/Windows emula las dos tablas nuevas.
  * *Criterio de éxito:* `tests/exchange-rate-immutability.test.ts` (10 casos: rechazo de tasa distinta a la del turno, equivalencia decimal, sin media factura tras el rechazo, corrección de turno sin ventas con rastro, motivo obligatorio, tasa idéntica rechazada, turno con ventas bloqueado, la corrección del día no re-tasa venta ni arqueo cerrado, sin corrección duplicada cuando el valor no cambia, `resolveDailyRate` conserva la del día, el consecutivo no retrocede tras un borrado físico, índice único por terminal, y una emisión fallida no quema el consecutivo) y las suites previas intactas. 192 tests (32 suites) y typecheck limpios.
  * *Pendiente:* PR-31 (F6: categoría como atributo vivo, solo si el balance llega a agrupar por rubro) y la vista en pantalla de la bitácora `exchange_rate_corrections` (el dato ya es consultable con `listRateCorrections`). Detalle en `docs/auditoria-inmutabilidad-historica.md`.