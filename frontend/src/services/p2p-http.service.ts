import { Decimal } from "decimal.js";
import type { SqlDriver } from "../database/connection";
import { getLatestRate } from "../database/repositories/exchange.repository";
import type { FileStore } from "./image-compressor.service";

export interface P2pHttpRequest {
  method: "GET" | "POST";
  path: string;
  headers: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
}

export interface P2pHttpResponse<T = unknown> {
  status: number;
  headers?: Record<string, string>;
  data?: T;
  error?: string;
}

export interface P2pStockData {
  productId: string;
  sku: string;
  barcode: string | null;
  name: string;
  priceUsd: string;
  costUsd: string;
  minStock: string;
  currentStock: string;
  imagePath: string | null;
}

export interface P2pExchangeRateData {
  rateDate: string;
  rateToVes: string;
  source: string;
  notes: string | null;
}

export interface P2pImageData {
  path: string;
  base64: string;
}

export interface P2pHttpServerConfig {
  ip: string;
  port: number;
  tenantId: string;
  terminalId: string;
  db: SqlDriver;
  fileStore?: FileStore;
}

export class P2pHttpServer {
  readonly ip: string;
  readonly port: number;
  readonly tenantId: string;
  readonly terminalId: string;

  constructor(private config: P2pHttpServerConfig) {
    this.ip = config.ip;
    this.port = config.port;
    this.tenantId = config.tenantId;
    this.terminalId = config.terminalId;
  }

  async handleRequest(req: P2pHttpRequest): Promise<P2pHttpResponse> {
    // 1. Aislamiento estricto por cuenta (Tenant ID)
    const reqTenantId = this.getHeader(req.headers, "x-tenant-id");
    if (!reqTenantId || reqTenantId !== this.tenantId) {
      return {
        status: 403,
        error: "Forbidden: Tenant mismatch",
      };
    }

    const path = req.path;

    // 2. GET /p2p/stock
    if (req.method === "GET" && path === "/p2p/stock") {
      return this.handleGetStock(req);
    }

    // 3. GET /p2p/exchange-rate
    if (req.method === "GET" && path === "/p2p/exchange-rate") {
      return this.handleGetExchangeRate();
    }

    // 4. GET /p2p/images
    if (req.method === "GET" && (path === "/p2p/images" || path.startsWith("/p2p/images/"))) {
      return this.handleGetImage(req);
    }

    return {
      status: 404,
      error: `Ruta no encontrada: ${req.method} ${path}`,
    };
  }

  private handleGetStock(req: P2pHttpRequest): P2pHttpResponse<P2pStockData> {
    const sku = req.query?.sku;
    const barcode = req.query?.barcode;
    const id = req.query?.id;

    if (!sku && !barcode && !id) {
      return { status: 400, error: "Parámetro requerido: sku, barcode o id" };
    }

    let whereClause = "";
    let param = "";
    if (sku) {
      whereClause = "sku = ?";
      param = sku;
    } else if (barcode) {
      whereClause = "barcode = ?";
      param = barcode;
    } else {
      whereClause = "id = ?";
      param = id!;
    }

    const [prod] = this.config.db.all<{
      id: string;
      sku: string;
      barcode: string | null;
      name: string;
      price_usd: string;
      cost_usd: string;
      min_stock: string;
      image_path: string | null;
    }>(
      `SELECT id, sku, barcode, name, price_usd, cost_usd, min_stock, image_path
       FROM products
       WHERE tenant_id = ? AND ${whereClause} AND is_active = 1`,
      [this.tenantId, param],
    );

    if (!prod) {
      return { status: 404, error: "Producto no encontrado" };
    }

    const [stockRow] = this.config.db.all<{ current_stock_e4: number }>(
      "SELECT current_stock_e4 FROM v_product_current_stock WHERE product_id = ?",
      [prod.id],
    );

    const currentStock = new Decimal(stockRow?.current_stock_e4 ?? 0).div(10000).toFixed(4);

    return {
      status: 200,
      data: {
        productId: prod.id,
        sku: prod.sku,
        barcode: prod.barcode,
        name: prod.name,
        priceUsd: prod.price_usd,
        costUsd: prod.cost_usd,
        minStock: prod.min_stock,
        currentStock,
        imagePath: prod.image_path,
      },
    };
  }

  private handleGetExchangeRate(): P2pHttpResponse<P2pExchangeRateData> {
    const rate = getLatestRate(this.config.db);
    if (!rate) {
      return { status: 404, error: "No hay tasa registrada" };
    }
    return {
      status: 200,
      data: {
        rateDate: rate.rateDate,
        rateToVes: rate.rateToVes,
        source: rate.source,
        notes: rate.notes,
      },
    };
  }

