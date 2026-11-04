# license-issuer — Emisor offline de licencias Ed25519

Herramienta de línea de comandos (Go, stdlib, cero dependencias) que **emite y
verifica** los tokens de licencia del POS local-first. Vive fuera del repo del
cliente: la app solo verifica con la llave pública embebida; aquí vive la llave
privada y el proceso de emisión.

## Requisitos

- Go 1.21 o superior (`go version`).

## Compilar el ejecutable

Desde la raíz del proyecto (`license-issuer/`):

```bash
# Windows (produce license-issuer.exe)
go build -o bin/license-issuer.exe .

# Linux (amd64)
GOOS=linux GOARCH=amd64 go build -o bin/license-issuer .

# macOS (Apple Silicon)
GOOS=darwin GOARCH=arm64 go build -o bin/license-issuer .

# Windows desde Linux/macOS (cross-compile)
GOOS=windows GOARCH=amd64 go build -o bin/license-issuer.exe .
```

> El binario es autocontenido (no necesita runtime de Go en el equipo donde corre).
> Puedes ejecutar las pruebas con `go test ./...`.

## Flujo completo de generación de un token

### Paso 1 — Generar el par de llaves (una sola vez)

```bash
./license-issuer keygen --out-key license.key --out-pub license.pub
```

- `license.key`: llave **privada** en hex. Es la que firma. **Guardarla offline
  (USB/máquina aislada), nunca compartir ni commitear.**
- `license.pub`: llave **pública** en PEM/SPKI. Es la que se embebe en la app
  (reemplaza `DEFAULT_EMBEDDED_PUBLIC_KEY` en `license-validator.service.ts`).
  **Ambas deben ir juntas**: la app solo valida tokens firmados con la privada
  que corresponde a esta pública.

### Paso 2 — Preparar la solicitud

La app en el dispositivo genera `solicitud.json` y se envía por email:

```json
{
  "requestId":   "uuidv7",
  "tenantId":    "uuidv7 del comercio (del emparejamiento)",
  "branchId":    "uuidv7 de la sede",
  "terminalId":  "TERM-02",
  "hwid":        "sha256-hex del dispositivo",
  "deviceLabel": "Caja 2"
}
```

> El `hwid` debe ser el HWID **real** del dispositivo (lo calcula la app con
> `computeHwid`). Si difiere, el token no valida (TAMPERED).

### Paso 3 — Emitir el token

```bash
./license-issuer issue \
  --key license.key \
  --request solicitud.json \
  --days 365 \
  --grace 3 \
  --features pos,bimoneda \
  --out licencia.token.json
```

Con `--out` vacío, el token se imprime por stdout.

### Paso 4 — Verificar antes de enviar (opcional)

```bash
./license-issuer verify --pub license.pub --token licencia.token.json
# VÁLIDA: firma Ed25519 correcta
```

### Paso 5 — Entregar por email y cargar en la app

El usuario carga `licencia.token.json` en la app; esta verifica firma + HWID +
vigencia y habilita el cobro según el estado.

## Condiciones de validez (qué evalúa la app)

La app decide el estado con tres chequeos, en este orden:

1. **Firma Ed25519** sobre `JSON.stringify(payload)`: si no coincide → `TAMPERED`.
2. **HWID binding**: `payload.hwid` debe igualar el HWID del dispositivo → si no → `TAMPERED`.
3. **Vigencia** comparando `validUntil` (Unix segundos) con el reloj actual y `gracePeriodDays`:

| Condición | Estado | ¿Puede cobrar? |
|---|---|---|
| `now < validUntil` | `ACTIVE` | sí |
| `validUntil <= now <= validUntil + grace` | `GRACE` | sí (con aviso) |
| `now > validUntil + grace` | `EXPIRED` | no |

Además hay una **guardia de reloj monótono** (`last_recorded_timestamp`): si el
reloj del dispositivo se atrasa, la app se bloquea como `TAMPERED`.

### Generar tokens en cada estado (pruebas)

El flag `--days` acepta **negativos** para "vencer" el token y probar estados:

```bash
# ACTIVE — vence en 1 día
... issue --days 1 ...

# GRACE — expiró hace 2 días, dentro de los 3 de gracia
... issue --days -2 --grace 3 ...

# EXPIRED — expiró hace 10 días
... issue --days -10 --grace 3 ...
```

Regla: `validUntil = issuedAt + days*86400`; con `days` negativo, `validUntil`
queda en el pasado. La app solo mira `validUntil` y `gracePeriodDays`, así que
`--days` + `--grace` controlan el estado exacto.

## Referencia de comandos

| Comando | Flags | Descripción |
|---|---|---|
| `keygen` | `--out-key` (def. `license.key`), `--out-pub` (def. `license.pub`) | Genera el par de llaves. |
| `issue` | `--key`, `--request`, `--days` (def. `365`), `--grace` (def. `3`), `--features` (def. `pos,bimoneda`), `--out` | Firma y emite el token. |
| `verify` | `--pub`, `--token` | Verifica la firma del token. |

## Formato del token emitido

```json
{
  "payload": {
    "tenantId": "...", "branchId": "...", "terminalId": "...",
    "hwid": "...", "issuedAt": 1700000000, "validUntil": 1731536000,
    "gracePeriodDays": 3, "p2pSyncEnabled": true, "features": ["pos","bimoneda"]
  },
  "signature": "<hex-ed25519>"
}
```

La firma se calcula sobre `JSON.stringify(payload)` (el mismo string que la app
re-serializa). Por eso el **orden de campos de `Payload` es parte del contrato**:
no reordenar sin re-emitir todos los tokens ya entregados.

## Seguridad

- La llave privada **jamás** entra en la app; solo la pública (PEM). `.gitignore`
  excluye `*.key`, `*.pub`, `bin/` y `demo-keys/`.
- Si la privada se filtra, hay que publicar un update de la app con una nueva
  pública y re-emitir todas las licencias (considerar un `keyId` a futuro).
- Los tokens offline no se revocan instantáneamente: el control de "1 dispositivo
  activo" se logra con HWID binding + `validUntil` corto (30–90 días) y renovación.
- `hwid` en Android hoy deriva de `androidId` (menos estable que motherboard+CPU
  en Windows); ver §4 de AGENTS.md.
