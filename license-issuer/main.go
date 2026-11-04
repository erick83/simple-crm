// Command license-issuer emite y verifica tokens de licencia Ed25519 para el
// sistema POS local-first. Se ejecuta 100% offline: la solicitud llega por
// email, el token firmado vuelve por email, y la app cliente solo verifica con
// la llave pública embebida. No hay servidor en línea.
package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"
)

// Payload es el cuerpo firmado del token de licencia.
// IMPORTANTE: el orden de declaración define el JSON canónico que se firma
// (encoding/json serializa en orden de campos). No reordenar sin re-emitir
// todos los tokens ya entregados, porque la app firma/verifica
// JSON.stringify(payload) sobre ese mismo orden.
type Payload struct {
	TenantID        string   `json:"tenantId"`
	BranchID        string   `json:"branchId"`
	TerminalID      string   `json:"terminalId"`
	HWID            string   `json:"hwid"`
	IssuedAt        int64    `json:"issuedAt"`   // Unix en segundos
	ValidUntil      int64    `json:"validUntil"` // Unix en segundos
	GracePeriodDays int      `json:"gracePeriodDays"`
	P2PSyncEnabled  bool     `json:"p2pSyncEnabled"`
	Features        []string `json:"features"`
}

// Envelope es el token completo que la app parsea: payload (JSON crudo) + firma.
type Envelope struct {
	Payload   json.RawMessage `json:"payload"`
	Signature string          `json:"signature"`
}

// Request es la solicitud que genera la app en el dispositivo y envía por email.
type Request struct {
	RequestID   string `json:"requestId"`
	TenantID    string `json:"tenantId"`
	BranchID    string `json:"branchId"`
	TerminalID  string `json:"terminalId"`
	HWID        string `json:"hwid"`
	DeviceLabel string `json:"deviceLabel"`
}

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	switch os.Args[1] {
	case "keygen":
		cmdKeygen(os.Args[2:])
	case "issue":
		cmdIssue(os.Args[2:])
	case "verify":
		cmdVerify(os.Args[2:])
	default:
		usage()
		os.Exit(2)
	}
}

func usage() {
	fmt.Fprint(os.Stderr, `license-issuer — emisor offline de licencias Ed25519

uso:
  license-issuer keygen  [--out-key archivo] [--out-pub archivo]
  license-issuer issue   --key privada --request solicitud.json [--days N] [--grace N] [--features a,b] [--out token.json]
  license-issuer verify  --pub publica.pem --token token.json
`)
}

// ---------- keygen ----------

func cmdKeygen(args []string) {
	fs := flag.NewFlagSet("keygen", flag.ExitOnError)
	outKey := fs.String("out-key", "license.key", "archivo para la llave privada (hex)")
	outPub := fs.String("out-pub", "license.pub", "archivo para la llave pública (PEM)")
	fs.Parse(args)

	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		fatal("generando llaves: %v", err)
	}

	if err := os.WriteFile(*outKey, []byte(hex.EncodeToString(priv)), 0o600); err != nil {
		fatal("escribiendo llave privada: %v", err)
	}

	pubPEM, err := publicKeyPEM(pub)
	if err != nil {
		fatal("serializando llave pública: %v", err)
	}
	if err := os.WriteFile(*outPub, []byte(pubPEM), 0o644); err != nil {
		fatal("escribiendo llave pública: %v", err)
	}

	fmt.Printf("Llave privada -> %s (mantener OFFLINE, nunca compartir)\n", *outKey)
	fmt.Printf("Llave pública -> %s (embebida en la app)\n", *outPub)
	fmt.Printf("\n%s\n", pubPEM)
}

// ---------- issue ----------

