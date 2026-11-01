/**
/**
 * Servicio de Descubrimiento P2P por mDNS en Red Wi-Fi Local (_cajapos._tcp)
 * Cumple con AGENTS.md y HARNESS_CONTROL.md (PR-10).
 * Cero dependencias cloud ($0 cost).
 */

export const CAJA_MDNS_SERVICE_TYPE = "_cajapos._tcp";

export interface MdnsAnnouncement {
  serviceType: string;
  terminalId: string;
  name: string;
  ip: string;
  port: number;
  status: "ONLINE" | "OFFLINE";
  timestamp: number;
  txtRecord?: Record<string, string>;
}

export interface SyncPeer {
  terminalId: string;
  name: string;
  ip: string;
  port: number;
  lastSeen: number;
  status: "ONLINE" | "OFFLINE";
  txtRecord?: Record<string, string>;
}

export interface MdnsTransport {
  announce(announcement: MdnsAnnouncement): Promise<void> | void;
  goodbye(terminalId: string): Promise<void> | void;
  query(serviceType: string): Promise<void> | void;
  onAnnouncement(callback: (announcement: MdnsAnnouncement) => void): () => void;
  onGoodbye(callback: (terminalId: string) => void): () => void;
  onQuery?(callback: (serviceType: string) => void): () => void;
  close(): Promise<void> | void;
}

export class InMemoryMdnsHub {
  private transports: Set<InMemoryMdnsTransport> = new Set();

  register(transport: InMemoryMdnsTransport): void {
    this.transports.add(transport);
  }

  unregister(transport: InMemoryMdnsTransport): void {
    this.transports.delete(transport);
  }

  broadcastAnnouncement(sender: InMemoryMdnsTransport, announcement: MdnsAnnouncement): void {
    if (!this.transports.has(sender)) return;
    for (const t of this.transports) {
      if (t !== sender) {
        t.receiveAnnouncement(announcement);
      }
    }
  }

  broadcastGoodbye(sender: InMemoryMdnsTransport, terminalId: string): void {
    if (!this.transports.has(sender)) return;
    for (const t of this.transports) {
      if (t !== sender) {
        t.receiveGoodbye(terminalId);
      }
    }
  }

  broadcastQuery(sender: InMemoryMdnsTransport, serviceType: string): void {
    if (!this.transports.has(sender)) return;
    for (const t of this.transports) {
      if (t !== sender) {
        t.receiveQuery(serviceType);
      }
    }
  }
}

export class InMemoryMdnsTransport implements MdnsTransport {
  private announcementListeners: Set<(announcement: MdnsAnnouncement) => void> = new Set();
  private goodbyeListeners: Set<(terminalId: string) => void> = new Set();
  private queryListeners: Set<(serviceType: string) => void> = new Set();

  constructor(private hub: InMemoryMdnsHub) {
    this.hub.register(this);
  }

  announce(announcement: MdnsAnnouncement): void {
    this.hub.broadcastAnnouncement(this, announcement);
  }

  goodbye(terminalId: string): void {
    this.hub.broadcastGoodbye(this, terminalId);
  }

  query(serviceType: string): void {
    this.hub.broadcastQuery(this, serviceType);
  }

  receiveAnnouncement(announcement: MdnsAnnouncement): void {
    for (const listener of this.announcementListeners) {
      listener(announcement);
    }
  }

  receiveGoodbye(terminalId: string): void {
    for (const listener of this.goodbyeListeners) {
      listener(terminalId);
    }
  }

  receiveQuery(serviceType: string): void {
    for (const listener of this.queryListeners) {
      listener(serviceType);
    }
  }

  onAnnouncement(callback: (announcement: MdnsAnnouncement) => void): () => void {
    this.announcementListeners.add(callback);
    return () => this.announcementListeners.delete(callback);
  }

  onGoodbye(callback: (terminalId: string) => void): () => void {
    this.goodbyeListeners.add(callback);
    return () => this.goodbyeListeners.delete(callback);
  }

  onQuery(callback: (serviceType: string) => void): () => void {
    this.queryListeners.add(callback);
    return () => this.queryListeners.delete(callback);
  }

  close(): void {
    this.hub.unregister(this);
    this.announcementListeners.clear();
    this.goodbyeListeners.clear();
    this.queryListeners.clear();
  }
}

export interface P2pDiscoveryConfig {
  terminalId: string;
  name: string;
  ip: string;
  port: number;
  transport: MdnsTransport;
  heartbeatIntervalMs?: number;
  peerTtlMs?: number;
  txtRecord?: Record<string, string>;
}

export class P2pDiscoveryService {
  private config: Required<P2pDiscoveryConfig>;
  private peers: Map<string, SyncPeer> = new Map();
  private peerListeners: Set<(peers: SyncPeer[]) => void> = new Set();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribers: Array<() => void> = [];
  private isRunning: boolean = false;

