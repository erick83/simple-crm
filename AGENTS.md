# AGENTS.md — Constitución del Sistema (POS P2P Local-First)

Este documento define las reglas estrictas, la arquitectura y las directrices técnicas que todos los agentes de IA (Antigravity, OpenCode) deben seguir obligatoriamente en este repositorio.

---

## 1. Stack Tecnológico y Plataforma (Cero Desviaciones)

* **Frontend / Cliente:** **React Native** (TypeScript) con arquitectura multiplataforma:
  * **Móvil / Tablet:** Android (APK / Google Play Billing).
  * **Escritorio:** Windows vía React Native for Windows o wrapper ligero (Tauri / React Native for Web).
* **Persistencia Local:** **SQLite nativo** (`op-sqlite` o equivalente de alto rendimiento JSI/C++; en Web/Tauri, SQLite WASM con OPFS). Prohibido el uso de IndexedDB o AsyncStorage para datos de negocio. Todo acceso a SQLite pasa por la interfaz `SqlDriver` (`frontend/src/db/driver.ts`).
* **Red y Topología:** **Local-First P2P Puro**. No existe base de datos centralizada ni servidor SaaS operativo. Los dispositivos en la misma tienda se comunican y sincronizan directamente por red local (Wi-Fi) vía **mDNS / Bonjour** y peticiones HTTP/TCP directas.
* **Sin backend:** Todo el sistema (base de datos, lógica de negocio, licenciamiento y sincronización) corre en el cliente React Native bajo `/frontend`. No existe servidor, API remota ni CLI propio. La emisión de licencias (backend/CLI Ed25519) es un **proyecto futuro** fuera de este repositorio; la app solo **verifica** tokens con una llave pública embebida.

---

## 2. Reglas Estrictas de Tipos e Integridad

1. **Identificadores:** Uso mandatorio de **UUIDv7** para todas las transacciones, productos, turnos, movimientos de inventario y tasas de cambio para garantizar orden cronológico y evitar colisiones entre cajas independientes.
2. **Matemática Financiera y Cantidades:** Uso obligatorio de librerías de precisión fija (ej. `decimal.js` o `bignumber.js` en TypeScript). **PROHIBIDO** el uso de tipos `number` flotantes nativos en precios, tasas cambiarias, totales o inventario (incluye `CAST ... AS REAL` en SQL).
3. **Kardex Conmutativo por Deltas:** Ninguna caja puede sobreescribir el stock de otra. El inventario se computa mediante la suma acumulada de registros delta inmutables (`quantity_delta: -1.0000`, `+10.0000`, 4 decimales) en la tabla `stock_movements`.

---

## 3. Especificación de Módulos Core en React Native

1. **Facturación y Flujo de Caja:**
   * Terminal de venta con soporte para múltiples métodos de pago combinados.
   * Gestión de sesiones de caja (`cash_shifts`): registro de fondo inicial, arqueo X (corte parcial) y cierre Z (arqueo ciego con detección de descuadres), con efectivo USD y efectivo VES contados de forma independiente.
   * Generación de balance mensual y acumulados contables mediante consultas de agregación en SQLite.
2. **Módulo Cambiario / Bimoneda (USD / VES - Exclusivo Venezuela):**
   * Activación condicional por configuración de país (`country_code == 'VE'`).
   * Consulta/scraping de la tasa oficial del BCV con fallback a captura manual auditada (motivo obligatorio) en la apertura de turno.
   * **Inmutabilidad en factura:** Cada venta congela permanentemente la tasa aplicada (`exchange_rate`), los montos en USD (`subtotal_usd`, `total_usd`) y el equivalente legal en VES (`subtotal_ves`, `total_ves`). Jamás se recalculan retrospectivamente.
3. **Inventario y Manejo de Imágenes:**
   * Catálogo con búsqueda indexada por código de barras (`barcode`; EAN-13, UPC, Code 128), SKU y categoría.
   * Carga de fotos con redimensionado y compresión en el dispositivo (WebP/JPEG, máx. 600x600 px, peso <80 KB), almacenando solo la ruta del archivo local en SQLite.
