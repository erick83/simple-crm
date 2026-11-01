# AGENTS.md — Constitución del Sistema (POS P2P Local-First)

Este documento define las reglas estrictas, la arquitectura y las directrices técnicas que todos los agentes de IA (Antigravity, OpenCode) deben seguir obligatoriamente.

---

## 1. Alcance y Filosofía del Sistema ($0 Infraestructura Cloud)

* **Topología P2P Local Pura:** NO existe backend centralizado de negocio ni base de datos SaaS en la nube. Los datos residen 100% en los dispositivos físicos de la tienda y se respaldan mediante replicación cruzada.
* **Persistencia Local:** Cada terminal gestiona su propia base de datos completa con SQLite (`op-sqlite`).
* **Tooling de Licencias Offline:** Un script/CLI local en Go (en `/tools/license-cli`) genera y firma los certificados Ed25519 para clientes en Windows. NO requiere servidores web activos 24/7.
* **Sincronización P2P en Wi-Fi:** Descubrimiento automático en red local (mDNS) y comunicación HTTP/TCP directa entre cajas bajo demanda para consultas de stock, catálogos y replicación de deltas.

---

## 2. Reglas Estrictas de Tipos e Integridad

1. **Identificadores:** Uso mandatorio de **UUIDv7** para todas las transacciones, productos, turnos, tasas y movimientos.
2. **Matemática Financiera y Multimoneda:** Uso estricto de tipos de precisión fija (librerías decimales en TypeScript/React Native). **PROHIBIDO** el uso de flotantes nativos (`number` impreciso) para precios, tasas de cambio o importes.
3. **Inmutabilidad Cambiaria en Facturas:** Toda factura emitida DEBE congelar:
   * Montos en moneda base (`subtotal_usd`, `total_usd`).
   * Tasa de cambio oficial aplicada en ese instante (`exchange_rate`).
   * Montos en moneda de curso legal (`subtotal_ves`, `total_ves`).
   * Estos valores jamás se recalculan retrospectivamente.

---

## 3. Módulos Core y Hardware

1. **Módulo de Facturación y Cierres X/Z:**
   * Fondo y arqueo ciego bimoneda (efectivo USD y efectivo VES independientes).
   * Generación de balances consolidados mensuales en SQLite.
2. **Módulo de Inventario e Imágenes:**
   * Catálogo con búsqueda por código de barras (EAN-13, UPC, Code 128).
   * Redimensionado de imágenes en el cliente a un máximo de 600x600 px (WebP <80 KB) almacenadas en el filesystem local.
3. **Integración con Lectores de Códigos de Barras:**
   * Listener global de teclado en modo **HID (Human Interface Device)**: detección de ráfagas rápidas (<30 ms entre teclas) finalizadas en `Enter` para cargar productos de inmediato en facturación.
4. **Módulo de Tasa BCV (Venezuela):**
   * Detección por configuración regional (`country_code == 'VE'`).
   * Consulta al portal oficial del BCV o API de contingencia; si está offline, permite el registro manual auditado en la apertura de turno.

---

## 4. Reglas de Ejecución para Agentes

1. Trabajar estrictamente **un Micro-PR a la vez** respetando el orden secuencial de `HARNESS_CONTROL.md`.
2. Mantener cada PR dentro de un rango de 150 a 300 líneas auditables por un humano.
3. Prohibido agregar dependencias que requieran servidores o bases de datos externas.

## 5. Directriz Obligatoria de Look & Feel y Diseño Táctil (UI/UX)

* Archivo de Referencia: `docs/skills/bisync-pos-design-guide.md`
* Form Factor: Tablet táctil en orientación horizontal (Landscape, 1280 × 800 px).
* Tema por Defecto: Dark Mode (#061426 base, #0E1C2F contenedores, #1D61E0 acento primario y #00B074 botón maestro de cobro).
* Ergonomía Táctil:
  * Botones de acción crítica (Cobrar, Cierre Z): 64 px de altura.
  * Teclado numérico táctil (Numpad): teclas de mínimo 64 × 64 px.
  * Controles secundarios (steppers, filtros, pestañas): mínimo 48 × 48 px.
  * Cero interacciones dependientes de hover.
* Formato Numérico: Fuentes tabulares (tabular-nums con Plus Jakarta Sans) mostrando 4 decimales exactos ($ X,XXX.0000 y Bs. X,XXX.0000).
