# frontend — Bisync POS (P2P Local-First)

Cliente React Native (TypeScript) del POS. Corre en tres destinos desde el
mismo código:

| Destino | Tecnología | Comando de build |
|---|---|---|
| Android (móvil/tablet) | React Native + Expo | `eas build` / `expo run:android` |
| Web (navegador) | React Native Web + Expo | `npm run web:build` |
| Escritorio Windows | Tauri 2 (embebe el bundle web) | `npm run desktop:build` |

No hay servidor central: la base de datos (SQLite), la lógica de negocio y la
sincronización P2P corren en el dispositivo.

---

## 1. Requisitos previos

- **Node.js** 18+ y **npm** (o equivalente).
- **Android**: Android Studio + SDK (solo para build/emulador), o un
  dispositivo físico con la app **Expo Go** para desarrollo rápido.
- **Escritorio Windows**: Rust toolchain (`rustup`) y **Visual Studio Build
  Tools** con *"Desktop development with C++"* (compilación de Tauri).
- **Licenciamiento**: para emitir licencias usa el CLI en
  [`../license-issuer`](../license-issuer/README.md) (Go, offline).

## 2. Instalación

```powershell
cd frontend
npm install
```

## 3. Scripts disponibles

| Comando | Qué hace |
|---|---|
| `npm start` | Arranca el dev server de Expo (elige plataforma). |
| `npm run android` | Dev server + abre en Android (emulador/Expo Go). |
| `npm run web` | Dev server web con hot reload. |
| `npm run web:build` | Exporta el bundle web estático a `dist/`. |
| `npm run desktop:dev` | Corre el escritorio Tauri con hot reload. |
| `npm run desktop:build` | Compila el instalador Windows (NSIS + MSI). |
| `npm test` | Corre los tests (Vitest). |
| `npm run typecheck` | Verifica tipos (TypeScript). |
| `npm run gen:schema` | Regenera `src/database/schema.generated.ts`. |

---

## 4. Uso y desarrollo por dispositivo

### 4.1 Android

```powershell
cd frontend
npm run android
```

- Con **Expo Go**: escanea el QR con la app Expo Go (mismo Wi-Fi).
- Con **emulador**: asegúrate de tener un AVD corriendo; el comando lo detecta.

> En desarrollo Android usa SQLite nativo (`op-sqlite`). La cámara para
> escaneo de código de barras usa el hardware del dispositivo.

### 4.2 Web (navegador)

```powershell
cd frontend
npm run web
```

Abre `http://localhost:8081`. Útil para probar UI/UX sin hardware.

> En web, SQLite corre en WASM con OPFS (`src/database/web-sqlite-driver.ts`).
> La captura HID por teclado funciona; la cámara depende del navegador.

### 4.3 Escritorio Windows (Tauri)

```powershell
cd frontend
npm run desktop:dev
```

- Arranca `expo start --web` (puerto 8081) y luego la ventana nativa de Tauri.
- La ventana abre en **1280×800** (landscape estándar del POS).

---

## 5. Debug

### 5.1 Logs de Metro / Expo

- Android/Web: la consola de Metro en el terminal muestra los `console.log`.
- Web/Escritorio: además abre DevTools (F12) en la vista web.

### 5.2 React Native debugger / DevTools

- Expo ofrece el menú de desarrollo (agitar el dispositivo o tecla `m` en
  emulador) con *Remote JS debug* y *Element inspector*.

### 5.3 Escritorio Tauri

- Logs del binario Rust en el terminal de `npm run desktop:dev`.
- El HWID se obtiene invocando el comando `get_windows_hwid` (ver
  `src-tauri/src/lib.rs`); depúralo con un `console.log` desde la app.

### 5.4 Tests y tipos

```powershell
npm test           # suite completa Vitest
npm run typecheck  # tsc --noEmit
```

---

## 6. Deploy por dispositivo

### 6.1 Android (APK / AAB)

La forma soportada es **EAS Build** (cloud):

```powershell
cd frontend
npm install --global eas-cli
eas build -p android            # genera .aab (o .apk con --profile preview)
```

> Falta `eas.json` en el repo: al primer `eas build` te pedirá configurar el
> proyecto (`eas build:configure`). Alternativa local:
> `npx expo run:android` (prebuild + Gradle).

La app se firma con Google Play Billing (paquete `com.bisync.pos`, ver
`app.json`).

### 6.2 Web (sitio estático)

```powershell
cd frontend
npm run web:build
```

El resultado queda en `frontend/dist/`. Sírvelo con cualquier hosting estático
(o con `npx serve dist`). Este bundle es también lo que **embebe Tauri**.

### 6.3 Escritorio Windows (instalador)

```powershell
cd frontend
npm run desktop:build
```

Produce en `frontend/src-tauri/target/release/bundle/`:

- `Bisync POS_0.1.0_x64-setup.exe` (NSIS, instalación `currentUser`).
- `Bisync POS_0.1.0_x64_en-US.msi` (MSI).

El instalador requiere **WebView2 Runtime** (preinstalado en Windows 10/11).
La licencia se valida contra el HWID del equipo (ver §7).

---

## 7. Licenciamiento

La app **no emite** licencias; solo las **verifica** con la llave pública
embebida y el HWID del dispositivo. El flujo completo (generar llaves, emitir
token, estados ACTIVE/GRACE/EXPIRED) está en
[`../license-issuer/README.md`](../license-issuer/README.md).

---

## 8. Notas de arquitectura

- **IDs**: UUIDv7 en todas las entidades (orden cronológico, sin colisiones).
- **Dinero**: `decimal.js`; prohibido `number` flotante en precios/inventario.
- **Inventario**: kardex por deltas inmutables en `stock_movements`.
- **Bimoneda (VES)**: activada solo con `country_code == 'VE'`; cada factura
  congela la tasa y los montos en ambas monedas.
