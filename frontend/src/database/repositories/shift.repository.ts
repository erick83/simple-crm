import type { SqlDriver } from "../connection";
import { uuidv7 } from "../../utils/uuid7";
import { toDecimal, formatFixed4 } from "../../utils/decimal";

export interface ShiftEntity {
  id: string;
  terminalId: string;
  cashierName: string;
  openedAt: number;
  closedAt: number | null;
  exchangeRateApplied: string;
  initialCashUsd: string;
  initialCashVes: string;
  expectedCashUsd: string | null;
  expectedCashVes: string | null;
  declaredCashUsd: string | null;
  declaredCashVes: string | null;
  differenceUsd: string | null;
  differenceVes: string | null;
  status: "OPEN" | "CLOSED";
}

export function openShift(
  db: SqlDriver,
  args: {
    terminalId: string;
    cashierName: string;
    exchangeRateApplied: string;
    initialCashUsd?: string;
    initialCashVes?: string;
  },
  now: number = Date.now(),
): string {
  const existing = getOpenShift(db, args.terminalId);
  if (existing) {
    throw new Error(`Ya existe un turno abierto para la terminal ${args.terminalId}`);
  }

  const id = uuidv7(now);
  const initialUsd = toDecimal(args.initialCashUsd ?? "0", "initialCashUsd").toFixed(4);
  const initialVes = toDecimal(args.initialCashVes ?? "0", "initialCashVes").toFixed(4);
  const rate = toDecimal(args.exchangeRateApplied, "exchangeRateApplied").toFixed(4);

  db.run(
    `INSERT INTO cash_shifts (
      id, terminal_id, cashier_name, opened_at, exchange_rate_applied,
      initial_cash_usd, initial_cash_ves, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN')`,
    [id, args.terminalId, args.cashierName.trim(), now, rate, initialUsd, initialVes],
  );
  return id;
}

export function getOpenShift(db: SqlDriver, terminalId: string): ShiftEntity | undefined {
  const [row] = db.all<{
    id: string;
    terminal_id: string;
    cashier_name: string;
    opened_at: number;
    closed_at: number | null;
    exchange_rate_applied: string;
    initial_cash_usd: string;
    initial_cash_ves: string;
    expected_cash_usd: string | null;
    expected_cash_ves: string | null;
    declared_cash_usd: string | null;
    declared_cash_ves: string | null;
    difference_usd: string | null;
    difference_ves: string | null;
    status: "OPEN" | "CLOSED";
  }>(
    "SELECT * FROM cash_shifts WHERE terminal_id = ? AND status = 'OPEN' ORDER BY opened_at DESC LIMIT 1",
    [terminalId],
  );
  if (!row) return undefined;

  return {
    id: row.id,
    terminalId: row.terminal_id,
    cashierName: row.cashier_name,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    exchangeRateApplied: row.exchange_rate_applied,
    initialCashUsd: row.initial_cash_usd,
    initialCashVes: row.initial_cash_ves,
    expectedCashUsd: row.expected_cash_usd,
    expectedCashVes: row.expected_cash_ves,
    declaredCashUsd: row.declared_cash_usd,
    declaredCashVes: row.declared_cash_ves,
    differenceUsd: row.difference_usd,
    differenceVes: row.difference_ves,
    status: row.status,
  };
}