  constructor(config: P2pDiscoveryConfig) {
    this.config = {
      ...config,
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? 5000,
      peerTtlMs: config.peerTtlMs ?? 15000,
      txtRecord: config.txtRecord ?? {},
    };
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Escuchar anuncios de peers
    const unsubAnnounce = this.config.transport.onAnnouncement((announcement) => {
      this.handleAnnouncement(announcement);
    });
    this.unsubscribers.push(unsubAnnounce);

    // Escuchar despedidas (goodbyes)
    const unsubGoodbye = this.config.transport.onGoodbye((terminalId) => {
      this.handleGoodbye(terminalId);
    });
    this.unsubscribers.push(unsubGoodbye);

    // Responder a consultas (queries) mDNS si el transporte lo soporta
    if (this.config.transport.onQuery) {
      const unsubQuery = this.config.transport.onQuery((serviceType) => {
        if (serviceType === CAJA_MDNS_SERVICE_TYPE && this.isRunning) {
          this.broadcastSelf();
        }
      });
      this.unsubscribers.push(unsubQuery);
    }

    // Anunciarse inmediatamente y consultar la red para descubrir peers existentes
    this.broadcastSelf();
    this.config.transport.query(CAJA_MDNS_SERVICE_TYPE);

    // Timer periódico de latido / anuncio
    this.heartbeatTimer = setInterval(() => {
      this.broadcastSelf();
    }, this.config.heartbeatIntervalMs);

    // Timer para marcar peers caídos según TTL
    this.pruneTimer = setInterval(() => {
      this.pruneStalePeers();
    }, Math.max(1000, Math.floor(this.config.peerTtlMs / 3)));
  }

  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;

    // Notificar despedida a la red local
    try {
      this.config.transport.goodbye(this.config.terminalId);
    } catch {
      // Ignorar errores al cerrar
    }

    // Limpiar timers
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }

    // Desuscribir listeners del transporte
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
  }

  broadcastSelf(): void {
    if (!this.isRunning) return;
    const announcement: MdnsAnnouncement = {
      serviceType: CAJA_MDNS_SERVICE_TYPE,
      terminalId: this.config.terminalId,
      name: this.config.name,
      ip: this.config.ip,
      port: this.config.port,
      status: "ONLINE",
      timestamp: Date.now(),
      txtRecord: this.config.txtRecord,
    };
    this.config.transport.announce(announcement);
  }

  private handleAnnouncement(announcement: MdnsAnnouncement): void {
    if (!this.isRunning) return;
    // Ignorarse a sí mismo
    if (announcement.terminalId === this.config.terminalId) return;
    // Validar tipo de servicio
    if (announcement.serviceType !== CAJA_MDNS_SERVICE_TYPE) return;

    const existing = this.peers.get(announcement.terminalId);
    const updated: SyncPeer = {
      terminalId: announcement.terminalId,
      name: announcement.name,
      ip: announcement.ip,
      port: announcement.port,
      lastSeen: announcement.timestamp || Date.now(),
      status: announcement.status,
      txtRecord: announcement.txtRecord,
    };

    this.peers.set(announcement.terminalId, updated);
    this.notifyListeners();
  }

  private handleGoodbye(terminalId: string): void {
    if (!this.isRunning) return;
    if (terminalId === this.config.terminalId) return;

    const existing = this.peers.get(terminalId);
    if (existing) {
      existing.status = "OFFLINE";
      existing.lastSeen = Date.now();
      this.notifyListeners();
    }
  }

  pruneStalePeers(now: number = Date.now()): void {
    let changed = false;
    for (const [id, peer] of this.peers.entries()) {
      if (peer.status === "ONLINE" && now - peer.lastSeen >= this.config.peerTtlMs) {
        peer.status = "OFFLINE";
        changed = true;
      }
    }
    if (changed) {
      this.notifyListeners();
    }
  }

  getPeers(): SyncPeer[] {
    return Array.from(this.peers.values());
  }

  getOnlinePeers(): SyncPeer[] {
    const now = Date.now();
    return Array.from(this.peers.values()).filter(
      (p) => p.status === "ONLINE" && now - p.lastSeen <= this.config.peerTtlMs,
    );
  }

  getPeer(terminalId: string): SyncPeer | undefined {
    return this.peers.get(terminalId);
  }

  onPeersChange(callback: (peers: SyncPeer[]) => void): () => void {
    this.peerListeners.add(callback);
    callback(this.getPeers());
    return () => this.peerListeners.delete(callback);
  }

  private notifyListeners(): void {
    const list = this.getPeers();
    for (const listener of this.peerListeners) {
      listener(list);
    }
  }
}
