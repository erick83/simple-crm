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

export interface MonthlyBalanceScreenProps {
  db?: SqlDriver;
}

type PeriodFilter = "ALL" | "MONTH" | "WEEK" | "TODAY";

export const MonthlyBalanceScreen: React.FC<MonthlyBalanceScreenProps> = ({ db }) => {
  const [activeFilter, setActiveFilter] = useState<PeriodFilter>("MONTH");
  const [report, setReport] = useState<PeriodicBalanceReport | null>(null);

  useEffect(() => {
    if (!db) {
      // Simulación de respaldo para vista previa en UI
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

  if (!report) return null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
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
  tdSub: {
    fontSize: typography.sizes.caption,
    color: colors.dark.primaryGlow,
    fontWeight: typography.weights.bold,
  },
  textRight: {
    textAlign: "right",
  },
});
