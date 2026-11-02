import React, { useState, useEffect } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";
import { typography } from "../theme/typography";
import { formatUsd, formatVes } from "../utils/decimal";
import type { SqlDriver } from "../database/connection";
import {
  generatePeriodicBalance,
  PeriodicBalanceReport,
} from "../database/repositories/balance.repository";
import {
  generateExchangeRateReport,
  ExchangeRateReport,
} from "../database/repositories/exchange.repository";
import { ExchangeRateLineChart } from "../components/ExchangeRateLineChart";

export interface MonthlyBalanceScreenProps {
  db?: SqlDriver;
}

type ReportSection = "BALANCE" | "EXCHANGE_RATES";
type PeriodFilter = "ALL" | "MONTH" | "WEEK" | "TODAY";
type RatesPeriodFilter = "ALL" | "QUARTER" | "MONTH" | "WEEK";
type RatesViewMode = "CHART" | "TABLE";

function toIsoDate(ts: number): string {
  const d = new Date(ts);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export const MonthlyBalanceScreen: React.FC<MonthlyBalanceScreenProps> = ({ db }) => {
  const [activeSection, setActiveSection] = useState<ReportSection>("BALANCE");

  // Filtros de Balance Financiero
  const [activeFilter, setActiveFilter] = useState<PeriodFilter>("MONTH");
  const [report, setReport] = useState<PeriodicBalanceReport | null>(null);

  // Filtros y Modo de Vista de Histórico de Tasas BCV
  const [activeRatesFilter, setActiveRatesFilter] = useState<RatesPeriodFilter>("MONTH");
  const [ratesViewMode, setRatesViewMode] = useState<RatesViewMode>("CHART");
  const [ratesReport, setRatesReport] = useState<ExchangeRateReport | null>(null);

  // 1. Carga de Balance Financiero
  useEffect(() => {
    if (!db) {
      setReport({
        periodFrom: Date.now() - 30 * 86400000,
        periodTo: Date.now(),
        totalInvoices: 248,
        totalRevenueUsd: "4820.5000",
        totalRevenueVes: "175948.2500",
        totalTaxUsd: "664.8966",
        totalTaxVes: "24268.7240",
        totalCogsUsd: "3370.3000",
        totalGrossMarginUsd: "1450.2000",
        grossMarginPercent: "30.08",
        paymentBreakdown: [
          { method: "CASH_USD", label: "Efectivo USD ($)", totalUsd: "2150.0000", totalVes: "0.0000", count: 110 },
          { method: "CASH_VES", label: "Efectivo VES (Bs.)", totalUsd: "920.5000", totalVes: "33598.2500", count: 52 },
          { method: "PAGO_MOVIL", label: "Pago Móvil (Bs.)", totalUsd: "1150.0000", totalVes: "41975.0000", count: 64 },
          { method: "CARD_VES", label: "Tarjeta de Débito (Punto Bs.)", totalUsd: "600.0000", totalVes: "21900.0000", count: 22 },
        ],
        topProducts: [
          { productId: "1", sku: "HAR-01", name: "Harina PAN 1kg", quantitySold: "420.0000", totalUsd: "525.0000", totalVes: "19162.5000" },
          { productId: "2", sku: "ARR-02", name: "Arroz Primor 1kg", quantitySold: "310.0000", totalUsd: "465.0000", totalVes: "16972.5000" },
          { productId: "3", sku: "ACE-03", name: "Aceite Mazeite 1L", quantitySold: "115.0000", totalUsd: "437.0000", totalVes: "15950.5000" },
        ],
      });
      return;
    }

    const now = Date.now();
    let fromTs: number | undefined;

    if (activeFilter === "TODAY") {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      fromTs = today.getTime();
    } else if (activeFilter === "WEEK") {
      fromTs = now - 7 * 86400000;
    } else if (activeFilter === "MONTH") {
      fromTs = now - 30 * 86400000;
    }

    const result = generatePeriodicBalance(db, {
      fromTimestamp: fromTs,
      toTimestamp: now,
    });
    setReport(result);
  }, [db, activeFilter]);

  // 2. Carga de Histórico de Tasas BCV
  useEffect(() => {
    if (!db) {
      setRatesReport({
        periodFrom: "2026-10-04",
        periodTo: "2026-11-02",
        totalDays: 30,
        latestRate: "36.5013",
        minRate: "36.2100",
        maxRate: "36.5800",
        averageRate: "36.4150",
        variationAbsolute: "+0.2913",
        variationPercent: "+0.80",
        bcvAutoCount: 28,
        manualCount: 2,
        rates: [
          { rateDate: "2026-11-02", rateToVes: "36.5013", source: "BCV_AUTO", notes: null, deltaPreviousDay: "+0.0313", percentPreviousDay: "+0.09%" },
          { rateDate: "2026-11-01", rateToVes: "36.4700", source: "BCV_AUTO", notes: null, deltaPreviousDay: "+0.0200", percentPreviousDay: "+0.05%" },
          { rateDate: "2026-10-31", rateToVes: "36.4500", source: "MANUAL", notes: "Sin internet en apertura", deltaPreviousDay: "+0.0500", percentPreviousDay: "+0.14%" },
          { rateDate: "2026-10-30", rateToVes: "36.4000", source: "BCV_AUTO", notes: null, deltaPreviousDay: "-0.0100", percentPreviousDay: "-0.03%" },
          { rateDate: "2026-10-29", rateToVes: "36.4100", source: "BCV_AUTO", notes: null, deltaPreviousDay: "+0.0400", percentPreviousDay: "+0.11%" },
        ],
      });
      return;
    }

    const now = Date.now();
    let startDate: string | undefined;

    if (activeRatesFilter === "WEEK") {
      startDate = toIsoDate(now - 7 * 86400000);
    } else if (activeRatesFilter === "MONTH") {
      startDate = toIsoDate(now - 30 * 86400000);
    } else if (activeRatesFilter === "QUARTER") {
      startDate = toIsoDate(now - 90 * 86400000);
    }

    const result = generateExchangeRateReport(db, {
      startDate,
      order: "DESC",
    });
    setRatesReport(result);
  }, [db, activeRatesFilter]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Selector de Sección del Módulo de Reportes */}
      <View style={styles.sectionTabsRow}>
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => setActiveSection("BALANCE")}
          style={[styles.sectionTabBtn, activeSection === "BALANCE" && styles.sectionTabBtnActive]}
        >
          <Text
            style={[
              styles.sectionTabBtnText,
              activeSection === "BALANCE" && styles.sectionTabBtnTextActive,
            ]}
          >
            📊 Balance de Ventas y Caja
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => setActiveSection("EXCHANGE_RATES")}
          style={[
            styles.sectionTabBtn,
            activeSection === "EXCHANGE_RATES" && styles.sectionTabBtnActive,
          ]}
        >
          <Text
            style={[
              styles.sectionTabBtnText,
              activeSection === "EXCHANGE_RATES" && styles.sectionTabBtnTextActive,
            ]}
          >
            💵 Histórico de Tasas BCV
          </Text>
        </TouchableOpacity>
      </View>

      {/* ============================================================== */}
      {/* SECCIÓN 1: BALANCE FINANCIERO Y VENTAS                         */}
      {/* ============================================================== */}
      {activeSection === "BALANCE" && report ? (
        <>
          {/* Cabecera y Filtros de Rango */}
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.title}>Balance Consolidado del Período</Text>
              <Text style={styles.subtitle}>
                Acumulados contables, margen comercial y métodos de pago en SQLite
              </Text>
            </View>

            <View style={styles.filterGroup}>
              {(
                [
                  { id: "TODAY", label: "Hoy" },
                  { id: "WEEK", label: "7 Días" },
                  { id: "MONTH", label: "Mes Actual" },
                  { id: "ALL", label: "Histórico" },
                ] as const
              ).map((f) => {
                const isActive = activeFilter === f.id;
                return (
                  <TouchableOpacity
                    key={f.id}
                    activeOpacity={0.8}
                    onPress={() => setActiveFilter(f.id)}
                    style={[styles.filterBtn, isActive && styles.filterBtnActive]}
                  >
                    <Text style={[styles.filterBtnText, isActive && styles.filterBtnTextActive]}>
                      {f.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Tarjetas Maestras de Resumen */}
          <View style={styles.cardsRow}>
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Facturación Total USD</Text>
              <Text style={[styles.cardValue, typography.tabularNumeric]}>
                {formatUsd(report.totalRevenueUsd)}
              </Text>
              <Text style={styles.cardSub}>{report.totalInvoices} facturas emitidas</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardLabel}>Equivalente Total VES</Text>
              <Text style={[styles.cardValue, typography.tabularNumeric]}>
                {formatVes(report.totalRevenueVes)}
              </Text>
              <Text style={styles.cardSub}>Total legal recaudado</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardLabel}>Margen Bruto Comercial</Text>
              <Text style={[styles.cardValue, styles.marginValue, typography.tabularNumeric]}>
                {formatUsd(report.totalGrossMarginUsd)}
              </Text>
              <Text style={[styles.cardSub, styles.marginValue]}>
                {report.grossMarginPercent}% de rentabilidad
              </Text>
            </View>
          </View>

          {/* Tabla Desglose por Método de Pago */}
          <View style={styles.tableCard}>
            <Text style={styles.tableTitle}>Desglose de Ingresos por Método de Pago</Text>
            <View style={styles.tableHeader}>
              <Text style={[styles.th, { flex: 2 }]}>Método de Pago</Text>
              <Text style={[styles.th, styles.textRight, { flex: 1 }]}>Transacciones</Text>
              <Text style={[styles.th, styles.textRight, { flex: 1.5 }]}>Total USD</Text>
              <Text style={[styles.th, styles.textRight, { flex: 1.5 }]}>Total VES</Text>
            </View>

            {report.paymentBreakdown.map((row) => (
              <View key={row.method} style={styles.tableRow}>
                <Text style={[styles.td, { flex: 2 }]}>{row.label}</Text>
                <Text style={[styles.td, styles.textRight, typography.tabularNumeric, { flex: 1 }]}>
                  {row.count}
                </Text>
                <Text style={[styles.td, styles.textRight, typography.tabularNumeric, { flex: 1.5 }]}>
                  {formatUsd(row.totalUsd)}
                </Text>
                <Text style={[styles.td, styles.textRight, typography.tabularNumeric, { flex: 1.5 }]}>
                  {formatVes(row.totalVes)}
                </Text>
              </View>
            ))}
          </View>

          {/* Tabla de Productos Más Vendidos */}
          {report.topProducts.length > 0 ? (
            <View style={styles.tableCard}>
              <Text style={styles.tableTitle}>Top Productos Más Vendidos del Período</Text>
              <View style={styles.tableHeader}>
                <Text style={[styles.th, { flex: 1 }]}>SKU</Text>
                <Text style={[styles.th, { flex: 2 }]}>Producto</Text>
                <Text style={[styles.th, styles.textRight, { flex: 1.2 }]}>Cantidad</Text>
                <Text style={[styles.th, styles.textRight, { flex: 1.5 }]}>Recaudación USD</Text>
                <Text style={[styles.th, styles.textRight, { flex: 1.5 }]}>Recaudación VES</Text>
              </View>

              {report.topProducts.map((p) => (
                <View key={p.productId} style={styles.tableRow}>
                  <Text style={[styles.tdSub, { flex: 1 }]}>{p.sku}</Text>
                  <Text style={[styles.td, { flex: 2 }]} numberOfLines={1}>
                    {p.name}
                  </Text>
                  <Text style={[styles.td, styles.textRight, typography.tabularNumeric, { flex: 1.2 }]}>
                    {p.quantitySold}
                  </Text>
                  <Text style={[styles.td, styles.textRight, typography.tabularNumeric, { flex: 1.5 }]}>
                    {formatUsd(p.totalUsd)}
                  </Text>
                  <Text style={[styles.td, styles.textRight, typography.tabularNumeric, { flex: 1.5 }]}>
                    {formatVes(p.totalVes)}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </>
      ) : null}

      {/* ============================================================== */}
      {/* SECCIÓN 2: HISTÓRICO DE TASAS BCV                              */}
      {/* ============================================================== */}
      {activeSection === "EXCHANGE_RATES" && ratesReport ? (
        <>
          {/* Cabecera y Filtros de Rango de Tasas */}
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.title}>Reporte Histórico de Tasas BCV</Text>
              <Text style={styles.subtitle}>
                Historial oficial de cambio USD / VES y auditoría de capturas manuales
              </Text>
            </View>

            <View style={styles.filterGroup}>
              {(
                [
                  { id: "WEEK", label: "7 Días" },
                  { id: "MONTH", label: "30 Días" },
                  { id: "QUARTER", label: "90 Días" },
                  { id: "ALL", label: "Todo" },
                ] as const
              ).map((f) => {
                const isActive = activeRatesFilter === f.id;
                return (
                  <TouchableOpacity
                    key={f.id}
                    activeOpacity={0.8}
                    onPress={() => setActiveRatesFilter(f.id)}
                    style={[styles.filterBtn, isActive && styles.filterBtnActive]}
                  >
                    <Text style={[styles.filterBtnText, isActive && styles.filterBtnTextActive]}>
                      {f.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Tarjetas Maestras de KPIs Cambiarios */}
          <View style={styles.cardsRow}>
            {/* Tasa Vigente */}
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Tasa Oficial Vigente</Text>
              <Text style={[styles.cardValue, typography.tabularNumeric]}>
                {ratesReport.latestRate !== "0.0000"
                  ? formatVes(ratesReport.latestRate)
                  : "Sin registro"}
              </Text>
              <Text style={styles.cardSub}>
                {ratesReport.periodTo
                  ? `Fecha: ${ratesReport.periodTo}`
                  : "Esperando sincronización"}
              </Text>
            </View>

            {/* Mínimo y Máximo */}
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Rango del Período (Mín / Máx)</Text>
              <Text style={[styles.cardValue, typography.tabularNumeric]}>
                {ratesReport.totalDays > 0
                  ? `${ratesReport.minRate} - ${ratesReport.maxRate}`
                  : "—"}
              </Text>
              <Text style={styles.cardSub}>
                Promedio: {ratesReport.totalDays > 0 ? `Bs. ${ratesReport.averageRate}` : "—"}
              </Text>
            </View>

            {/* Variación Acumulada */}
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Variación del Período</Text>
              <Text
                style={[
                  styles.cardValue,
                  ratesReport.variationAbsolute.startsWith("+")
                    ? styles.deltaPositive
                    : ratesReport.variationAbsolute.startsWith("-")
                    ? styles.deltaNegative
                    : null,
                  typography.tabularNumeric,
                ]}
              >
                {ratesReport.totalDays > 0
                  ? `${ratesReport.variationAbsolute} Bs. (${ratesReport.variationPercent}%)`
                  : "0.00%"}
              </Text>
              <Text style={styles.cardSub}>
                {ratesReport.totalDays} {ratesReport.totalDays === 1 ? "día registrado" : "días registrados"}
              </Text>
            </View>

            {/* Fuentes / Auditoría */}
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Fuentes de Fijación</Text>
              <Text style={[styles.cardValue, typography.tabularNumeric]}>
                {ratesReport.bcvAutoCount} BCV / {ratesReport.manualCount} Manual
              </Text>
              <Text style={styles.cardSub}>
                {ratesReport.manualCount > 0
                  ? "Incluye capturas manuales auditadas"
                  : "100% oficial BCV automático"}
              </Text>
            </View>
          </View>

          {/* Barra de Alternancia de Vista: Gráfico vs Tabla */}
          <View style={styles.viewModeRow}>
            <Text style={styles.viewModeTitle}>
              {ratesViewMode === "CHART"
                ? "📈 Gráfico de Evolución y Curva Diaria"
                : "📋 Tabla Detallada con Auditoría"}
            </Text>

            <View style={styles.viewModeGroup}>
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => setRatesViewMode("CHART")}
                style={[
                  styles.viewModeBtn,
                  ratesViewMode === "CHART" && styles.viewModeBtnActive,
                ]}
              >
                <Text
                  style={[
                    styles.viewModeBtnText,
                    ratesViewMode === "CHART" && styles.viewModeBtnTextActive,
                  ]}
                >
                  📈 Gráfico de Líneas
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => setRatesViewMode("TABLE")}
                style={[
                  styles.viewModeBtn,
                  ratesViewMode === "TABLE" && styles.viewModeBtnActive,
                ]}
              >
                <Text
                  style={[
                    styles.viewModeBtnText,
                    ratesViewMode === "TABLE" && styles.viewModeBtnTextActive,
                  ]}
                >
                  📋 Tabla Detallada
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* VISTA 1: GRÁFICO DE LÍNEAS TÁCTIL */}
          {ratesViewMode === "CHART" ? (
            <ExchangeRateLineChart rates={ratesReport.rates} height={290} />
          ) : null}

          {/* VISTA 2: TABLA DE REGISTROS HISTÓRICOS */}
          {ratesViewMode === "TABLE" ? (
            <View style={styles.tableCard}>
              <Text style={styles.tableTitle}>Detalle Diario de Tasas Oficiales Registradas</Text>
              <View style={styles.tableHeader}>
                <Text style={[styles.th, { flex: 1.5 }]}>Fecha</Text>
                <Text style={[styles.th, styles.textRight, { flex: 2 }]}>Tasa Oficial USD (Bs.)</Text>
                <Text style={[styles.th, styles.textRight, { flex: 2 }]}>Variación Diaria</Text>
                <Text style={[styles.th, { flex: 2, paddingLeft: spacing.md }]}>Origen / Método</Text>
                <Text style={[styles.th, { flex: 3 }]}>Notas de Auditoría</Text>
              </View>

              {ratesReport.rates.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyText}>
                    No se registran tasas en el período seleccionado.
                  </Text>
                </View>
              ) : (
                ratesReport.rates.map((row) => (
                  <View key={row.rateDate} style={styles.tableRow}>
                    {/* Fecha */}
                    <Text style={[styles.td, typography.tabularNumeric, { flex: 1.5 }]}>
                      {row.rateDate}
                    </Text>

                    {/* Tasa en Bolívares */}
                    <Text
                      style={[
                        styles.td,
                        styles.textRight,
                        styles.rateValueText,
                        typography.tabularNumeric,
                        { flex: 2 },
                      ]}
                    >
                      {formatVes(row.rateToVes)}
                    </Text>

                    {/* Variación diaria */}
                    <View style={[{ flex: 2, alignItems: "flex-end" }]}>
                      {row.deltaPreviousDay ? (
                        <View
                          style={[
                            styles.deltaBadge,
                            row.deltaPreviousDay.startsWith("+")
                              ? styles.deltaBadgeWarn
                              : styles.deltaBadgeGood,
                          ]}
                        >
                          <Text
                            style={[
                              styles.deltaBadgeText,
                              row.deltaPreviousDay.startsWith("+")
                                ? styles.deltaTextWarn
                                : styles.deltaTextGood,
                              typography.tabularNumeric,
                            ]}
                          >
                            {row.deltaPreviousDay} ({row.percentPreviousDay})
                          </Text>
                        </View>
                      ) : (
                        <Text style={[styles.tdMuted, typography.tabularNumeric]}>— Base</Text>
                      )}
                    </View>

                    {/* Origen (Badge) */}
                    <View style={[{ flex: 2, paddingLeft: spacing.md }]}>
                      <View
                        style={[
                          styles.sourceBadge,
                          row.source === "BCV_AUTO"
                            ? styles.sourceBadgeBcv
                            : styles.sourceBadgeManual,
                        ]}
                      >
                        <Text
                          style={[
                            styles.sourceBadgeText,
                            row.source === "BCV_AUTO"
                              ? styles.sourceTextBcv
                              : styles.sourceTextManual,
                          ]}
                        >
                          {row.source === "BCV_AUTO" ? "🏛️ BCV Oficial" : "✍️ Manual Auditado"}
                        </Text>
                      </View>
                    </View>

                    {/* Notas */}
                    <Text
                      style={[
                        styles.td,
                        styles.notesText,
                        { flex: 3 },
                        !row.notes && styles.tdMuted,
                      ]}
                      numberOfLines={2}
                    >
                      {row.notes ?? "—"}
                    </Text>
                  </View>
                ))
              )}
            </View>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
};

export { MonthlyBalanceScreen as ReportsScreen };

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.dark.surfaceBase,
  },
  content: {
    padding: spacing.xl,
  },
  sectionTabsRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginBottom: spacing.xl,
    borderBottomWidth: 1,
    borderBottomColor: colors.dark.border,
    paddingBottom: spacing.md,
  },
  sectionTabBtn: {
    minHeight: spacing.touchTargetMin,
    paddingHorizontal: spacing.lg,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.dark.surfaceContainerLow,
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  sectionTabBtnActive: {
    backgroundColor: colors.dark.primary,
    borderColor: colors.dark.primaryGlow,
  },
  sectionTabBtnText: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.semibold,
    color: colors.dark.textSecondary,
  },
  sectionTabBtnTextActive: {
    color: colors.dark.textPrimary,
    fontWeight: typography.weights.bold,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.xl,
  },
  title: {
    fontSize: typography.sizes.titleLg,
    fontWeight: typography.weights.bold,
    color: colors.dark.textPrimary,
  },
  subtitle: {
    fontSize: typography.sizes.subText,
    color: colors.dark.textSecondary,
    marginTop: 2,
  },
  filterGroup: {
    flexDirection: "row",
    backgroundColor: colors.dark.surfaceContainerLow,
    borderRadius: spacing.radiusMd,
    padding: 4,
    borderWidth: 1,
    borderColor: colors.dark.border,
    gap: 4,
  },
  filterBtn: {
    height: spacing.touchTargetMin - 8, // ~40px
    paddingHorizontal: spacing.md,
    borderRadius: spacing.radiusSm,
    justifyContent: "center",
    alignItems: "center",
  },
  filterBtnActive: {
    backgroundColor: colors.dark.primary,
  },
  filterBtnText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.semibold,
    color: colors.dark.textSecondary,
  },
  filterBtnTextActive: {
    color: colors.dark.textPrimary,
    fontWeight: typography.weights.bold,
  },
  cardsRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  card: {
    flex: 1,
    backgroundColor: colors.dark.surfaceContainerLow,
    borderRadius: spacing.radiusLg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  cardLabel: {
    fontSize: typography.sizes.caption,
    color: colors.dark.textSecondary,
    marginBottom: spacing.xs,
  },
  cardValue: {
    fontSize: typography.sizes.titleMd,
    fontWeight: typography.weights.bold,
    color: colors.dark.textPrimary,
  },
  cardSub: {
    fontSize: typography.sizes.caption,
    color: colors.dark.textMuted,
    marginTop: 4,
  },
  marginValue: {
    color: colors.dark.hero,
  },
  deltaPositive: {
    color: "#F59E0B",
  },
  deltaNegative: {
    color: colors.dark.hero,
  },
  viewModeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  viewModeTitle: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    color: colors.dark.textPrimary,
  },
  viewModeGroup: {
    flexDirection: "row",
    backgroundColor: colors.dark.surfaceContainerLow,
    borderRadius: spacing.radiusMd,
    padding: 4,
    borderWidth: 1,
    borderColor: colors.dark.border,
    gap: 4,
  },
  viewModeBtn: {
    height: spacing.touchTargetMin - 8,
    paddingHorizontal: spacing.md,
    borderRadius: spacing.radiusSm,
    justifyContent: "center",
    alignItems: "center",
  },
  viewModeBtnActive: {
    backgroundColor: colors.dark.primary,
  },
  viewModeBtnText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.semibold,
    color: colors.dark.textSecondary,
  },
  viewModeBtnTextActive: {
    color: colors.dark.textPrimary,
    fontWeight: typography.weights.bold,
  },
  tableCard: {
    backgroundColor: colors.dark.surfaceContainerLow,
    borderRadius: spacing.radiusLg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.dark.border,
    marginBottom: spacing.lg,
  },
  tableTitle: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    color: colors.dark.textPrimary,
    marginBottom: spacing.md,
  },
  tableHeader: {
    flexDirection: "row",
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.dark.border,
  },
  th: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: colors.dark.textSecondary,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.dark.border,
    alignItems: "center",
  },
  td: {
    fontSize: typography.sizes.body,
    color: colors.dark.textPrimary,
  },
  tdMuted: {
    fontSize: typography.sizes.caption,
    color: colors.dark.textMuted,
  },
  tdSub: {
    fontSize: typography.sizes.caption,
    color: colors.dark.primaryGlow,
    fontWeight: typography.weights.bold,
  },
  rateValueText: {
    fontWeight: typography.weights.bold,
    color: "#60A5FA",
  },
  notesText: {
    fontSize: typography.sizes.caption,
    color: colors.dark.textSecondary,
  },
  textRight: {
    textAlign: "right",
  },
  sourceBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: spacing.radiusSm,
    alignSelf: "flex-start",
  },
  sourceBadgeBcv: {
    backgroundColor: "rgba(0, 176, 116, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(0, 176, 116, 0.4)",
  },
  sourceBadgeManual: {
    backgroundColor: "rgba(245, 158, 11, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.4)",
  },
  sourceBadgeText: {
    fontSize: 11,
    fontWeight: typography.weights.bold,
  },
  sourceTextBcv: {
    color: colors.dark.hero,
  },
  sourceTextManual: {
    color: "#F59E0B",
  },
  deltaBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: spacing.radiusSm,
  },
  deltaBadgeWarn: {
    backgroundColor: "rgba(245, 158, 11, 0.12)",
  },
  deltaBadgeGood: {
    backgroundColor: "rgba(0, 176, 116, 0.12)",
  },
  deltaBadgeText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
  },
  deltaTextWarn: {
    color: "#F59E0B",
  },
  deltaTextGood: {
    color: colors.dark.hero,
  },
  emptyContainer: {
    paddingVertical: spacing.xl,
    alignItems: "center",
  },
  emptyText: {
    color: colors.dark.textMuted,
    fontSize: typography.sizes.body,
  },
});