func cmdIssue(args []string) {
	fs := flag.NewFlagSet("issue", flag.ExitOnError)
	keyPath := fs.String("key", "", "archivo de llave privada (hex)")
	reqPath := fs.String("request", "", "archivo de solicitud JSON de la app")
	days := fs.Int("days", 365, "días hasta expirar; negativo = ya expiró (pruebas GRACE/EXPIRED)")
	grace := fs.Int("grace", 3, "días de gracia tras expirar")
	features := fs.String("features", "pos,bimoneda", "lista de features separada por coma")
	out := fs.String("out", "", "archivo de salida (vacío = stdout)")
	fs.Parse(args)

	if *keyPath == "" || *reqPath == "" {
		fatal("--key y --request son obligatorios")
	}

	priv, err := loadPrivateKey(*keyPath)
	if err != nil {
		fatal("cargando llave privada: %v", err)
	}
	req, err := loadRequest(*reqPath)
	if err != nil {
		fatal("cargando solicitud: %v", err)
	}
	if req.TenantID == "" || req.HWID == "" {
		fatal("la solicitud debe incluir tenantId y hwid")
	}

	issuedAt := time.Now().Unix()
	payload := Payload{
		TenantID:        req.TenantID,
		BranchID:        req.BranchID,
		TerminalID:      req.TerminalID,
		HWID:            req.HWID,
		IssuedAt:        issuedAt,
		ValidUntil:      issuedAt + int64(*days)*86400,
		GracePeriodDays: *grace,
		P2PSyncEnabled:  true,
		Features:        splitFeatures(*features),
	}

	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		fatal("serializando payload: %v", err)
	}
	sig := ed25519.Sign(priv, payloadBytes)

	// RawMessage garantiza que los bytes firmados son exactamente los embebidos.
	env, err := json.Marshal(Envelope{
		Payload:   json.RawMessage(payloadBytes),
		Signature: hex.EncodeToString(sig),
	})
	if err != nil {
		fatal("serializando token: %v", err)
	}

	if *out != "" {
		if err := os.WriteFile(*out, append(env, '\n'), 0o644); err != nil {
			fatal("escribiendo token: %v", err)
		}
		fmt.Fprintf(os.Stderr, "Token emitido -> %s (dispositivo: %s, %d días)\n", *out, req.DeviceLabel, *days)
	} else {
		fmt.Println(string(env))
	}
}

func splitFeatures(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}

// ---------- verify ----------

func cmdVerify(args []string) {
	fs := flag.NewFlagSet("verify", flag.ExitOnError)
	pubPath := fs.String("pub", "", "archivo de llave pública (PEM)")
	tokenPath := fs.String("token", "", "archivo de token JSON")
	fs.Parse(args)

	if *pubPath == "" || *tokenPath == "" {
		fatal("--pub y --token son obligatorios")
	}

	pubPEMBytes, err := os.ReadFile(*pubPath)
	if err != nil {
		fatal("leyendo llave pública: %v", err)
	}
	pub, err := parsePublicKeyPEM(pubPEMBytes)
	if err != nil {
		fatal("parseando llave pública: %v", err)
	}
	envBytes, err := os.ReadFile(*tokenPath)
	if err != nil {
		fatal("leyendo token: %v", err)
	}

	var env Envelope
	if err := json.Unmarshal(envBytes, &env); err != nil {
		fatal("parseando token: %v", err)
	}
	sigBytes, err := hex.DecodeString(env.Signature)
	if err != nil {
		fatal("firma no es hex válido: %v", err)
	}

	if ed25519.Verify(pub, env.Payload, sigBytes) {
		fmt.Println("VÁLIDA: firma Ed25519 correcta")
	} else {
		fmt.Println("INVÁLIDA: la firma no corresponde al payload")
		os.Exit(1)
	}
}

// ---------- helpers ----------

func publicKeyPEM(pub ed25519.PublicKey) (string, error) {
	der, err := x509.MarshalPKIXPublicKey(pub)
	if err != nil {
		return "", err
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der})), nil
}

func parsePublicKeyPEM(b []byte) (ed25519.PublicKey, error) {
	block, _ := pem.Decode(b)
	if block == nil {
		return nil, fmt.Errorf("PEM inválido")
	}
	pubAny, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return nil, err
	}
	pub, ok := pubAny.(ed25519.PublicKey)
	if !ok {
		return nil, fmt.Errorf("la llave pública no es Ed25519")
	}
	return pub, nil
}

func loadPrivateKey(path string) (ed25519.PrivateKey, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	trimmed := strings.TrimSpace(string(raw))
	if strings.Contains(trimmed, "BEGIN") {
		block, _ := pem.Decode([]byte(trimmed))
		if block == nil {
			return nil, fmt.Errorf("PEM inválido")
		}
		key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
		if err != nil {
			return nil, err
		}
		priv, ok := key.(ed25519.PrivateKey)
		if !ok {
			return nil, fmt.Errorf("la llave privada no es Ed25519")
		}
		return priv, nil
	}
	b, err := hex.DecodeString(trimmed)
	if err != nil {
		return nil, fmt.Errorf("llave privada debe ser hex: %w", err)
	}
	if len(b) != ed25519.PrivateKeySize {
		return nil, fmt.Errorf("llave privada debe tener %d bytes (128 hex)", ed25519.PrivateKeySize)
	}
	return ed25519.PrivateKey(b), nil
}

func loadRequest(path string) (*Request, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var req Request
	if err := json.Unmarshal(raw, &req); err != nil {
		return nil, err
	}
	return &req, nil
}

func fatal(format string, a ...interface{}) {
	fmt.Fprintf(os.Stderr, "error: "+format+"\n", a...)
	os.Exit(1)
}
