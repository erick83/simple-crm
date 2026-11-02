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
     VALUES (?, ?, 'USD', ?, ?, ?, ?, ?)`,
    [uuidv7(now), rateDate, rate, source, now, notes, now],
  );
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


