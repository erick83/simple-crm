import type { SqlDriver } from "../connection";
import { uuidv7 } from "../../utils/uuid7";
import { Decimal, toDecimal } from "../../utils/decimal";

export interface StoredRate {
  rateDate: string;
  rateToVes: string;
  source: "BCV_AUTO" | "MANUAL";
  notes: string | null;
}

export interface ExchangeRateHistoryItem extends StoredRate {
  deltaPreviousDay?: string;
  percentPreviousDay?: string;
}

export interface ExchangeRateReport {
  periodFrom: string;
  periodTo: string;
  totalDays: number;
  latestRate: string;
  minRate: string;
  maxRate: string;
  averageRate: string;
  variationAbsolute: string;
  variationPercent: string;
  bcvAutoCount: number;
  manualCount: number;
  rates: ExchangeRateHistoryItem[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function getRateForDate(db: SqlDriver, rateDate: string): StoredRate | undefined {
  const [r] = db.all<{
    rate_date: string;
    rate_to_ves: string;
    source: StoredRate["source"];
    notes: string | null;
  }>(
    "SELECT rate_date, rate_to_ves, source, notes FROM exchange_rates WHERE rate_date = ? AND currency_code = 'USD'",
    [rateDate],
  );
  return r && { rateDate: r.rate_date, rateToVes: r.rate_to_ves, source: r.source, notes: r.notes };
}

export function insertRate(
  db: SqlDriver,
  rateDate: string,
  rate: string,
  source: StoredRate["source"],
  notes: string | null,
  now: number = Date.now(),
): void {
  db.run(
    `INSERT INTO exchange_rates (id, rate_date, currency_code, rate_to_ves, source, fetched_at, notes, created_at)
     VALUES (?, ?, 'USD', ?, ?, ?, ?, ?)
     ON CONFLICT(rate_date, currency_code) DO UPDATE SET
       rate_to_ves = excluded.rate_to_ves,
       source = excluded.source,
       fetched_at = excluded.fetched_at,
       notes = excluded.notes`,
    [uuidv7(now), rateDate, rate, source, now, notes, now],
  );
}

/**
 * Corrección auditada de una tasa ya fijada (auditoría §F3/§F4). `exchange_rates` conserva
 * el valor oficial del día; esta bitácora guarda el valor reemplazado, el nuevo, el motivo,
 * la caja y el momento. Las ventas NO se re-tasan: su tasa vive en `invoices.exchange_rate`.
 */
export interface RateCorrection {
  id: string;
  rateDate: string;
  /** 'EXCHANGE_RATE' = tasa del día; 'SHIFT' = tasa de un turno abierto sin ventas. */
  context: "EXCHANGE_RATE" | "SHIFT";
  contextId: string | null;
  previousRate: string;
  newRate: string;
  reason: string;
  source: "MANUAL" | "SHIFT_OVERRIDE";
  terminalId: string | null;
  createdAt: number;
}

export function recordRateCorrection(
  db: SqlDriver,
  args: {
    rateDate: string;
    context: RateCorrection["context"];
    contextId?: string | null;
    previousRate: string;
    newRate: string;
    reason: string;
    source: RateCorrection["source"];
    terminalId?: string | null;
  },
  now: number = Date.now(),
): string {
  const reason = args.reason.trim();
  if (!reason) {
    throw new Error("Toda corrección de tasa exige un motivo auditado.");
  }
  const previous = toDecimal(args.previousRate, "previousRate").toFixed(4);
  const next = toDecimal(args.newRate, "newRate").toFixed(4);
  if (previous === next) {
    throw new Error("La tasa nueva es idéntica a la vigente; no hay nada que corregir.");
  }

  const id = uuidv7(now);
  db.run(
    `INSERT INTO exchange_rate_corrections (
       id, rate_date, context, context_id, previous_rate, new_rate, reason, source, terminal_id, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      args.rateDate,
      args.context,
      args.contextId ?? null,
      previous,
      next,
      reason,
      args.source,
      args.terminalId ?? null,
      now,
    ],
  );
  return id;
}

export function listRateCorrections(
  db: SqlDriver,
  filter: { rateDate?: string; shiftId?: string; limit?: number } = {},
): RateCorrection[] {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filter.rateDate) {
    conditions.push("rate_date = ?");
    params.push(filter.rateDate);
  }
  if (filter.shiftId) {
    conditions.push("context_id = ?");
    params.push(filter.shiftId);
  }

  let sql = `SELECT id, rate_date, context, context_id, previous_rate, new_rate, reason, source, terminal_id, created_at
     FROM exchange_rate_corrections`;
  if (conditions.length > 0) sql += ` WHERE ${conditions.join(" AND ")}`;
  sql += " ORDER BY created_at DESC";
  if (typeof filter.limit === "number" && filter.limit > 0) {
    sql += " LIMIT ?";
    params.push(filter.limit);
  }

  return db
    .all<{
      id: string;
      rate_date: string;
      context: RateCorrection["context"];
      context_id: string | null;
      previous_rate: string;
      new_rate: string;
      reason: string;
      source: RateCorrection["source"];
      terminal_id: string | null;
      created_at: number;
    }>(sql, params)
    .map((r) => ({
      id: r.id,
      rateDate: r.rate_date,
      context: r.context,
      contextId: r.context_id,
      previousRate: r.previous_rate,
      newRate: r.new_rate,
      reason: r.reason,
      source: r.source,
      terminalId: r.terminal_id,
      createdAt: r.created_at,
    }));
}

export function getLatestRate(db: SqlDriver): StoredRate | undefined {
  const [r] = db.all<{
    rate_date: string;
    rate_to_ves: string;
    source: StoredRate["source"];
    notes: string | null;
  }>(
    "SELECT rate_date, rate_to_ves, source, notes FROM exchange_rates WHERE currency_code = 'USD' ORDER BY rate_date DESC LIMIT 1",
  );
  return r && { rateDate: r.rate_date, rateToVes: r.rate_to_ves, source: r.source, notes: r.notes };
}

export interface RateHistoryOptions {
  startDate?: string;
  endDate?: string;
  limit?: number;
  order?: "ASC" | "DESC";
}

export function getRateHistory(
  db: SqlDriver,
  options: RateHistoryOptions = {},
): StoredRate[] {
  const { startDate, endDate, limit, order = "DESC" } = options;
  const conditions: string[] = ["currency_code = 'USD'"];
  const params: (string | number)[] = [];

  if (startDate) {
    conditions.push("rate_date >= ?");
    params.push(startDate);
  }
  if (endDate) {
    conditions.push("rate_date <= ?");
    params.push(endDate);
  }

  const orderDirection = order === "ASC" ? "ASC" : "DESC";
  let sql = `SELECT rate_date, rate_to_ves, source, notes FROM exchange_rates WHERE ${conditions.join(
    " AND ",
  )} ORDER BY rate_date ${orderDirection}`;

  if (typeof limit === "number" && limit > 0) {
    sql += " LIMIT ?";
    params.push(limit);
  }

  const rows = db.all<{
    rate_date: string;
    rate_to_ves: string;
    source: StoredRate["source"];
    notes: string | null;
  }>(sql, params);

  return rows.map((r) => ({
    rateDate: r.rate_date,
    rateToVes: r.rate_to_ves,
    source: r.source,
    notes: r.notes,
  }));
}

export function generateExchangeRateReport(
  db: SqlDriver,
  options: RateHistoryOptions = {},
): ExchangeRateReport {
  // Consultar en orden ascendente para calcular correctamente los deltas interdiarios
  const ascRates = getRateHistory(db, {
    ...options,
    order: "ASC",
  });

  if (ascRates.length === 0) {
    return {
      periodFrom: options.startDate ?? "",
      periodTo: options.endDate ?? "",
      totalDays: 0,
      latestRate: "0.0000",
      minRate: "0.0000",
      maxRate: "0.0000",
      averageRate: "0.0000",
      variationAbsolute: "0.0000",
      variationPercent: "0.00",
      bcvAutoCount: 0,
      manualCount: 0,
      rates: [],
    };
  }

  let min = toDecimal(ascRates[0]!.rateToVes);
  let max = toDecimal(ascRates[0]!.rateToVes);
  let sum = new Decimal(0);
  let bcvAutoCount = 0;
  let manualCount = 0;

  const itemsWithDelta: ExchangeRateHistoryItem[] = [];

  for (let i = 0; i < ascRates.length; i++) {
    const item = ascRates[i]!;
    const rateDec = toDecimal(item.rateToVes);

    if (rateDec.lt(min)) min = rateDec;
    if (rateDec.gt(max)) max = rateDec;
    sum = sum.plus(rateDec);

    if (item.source === "BCV_AUTO") bcvAutoCount++;
    else manualCount++;

    let deltaPreviousDay: string | undefined;
    let percentPreviousDay: string | undefined;

    if (i > 0) {
      const prevDec = toDecimal(ascRates[i - 1]!.rateToVes);
      const diff = rateDec.minus(prevDec);
      const sign = diff.isPositive() && !diff.isZero() ? "+" : "";
      deltaPreviousDay = `${sign}${diff.toFixed(4)}`;

      if (!prevDec.isZero()) {
        const pct = diff.dividedBy(prevDec).times(100);
        const pctSign = pct.isPositive() && !pct.isZero() ? "+" : "";
        percentPreviousDay = `${pctSign}${pct.toFixed(2)}%`;
      } else {
        percentPreviousDay = "0.00%";
      }
    }

    itemsWithDelta.push({
      ...item,
      deltaPreviousDay,
      percentPreviousDay,
    });
  }

  const firstRate = toDecimal(ascRates[0]!.rateToVes);
  const lastRate = toDecimal(ascRates[ascRates.length - 1]!.rateToVes);
  const totalDiff = lastRate.minus(firstRate);
  const totalDiffSign = totalDiff.isPositive() && !totalDiff.isZero() ? "+" : "";
  const variationAbsolute = `${totalDiffSign}${totalDiff.toFixed(4)}`;

  let variationPercent = "0.00";
  if (!firstRate.isZero()) {
    const totalPct = totalDiff.dividedBy(firstRate).times(100);
    const totalPctSign = totalPct.isPositive() && !totalPct.isZero() ? "+" : "";
    variationPercent = `${totalPctSign}${totalPct.toFixed(2)}`;
  }

  const averageRate = sum.dividedBy(ascRates.length).toFixed(4);

  const resultRates =
    options.order === "ASC" ? itemsWithDelta : [...itemsWithDelta].reverse();

  return {
    periodFrom: ascRates[0]!.rateDate,
    periodTo: ascRates[ascRates.length - 1]!.rateDate,
    totalDays: ascRates.length,
    latestRate: lastRate.toFixed(4),
    minRate: min.toFixed(4),
    maxRate: max.toFixed(4),
    averageRate,
    variationAbsolute,
    variationPercent,
    bcvAutoCount,
    manualCount,
    rates: resultRates,
  };
}


