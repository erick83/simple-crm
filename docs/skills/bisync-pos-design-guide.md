---
name: bisync-pos-design-guide
description: Guía de diseño, tokens, paletas de color (Dark y Light), Look & Feel, componentes táctiles y reglas offline-first para la PWA de Punto de Venta (POS) y CRM BISync Solutions.
---

# BISync Solutions POS & CRM — Design System & Look & Feel Guide

Esta especificación detalla las directrices estéticas, paletas cromáticas (Dark y Light Mode), arquitectura visual, microinteracciones y reglas ergonómicas táctiles de la plataforma **BISync Solutions POS**. Diseñado para que cualquier agente o modelo de diseño y desarrollo genere interfaces con coherencia y precisión de grado de producción.

---

## 1. Identidad de Marca y Esencia Visual (Look & Feel)

* **Arquetipo**: Sistema Industrial / FinTech táctil para Punto de Venta y CRM de alta disponibilidad (*Offline-First*).
* **Sensación Clave**: Robusto, confiable, veloz (0 ms de latencia local), táctil-ergonómico y con jerarquía visual nítida para ambientes comerciales con iluminación variable.
* **Form Factor Estándar**: Tablets táctiles en orientación horizontal / Landscape (**1280 × 800 px** o 1920 × 1080 px).
* **Filosofía Táctil**:
  * **Cero interacciones basadas en hover**: Todo control debe comunicar su estado sin necesidad de puntero de ratón.
  * **Zonas táctiles (Touch Targets)**: Mínimo **48 × 48 px** para controles secundarios (steppers, filtros, pestañas); botones de acción crítica (Cobrar, Confirmar, Cerrar Turno) y teclas de teclados numéricos a **64 px**.
  * **Tipografía numérica tabular**: Importes monetarios presentados con fuente monoespaciada/tabular y **4 decimales exactos** (formato: `$ 22,015.0000`).

---

## 2. Paletas Cromáticas Detalladas

### A. Dark Mode (Tema Nativo Principal de Caja)
Superficies neutras (grafito) para reducir fatiga visual en turnos prolongados; el cobalto se reserva a la acción primaria y a la selección activa.

| Rol del Token | Código Hexadecimal | Uso y Aplicación |
|---|---|---|
| **Primary Brand (Cobalt Blue)** | `#1D61E0` | Relleno de acciones principales y selección activa. |
| **Primary Glow (acento de texto)** | `#6EA8FF` | Texto de enlaces, bordes de foco y chips seleccionados. |
| **Primary Soft** | `rgba(29, 97, 224, 0.18)` | Fondo del ítem de navegación activo y píldoras seleccionadas. |
| **Secondary (Emerald Green / Success)** | `#00B074` / `#10B981` | Botón maestro de cobro, arqueo cuadrado y badges de stock alto. |
| **Hero Text** | `#34D8A4` | Importes y estados positivos sobre superficie. |
| **On Hero / On Primary** | `#04170F` / `#FFFFFF` | Texto sobre relleno esmeralda / cobalto. |
| **Surface Base** | `#0A0D12` | Fondo principal de la aplicación. |
| **Surface Dim / Lowest** | `#05070A` | Zonas traseras y áreas periféricas. |
| **Surface Container Low** | `#10141A` | Paneles laterales, barra superior y modales. |
| **Surface Container** | `#161B23` | Tarjetas de producto y filas de ticket. |
| **Surface Container High** | `#1E242D` | Teclas del numpad, inputs y contenedores flotantes. |
| **Surface Container Highest** | `#2B3340` | Estados activos de selección y rieles de control. |
| **Border / Outline** | `rgba(255, 255, 255, 0.08)` / `#232A34` | Separadores de rejilla y marcos de tarjeta. |
| **Text Primary (High Contrast)** | `#F3F6F9` | Rótulos principales, montos totales y títulos. |
| **Text Secondary (Medium Contrast)** | `#A3ADBA` | SKUs, metadatos, descripciones y marcas de tiempo. |
| **Text Muted** | `#7E8A99` | Etiquetas secundarias y texto inactivo. |
| **Warning / Offline (Ámbar)** | `#F5A524` (texto `#F7B955`) | Modo offline, cola pendiente y banners de contingencia. |
| **Error / Dead-Letter (Rojo)** | `#DC2626` (texto `#FF7A7A`) | Conflictos de sincronización, descuadre de caja y descarte de tickets. |

