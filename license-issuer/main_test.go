package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"
)

func testKeypair(t *testing.T) (ed25519.PublicKey, ed25519.PrivateKey) {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generateKey: %v", err)
	}
	return pub, priv
}

func TestSignVerifyRoundTrip(t *testing.T) {
	pub, priv := testKeypair(t)

	payload := Payload{
		TenantID:        "tenant-0001",
		BranchID:        "branch-0001",
		TerminalID:      "TERM-01",
		HWID:            "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
		IssuedAt:        1700000000,
		ValidUntil:      1731536000,
		GracePeriodDays: 3,
		P2PSyncEnabled:  true,
		Features:        []string{"pos", "bimoneda"},
	}
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	sig := ed25519.Sign(priv, payloadBytes)

	envBytes, err := json.Marshal(Envelope{
		Payload:   json.RawMessage(payloadBytes),
		Signature: hex.EncodeToString(sig),
	})
	if err != nil {
		t.Fatal(err)
	}

	// Round-trip: lo que se escribe es lo que se verifica (igual que la app).
	var env Envelope
	if err := json.Unmarshal(envBytes, &env); err != nil {
		t.Fatal(err)
	}
	sigBytes, err := hex.DecodeString(env.Signature)
	if err != nil {
		t.Fatal(err)
	}
	if !ed25519.Verify(pub, env.Payload, sigBytes) {
		t.Fatal("la firma no verifica tras round-trip")
	}

	// Un payload adulterado debe romper la firma.
	tampered := json.RawMessage(`{"tenantId":"OTRO","branchId":"x","terminalId":"x","hwid":"x","issuedAt":0,"validUntil":0,"gracePeriodDays":0,"p2pSyncEnabled":false,"features":[]}`)
	if ed25519.Verify(pub, tampered, sigBytes) {
		t.Fatal("la firma validó un payload adulterado")
	}
}

func TestPublicKeyPEMRoundTrip(t *testing.T) {
	pub, _ := testKeypair(t)
	pemStr, err := publicKeyPEM(pub)
	if err != nil {
		t.Fatal(err)
	}
	reloaded, err := parsePublicKeyPEM([]byte(pemStr))
	if err != nil {
		t.Fatal(err)
	}
	if !pub.Equal(reloaded) {
		t.Fatal("la llave pública PEM no sobrevive el round-trip")
	}
}

func TestPrivateKeyHexRoundTrip(t *testing.T) {
	_, priv := testKeypair(t)
	hexStr := hex.EncodeToString(priv)
	path := t.TempDir() + "/license.key"
	if err := os.WriteFile(path, []byte(hexStr), 0o600); err != nil {
		t.Fatal(err)
	}
	reloaded, err := loadPrivateKey(path)
	if err != nil {
		t.Fatal(err)
	}
	if !priv.Equal(reloaded) {
		t.Fatal("la llave privada hex no sobrevive el round-trip")
	}
}

func TestLoadRequestWithEmail(t *testing.T) {
	raw := `{
		"requestId": "018d9f42-7000-7000-8000-000000000001",
		"email": "comercio@bisync.dev",
		"tenantId": "TENANT-001",
		"branchId": "SEDE-1",
		"terminalId": "TERM-01",
		"hwid": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
		"deviceLabel": "Caja 1"
	}`
	path := t.TempDir() + "/request.json"
	if err := os.WriteFile(path, []byte(raw), 0o600); err != nil {
		t.Fatal(err)
	}
	req, err := loadRequest(path)
	if err != nil {
		t.Fatalf("loadRequest: %v", err)
	}
	if req.Email != "comercio@bisync.dev" {
		t.Errorf("req.Email = %q, want %q", req.Email, "comercio@bisync.dev")
	}
	if req.HWID == "" || req.TenantID != "TENANT-001" {
		t.Errorf("datos de solicitud corruptos: %+v", req)
	}
}
