# HARNESS_CONTROL.md — Tablero de Control y Bitácora P2P

Archivo de seguimiento y memoria persistente entre sesiones de desarrollo para Antigravity y OpenCode.

---

## 1. Estado de la Última Sesión (Handoff)
* **Fecha:** 2026-11-01
* **Arquitectura:** React Native (Expo SDK 52, Android / Web / Windows) + SQLite local (`op-sqlite`) + P2P LAN Wi-Fi (mDNS/HTTP) + Validador Offline Ed25519. $0 Cloud / Cero Servidores Backend.
* **Look & Feel:** Dark Mode nativo (`#061426`), Touch Targets 48px/64px, Landscape 1280×800 px, aritmética decimal fija a 4 decimales (`tabular-nums`).
* **Estado actual:** PR-07 completado. Emisión de facturas con inmutabilidad cambiaria permanente, congelamiento de totales USD/VES, descuento atómico en Kardex delta conmutativo y modal táctil de cobro conectado. Los 47 tests unitarios e integrados pasan al 100% y typecheck limpio.
* **Próxima tarea a ejecutar:** PR-08 (Módulo de Balance Periódico y Cierre Mensual con agregaciones contables en SQLite).

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
- [ ] **PR-08: Módulo de Balance Periódico y Cierre Mensual**
  * *Descripción:* Consultas agregadas en SQLite para totalizar ingresos por método de pago, volumen y margen para cualquier rango de fechas.
  * *Criterio de éxito:* Reporte mensual calcula exactamente las sumatorias por moneda y método de cobro.

### Fase 4: Licenciamiento Criptográfico Offline-First
- [ ] **PR-09: Validador de Licencia en App y Guardia de Reloj Monótono**
  * *Descripción:* Verificación en la app usando la llave pública Ed25519, chequeo de coincidencia con el `HWID` local y bloqueo si `last_recorded_timestamp` detecta atraso de fecha.
  * *Criterio de éxito:* App activa el cobro con licencia válida; se bloquea si el HWID difiere o el reloj es manipulado.

### Fase 5: Red Local y Sincronización Wi-Fi P2P
- [ ] **PR-10: Descubrimiento de Cajas por mDNS en Red Wi-Fi**
  * *Descripción:* Anuncio y detección de terminales en la red local (`_cajapos._tcp`).
  * *Criterio de éxito:* Dos cajas en la misma Wi-Fi intercambian sus IPs privadas automáticamente.
- [ ] **PR-11: Servidor HTTP Embebido para Consultas On-Demand**
  * *Descripción:* Mini-servidor HTTP local en la app para responder endpoints: `GET /p2p/stock?sku=XYZ` y `GET /p2p/exchange-rate`.
  * *Criterio de éxito:* La Caja 2 consulta el inventario en tiempo real de la Caja 1 en <15 ms.
- [ ] **PR-12: Replicación Cruzada y Respaldo P2P de Deltas**
  * *Descripción:* Endpoint `POST /p2p/sync/deltas` que recibe lotes de `peer_sync_outbox`, los persiste de forma idempotente y actualiza el inventario local.
  * *Criterio de éxito:* Las ventas de la Caja 1 quedan respaldadas automáticamente en la Caja 2.