  private async handleGetImage(req: P2pHttpRequest): Promise<P2pHttpResponse<P2pImageData>> {
    let imagePath = req.query?.path;
    if (!imagePath && req.path.startsWith("/p2p/images/")) {
      imagePath = decodeURIComponent(req.path.slice("/p2p/images/".length));
    }

    if (!imagePath) {
      return { status: 400, error: "Parámetro 'path' requerido" };
    }

    // Prevención de directory traversal
    if (imagePath.includes("..") || imagePath.includes("\\") || imagePath.startsWith("/")) {
      return { status: 400, error: "Ruta de imagen inválida" };
    }

    if (!this.config.fileStore?.readFile) {
      return { status: 404, error: "FileStore no disponible para lectura" };
    }

    const data = await this.config.fileStore.readFile(imagePath);
    if (!data) {
      return { status: 404, error: "Imagen no encontrada" };
    }

    const base64 = Buffer.from(data).toString("base64");
    return {
      status: 200,
      data: {
        path: imagePath,
        base64,
      },
    };
  }

  private getHeader(headers: Record<string, string>, target: string): string | undefined {
    const targetLower = target.toLowerCase();
    for (const [k, v] of Object.entries(headers)) {
      if (k.toLowerCase() === targetLower) return v;
    }
    return undefined;
  }
}

export interface P2pHttpDispatcher {
  dispatch<T = unknown>(ip: string, port: number, request: P2pHttpRequest): Promise<P2pHttpResponse<T>>;
}

export class InMemoryP2pNetwork implements P2pHttpDispatcher {
  private servers: Map<string, P2pHttpServer> = new Map();

  register(server: P2pHttpServer): void {
    this.servers.set(`${server.ip}:${server.port}`, server);
  }

  unregister(server: P2pHttpServer): void {
    this.servers.delete(`${server.ip}:${server.port}`);
  }

  async dispatch<T = unknown>(ip: string, port: number, request: P2pHttpRequest): Promise<P2pHttpResponse<T>> {
    const key = `${ip}:${port}`;
    const server = this.servers.get(key);
    if (!server) {
      return {
        status: 503,
        error: `Servidor P2P no alcanzable en ${key}`,
      };
    }
    return (await server.handleRequest(request)) as P2pHttpResponse<T>;
  }
}

export class FetchP2pHttpDispatcher implements P2pHttpDispatcher {
  async dispatch<T = unknown>(ip: string, port: number, request: P2pHttpRequest): Promise<P2pHttpResponse<T>> {
    const queryStr = request.query && Object.keys(request.query).length > 0
      ? "?" + new URLSearchParams(request.query).toString()
      : "";
    const url = `http://${ip}:${port}${request.path}${queryStr}`;
    const res = await fetch(url, {
      method: request.method,
      headers: {
        "Content-Type": "application/json",
        ...request.headers,
      },
      body: request.body ? JSON.stringify(request.body) : undefined,
      signal: AbortSignal.timeout(5000),
    });
    return (await res.json()) as P2pHttpResponse<T>;
  }
}

export interface P2pHttpClientConfig {
  tenantId: string;
  terminalId: string;
  dispatcher: P2pHttpDispatcher;
}

export class P2pHttpClient {
  constructor(private config: P2pHttpClientConfig) {}

  private getHeaders(): Record<string, string> {
    return {
      "x-tenant-id": this.config.tenantId,
      "x-terminal-id": this.config.terminalId,
    };
  }

  async getStock(
    peer: { ip: string; port: number },
    query: { sku?: string; barcode?: string; id?: string },
  ): Promise<P2pHttpResponse<P2pStockData>> {
    return this.config.dispatcher.dispatch<P2pStockData>(peer.ip, peer.port, {
      method: "GET",
      path: "/p2p/stock",
      headers: this.getHeaders(),
      query: query as Record<string, string>,
    });
  }

  async getExchangeRate(peer: { ip: string; port: number }): Promise<P2pHttpResponse<P2pExchangeRateData>> {
    return this.config.dispatcher.dispatch<P2pExchangeRateData>(peer.ip, peer.port, {
      method: "GET",
      path: "/p2p/exchange-rate",
      headers: this.getHeaders(),
    });
  }

  async getImage(peer: { ip: string; port: number }, imagePath: string): Promise<P2pHttpResponse<P2pImageData>> {
    return this.config.dispatcher.dispatch<P2pImageData>(peer.ip, peer.port, {
      method: "GET",
      path: "/p2p/images",
      headers: this.getHeaders(),
      query: { path: imagePath },
    });
  }
}

