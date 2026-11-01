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
Optimizado para reducir fatiga visual en turnos prolongados y destacar estados críticos mediante contrastes luminosos de alta fidelidad.

| Rol del Token | Código Hexadecimal | Uso y Aplicación |
|---|---|---|
| **Primary Brand (Cobalt Blue)** | `#1D61E0` | Acciones principales, botones primarios, enlaces activos y acentos del sistema. |
| **Primary Light / Glow** | `#3B82F6` | Estados de foco, bordes activos de campos y chips seleccionados. |
| **Secondary (Emerald Green / Success)** | `#00B074` / `#10B981` | Botón maestro de cobro, arqueo cuadrado, estado en línea sincronizado y badges de stock alto. |
| **Accent Gradient** | `linear-gradient(135deg, #1D61E0 0%, #00B074 100%)` | Botones de inicio de sesión, cabeceras maestras de llamada a la acción y banners destacados. |
| **Surface Dark Base** | `#061426` | Fondo principal de la aplicación (`body` / contenedor global). |
| **Surface Dim / Lowest** | `#020E21` | Zonas traseras, backdrop de modales y áreas periféricas. |
| **Surface Container Low** | `#0E1C2F` | Paneles laterales fijos, barra superior de navegación y tarjetas base. |
| **Surface Container** | `#14243B` | Tarjetas interactivas de productos, tarjetas de denominación de billetes y filas de tabla. |
| **Surface Container High** | `#1E314B` | Teclas del teclado numérico (`numpad`), contenedores flotantes e inputs activos. |
| **Surface Container Highest** | `#283F5E` | Bordes divisorios sutiles, estados activos de selección y hover accesible. |
| **Border / Outline** | `rgba(255, 255, 255, 0.08)` a `#1E293B` | Separadores de rejilla y marcos de tarjeta. |
| **Text Primary (High Contrast)** | `#FFFFFF` o `#F8FAFC` | Rótulos principales, montos totales y títulos. |
| **Text Secondary (Medium Contrast)** | `#94A3B8` | SKUs, metadatos, descripciones secundarias y marcas de tiempo. |
| **Text Muted** | `#64748B` | Etiquetas secundarias de pie de página y texto inactivo. |
| **Warning / Offline (Ámbar)** | `#F59E0B` / `#D97706` | Modo offline activo, operaciones en cola pendientes y banners de contingencia. |
| **Error / Dead-Letter (Rojo Carmesí)** | `#EF4444` / `#DC2626` | Conflictos de sincronización, descuadre de caja y descarte de tickets. |

---

### B. Light Mode (Modo Claro de Alto Contraste para Exterior / Diurno)
Diseñado para quioscos o locales comerciales con alta luz solar directa, manteniendo la solidez del azul marino y verde esmeralda.

| Rol del Token | Código Hexadecimal | Uso y Aplicación |
|---|---|---|
| **Primary Brand (Cobalt Blue)** | `#1550BC` | Botones primarios, enlaces y acentos en superficies claras. |
| **Secondary (Emerald Green)** | `#059669` | Botones de cobro, montos a favor y estados confirmados. |
| **Surface Base** | `#F8FAFC` | Fondo principal del viewport y lienzo. |
| **Surface Container Low** | `#FFFFFF` | Tarjetas de producto, contenedores de tickets y modales. |
| **Surface Container** | `#F1F5F9` | Barra lateral de navegación y cabecera superior. |
| **Surface Container High** | `#E2E8F0` | Botones numéricos de teclado en pantalla, inputs y barras de herramientas. |
| **Border / Outline** | `#CBD5E1` | Bordes estructurados de tarjetas, tablas y separadores. |
| **Text Primary** | `#0F172A` | Títulos, importes monetarios y etiquetas principales. |
| **Text Secondary** | `#475569` | SKUs, subtítulos y datos contextuales. |
| **Text Muted** | `#64748B` / `#94A3B8` | Placeholders y marcas de tiempo. |
| **Warning (Ámbar)** | `#D97706` (Fondo: `#FEF3C7`) | Alertas de operaciones offline. |
| **Error (Rojo)** | `#DC2626` (Fondo: `#FEE2E2`) | Descuadres y transacciones fallidas. |

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
2. **Priorizar modo oscuro por defecto**: A menos que el usuario especifique modo claro, mantener la coherencia con `#061426` y `#0E1C2F`.
3. **Respetar la proporción 1280×800**: Mantener diseños limpios con densidad adecuada, sin scrollbars innecesarias en el contenedor principal.
4. **Usar los identificadores de imagen oficiales**:
   * Logo completo horizontal: `{{DATA:IMAGE:IMAGE_14}}`
   * Monograma / Isotipo: `{{DATA:IMAGE:IMAGE_13}}`
   * Logo cuadrado / App icon: `{{DATA:IMAGE:IMAGE_15}}`
   * Wordmark simple: `{{DATA:IMAGE:IMAGE_12}}`
5. **Vincular el Design System**: Usar siempre el ID `{{DATA:DESIGN_SYSTEM:DESIGN_SYSTEM_1}}` para guardar coherencia de tokens.
