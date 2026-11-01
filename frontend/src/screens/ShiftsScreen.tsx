import React, { useState, useEffect } from "react";
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";
import { typography } from "../theme/typography";
import { formatUsd, formatVes, toDecimal, formatFixed4 } from "../utils/decimal";
import type { SqlDriver } from "../database/connection";
import {
  getOpenShift,
  openShift,
  performArqueoX,
  performCierreZ,
  ShiftEntity,
  ShiftCashAudit,
  CierreZResult,
} from "../database/repositories/shift.repository";

  export interface ShiftsScreenProps {
    db?: SqlDriver;
    terminalId?: string;
    defaultExchangeRate?: string;
  }

  export const ShiftsScreen: React.FC<ShiftsScreenProps> = ({
    db,
    terminalId = "TERM-01",
    defaultExchangeRate = "36.5000",
  }) => {
    const [activeShift, setActiveShift] = useState<ShiftEntity | null>(null);

    // Apertura de turno
    const [newCashier, setNewCashier] = useState("Erick");
    const [newInitialUsd, setNewInitialUsd] = useState("50.0000");
    const [newInitialVes, setNewInitialVes] = useState("1825.0000");
    const [newExchangeRate, setNewExchangeRate] = useState(defaultExchangeRate);
    const [openError, setOpenError] = useState<string | null>(null);

    // Cierre Z
    const [declaredUsd, setDeclaredUsd] = useState("");
    const [declaredVes, setDeclaredVes] = useState("");
    const [closeReport, setCloseReport] = useState<CierreZResult | null>(null);
    const [closeError, setCloseError] = useState<string | null>(null);

    // Arqueo X (Modal)
    const [isArqueoXModalOpen, setIsArqueoXModalOpen] = useState(false);
    const [arqueoXData, setArqueoXData] = useState<ShiftCashAudit | null>(null);

    // Carga inicial del turno
    useEffect(() => {
      if (db) {
        const shift = getOpenShift(db, terminalId);
        setActiveShift(shift ?? null);
      }
    }, [db, terminalId]);

    const handleOpenShift = () => {
      try {
        setOpenError(null);
        if (!db) {
          // Modo preview / sin db directa
          setActiveShift({
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
          });
          return;
        }

        openShift(db, {
          terminalId,
          cashierName: newCashier,
          exchangeRateApplied: newExchangeRate,
          initialCashUsd: newInitialUsd,
          initialCashVes: newInitialVes,
        });

        const shift = getOpenShift(db, terminalId);
        setActiveShift(shift ?? null);
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
          salesPagoMovilVes: "4197.5000",
          salesCardVes: "1825.0000",
          totalSalesUsd: "250.0000",
          totalSalesVes: "9125.0000",
          expectedCashUsd: "142.5000",
          expectedCashVes: "5201.2500",
          invoiceCount: 12,
        });
      }
      setIsArqueoXModalOpen(true);
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
          setCloseReport(result);
          setActiveShift(result.shift);
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
                      {formatVes(activeShift.exchangeRateApplied)}
                    </Text>
                  </View>

                  <View style={styles.divider} />

                  <View style={styles.subHeaderRow}>
                    <Text style={styles.subTitle}>Fondos Iniciales de Apertura</Text>
                    {/* Botón Arqueo X (Corte Parcial Informativo) */}
                    <TouchableOpacity
                      activeOpacity={0.8}
                      onPress={handleArqueoX}
                      style={styles.xButton}
                    >
                      <Text style={styles.xButtonText}>ARQUEO X (PARCIAL)</Text>
                    </TouchableOpacity>
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

                      <View style={styles.divider} />

                          {/* Sección Cierre Z (Arqueo Ciego) */}
                          <View style={styles.closeSection}>
                            <Text style={styles.subTitle}>Cierre Z — Arqueo Ciego Independiente</Text>
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
                                  placeholder="0.0000"
                                  placeholderTextColor={colors.dark.textMuted}
                                  keyboardType="decimal-pad"
                                  value={declaredUsd}
                                  onChangeText={setDeclaredUsd}
                                />
                              </View>

                              <View style={styles.inputContainer}>
                                <Text style={styles.inputLabel}>Efectivo VES Contado (Bs.)</Text>
                                <TextInput
                                  style={[styles.input, typography.tabularNumeric]}
                                  placeholder="0.0000"
                                  placeholderTextColor={colors.dark.textMuted}
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
                                    onChangeText={setNewInitialUsd}
                                    keyboardType="decimal-pad"
                                  />
                                </View>

                                <View style={styles.inputContainer}>
                                  <Text style={styles.inputLabel}>Fondo Inicial VES (Bs.)</Text>
                                  <TextInput
                                    style={[styles.input, typography.tabularNumeric]}
                                    value={newInitialVes}
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
                            </ScrollView>
                            );
};

                            const styles = StyleSheet.create({
                              container: {
                              flex: 1,
                            backgroundColor: colors.dark.surfaceBase,
  },
                            content: {
                              padding: spacing.xl,
                            alignItems: "center",
  },
                            card: {
                              width: "100%",
                            maxWidth: 760,
                            backgroundColor: colors.dark.surfaceContainerLow,
                            borderRadius: spacing.radiusXl,
                            padding: spacing.xl,
                            borderWidth: 1,
                            borderColor: colors.dark.border,
  },
                            header: {
                              flexDirection: "row",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginBottom: spacing.md,
  },
                            title: {
                              fontSize: typography.sizes.titleLg,
                            fontWeight: typography.weights.bold,
                            color: colors.dark.textPrimary,
  },
                            statusBadge: {
                              paddingHorizontal: spacing.md,
                            paddingVertical: spacing.xs,
                            borderRadius: spacing.radiusFull,
  },
                            openBadge: {
                              backgroundColor: "rgba(0, 176, 116, 0.2)",
  },
                            closedBadge: {
                              backgroundColor: "rgba(239, 68, 68, 0.2)",
  },
                            statusText: {
                              fontSize: typography.sizes.caption,
                            fontWeight: typography.weights.bold,
                            color: colors.dark.hero,
  },
                            infoRow: {
                              flexDirection: "row",
                            gap: spacing.sm,
                            marginBottom: 4,
  },
                            infoLabel: {
                              fontSize: typography.sizes.body,
                            color: colors.dark.textSecondary,
  },
                            infoValue: {
                              fontSize: typography.sizes.body,
                            fontWeight: typography.weights.semibold,
                            color: colors.dark.textPrimary,
  },
                            divider: {
                              height: 1,
                            backgroundColor: colors.dark.border,
                            marginVertical: spacing.lg,
  },
                            subHeaderRow: {
                              flexDirection: "row",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginBottom: spacing.sm,
  },
                            subTitle: {
                              fontSize: typography.sizes.body,
                            fontWeight: typography.weights.bold,
                            color: colors.dark.textPrimary,
  },
                            xButton: {
                              height: spacing.touchTargetMin, // 48px
                            backgroundColor: colors.dark.surfaceContainerHigh,
                            paddingHorizontal: spacing.md,
                            borderRadius: spacing.radiusMd,
                            justifyContent: "center",
                            alignItems: "center",
                            borderWidth: 1,
                            borderColor: colors.dark.primaryGlow,
  },
                            xButtonText: {
                              fontSize: typography.sizes.caption,
                            fontWeight: typography.weights.bold,
                            color: colors.dark.primaryGlow,
                            letterSpacing: 0.5,
  },
                            grid2: {
                              flexDirection: "row",
                            gap: spacing.md,
                            marginTop: spacing.xs,
  },
                            gridItem: {
                              flex: 1,
                            backgroundColor: colors.dark.surfaceContainer,
                            padding: spacing.md,
                            borderRadius: spacing.radiusMd,
  },
                            gridLabel: {
                              fontSize: typography.sizes.caption,
                            color: colors.dark.textSecondary,
                            marginBottom: spacing.xs,
  },
                            gridValue: {
                              fontSize: typography.sizes.titleMd,
                            fontWeight: typography.weights.bold,
                            color: colors.dark.textPrimary,
  },
                            closeSection: {
                            marginTop: spacing.xs,
  },
                            blindNotice: {
                              fontSize: typography.sizes.caption,
                            color: colors.dark.textSecondary,
                            marginVertical: spacing.sm,
  },
                            errorText: {
                              fontSize: typography.sizes.caption,
                            color: colors.dark.error,
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
                            color: colors.dark.textSecondary,
                            marginBottom: spacing.xs,
  },
                            input: {
                              height: spacing.touchTargetMin,
                            backgroundColor: colors.dark.surfaceContainerHigh,
                            borderRadius: spacing.radiusMd,
                            paddingHorizontal: spacing.md,
                            color: colors.dark.textPrimary,
                            fontSize: typography.sizes.body,
                            borderWidth: 1,
                            borderColor: colors.dark.border,
  },
                            zButton: {
                            height: spacing.touchTargetHero, // 64px para Cierre Z (AGENTS.md)
                            backgroundColor: colors.dark.error,
                            borderRadius: spacing.radiusLg,
                            justifyContent: "center",
                            alignItems: "center",
                            marginTop: spacing.sm,
  },
                            zButtonText: {
                              fontSize: typography.sizes.body,
                            fontWeight: typography.weights.bold,
                            color: colors.dark.textPrimary,
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
                              backgroundColor: "rgba(0, 176, 116, 0.2)",
  },
                            squareWarning: {
                              backgroundColor: "rgba(245, 158, 11, 0.2)",
  },
                            squareText: {
                              fontSize: typography.sizes.subText,
                            fontWeight: typography.weights.bold,
                            color: colors.dark.textPrimary,
  },
                            reportGrid: {
                              flexDirection: "row",
                            gap: spacing.md,
  },
                            reportItem: {
                              flex: 1,
                            backgroundColor: colors.dark.surfaceContainer,
                            padding: spacing.md,
                            borderRadius: spacing.radiusMd,
  },
                            reportValue: {
                              fontSize: typography.sizes.titleMd,
                            fontWeight: typography.weights.bold,
  },
                            reportSub: {
                              fontSize: typography.sizes.caption,
                            color: colors.dark.textSecondary,
                            marginTop: 4,
  },
                            positiveDiff: {
                              color: colors.dark.hero,
  },
                            negativeDiff: {
                              color: colors.dark.error,
  },
                            openSection: {
                              marginTop: spacing.sm,
  },
                            openButton: {
                              height: spacing.touchTargetHero, // 64px
                            backgroundColor: colors.dark.primary,
                            borderRadius: spacing.radiusLg,
                            justifyContent: "center",
                            alignItems: "center",
                            marginTop: spacing.sm,
  },
                            openButtonText: {
                              fontSize: typography.sizes.body,
                            fontWeight: typography.weights.bold,
                            color: colors.dark.textPrimary,
                            letterSpacing: 1,
  },
                            modalOverlay: {
                              flex: 1,
                            backgroundColor: colors.dark.surfaceDim,
                            justifyContent: "center",
                            alignItems: "center",
                            padding: spacing.xl,
  },
                            modalCard: {
                              width: "100%",
                            maxWidth: 540,
                            backgroundColor: colors.dark.surfaceContainerLow,
                            borderRadius: spacing.radiusXl,
                            padding: spacing.xl,
                            borderWidth: 1,
                            borderColor: colors.dark.border,
  },
                            modalTitle: {
                              fontSize: typography.sizes.titleLg,
                            fontWeight: typography.weights.bold,
                            color: colors.dark.textPrimary,
                            marginBottom: spacing.xs,
  },
                            modalNotice: {
                              fontSize: typography.sizes.caption,
                            color: colors.dark.textSecondary,
                            marginBottom: spacing.md,
  },
                            auditContainer: {
                              backgroundColor: colors.dark.surfaceContainer,
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
                            color: colors.dark.textSecondary,
  },
                            auditValue: {
                              fontSize: typography.sizes.subText,
                            fontWeight: typography.weights.bold,
                            color: colors.dark.textPrimary,
  },
                            breakdownTitle: {
                              fontSize: typography.sizes.caption,
                            fontWeight: typography.weights.bold,
                            color: colors.dark.textSecondary,
                            marginBottom: 4,
  },
                            modalCloseBtn: {
                              height: spacing.touchTargetMin,
                            backgroundColor: colors.dark.surfaceContainerHighest,
                            borderRadius: spacing.radiusMd,
                            justifyContent: "center",
                            alignItems: "center",
                            marginTop: spacing.lg,
  },
                            modalCloseBtnText: {
                              fontSize: typography.sizes.body,
                            fontWeight: typography.weights.semibold,
                            color: colors.dark.textPrimary,
  },
});
