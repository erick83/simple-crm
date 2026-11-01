import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  CAJA_MDNS_SERVICE_TYPE,
  InMemoryMdnsHub,
  InMemoryMdnsTransport,
  P2pDiscoveryService,
  type SyncPeer,
} from "../src/services/p2p-discovery.service";

describe("PR-10: Descubrimiento de Cajas por mDNS en Red Wi-Fi Local", () => {
  let hub: InMemoryMdnsHub;

  beforeEach(() => {
    hub = new InMemoryMdnsHub();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("dos cajas en la misma Wi-Fi intercambian sus IPs privadas automáticamente al iniciar", () => {
    const transport1 = new InMemoryMdnsTransport(hub);
    const transport2 = new InMemoryMdnsTransport(hub);

    const caja1 = new P2pDiscoveryService({
      terminalId: "CAJA-01",
      name: "Caja Principal - Entrada",
      ip: "192.168.1.100",
      port: 8088,
      transport: transport1,
    });

    const caja2 = new P2pDiscoveryService({
      terminalId: "CAJA-02",
      name: "Caja 2 - Pasillo Central",
      ip: "192.168.1.101",
      port: 8088,
      transport: transport2,
    });

    caja1.start();
    caja2.start();

    // Caja 1 debió descubrir a Caja 2 con su IP privada
    const peersCaja1 = caja1.getOnlinePeers();
    expect(peersCaja1).toHaveLength(1);
    expect(peersCaja1[0]!.terminalId).toBe("CAJA-02");
    expect(peersCaja1[0]!.ip).toBe("192.168.1.101");
    expect(peersCaja1[0]!.port).toBe(8088);
    expect(peersCaja1[0]!.status).toBe("ONLINE");

    // Caja 2 debió descubrir a Caja 1 con su IP privada
    const peersCaja2 = caja2.getOnlinePeers();
    expect(peersCaja2).toHaveLength(1);
    expect(peersCaja2[0]!.terminalId).toBe("CAJA-01");
    expect(peersCaja2[0]!.ip).toBe("192.168.1.100");
    expect(peersCaja2[0]!.port).toBe(8088);
    expect(peersCaja2[0]!.status).toBe("ONLINE");

    caja1.stop();
    caja2.stop();
  });

  it("ninguna caja se incluye a sí misma en su listado de peers conocidos", () => {
    const transport1 = new InMemoryMdnsTransport(hub);
    const caja1 = new P2pDiscoveryService({
      terminalId: "CAJA-01",
      name: "Caja Única",
      ip: "192.168.1.50",
      port: 8088,
      transport: transport1,
    });

    caja1.start();
    caja1.broadcastSelf();

    expect(caja1.getPeers()).toHaveLength(0);
    caja1.stop();
  });

  it("una caja existente responde a la consulta (query) cuando una nueva caja se une", () => {
    const transport1 = new InMemoryMdnsTransport(hub);
    const caja1 = new P2pDiscoveryService({
      terminalId: "CAJA-01",
      name: "Caja 1",
      ip: "192.168.1.10",
      port: 8088,
      transport: transport1,
    });
    caja1.start();

    // Al iniciar Caja 1, está sola
    expect(caja1.getPeers()).toHaveLength(0);

    // Minutos después entra Caja 2
    const transport2 = new InMemoryMdnsTransport(hub);
    const caja2 = new P2pDiscoveryService({
      terminalId: "CAJA-02",
      name: "Caja 2",
      ip: "192.168.1.20",
      port: 8088,
      transport: transport2,
    });
    caja2.start();

    // Caja 2 emitió query, y Caja 1 le respondió inmediatamente
    expect(caja2.getPeer("CAJA-01")?.ip).toBe("192.168.1.10");
    expect(caja1.getPeer("CAJA-02")?.ip).toBe("192.168.1.20");

    caja1.stop();
    caja2.stop();
  });

  it("notifica despedida (goodbye) inmediatamente al detener el servicio", () => {
    const transport1 = new InMemoryMdnsTransport(hub);
    const transport2 = new InMemoryMdnsTransport(hub);

    const caja1 = new P2pDiscoveryService({
      terminalId: "CAJA-01",
      name: "Caja 1",
      ip: "192.168.1.10",
      port: 8088,
      transport: transport1,
    });
    const caja2 = new P2pDiscoveryService({
      terminalId: "CAJA-02",
      name: "Caja 2",
      ip: "192.168.1.20",
      port: 8088,
      transport: transport2,
    });

    caja1.start();
    caja2.start();

    expect(caja1.getPeer("CAJA-02")?.status).toBe("ONLINE");

    // Caja 2 se apaga ordenadamente
    caja2.stop();

    expect(caja1.getPeer("CAJA-02")?.status).toBe("OFFLINE");
    expect(caja1.getOnlinePeers()).toHaveLength(0);

    caja1.stop();
  });

  it("marca peers como OFFLINE si caduca su TTL por caída abrupta de red", () => {
    const transport1 = new InMemoryMdnsTransport(hub);
    const transport2 = new InMemoryMdnsTransport(hub);

    const caja1 = new P2pDiscoveryService({
      terminalId: "CAJA-01",
      name: "Caja 1",
      ip: "192.168.1.10",
      port: 8088,
      transport: transport1,
      peerTtlMs: 10000,
      heartbeatIntervalMs: 5000,
    });
    const caja2 = new P2pDiscoveryService({
      terminalId: "CAJA-02",
      name: "Caja 2",
      ip: "192.168.1.20",
      port: 8088,
      transport: transport2,
      peerTtlMs: 10000,
      heartbeatIntervalMs: 5000,
    });

    caja1.start();
    caja2.start();

    expect(caja1.getOnlinePeers()).toHaveLength(1);

    // Simular desconexión de red abrupta de Caja 2 (desconectar del hub sin goodbye)
    hub.unregister(transport2);

    // Avanzar tiempo 15 segundos (supera TTL de 10s y el ciclo de chequeo)
    vi.advanceTimersByTime(15000);

    expect(caja1.getPeer("CAJA-02")?.status).toBe("OFFLINE");
    expect(caja1.getOnlinePeers()).toHaveLength(0);

    caja1.stop();
  });

  it("ignora servicios ajenos que no correspondan a _cajapos._tcp", () => {
    const transport1 = new InMemoryMdnsTransport(hub);
    const caja1 = new P2pDiscoveryService({
      terminalId: "CAJA-01",
      name: "Caja 1",
      ip: "192.168.1.10",
      port: 8088,
      transport: transport1,
    });
    caja1.start();

    const foreignTransport = new InMemoryMdnsTransport(hub);
    foreignTransport.announce({
      serviceType: "_other_service._tcp",
      terminalId: "IMPRESORA-HP",
      name: "HP LaserJet",
      ip: "192.168.1.200",
      port: 9100,
      status: "ONLINE",
      timestamp: Date.now(),
    });

    expect(caja1.getPeers()).toHaveLength(0);

    caja1.stop();
  });

  it("permite suscripción reactiva a cambios en la lista de peers", () => {
    const transport1 = new InMemoryMdnsTransport(hub);
    const transport2 = new InMemoryMdnsTransport(hub);

    const caja1 = new P2pDiscoveryService({
      terminalId: "CAJA-01",
      name: "Caja 1",
      ip: "192.168.1.10",
      port: 8088,
      transport: transport1,
    });

    const listener = vi.fn();
    const unsubscribe = caja1.onPeersChange(listener);

    // Se llama inmediatamente con lista inicial vacía
    expect(listener).toHaveBeenCalledWith([]);

    caja1.start();

    const caja2 = new P2pDiscoveryService({
      terminalId: "CAJA-02",
      name: "Caja 2",
      ip: "192.168.1.20",
      port: 8088,
      transport: transport2,
    });
    caja2.start();

    // Listener fue llamado con el nuevo peer descubierto
    expect(listener).toHaveBeenCalled();
    const lastCallArg = listener.mock.calls[listener.mock.calls.length - 1][0] as SyncPeer[];
    expect(lastCallArg.some((p) => p.terminalId === "CAJA-02")).toBe(true);

    unsubscribe();
    caja1.stop();
    caja2.stop();
  });
});
