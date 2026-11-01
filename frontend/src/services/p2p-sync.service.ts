import type { SqlDriver } from "../database/connection";
import { uuidv7 } from "../utils/uuid7";

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
}

