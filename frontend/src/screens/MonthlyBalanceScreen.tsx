import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";
import { typography } from "../theme/typography";
import { formatUsd, formatVes } from "../utils/decimal";

export const MonthlyBalanceScreen: React.FC = () => {
  const totals = {
    totalRevenueUsd: "4820.5000",
    totalRevenueVes: "175948.2500",
    totalGrossMarginUsd: "1450.2000",
    totalTickets: 248,
    breakdown: [
      { method: "Efectivo USD ($)", amountUsd: "2150.0000", amountVes: "0.0000" },
      { method: "Efectivo VES (Bs.)", amountUsd: "920.5000", amountVes: "33598.2500" },
      { method: "Pago Móvil (Bs.)", amountUsd: "1150.0000", amountVes: "41975.0000" },
      { method: "Tarjeta de Débito VES (Punto)", amountUsd: "600.0000", amountVes: "21900.0000" },
    ],
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Balance Consolidado del Período</Text>
      <Text style={styles.subtitle}>Reporte agregado y márgenes brutos por método de cobro</Text>

      <View style={styles.cardsRow}>
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Facturación Total USD</Text>
          <Text style={[styles.cardValue, typography.tabularNumeric]}>
            {formatUsd(totals.totalRevenueUsd)}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Equivalente Total VES</Text>
          <Text style={[styles.cardValue, typography.tabularNumeric]}>
            {formatVes(totals.totalRevenueVes)}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Margen Bruto Estimado</Text>
          <Text style={[styles.cardValue, styles.marginValue, typography.tabularNumeric]}>
            {formatUsd(totals.totalGrossMarginUsd)}
          </Text>
        </View>
      </View>

      <View style={styles.tableCard}>
        <Text style={styles.tableTitle}>Desglose por Método de Pago</Text>
        <View style={styles.tableHeader}>
          <Text style={[styles.th, { flex: 2 }]}>Método de Pago</Text>
          <Text style={[styles.th, styles.textRight, { flex: 1.5 }]}>Total USD</Text>
          <Text style={[styles.th, styles.textRight, { flex: 1.5 }]}>Total VES</Text>
        </View>

        {totals.breakdown.map((row, idx) => (
          <View key={idx} style={styles.tableRow}>
            <Text style={[styles.td, { flex: 2 }]}>{row.method}</Text>
            <Text style={[styles.td, styles.textRight, typography.tabularNumeric, { flex: 1.5 }]}>
              {formatUsd(row.amountUsd)}
            </Text>
            <Text style={[styles.td, styles.textRight, typography.tabularNumeric, { flex: 1.5 }]}>
              {formatVes(row.amountVes)}
            </Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.dark.surfaceBase,
    padding: spacing.xl,
  },
  title: {
    fontSize: typography.sizes.titleLg,
    fontWeight: typography.weights.bold,
    color: colors.dark.textPrimary,
  },
  subtitle: {
    fontSize: typography.sizes.subText,
    color: colors.dark.textSecondary,
    marginBottom: spacing.lg,
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
  marginValue: {
    color: colors.dark.hero,
  },
  tableCard: {
    backgroundColor: colors.dark.surfaceContainerLow,
    borderRadius: spacing.radiusLg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.dark.border,
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
  },
  td: {
    fontSize: typography.sizes.body,
    color: colors.dark.textPrimary,
  },
  textRight: {
    textAlign: "right",
  },
});