---

### B. Light Mode (Modo Claro de Alto Contraste para Exterior / Diurno)
Diseñado para quioscos o locales comerciales con alta luz solar directa, sobre porcelana neutra.

| Rol del Token | Código Hexadecimal | Uso y Aplicación |
|---|---|---|
| **Primary Brand (Cobalt Blue)** | `#1550BC` | Relleno de botones primarios y selección activa. |
| **Primary Glow (acento de texto)** | `#1A56C4` | Enlaces, bordes de foco y acentos sobre superficies claras. |
| **Secondary (Emerald Green)** | `#047857` (texto `#046C4E`) | Botones de cobro, montos a favor y estados confirmados. |
| **Surface Base** | `#F4F6F8` | Fondo principal del viewport y lienzo. |
| **Surface Container Low** | `#FFFFFF` | Tarjetas de producto, contenedores de tickets y modales. |
| **Surface Container** | `#EFF2F5` | Barra lateral de navegación y cabecera superior. |
| **Surface Container High** | `#E3E7EC` | Botones numéricos de teclado en pantalla, inputs y barras de herramientas. |
| **Border / Outline** | `#DFE4EA` / `#CBD2DB` | Bordes estructurados de tarjetas, tablas y separadores. |
| **Text Primary** | `#0C1116` | Títulos, importes monetarios y etiquetas principales. |
| **Text Secondary** | `#46505D` | SKUs, subtítulos y datos contextuales. |
| **Text Muted** | `#6A7583` | Placeholders y marcas de tiempo. |
| **Warning (Ámbar)** | `#B45309` (Fondo: `#FEF3C7`) | Alertas de operaciones offline. |
| **Error (Rojo)** | `#DC2626` (texto `#B91C1C`) | Descuadres y transacciones fallidas. |

Los tokens viven en `frontend/src/theme/tokens.ts`; `useTheme()` expone la paleta activa y `useThemedStyles()` reconstruye los `StyleSheet` al cambiar de tema. El contraste mínimo AA está cubierto por `frontend/tests/react-native-shell.test.ts`.

---

## 3. Tipografía y Estilo Numérico

* **Familia Tipográfica Primaria**: `Plus Jakarta Sans`, con respaldo en `Inter` o sistema `sans-serif`.
* **Fuente Numérica para Caja**: `Plus Jakarta Sans` con clases Tailwind `font-mono tabular-nums` o soporte OpenType `tnum` para alineación perfecta de columnas decimales.
* **Escala de Tamaños**:
  * **Total Maestro en Carrito / Modal de Cobro**: `text-4xl` a `text-5xl` (36px – 48px), `font-extrabold` o `font-black`.
  * **Títulos de Sección & Encabezados**: `text-xl` a `text-2xl` (20px – 24px), `font-bold`.
  * **Teclado Numérico (Dígitos)**: `text-2xl` a `text-3xl` (24px – 30px), `font-semibold`.
  * **Cuerpo & Nombres de Producto**: `text-base` (16px), `font-medium`.
  * **Metadatos, SKUs, Badges**: `text-xs` a `text-sm` (12px – 14px), `font-semibold` o `font-bold` en mayúsculas pequeñas (*smallcaps*).

---

## 4. App Shell y Estructura Arquitectónica

1. **Barra Lateral Izquierda (Persistent Left Sidebar - Ancho ~220-240px)**:
   * **Zona Superior**: Logotipo de la marca (`BISync.webp` / `BISync-FullLogo.webp` o monograma `BISyncISO.webp`).
   * **Menú de Navegación Vertical**:
     * Items táctiles (altura mínima 52px con icono 24px + etiqueta legible).
     * Módulos: **Caja (POS)**, **Inventario**, **Turnos**, **Sincronización** (con badge numérico ámbar si hay cola), **Ajustes**.
     * Item activo: Píldora destacada en Cobalt Blue (`#1D61E0`) con esquinas redondeadas (`rounded-xl`).
   * **Zona Inferior**: Indicador de **Turno Activo** (Cajero en sesión, número de turno `#402`, punto verde de estado activo).

