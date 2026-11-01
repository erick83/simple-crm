import type { SqlDriver } from "../database/connection";
import { uuidv7 } from "../utils/uuid7";
import type { FileStore } from "./image-compressor.service";
import type { P2pHttpClient, SyncDeltaItem } from "./p2p-http.service";

export * from "./p2p-discovery.service";
export * from "./p2p-http.service";

export interface OutboxItem {
  id: string;
  originTerminalId: string;
  entityType: "PRODUCT" | "STOCK_MOVEMENT" | "INVOICE";
  entityId: string;
  action: "UPSERT" | "DELETE";
  payload: string;
  createdAt: number;
  replicatedPeers: string[];
}

export class P2pSyncService {
  /**
   * Encola un evento en el outbox para replicación local
   */
  static enqueueEvent(
    db: SqlDriver,
    event: {
      originTerminalId: string;
      entityType: "PRODUCT" | "STOCK_MOVEMENT" | "INVOICE";
      entityId: string;
      action: "UPSERT" | "DELETE";
      payload: Record<string, unknown>;
    },
    now: number = Date.now(),
  ): string {
    const id = uuidv7(now);
    db.run(
      `INSERT INTO peer_sync_outbox (id, origin_terminal_id, entity_type, entity_id, action, payload, created_at, replicated_peers)
       VALUES (?, ?, ?, ?, ?, ?, ?, '[]')`,
      [id, event.originTerminalId, event.entityType, event.entityId, event.action, JSON.stringify(event.payload), now],
    );
    return id;
  }

  /**
   * Obtiene la cantidad de eventos pendientes en el outbox
   */
  static getPendingCount(db: SqlDriver): number {
    const [row] = db.all<{ count: number }>("SELECT COUNT(*) as count FROM peer_sync_outbox");
    return row?.count ?? 0;
  }

  /**
   * Obtiene los eventos del outbox aún no replicados al terminal especificado
   */
  static getPendingEvents(db: SqlDriver, peerTerminalId: string, limit = 50): OutboxItem[] {
    const rows = db.all<{
      id: string;
      origin_terminal_id: string;
      entity_type: "PRODUCT" | "STOCK_MOVEMENT" | "INVOICE";
      entity_id: string;
      action: "UPSERT" | "DELETE";
      payload: string;
      created_at: number;
      replicated_peers: string;
    }>("SELECT * FROM peer_sync_outbox ORDER BY created_at ASC");

    const result: OutboxItem[] = [];
    for (const r of rows) {
      let peers: string[] = [];
      try {
        peers = JSON.parse(r.replicated_peers);
      } catch {
        peers = [];
      }
      if (!peers.includes(peerTerminalId)) {
        result.push({
          id: r.id,
          originTerminalId: r.origin_terminal_id,
          entityType: r.entity_type,
          entityId: r.entity_id,
          action: r.action,
          payload: r.payload,
          createdAt: r.created_at,
          replicatedPeers: peers,
        });
        if (result.length >= limit) break;
      }
    }
    return result;
  }

  /**
   * Marca los eventos como replicados hacia el terminal destino
   */
  static markEventsReplicated(db: SqlDriver, eventIds: string[], peerTerminalId: string): void {
    if (eventIds.length === 0) return;
    db.transaction(() => {
      for (const id of eventIds) {
        const [row] = db.all<{ replicated_peers: string }>(
          "SELECT replicated_peers FROM peer_sync_outbox WHERE id = ?",
          [id],
        );
        if (row) {
          let list: string[] = [];
          try {
            list = JSON.parse(row.replicated_peers);
          } catch {
            list = [];
          }
          if (!list.includes(peerTerminalId)) {
            list.push(peerTerminalId);
            db.run("UPDATE peer_sync_outbox SET replicated_peers = ? WHERE id = ?", [
              JSON.stringify(list),
              id,
            ]);
          }
        }
      }
    });
  }

  /**
   * Sincroniza el lote de eventos pendientes hacia un peer específico
   */
  static async syncWithPeer(params: {
    db: SqlDriver;
    client: P2pHttpClient;
    peer: { ip: string; port: number; terminalId: string };
    fileStore?: FileStore;
    limit?: number;
  }): Promise<{ sent: number; acked: number }> {
    const { db, client, peer, fileStore, limit = 50 } = params;
    const pending = this.getPendingEvents(db, peer.terminalId, limit);
    if (pending.length === 0) {
      return { sent: 0, acked: 0 };
    }

    const deltas: SyncDeltaItem[] = [];
    for (const item of pending) {
      let payloadObj: Record<string, unknown> = {};
      try {
        payloadObj = JSON.parse(item.payload);
      } catch {
        payloadObj = {};
      }

      // Si es un producto con imagen y no tiene base64 adjunto, buscarlo en FileStore
      if (item.entityType === "PRODUCT" && payloadObj.imagePath && !payloadObj.imageBase64 && fileStore?.readFile) {
        try {
          const imgBytes = await fileStore.readFile(String(payloadObj.imagePath));
          if (imgBytes) {
            payloadObj.imageBase64 = Buffer.from(imgBytes).toString("base64");
          }
        } catch {
          // No bloquear envío de metadatos si falla la imagen
        }
      }

      deltas.push({
        id: item.id,
        originTerminalId: item.originTerminalId,
        entityType: item.entityType,
        entityId: item.entityId,
        action: item.action,
        payload: payloadObj,
        createdAt: item.createdAt,
      });
    }

    const res = await client.sendDeltas(peer, deltas);
    if (res.status === 200 && res.data?.ackIds) {
      this.markEventsReplicated(db, res.data.ackIds, peer.terminalId);
      return { sent: deltas.length, acked: res.data.ackIds.length };
    }

    return { sent: deltas.length, acked: 0 };
  }
}

