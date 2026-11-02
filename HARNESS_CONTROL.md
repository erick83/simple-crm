# HARNESS_CONTROL.md — Tablero de Control y Bitácora P2P

Archivo de seguimiento y memoria persistente entre sesiones de desarrollo para Antigravity y OpenCode.

---

## 1. Estado de la Última Sesión (Handoff)
* **Fecha:** 2026-11-02
* **Arquitectura:** React Native (Expo SDK 52, Android / Web / Windows) + SQLite local (`op-sqlite`) + P2P LAN Wi-Fi (mDNS/HTTP) + Validador Offline Ed25519. $0 Cloud / Cero Servidores Backend.
* **Look & Feel:** Dark Mode nativo (`#061426`), Touch Targets 48px/64px, Landscape 1280×800 px, aritmética decimal fija a 4 decimales (`tabular-nums`).
* **Estado actual:** PR-20 completado (Fases 1 a 6 cerradas al 100%, Fase 7 con PR-17, PR-18, PR-19 y PR-20 finalizados). Integración reactiva completa de turnos de caja y tasa cambiaria: (1) Indicador dinámico en la barra lateral (`App.tsx`) conectado a `getOpenShift(db, terminalId)`, mostrando nombre del cajero, número de turno activo y punto de estado verde/ámbar con navegación directa al gestor de turnos; (2) Banner de advertencia en `PosScreen.tsx` cuando no hay turno abierto para la terminal con botón táctil directo "Abrir Turno"; (3) Soporte de upsert auditado para la tasa cambiaria del día en `exchange.repository.ts` y `bcv-exchange.service.ts` (`allowUpdate: true`), posibilitando registrar ajustes intradía desde la interfaz sin conflictos de unicidad; (4) 119 tests unitarios e integrados pasando al 100% (21 suites) y chequeo estricto TypeScript limpio.
* **Próxima tarea a ejecutar:** PR-21: Movimientos de Gaveta (Sangrías/Ingresos) y Conteo por Denominación en Turnos.

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
- [ ] **PR-21: Movimientos de Gaveta (Sangrías/Ingresos) y Conteo por Denominación en Turnos**
  * *Descripción:* Registrar entradas y salidas de efectivo justificadas (sangrías, fondo para vuelto, gastos menores), asistente táctil de arqueo ciego por denominación de billetes y reporte histórico de cierres Z.
  * *Criterio de éxito:* Retiro parcial por seguridad queda registrado y se descuenta del efectivo esperado en el Cierre Z.
- [ ] **PR-22: Historial de Ventas del Turno, Devoluciones (RETURN) y Sync P2P de Facturas**
  * *Descripción:* Pestaña de facturas emitidas en el turno con vista de comprobante/recibo digital, opción de anulación/devolución que genera el delta `'RETURN'` en Kardex, y encolado de `INVOICE` en `peer_sync_outbox` para sincronización Wi-Fi LAN entre cajas.
  * *Criterio de éxito:* Anular una factura restituye el stock y ambas cajas sincronizan las facturas de la tienda.