4. **Entrada de Datos por Código de Barras (HID):**
   * Captura global de eventos de teclado para pistolas y escáneres USB/Bluetooth que operen como dispositivos HID (pulsaciones rápidas, <30 ms entre teclas, finalizadas en `Enter`).
   * Alternativa de escaneo por cámara de la tablet/teléfono para terminales sin hardware externo.

---

## 4. Licenciamiento Criptográfico Offline-First

* **Hardware Binding (Windows):** La app extrae un identificador inmutable (`HWID = SHA256(Motherboard_UUID + CPU_Serial)`). En Android se usará un identificador equivalente definido en el PR correspondiente.
* **Verificación Ed25519:** La app valida localmente la firma del token JSON emitido por el emisor de licencias externo (proyecto futuro) usando la llave pública embebida. Si `HWID_local != token.hwid` o la fecha expiró, la app bloquea las funciones de cobro.
* **Guardia de Reloj Monótono:** La app almacena `last_recorded_timestamp` en cada operación. Si el reloj del dispositivo se atrasa deliberadamente, el sistema se bloquea hasta restablecer la hora real.

---

## 5. Diseño Visual y Reglas Táctiles (UI/UX)

Todo componente visual debe cumplir estrictamente con:
* `docs/skills/bisync-pos-design-guide.md`
* Orientación preferente horizontal (**Landscape**, estándar 1280×800 px para tablets).
* Tema por defecto: el del sistema operativo, con conmutador claro/oscuro (Dark: base `#0A0D12`, contenedores `#10141A`, acento primario `#1D61E0`, cobro `#00B074`; Light: base `#F4F6F8`, contenedores `#FFFFFF`, acento `#1550BC`, cobro `#047857`). Superficies neutras: el cobalto no tiñe la interfaz entera.
* **Touch Targets mínimos de 48×48 px** (64 px para cobro, cierre Z y teclado numérico). Cero dependencias de eventos `hover`.
* Formateo numérico tabular con 4 decimales exactos (`tabular-nums`, Plus Jakarta Sans): `$ X,XXX.0000` y `Bs. X,XXX.0000`.

---

## 6. Protocolo de Ejecución para Agentes

1. Trabajar estrictamente **un Micro-PR a la vez** respetando el orden secuencial de `HARNESS_CONTROL.md`.
2. Mantener cada PR dentro de 150 a 300 líneas auditables por un humano.
3. Prohibido agregar dependencias que requieran servidores web centrales de datos o bases de datos externas en la nube.

## Code Exploration Policy

Always use jCodeMunch-MCP for code navigation. Never fall back to Read, Grep, Glob, or Bash for code exploration.
**Exception:** use `Read` when you are about to edit a file — the harness requires a `Read` before `Edit`/`Write`. Use jCodeMunch to *find and understand* code, then `Read` only the file you are changing.

This server runs the **front door** surface: three tools reach every jCodeMunch capability, so the tool list stays small and the catalogue is fetched only when you need it.

**Start any session:**
1. `order { "action": "resolve_repo", "args": { "path": "." } }` — confirm the project is indexed. If it is not: `order { "action": "index_folder", "args": { "path": "." } }`

**Then, for any task:**
- Know what you want → `order { "action": "<name>", "args": { ... } }`
- Know the goal, not the tool → `route { "query": "your task in a sentence" }` picks the action and shapes the arguments
- Want to see what exists → `menu { "query": "what you are trying to do" }` returns matching actions with example arguments
- Want the whole catalogue and the usage rules → `jcodemunch_guide`

`menu` and `jcodemunch_guide` list every action this server can run, including ones absent from your tool list. That is expected: the front door is the way to call them.

**Interpreting results:**
- A `verdict` of `no_implementation_found` is evidence of absence. Report the gap; do not re-search with different wording.
- A `verdict` of `degraded` means a channel was unavailable, so absence is NOT proven. Read the note before relying on the result.
- `source: ""` alongside `source_status` means the body could not be read, not that the symbol is empty.

**After editing files:**
- With PostToolUse hooks installed (Claude Code), edited files are reindexed automatically.
- Otherwise `order { "action": "register_edit", "args": { "paths": [...] } }` after an edit, batched for bulk changes.

**Announce your model once per session** so the server can size its answers: `announce_model { "model": "<your-model-id>" }`.

