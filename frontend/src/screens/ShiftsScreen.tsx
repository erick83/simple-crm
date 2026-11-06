import React, { useState, useEffect, useCallback } from "react";
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { spacing } from "../theme/spacing";
import { typography } from "../theme/typography";
import { useTheme, useThemedStyles } from "../theme/ThemeContext";
import type { Palette } from "../theme/tokens";
import { formatUsd, formatVes, formatExchangeRate, toDecimal, formatFixed4 } from "../utils/decimal";
import type { SqlDriver } from "../database/connection";
import {
  getOpenShift,
  openShift,
  performArqueoX,
  performCierreZ,
  addCashMovement,
  listCashMovements,
  listClosedShifts,
  ShiftEntity,
  ShiftCashAudit,
  CierreZResult,
  CashMovementEntity,
} from "../database/repositories/shift.repository";
import {
  USD_DENOMINATIONS,
  VES_DENOMINATIONS,
  calculateDenominationsTotal,
} from "../utils/denominations";
import { logOperatorAction } from "../database/repositories/operator.repository";
import type { OperatorEntity } from "../database/repositories/operator.repository";

export interface ShiftsScreenProps {
  db?: SqlDriver;
  terminalId?: string;
  defaultExchangeRate?: string;
  initialCashierName?: string;
  currentOperator?: OperatorEntity | null;
  onShiftChanged?: (shift: ShiftEntity | null) => void;
}

