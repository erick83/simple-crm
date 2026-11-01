import type { SqlDriver } from "../connection";
import { uuidv7 } from "../../utils/uuid7";

export interface StoredRate {
  rateDate: string;
  rateToVes: string;
  source: "BCV_AUTO" | "MANUAL";
  notes: string | null;
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