2. **Barra Superior (Top Header - Altura 64px)**:
   * **Chip Maestro de Sincronización (Multi-Estado)**:
     * *Verde*: `● En línea | Sincronizado hace 1 min (0 pendientes)`
     * *Azul animado*: `↻ Sincronizando 4 operaciones...`
     * *Ámbar*: `⚡ Trabajando Offline | 12 operaciones en SQLite | Última sinc: hace 28 min`
     * *Rojo*: `⚠ Retraso crítico +4 h | [Descargar Respaldo]`
   * **Sede Activa**: Icono de ubicación + Nombre de Sede (ej. `Sede Central – Bogotá`).
   * **Perfil del Cajero**: Avatar circular + Nombre de usuario + Rol.
   * **Acceso Rápido**: Botón táctil rojo o contorneado `Cerrar Turno`.

---

## 5. Patrones de Componentes Específicos

### A. Botón de Cobro Maestro (Hero Action)
* **Altura**: **64 px** exacta (`h-16`).
* **Estilo**: Fondo Emerald Green (`#00B074`), texto en negrita blanco/negro de alto contraste, icono de billete o POS a la izquierda y monto total dinámico a la derecha.
* **Comportamiento**: Ancho completo en el panel del carrito; fácil de presionar con el pulgar derecho en sujeción de tablet.

### B. Teclado Numérico Táctil en Pantalla (Numpad)
* **Dimensiones de Tecla**: Mínimo **64 × 64 px** por tecla en cuadrícula de 3 columnas (1-9, C / Borrar, 0, 00 / Enter).
* **Feedback Visual**: Elevación táctil visible (`bg-surface-container-high` con borde `border border-white/10` y transición inmediata a escala sutil al toque).

### C. Rejilla de Productos (POS Catalog)
* Tarjetas con relación de aspecto cómoda, imagen de producto recortada arriba, nombre en 2 líneas, SKU discreto, badge de stock (`● 48 en stock` en verde o `● 8 bajo stock` en naranja) y precio grande en la base.

### D. Steppers de Cantidad (− / +)
* Botones cuadrados con área mínima de 44×44 px o 48×48 px, separando el valor numérico en el centro para evitar toques erróneos durante el ritmo rápido de caja.

### E. Banners de Contingencia Offline-First
* Fondo con tinte ámbar oscuro (`rgba(245, 158, 11, 0.15)`) con borde ámbar suave, icono de rayo o alerta, y acciones directas: `Sincronizar Ahora` o `Exportar .json`.

---

## 6. Instrucciones para Agentes / Modelos al Generar Nuevas Pantallas

1. **Nunca omitir los 4 decimales**: Siempre formatear importes como `$ X,XXX.0000`.
2. **Tema oscuro por defecto, ambos temas soportados**: La app arranca en el tema del sistema y ofrece un conmutador claro/oscuro. Nunca codificar colores literales: usar los tokens de `frontend/src/theme/tokens.ts` vía `useThemedStyles`.
3. **Responsive en tres anchos**: móvil (`< 720 px`, una columna + navegación inferior de 64 px), tablet (`720–1023 px`, riel lateral de iconos de 88 px) y escritorio (`≥ 1024 px`, barra lateral de 240 px). Conservar 1280×800 como lienzo de referencia para tablet horizontal, sin scrollbars innecesarias en el contenedor principal.
4. **Usar los identificadores de imagen oficiales**:
   * Logo completo horizontal: `{{DATA:IMAGE:IMAGE_14}}`
   * Monograma / Isotipo: `{{DATA:IMAGE:IMAGE_13}}`
   * Logo cuadrado / App icon: `{{DATA:IMAGE:IMAGE_15}}`
   * Wordmark simple: `{{DATA:IMAGE:IMAGE_12}}`
5. **Vincular el Design System**: Usar siempre el ID `{{DATA:DESIGN_SYSTEM:DESIGN_SYSTEM_1}}` para guardar coherencia de tokens.