export const ShiftsScreen: React.FC<ShiftsScreenProps> = ({
  db,
  terminalId = "TERM-01",
  defaultExchangeRate = "36.5000",
  initialCashierName,
  currentOperator,
  onShiftChanged,
}) => {
  const { colors: theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [activeShift, setActiveShift] = useState<ShiftEntity | null>(null);

  // Apertura de turno
  const [newCashier, setNewCashier] = useState(
    () => currentOperator?.name ?? initialCashierName ?? "",
  );
  const [newInitialUsd, setNewInitialUsd] = useState("50.00");
  const [newInitialVes, setNewInitialVes] = useState("1825.00");
  const [newExchangeRate, setNewExchangeRate] = useState(defaultExchangeRate);
  const [openError, setOpenError] = useState<string | null>(null);

  useEffect(() => {
    if (currentOperator?.name) {
      setNewCashier(currentOperator.name);
    } else if (initialCashierName) {
      setNewCashier(initialCashierName);
    }
  }, [currentOperator?.name, initialCashierName]);

  // Cierre Z
  const [declaredUsd, setDeclaredUsd] = useState("");
  const [declaredVes, setDeclaredVes] = useState("");
  const [closeReport, setCloseReport] = useState<CierreZResult | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);

  // Arqueo X (Modal)
  const [isArqueoXModalOpen, setIsArqueoXModalOpen] = useState(false);
  const [arqueoXData, setArqueoXData] = useState<ShiftCashAudit | null>(null);

  // Movimientos de Gaveta (Sangrías y Entradas)
  const [cashMovements, setCashMovements] = useState<CashMovementEntity[]>([]);
  const [isCashMovementModalOpen, setIsCashMovementModalOpen] = useState(false);
  const [movementType, setMovementType] = useState<"DROP" | "INFLOW">("DROP");
  const [movementCurrency, setMovementCurrency] = useState<"USD" | "VES">("USD");
  const [movementAmount, setMovementAmount] = useState("");
  const [movementReason, setMovementReason] = useState("");
  const [movementError, setMovementError] = useState<string | null>(null);

  // Asistente de Conteo por Denominación de Billetes
  const [isDenomModalOpen, setIsDenomModalOpen] = useState(false);
  const [usdDenomCounts, setUsdDenomCounts] = useState<Record<number, number>>({});
  const [vesDenomCounts, setVesDenomCounts] = useState<Record<number, number>>({});

  // Historial de Cierres Z
  const [closedShiftsHistory, setClosedShiftsHistory] = useState<ShiftEntity[]>([]);

  // Carga inicial y refresco del turno, movimientos e histórico
  const refreshShiftData = useCallback(() => {
    if (!db) return;
    try {
      const shift = getOpenShift(db, terminalId);
      setActiveShift(shift ?? null);
      onShiftChanged?.(shift ?? null);
      if (shift) {
        setCashMovements(listCashMovements(db, shift.id));
      } else {
        setCashMovements([]);
      }
      setClosedShiftsHistory(listClosedShifts(db, terminalId, 5));
    } catch {
      // ignore
    }
  }, [db, terminalId, onShiftChanged]);

  useEffect(() => {
    refreshShiftData();
  }, [refreshShiftData]);

    const handleOpenShift = () => {
      try {
        setOpenError(null);
        if (!db) {
          // Modo preview / sin db directa
          const simulatedShift: ShiftEntity = {
            id: "sim-shift-1",
            terminalId,
            cashierName: newCashier,
            openedAt: Date.now(),
            closedAt: null,
            exchangeRateApplied: formatFixed4(newExchangeRate),
            initialCashUsd: formatFixed4(newInitialUsd),
            initialCashVes: formatFixed4(newInitialVes),
            expectedCashUsd: null,
            expectedCashVes: null,
            declaredCashUsd: null,
            declaredCashVes: null,
            differenceUsd: null,
            differenceVes: null,
            status: "OPEN",
          };
          setActiveShift(simulatedShift);
          onShiftChanged?.(simulatedShift);
          return;
        }

        const openedId = openShift(db, {
          terminalId,
          cashierName: newCashier,
          exchangeRateApplied: newExchangeRate,
          initialCashUsd: newInitialUsd,
          initialCashVes: newInitialVes,
        });

        try {
          logOperatorAction(db, {
            operatorId: currentOperator?.id ?? "op-shift",
            operatorName: currentOperator?.name ?? newCashier,
            action: "OPEN_SHIFT",
            entityType: "SHIFT",
            entityId: openedId,
            details: {
              cashier: newCashier,
              exchangeRate: newExchangeRate,
              initialCashUsd: newInitialUsd,
              initialCashVes: newInitialVes,
            },
          });
        } catch {
          // No romper apertura si falla auditoría
        }

        refreshShiftData();
      } catch (err) {
        setOpenError((err as Error).message);
      }
    };

    const handleArqueoX = () => {
      if (!activeShift) return;
      if (db) {
        const audit = performArqueoX(db, activeShift.id);
        setArqueoXData(audit);
      } else {
        // Simulado para UI
        setArqueoXData({
          shiftId: activeShift.id,
          terminalId: activeShift.terminalId,
          cashierName: activeShift.cashierName,
          status: "OPEN",
          exchangeRateApplied: activeShift.exchangeRateApplied,
          initialCashUsd: activeShift.initialCashUsd,
          initialCashVes: activeShift.initialCashVes,
          salesCashUsd: "92.5000",
          salesCashVes: "3376.2500",
          dropsCashUsd: "20.0000",
          dropsCashVes: "500.0000",
          inflowsCashUsd: "0.0000",
          inflowsCashVes: "200.0000",
          salesPagoMovilVes: "4197.5000",
          salesCardVes: "1825.0000",
          totalSalesUsd: "250.0000",
          totalSalesVes: "9125.0000",
          expectedCashUsd: "122.5000",
          expectedCashVes: "4901.2500",
          invoiceCount: 12,
        });
      }
      setIsArqueoXModalOpen(true);
    };

    const handleAddMovement = () => {
      if (!activeShift) return;
      try {
        setMovementError(null);
        if (db) {
          const mov = addCashMovement(db, {
            shiftId: activeShift.id,
            terminalId,
            movementType,
            currency: movementCurrency,
            amount: movementAmount,
            reason: movementReason,
            cashierName: activeShift.cashierName,
          });

          try {
            logOperatorAction(db, {
              operatorId: currentOperator?.id ?? "op-shift",
              operatorName: currentOperator?.name ?? activeShift.cashierName,
              action: "CASH_MOVEMENT",
              entityType: "CASH_MOVEMENT",
              entityId: mov.id,
              details: {
                movementType,
                currency: movementCurrency,
                amount: movementAmount,
                reason: movementReason,
              },
            });
          } catch {
            // ignore
          }

          setCashMovements(listCashMovements(db, activeShift.id));
        } else {
          const simulated: CashMovementEntity = {
            id: `sim-mov-${Date.now()}`,
            shiftId: activeShift.id,
            terminalId,
            movementType,
            currency: movementCurrency,
            amount: formatFixed4(movementAmount || "0"),
            reason: movementReason || "Movimiento manual",
            cashierName: activeShift.cashierName,
            createdAt: Date.now(),
          };
          setCashMovements((prev) => [...prev, simulated]);
        }
        setMovementAmount("");
        setMovementReason("");
        setIsCashMovementModalOpen(false);
      } catch (err) {
        setMovementError((err as Error).message);
      }
    };

    const handleApplyDenominations = () => {
      const totalUsd = calculateDenominationsTotal(usdDenomCounts);
      const totalVes = calculateDenominationsTotal(vesDenomCounts);
      if (toDecimal(totalUsd).gt(0)) {
        setDeclaredUsd(toDecimal(totalUsd).toFixed(2));
      }
      if (toDecimal(totalVes).gt(0)) {
        setDeclaredVes(toDecimal(totalVes).toFixed(2));
      }
      setIsDenomModalOpen(false);
    };

    const handleCierreZ = () => {
      if (!activeShift) return;
      try {
        setCloseError(null);
        if (db) {
          const result = performCierreZ(db, {
            shiftId: activeShift.id,
            declaredCashUsd: declaredUsd || "0",
            declaredCashVes: declaredVes || "0",
          });

          try {
            logOperatorAction(db, {
              operatorId: currentOperator?.id ?? "op-shift",
              operatorName: currentOperator?.name ?? activeShift.cashierName,
              action: "CLOSE_SHIFT",
              entityType: "SHIFT",
              entityId: activeShift.id,
              details: {
                declaredUsd,
                declaredVes,
                isSquare: result.isSquare,
                diffUsd: result.differenceUsd,
                diffVes: result.differenceVes,
              },
            });
          } catch {
            // ignore
          }

          setCloseReport(result);
          setActiveShift(result.shift);
          onShiftChanged?.(null);
          setClosedShiftsHistory(listClosedShifts(db, terminalId, 5));
        } else {
          // Simulado
          const expectedUsd = "142.5000";
          const expectedVes = "5201.2500";
          const decUsd = toDecimal(declaredUsd || "0").toFixed(4);
          const decVes = toDecimal(declaredVes || "0").toFixed(4);
          const diffUsd = toDecimal(decUsd).minus(toDecimal(expectedUsd)).toFixed(4);
          const diffVes = toDecimal(decVes).minus(toDecimal(expectedVes)).toFixed(4);
          const isSquare = toDecimal(diffUsd).isZero() && toDecimal(diffVes).isZero();

          setCloseReport({
            shift: { ...activeShift, status: "CLOSED", closedAt: Date.now() },
            declaredCashUsd: decUsd,
            declaredCashVes: decVes,
            expectedCashUsd: expectedUsd,
            expectedCashVes: expectedVes,
            differenceUsd: diffUsd,
            differenceVes: diffVes,
            isSquare,
          });
          setActiveShift({ ...activeShift, status: "CLOSED" });
          onShiftChanged?.(null);
        }
      } catch (err) {
        setCloseError((err as Error).message);
      }
    };

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
          <View style={styles.card}>
            <View style={styles.header}>
              <Text style={styles.title}>Control de Turno de Caja</Text>
                <View
                  style={[
                    styles.statusBadge,
                    activeShift?.status === "OPEN" ? styles.openBadge : styles.closedBadge,
                  ]}
                >
                  <Text style={styles.statusText}>
                    {activeShift?.status === "OPEN" ? "TURNO ABIERTO" : "TURNO CERRADO"}
                  </Text>
                </View>
              </View>

              {activeShift && activeShift.status === "OPEN" ? (
          <>
                  {/* Información del Turno Abierto */}
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Operador en sesión:</Text>
                    <Text style={styles.infoValue}>{activeShift.cashierName}</Text>
                  </View>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Tasa fijada de turno:</Text>
                    <Text style={[styles.infoValue, typography.tabularNumeric]}>
                      {formatExchangeRate(activeShift.exchangeRateApplied)}
                    </Text>
                  </View>

                  <View style={styles.divider} />

                  <View style={styles.subHeaderRow}>
                    <Text style={styles.subTitle}>Fondos y Movimientos de Gaveta</Text>
                    <View style={styles.headerBtnGroup}>
                      <TouchableOpacity
                        activeOpacity={0.8}
                        onPress={() => {
                          setMovementError(null);
                          setIsCashMovementModalOpen(true);
                        }}
                        style={styles.movementButton}
                        testID="btn-open-movement-modal"
                      >
                        <Text style={styles.movementButtonText}>💸 MOVIMIENTO GAVETA</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        activeOpacity={0.8}
                        onPress={handleArqueoX}
                        style={styles.xButton}
                        testID="btn-open-arqueox"
                      >
                        <Text style={styles.xButtonText}>ARQUEO X (PARCIAL)</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={styles.grid2}>
                    <View style={styles.gridItem}>
                      <Text style={styles.gridLabel}>Efectivo USD Inicial</Text>
                      <Text style={[styles.gridValue, typography.tabularNumeric]}>
                        {formatUsd(activeShift.initialCashUsd)}
                      </Text>
                    </View>
                    <View style={styles.gridItem}>
                      <Text style={styles.gridLabel}>Efectivo VES Inicial</Text>
                      <Text style={[styles.gridValue, typography.tabularNumeric]}>
                        {formatVes(activeShift.initialCashVes)}
                      </Text>
                    </View>
                  </View>

                  {/* Lista de movimientos de gaveta registrados en el turno */}
                  {cashMovements.length > 0 ? (
                    <View style={styles.movementsSection}>
                      <Text style={styles.movementsSectionTitle}>
                        Movimientos de Gaveta ({cashMovements.length})
                      </Text>
                      {cashMovements.map((m) => (
                        <View key={m.id} style={styles.movementItemRow}>
                          <View style={styles.movementBadgeContainer}>
                            <View
                              style={[
                                styles.movementTypeBadge,
                                m.movementType === "DROP" ? styles.badgeDrop : styles.badgeInflow,
                              ]}
                            >
                              <Text style={styles.movementBadgeText}>
                                {m.movementType === "DROP" ? "SANGRÍA" : "ENTRADA"}
                              </Text>
                            </View>
                            <Text style={styles.movementReasonText} numberOfLines={1}>
                              {m.reason}
                            </Text>
                          </View>
                          <Text
                            style={[
                              styles.movementAmountText,
                              m.movementType === "DROP" ? styles.dropAmount : styles.inflowAmount,
                              typography.tabularNumeric,
                            ]}
                          >
                            {m.movementType === "DROP" ? "-" : "+"}
                            {m.currency === "USD" ? formatUsd(m.amount) : formatVes(m.amount)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : null}

                  <View style={styles.divider} />

                  {/* Sección Cierre Z (Arqueo Ciego) */}
                  <View style={styles.closeSection}>
                    <View style={styles.blindHeaderRow}>
                      <Text style={styles.subTitle}>Cierre Z — Arqueo Ciego Independiente</Text>
                      <TouchableOpacity
                        activeOpacity={0.8}
                        onPress={() => setIsDenomModalOpen(true)}
                        style={styles.denomAssistantBtn}
                        testID="btn-open-denom-assistant"
                      >
                        <Text style={styles.denomAssistantBtnText}>🧮 Asistente de Billetes</Text>
                      </TouchableOpacity>
                    </View>
                    <Text style={styles.blindNotice}>
                      El operador debe contar físicamente el efectivo en gaveta y declararlo de forma
                      independiente por moneda. El sistema contrastará el dinero contra las ventas registradas.
                    </Text>

                            {closeError ? <Text style={styles.errorText}>{closeError}</Text> : null}

                            <View style={styles.inputsRow}>
                              <View style={styles.inputContainer}>
                                <Text style={styles.inputLabel}>Efectivo USD Contado ($)</Text>
                                <TextInput
                                  style={[styles.input, typography.tabularNumeric]}
                                  placeholder="0.00"
                                  placeholderTextColor={theme.textMuted}
                                  keyboardType="decimal-pad"
                                  value={declaredUsd}
                                  onChangeText={setDeclaredUsd}
                                />
                              </View>

                              <View style={styles.inputContainer}>
                                <Text style={styles.inputLabel}>Efectivo VES Contado (Bs.)</Text>
                                <TextInput
                                  style={[styles.input, typography.tabularNumeric]}
                                  placeholder="0.00"
                                  placeholderTextColor={theme.textMuted}
                                  keyboardType="decimal-pad"
                                  value={declaredVes}
                                  onChangeText={setDeclaredVes}
                                />
                              </View>
                            </View>

                              <TouchableOpacity
                                activeOpacity={0.8}
                                onPress={handleCierreZ}
                                style={styles.zButton}
                              >
                                <Text style={styles.zButtonText}>EJECUTAR CIERRE Z Y BLOQUEAR TURNO</Text>
                              </TouchableOpacity>
                            </View>
                          </>
                          ) : (
                          <>
                            {/* Si hay un reporte de cierre Z recién hecho, mostrarlo */}
                            {closeReport ? (
                              <View style={styles.reportSection}>
                                <Text style={styles.subTitle}>Resultados del Cierre Z</Text>
                                <View
                                  style={[
                                    styles.squareBadge,
                                    closeReport.isSquare ? styles.squareSuccess : styles.squareWarning,
                                  ]}
                                >
                                  <Text style={styles.squareText}>
                                    {closeReport.isSquare
                                      ? "✓ CAJA PERFECTAMENTE CUADRADA"
                                      : "⚠ DESCUADRE DETECTADO"}
                                  </Text>
                                </View>

                                <View style={styles.reportGrid}>
                                  <View style={styles.reportItem}>
                                    <Text style={styles.gridLabel}>Diferencia USD</Text>
                                    <Text
                                      style={[
                                        styles.reportValue,
                                        typography.tabularNumeric,
                                        toDecimal(closeReport.differenceUsd).isNegative()
                                          ? styles.negativeDiff
                                          : styles.positiveDiff,
                                      ]}
                                    >
                                      {formatUsd(closeReport.differenceUsd)}
                                    </Text>
                                    <Text style={styles.reportSub}>
                                      Declarado: {formatUsd(closeReport.declaredCashUsd)} | Esperado:{" "}
                                      {formatUsd(closeReport.expectedCashUsd)}
                                    </Text>
                                  </View>

                                  <View style={styles.reportItem}>
                                    <Text style={styles.gridLabel}>Diferencia VES</Text>
                                    <Text
                                      style={[
                                        styles.reportValue,
                                        typography.tabularNumeric,
                                        toDecimal(closeReport.differenceVes).isNegative()
                                          ? styles.negativeDiff
                                          : styles.positiveDiff,
                                      ]}
                                    >
                                      {formatVes(closeReport.differenceVes)}
                                    </Text>
                                    <Text style={styles.reportSub}>
                                      Declarado: {formatVes(closeReport.declaredCashVes)} | Esperado:{" "}
                                      {formatVes(closeReport.expectedCashVes)}
                                    </Text>
                                  </View>
                                </View>

                                <View style={styles.divider} />
                              </View>
                            ) : null}

                            {/* Formulario de Apertura de Nuevo Turno */}
                            <View style={styles.openSection}>
                              <Text style={styles.subTitle}>Apertura de Nuevo Turno de Caja</Text>
                              <Text style={styles.blindNotice}>
                                Registre el cajero, fije la tasa oficial y declare el fondo inicial por moneda.
                              </Text>

                              {openError ? <Text style={styles.errorText}>{openError}</Text> : null}

                              <View style={styles.inputsRow}>
                                <View style={styles.inputContainer}>
                                  <Text style={styles.inputLabel}>Nombre del Cajero</Text>
                                  <TextInput
                                    style={styles.input}
                                    value={newCashier}
                                    onChangeText={setNewCashier}
                                  />
                                </View>

                                <View style={styles.inputContainer}>
                                  <Text style={styles.inputLabel}>Tasa Aplicada (Bs.)</Text>
                                  <TextInput
                                    style={[styles.input, typography.tabularNumeric]}
                                    value={newExchangeRate}
                                    onChangeText={setNewExchangeRate}
                                    keyboardType="decimal-pad"
                                  />
                                </View>
                              </View>

                              <View style={styles.inputsRow}>
                                <View style={styles.inputContainer}>
                                  <Text style={styles.inputLabel}>Fondo Inicial USD ($)</Text>
                                  <TextInput
                                    style={[styles.input, typography.tabularNumeric]}
                                    value={newInitialUsd}
                                    placeholder="0.00"
                                    placeholderTextColor={theme.textMuted}
                                    onChangeText={setNewInitialUsd}
                                    keyboardType="decimal-pad"
                                  />
                                </View>

                                <View style={styles.inputContainer}>
                                  <Text style={styles.inputLabel}>Fondo Inicial VES (Bs.)</Text>
                                  <TextInput
                                    style={[styles.input, typography.tabularNumeric]}
                                    value={newInitialVes}
                                    placeholder="0.00"
                                    placeholderTextColor={theme.textMuted}
                                    onChangeText={setNewInitialVes}
                                    keyboardType="decimal-pad"
                                  />
                                </View>
                              </View>

                              <TouchableOpacity
                                activeOpacity={0.8}
                                onPress={handleOpenShift}
                                style={styles.openButton}
                              >
                                <Text style={styles.openButtonText}>ABRIR TURNO DE CAJA</Text>
                              </TouchableOpacity>
                            </View>
          </>
        )}
      </View>

      {/* Historial de Cierres Z Anteriores */}
      {closedShiftsHistory.length > 0 ? (
        <View style={styles.historyCard}>
          <Text style={styles.historyTitle}>📜 Historial de Cierres Z Anteriores</Text>
          <View style={styles.historyList}>
            {closedShiftsHistory.map((s) => {
              const isSquare =
                toDecimal(s.differenceUsd ?? "0").isZero() &&
                toDecimal(s.differenceVes ?? "0").isZero();
              const closedDate = s.closedAt ? new Date(s.closedAt) : null;
              return (
                <View key={s.id} style={styles.historyRow}>
                  <View style={styles.historyMeta}>
                    <Text style={styles.historyCashier}>
                      {s.cashierName} • Turno #{s.id.slice(-4).toUpperCase()}
                    </Text>
                    <Text style={styles.historyDate}>
                      {closedDate ? `${closedDate.toLocaleDateString()} ${closedDate.toLocaleTimeString()}` : "Cerrado"}
                    </Text>
                  </View>
                  <View style={styles.historyAmounts}>
                    <Text style={[styles.historyAmountText, typography.tabularNumeric]}>
                      USD: {formatUsd(s.declaredCashUsd ?? "0")} (Dif: {formatUsd(s.differenceUsd ?? "0")})
                    </Text>
                    <Text style={[styles.historyAmountText, typography.tabularNumeric]}>
                      VES: {formatVes(s.declaredCashVes ?? "0")} (Dif: {formatVes(s.differenceVes ?? "0")})
                    </Text>
                  </View>
                  <View style={[styles.historyBadge, isSquare ? styles.badgeSquare : styles.badgeDiff]}>
                    <Text style={styles.historyBadgeText}>
                      {isSquare ? "CUADRADO" : "DESCUADRE"}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}

      {/* Modal Arqueo X (Corte Parcial) */}
      <Modal visible={isArqueoXModalOpen} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Arqueo X — Corte Parcial de Turno</Text>
            <Text style={styles.modalNotice}>
              Este corte es informativo y no bloquea ni cierra las ventas de la sesión.
            </Text>

            {arqueoXData ? (
              <View style={styles.auditContainer}>
                <View style={styles.auditRow}>
                  <Text style={styles.auditLabel}>Facturas emitidas:</Text>
                  <Text style={styles.auditValue}>{arqueoXData.invoiceCount}</Text>
                </View>

                <View style={styles.auditRow}>
                  <Text style={styles.auditLabel}>Efectivo en Caja Esperado (USD):</Text>
                  <Text style={[styles.auditValue, typography.tabularNumeric]}>
                    {formatUsd(arqueoXData.expectedCashUsd)}
                  </Text>
                </View>
                <View style={styles.auditRow}>
                  <Text style={styles.auditLabel}>Efectivo en Caja Esperado (VES):</Text>
                  <Text style={[styles.auditValue, typography.tabularNumeric]}>
                    {formatVes(arqueoXData.expectedCashVes)}
                  </Text>
                </View>

                <View style={styles.divider} />

                <Text style={styles.breakdownTitle}>Movimientos de Gaveta:</Text>
                <View style={styles.auditRow}>
                  <Text style={styles.auditLabel}>• Sangrías / Retiros USD:</Text>
                  <Text style={[styles.auditValue, styles.dropAmount, typography.tabularNumeric]}>
                    -{formatUsd(arqueoXData.dropsCashUsd)}
                  </Text>
                </View>
                <View style={styles.auditRow}>
                  <Text style={styles.auditLabel}>• Sangrías / Retiros VES:</Text>
                  <Text style={[styles.auditValue, styles.dropAmount, typography.tabularNumeric]}>
                    -{formatVes(arqueoXData.dropsCashVes)}
                  </Text>
                </View>
                <View style={styles.auditRow}>
                  <Text style={styles.auditLabel}>• Entradas Extraordinarias USD:</Text>
                  <Text style={[styles.auditValue, styles.inflowAmount, typography.tabularNumeric]}>
                    +{formatUsd(arqueoXData.inflowsCashUsd)}
                  </Text>
                </View>
                <View style={styles.auditRow}>
                  <Text style={styles.auditLabel}>• Entradas Extraordinarias VES:</Text>
                  <Text style={[styles.auditValue, styles.inflowAmount, typography.tabularNumeric]}>
                    +{formatVes(arqueoXData.inflowsCashVes)}
                  </Text>
                </View>

                <View style={styles.divider} />

                <Text style={styles.breakdownTitle}>Ventas del turno por método:</Text>
                <View style={styles.auditRow}>
                  <Text style={styles.auditLabel}>• Efectivo USD:</Text>
                  <Text style={[styles.auditValue, typography.tabularNumeric]}>
                    {formatUsd(arqueoXData.salesCashUsd)}
                  </Text>
                </View>
                <View style={styles.auditRow}>
                  <Text style={styles.auditLabel}>• Efectivo VES:</Text>
                  <Text style={[styles.auditValue, typography.tabularNumeric]}>
                    {formatVes(arqueoXData.salesCashVes)}
                  </Text>
                </View>
                <View style={styles.auditRow}>
                  <Text style={styles.auditLabel}>• Pago Móvil (VES):</Text>
                  <Text style={[styles.auditValue, typography.tabularNumeric]}>
                    {formatVes(arqueoXData.salesPagoMovilVes)}
                  </Text>
                </View>
                <View style={styles.auditRow}>
                  <Text style={styles.auditLabel}>• Tarjeta Débito (VES):</Text>
                  <Text style={[styles.auditValue, typography.tabularNumeric]}>
                    {formatVes(arqueoXData.salesCardVes)}
                  </Text>
                </View>
              </View>
            ) : null}

            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => setIsArqueoXModalOpen(false)}
              style={styles.modalCloseBtn}
            >
              <Text style={styles.modalCloseBtnText}>Cerrar Arqueo X</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modal Registrar Movimiento de Gaveta (Sangría / Entrada) */}
      <Modal visible={isCashMovementModalOpen} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Registrar Movimiento de Gaveta</Text>
            <Text style={styles.modalNotice}>
              Las sangrías (retiros parciales a caja fuerte) y entradas de cambio se auditan obligatoriamente
              y afectan el efectivo esperado del turno.
            </Text>

            {movementError ? <Text style={styles.errorText}>{movementError}</Text> : null}

            {/* Selector de Tipo de Movimiento */}
            <Text style={styles.inputLabel}>Tipo de Movimiento</Text>
            <View style={styles.toggleRow}>
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => setMovementType("DROP")}
                style={[styles.toggleBtn, movementType === "DROP" && styles.toggleBtnDropActive]}
              >
                <Text style={[styles.toggleBtnText, movementType === "DROP" && styles.toggleBtnTextActive]}>
                  🔴 Sangría / Retiro
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => setMovementType("INFLOW")}
                style={[styles.toggleBtn, movementType === "INFLOW" && styles.toggleBtnInflowActive]}
              >
                <Text style={[styles.toggleBtnText, movementType === "INFLOW" && styles.toggleBtnTextOnHero]}>
                  🟢 Entrada de Efectivo
                </Text>
              </TouchableOpacity>
            </View>

            {/* Selector de Moneda */}
            <Text style={styles.inputLabel}>Moneda</Text>
            <View style={styles.toggleRow}>
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => setMovementCurrency("USD")}
                style={[styles.toggleBtn, movementCurrency === "USD" && styles.toggleBtnActive]}
              >
                <Text style={[styles.toggleBtnText, movementCurrency === "USD" && styles.toggleBtnTextActive]}>
                  💵 Dólares (USD)
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => setMovementCurrency("VES")}
                style={[styles.toggleBtn, movementCurrency === "VES" && styles.toggleBtnActive]}
              >
                <Text style={[styles.toggleBtnText, movementCurrency === "VES" && styles.toggleBtnTextActive]}>
                  🇻🇪 Bolívares (VES)
                </Text>
              </TouchableOpacity>
            </View>

            {/* Monto del Movimiento */}
            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Monto ({movementCurrency})</Text>
              <TextInput
                style={[styles.input, typography.tabularNumeric]}
                placeholder="0.00"
                placeholderTextColor={theme.textMuted}
                keyboardType="decimal-pad"
                value={movementAmount}
                onChangeText={setMovementAmount}
              />
            </View>

            {/* Motivo Obligatorio */}
            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Motivo Auditado Obligatorio</Text>
              <TextInput
                style={styles.input}
                placeholder="Ej. Retiro de seguridad a sobre / Pago menor / Cambio"
                placeholderTextColor={theme.textMuted}
                value={movementReason}
                onChangeText={setMovementReason}
              />
            </View>

            <View style={styles.modalActionsRow}>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => setIsCashMovementModalOpen(false)}
                style={styles.modalCancelBtn}
              >
                <Text style={styles.modalCancelBtnText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={handleAddMovement}
                style={styles.modalConfirmBtn}
                testID="btn-confirm-movement"
              >
                <Text style={styles.modalConfirmBtnText}>REGISTRAR</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal Asistente de Conteo por Billetes (Denominaciones) */}
      <Modal visible={isDenomModalOpen} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, styles.modalCardLarge]}>
            <Text style={styles.modalTitle}>🧮 Asistente de Conteo de Billetes</Text>
            <Text style={styles.modalNotice}>
              Indique la cantidad de billetes por denominación para calcular el total físico a declarar en el arqueo ciego.
            </Text>

            <View style={styles.denomGridContainer}>
              {/* Columna Billetes USD */}
              <View style={styles.denomCol}>
                <Text style={styles.denomColTitle}>Dólares (USD)</Text>
                {USD_DENOMINATIONS.map((d) => {
                  const count = usdDenomCounts[d] || 0;
                  return (
                    <View key={`usd-${d}`} style={styles.denomRow}>
                      <Text style={styles.denomLabel}>${d}</Text>
                      <View style={styles.denomStepper}>
                        <TouchableOpacity
                          style={styles.stepperBtn}
                          onPress={() =>
                            setUsdDenomCounts((prev) => ({
                              ...prev,
                              [d]: Math.max(0, (prev[d] || 0) - 1),
                            }))
                          }
                        >
                          <Text style={styles.stepperBtnText}>-</Text>
                        </TouchableOpacity>
                        <TextInput
                          style={[styles.stepperInput, typography.tabularNumeric]}
                          keyboardType="numeric"
                          value={count > 0 ? String(count) : ""}
                          placeholder="0"
                          placeholderTextColor={theme.textMuted}
                          onChangeText={(v) => {
                            const val = parseInt(v, 10);
                            setUsdDenomCounts((prev) => ({
                              ...prev,
                              [d]: isNaN(val) ? 0 : Math.max(0, val),
                            }));
                          }}
                        />
                        <TouchableOpacity
                          style={styles.stepperBtn}
                          onPress={() =>
                            setUsdDenomCounts((prev) => ({
                              ...prev,
                              [d]: (prev[d] || 0) + 1,
                            }))
                          }
                        >
                          <Text style={styles.stepperBtnText}>+</Text>
                        </TouchableOpacity>
                      </View>
                      <Text style={[styles.denomSubtotal, typography.tabularNumeric]}>
                        ${(d * count).toFixed(2)}
                      </Text>
                    </View>
                  );
                })}
              </View>

              {/* Columna Billetes VES */}
              <View style={styles.denomCol}>
                <Text style={styles.denomColTitle}>Bolívares (VES)</Text>
                {VES_DENOMINATIONS.map((d) => {
                  const count = vesDenomCounts[d] || 0;
                  return (
                    <View key={`ves-${d}`} style={styles.denomRow}>
                      <Text style={styles.denomLabel}>Bs. {d}</Text>
                      <View style={styles.denomStepper}>
                        <TouchableOpacity
                          style={styles.stepperBtn}
                          onPress={() =>
                            setVesDenomCounts((prev) => ({
                              ...prev,
                              [d]: Math.max(0, (prev[d] || 0) - 1),
                            }))
                          }
                        >
                          <Text style={styles.stepperBtnText}>-</Text>
                        </TouchableOpacity>
                        <TextInput
                          style={[styles.stepperInput, typography.tabularNumeric]}
                          keyboardType="numeric"
                          value={count > 0 ? String(count) : ""}
                          placeholder="0"
                          placeholderTextColor={theme.textMuted}
                          onChangeText={(v) => {
                            const val = parseInt(v, 10);
                            setVesDenomCounts((prev) => ({
                              ...prev,
                              [d]: isNaN(val) ? 0 : Math.max(0, val),
                            }));
                          }}
                        />
                        <TouchableOpacity
                          style={styles.stepperBtn}
                          onPress={() =>
                            setVesDenomCounts((prev) => ({
                              ...prev,
                              [d]: (prev[d] || 0) + 1,
                            }))
                          }
                        >
                          <Text style={styles.stepperBtnText}>+</Text>
                        </TouchableOpacity>
                      </View>
                      <Text style={[styles.denomSubtotal, typography.tabularNumeric]}>
                        Bs. {(d * count).toFixed(2)}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>

            {/* Totalizadores en vivo */}
            <View style={styles.denomSummaryBox}>
              <View style={styles.denomSummaryItem}>
                <Text style={styles.denomSummaryLabel}>Total USD Contado:</Text>
                <Text style={[styles.denomSummaryVal, typography.tabularNumeric]}>
                  {formatUsd(calculateDenominationsTotal(usdDenomCounts))}
                </Text>
              </View>
              <View style={styles.denomSummaryItem}>
                <Text style={styles.denomSummaryLabel}>Total VES Contado:</Text>
                <Text style={[styles.denomSummaryVal, typography.tabularNumeric]}>
                  {formatVes(calculateDenominationsTotal(vesDenomCounts))}
                </Text>
              </View>
            </View>

            <View style={styles.modalActionsRow}>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => setIsDenomModalOpen(false)}
                style={styles.modalCancelBtn}
              >
                <Text style={styles.modalCancelBtnText}>Cerrar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={handleApplyDenominations}
                style={styles.modalConfirmBtn}
                testID="btn-apply-denominations"
              >
                <Text style={styles.modalConfirmBtnText}>APLICAR AL ARQUEO CIEGO</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};

const makeStyles = (c: Palette) =>
  StyleSheet.create({
                              container: {
                              flex: 1,
                            backgroundColor: c.surfaceBase,
  },
                            content: {
                              padding: spacing.xl,
                            alignItems: "center",
  },
                            card: {
                              width: "100%",
                            maxWidth: 760,
                            backgroundColor: c.surfaceContainerLow,
                            borderRadius: spacing.radiusXl,
                            padding: spacing.xl,
                            borderWidth: 1,
                            borderColor: c.border,
  },
                            header: {
                              flexWrap: "wrap",
                              gap: spacing.sm,
                              flexDirection: "row",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginBottom: spacing.md,
  },
                            title: {
                              fontSize: typography.sizes.titleLg,
                            fontWeight: typography.weights.bold,
                            color: c.textPrimary,
  },
                            statusBadge: {
                              paddingHorizontal: spacing.md,
                            paddingVertical: spacing.xs,
                            borderRadius: spacing.radiusFull,
  },
                            openBadge: {
                              backgroundColor: c.heroSoft,
  },
                            closedBadge: {
                              backgroundColor: c.errorSoft,
  },
                            statusText: {
                              fontSize: typography.sizes.caption,
                            fontWeight: typography.weights.bold,
                            color: c.heroText,
  },
                            infoRow: {
                              flexDirection: "row",
                            gap: spacing.sm,
                            marginBottom: 4,
  },
                            infoLabel: {
                              fontSize: typography.sizes.body,
                            color: c.textSecondary,
  },
                            infoValue: {
                              fontSize: typography.sizes.body,
                            fontWeight: typography.weights.semibold,
                            color: c.textPrimary,
  },
                            divider: {
                              height: 1,
                            backgroundColor: c.border,
                            marginVertical: spacing.lg,
  },
                            subHeaderRow: {
                              flexWrap: "wrap",
                              gap: spacing.sm,
                              flexDirection: "row",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginBottom: spacing.sm,
  },
                            subTitle: {
                              fontSize: typography.sizes.body,
                            fontWeight: typography.weights.bold,
                            color: c.textPrimary,
  },
                            xButton: {
                              height: spacing.touchTargetMin, // 48px
                            backgroundColor: c.surfaceContainerHigh,
                            paddingHorizontal: spacing.md,
                            borderRadius: spacing.radiusMd,
                            justifyContent: "center",
                            alignItems: "center",
                            borderWidth: 1,
                            borderColor: c.primaryGlow,
  },
                            xButtonText: {
                              fontSize: typography.sizes.caption,
                            fontWeight: typography.weights.bold,
                            color: c.primaryGlow,
                            letterSpacing: 0.5,
  },
                            grid2: {
                              flexWrap: "wrap",
                              flexDirection: "row",
                            gap: spacing.md,
                            marginTop: spacing.xs,
  },
                            gridItem: {
                              minWidth: 140,
                              flex: 1,
                            backgroundColor: c.surfaceContainer,
                            padding: spacing.md,
                            borderRadius: spacing.radiusMd,
  },
                            gridLabel: {
                              fontSize: typography.sizes.caption,
                            color: c.textSecondary,
                            marginBottom: spacing.xs,
  },
                            gridValue: {
                              fontSize: typography.sizes.titleMd,
                            fontWeight: typography.weights.bold,
                            color: c.textPrimary,
  },
                            closeSection: {
                            marginTop: spacing.xs,
  },
                            blindNotice: {
                              fontSize: typography.sizes.caption,
                            color: c.textSecondary,
                            marginVertical: spacing.sm,
  },
                            errorText: {
                              fontSize: typography.sizes.caption,
                            color: c.errorText,
                            fontWeight: typography.weights.bold,
                            marginBottom: spacing.sm,
  },
                            inputsRow: {
                              flexDirection: "row",
                            gap: spacing.md,
                            marginBottom: spacing.md,
  },
                            inputContainer: {
                              flex: 1,
  },
                            inputLabel: {
                              fontSize: typography.sizes.caption,
                            color: c.textSecondary,
                            marginBottom: spacing.xs,
  },
                            input: {
                              height: spacing.touchTargetMin,
                            backgroundColor: c.surfaceContainerHigh,
                            borderRadius: spacing.radiusMd,
                            paddingHorizontal: spacing.md,
                            color: c.textPrimary,
                            fontSize: typography.sizes.body,
                            borderWidth: 1,
                            borderColor: c.border,
  },
                            zButton: {
                            height: spacing.touchTargetHero, // 64px para Cierre Z (AGENTS.md)
                            backgroundColor: c.error,
                            borderRadius: spacing.radiusLg,
                            justifyContent: "center",
                            alignItems: "center",
                            marginTop: spacing.sm,
  },
                            zButtonText: {
                              fontSize: typography.sizes.body,
                            fontWeight: typography.weights.bold,
                            color: c.onPrimary,
                            letterSpacing: 1,
  },
                            reportSection: {
                            marginBottom: spacing.md,
  },
                            squareBadge: {
                              paddingHorizontal: spacing.md,
                            paddingVertical: spacing.sm,
                            borderRadius: spacing.radiusMd,
                            marginVertical: spacing.md,
                            alignItems: "center",
  },
                            squareSuccess: {
                              backgroundColor: c.heroSoft,
  },
                            squareWarning: {
                              backgroundColor: c.warningSoft,
  },
                            squareText: {
                              fontSize: typography.sizes.subText,
                            fontWeight: typography.weights.bold,
                            color: c.textPrimary,
  },
                            reportGrid: {
                              flexDirection: "row",
                            gap: spacing.md,
  },
                            reportItem: {
                              flex: 1,
                            backgroundColor: c.surfaceContainer,
                            padding: spacing.md,
                            borderRadius: spacing.radiusMd,
  },
                            reportValue: {
                              fontSize: typography.sizes.titleMd,
                            fontWeight: typography.weights.bold,
  },
                            reportSub: {
                              fontSize: typography.sizes.caption,
                            color: c.textSecondary,
                            marginTop: 4,
  },
                            positiveDiff: {
                              color: c.heroText,
  },
                            negativeDiff: {
                              color: c.errorText,
  },
                            openSection: {
                              marginTop: spacing.sm,
  },
                            openButton: {
                              height: spacing.touchTargetHero, // 64px
                            backgroundColor: c.primary,
                            borderRadius: spacing.radiusLg,
                            justifyContent: "center",
                            alignItems: "center",
                            marginTop: spacing.sm,
  },
                            openButtonText: {
                              fontSize: typography.sizes.body,
                            fontWeight: typography.weights.bold,
                            color: c.onPrimary,
                            letterSpacing: 1,
  },
                            modalOverlay: {
                              flex: 1,
                            backgroundColor: c.overlay,
                            justifyContent: "center",
                            alignItems: "center",
                            padding: spacing.xl,
  },
                            modalCard: {
                              width: "100%",
                            maxWidth: 540,
                            backgroundColor: c.surfaceContainerLow,
                            borderRadius: spacing.radiusXl,
                            padding: spacing.xl,
                            borderWidth: 1,
                            borderColor: c.border,
  },
                            modalTitle: {
                              fontSize: typography.sizes.titleLg,
                            fontWeight: typography.weights.bold,
                            color: c.textPrimary,
                            marginBottom: spacing.xs,
  },
                            modalNotice: {
                              fontSize: typography.sizes.caption,
                            color: c.textSecondary,
                            marginBottom: spacing.md,
  },
                            auditContainer: {
                              backgroundColor: c.surfaceContainer,
                            borderRadius: spacing.radiusMd,
                            padding: spacing.md,
                            gap: spacing.xs,
  },
                            auditRow: {
                              flexDirection: "row",
                            justifyContent: "space-between",
                            alignItems: "center",
  },
                            auditLabel: {
                              fontSize: typography.sizes.subText,
                            color: c.textSecondary,
  },
                            auditValue: {
                              fontSize: typography.sizes.subText,
                            fontWeight: typography.weights.bold,
                            color: c.textPrimary,
  },
                            breakdownTitle: {
                              fontSize: typography.sizes.caption,
                            fontWeight: typography.weights.bold,
                            color: c.textSecondary,
                            marginBottom: 4,
  },
                            modalCloseBtn: {
                              height: spacing.touchTargetMin,
                            backgroundColor: c.surfaceContainerHighest,
                            borderRadius: spacing.radiusMd,
                            justifyContent: "center",
                            alignItems: "center",
                            marginTop: spacing.lg,
  },
                            modalCloseBtnText: {
                              fontSize: typography.sizes.body,
                            fontWeight: typography.weights.semibold,
                            color: c.textPrimary,
  },
  headerBtnGroup: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
  },
  movementButton: {
    height: spacing.touchTargetMin,
    backgroundColor: c.surfaceContainerHigh,
    paddingHorizontal: spacing.md,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: c.warning,
  },
  movementButtonText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: c.warningText,
    letterSpacing: 0.5,
  },
  movementsSection: {
    backgroundColor: c.surfaceContainer,
    borderRadius: spacing.radiusMd,
    padding: spacing.md,
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  movementsSectionTitle: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: c.textSecondary,
    marginBottom: spacing.xs,
  },
  movementItemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: c.surfaceContainerHighest,
  },
  movementBadgeContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flex: 1,
  },
  movementTypeBadge: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: spacing.radiusSm,
  },
  badgeDrop: {
    backgroundColor: c.errorSoft,
  },
  badgeInflow: {
    backgroundColor: c.heroSoft,
  },
  movementBadgeText: {
    fontSize: 12,
    fontWeight: typography.weights.bold,
    color: c.textPrimary,
  },
  movementReasonText: {
    fontSize: typography.sizes.caption,
    color: c.textSecondary,
    flex: 1,
  },
  movementAmountText: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
  },
  dropAmount: {
    color: c.errorText,
  },
  inflowAmount: {
    color: c.heroText,
  },
  blindHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  denomAssistantBtn: {
    height: 38,
    backgroundColor: c.surfaceContainerHigh,
    paddingHorizontal: spacing.md,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: c.primary,
  },
  denomAssistantBtnText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: c.textPrimary,
  },
  toggleRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  toggleBtn: {
    flex: 1,
    height: spacing.touchTargetMin,
    backgroundColor: c.surfaceContainer,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: c.border,
  },
  toggleBtnActive: {
    backgroundColor: c.primary,
    borderColor: c.primary,
  },
  toggleBtnDropActive: {
    backgroundColor: c.error,
    borderColor: c.error,
  },
  toggleBtnInflowActive: {
    backgroundColor: c.hero,
    borderColor: c.hero,
  },
  toggleBtnText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.semibold,
    color: c.textSecondary,
  },
  toggleBtnTextActive: {
    color: c.onPrimary,
    fontWeight: typography.weights.bold,
  },
  toggleBtnTextOnHero: {
    color: c.onHero,
    fontWeight: typography.weights.bold,
  },
  modalActionsRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  modalCancelBtn: {
    flex: 1,
    height: spacing.touchTargetMin,
    backgroundColor: c.surfaceContainerHighest,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
  },
  modalCancelBtnText: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.semibold,
    color: c.textSecondary,
  },
  modalConfirmBtn: {
    flex: 2,
    height: spacing.touchTargetMin,
    backgroundColor: c.hero,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
  },
  modalConfirmBtnText: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    color: c.onHero,
  },
  modalCardLarge: {
    maxWidth: 720,
    maxHeight: "90%",
  },
  denomGridContainer: {
    flexDirection: "row",
    gap: spacing.lg,
    marginVertical: spacing.sm,
  },
  denomCol: {
    flex: 1,
    backgroundColor: c.surfaceContainer,
    borderRadius: spacing.radiusMd,
    padding: spacing.md,
    gap: spacing.xs,
  },
  denomColTitle: {
    fontSize: typography.sizes.subText,
    fontWeight: typography.weights.bold,
    color: c.textPrimary,
    marginBottom: spacing.xs,
    textAlign: "center",
  },
  denomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 2,
  },
  denomLabel: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    color: c.textPrimary,
    minWidth: 60,
  },
  denomStepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  stepperBtn: {
    width: 32,
    height: 32,
    backgroundColor: c.surfaceContainerHigh,
    borderRadius: spacing.radiusSm,
    justifyContent: "center",
    alignItems: "center",
  },
  stepperBtnText: {
    fontSize: 16,
    fontWeight: typography.weights.bold,
    color: c.textPrimary,
  },
  stepperInput: {
    width: 44,
    height: 32,
    backgroundColor: c.surfaceContainerHighest,
    borderRadius: spacing.radiusSm,
    textAlign: "center",
    color: c.textPrimary,
    fontSize: typography.sizes.body,
  },
  denomSubtotal: {
    fontSize: typography.sizes.caption,
    color: c.textSecondary,
    minWidth: 64,
    textAlign: "right",
  },
  denomSummaryBox: {
    flexDirection: "row",
    justifyContent: "space-around",
    backgroundColor: c.surfaceContainer,
    borderRadius: spacing.radiusMd,
    padding: spacing.md,
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: c.border,
  },
  denomSummaryItem: {
    alignItems: "center",
  },
  denomSummaryLabel: {
    fontSize: typography.sizes.caption,
    color: c.textSecondary,
  },
  denomSummaryVal: {
    fontSize: typography.sizes.titleMd,
    fontWeight: typography.weights.bold,
    color: c.textPrimary,
  },
  historyCard: {
    width: "100%",
    maxWidth: 760,
    backgroundColor: c.surfaceContainerLow,
    borderRadius: spacing.radiusXl,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: c.border,
    marginTop: spacing.xl,
  },
  historyTitle: {
    fontSize: typography.sizes.titleMd,
    fontWeight: typography.weights.bold,
    color: c.textPrimary,
    marginBottom: spacing.md,
  },
  historyList: {
    gap: spacing.sm,
  },
  historyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: c.surfaceContainer,
    padding: spacing.md,
    borderRadius: spacing.radiusMd,
    borderWidth: 1,
    borderColor: c.border,
  },
  historyMeta: {
    flex: 2,
  },
  historyCashier: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    color: c.textPrimary,
  },
  historyDate: {
    fontSize: typography.sizes.caption,
    color: c.textSecondary,
    marginTop: 2,
  },
  historyAmounts: {
    flex: 3,
    alignItems: "flex-end",
    paddingRight: spacing.md,
  },
  historyAmountText: {
    fontSize: typography.sizes.caption,
    color: c.textSecondary,
  },
  historyBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: spacing.radiusSm,
  },
  badgeSquare: {
    backgroundColor: c.heroSoft,
  },
  badgeDiff: {
    backgroundColor: c.errorSoft,
  },
  historyBadgeText: {
    fontSize: 12,
    fontWeight: typography.weights.bold,
    color: c.textPrimary,
  },
});
