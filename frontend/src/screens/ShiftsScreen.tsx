import React, { useState } from "react";
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";
import { typography } from "../theme/typography";
import { formatUsd, formatVes, toDecimal } from "../utils/decimal";

export const ShiftsScreen: React.FC = () => {
  const [isOpen, setIsOpen] = useState(true);
  const [cashier] = useState("Erick (Caja 01)");
  const [initialUsd] = useState("50.0000");
  const [initialVes] = useState("1825.0000");

  const [declaredUsd, setDeclaredUsd] = useState("");
  const [declaredVes, setDeclaredVes] = useState("");
  const [closeReport, setCloseReport] = useState<{
    diffUsd: string;
    diffVes: string;
  } | null>(null);

  // Valores esperados simulados calculados por el sistema (en PR-06 se computan con SQLite)
  const expectedUsd = "142.5000";
  const expectedVes = "5201.2500";

  const handleCierreZ = () => {
    try {
      const decUsd = toDecimal(declaredUsd || "0");
      const decVes = toDecimal(declaredVes || "0");
      const diffUsd = decUsd.minus(toDecimal(expectedUsd)).toFixed(4);
      const diffVes = decVes.minus(toDecimal(expectedVes)).toFixed(4);

      setCloseReport({ diffUsd, diffVes });
      setIsOpen(false);
    } catch {
      // Ignorar errores de parsing temporal
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={styles.header}>
          <Text style={styles.title}>Control de Turno de Caja</Text>
          <View style={[styles.statusBadge, isOpen ? styles.openBadge : styles.closedBadge]}>
            <Text style={styles.statusText}>{isOpen ? "TURNO ABIERTO" : "TURNO CERRADO"}</Text>
          </View>
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Operador en sesión:</Text>
          <Text style={styles.infoValue}>{cashier}</Text>
        </View>

        <View style={styles.divider} />

        <Text style={styles.subTitle}>Fondos Iniciales de Apertura</Text>
        <View style={styles.grid2}>
          <View style={styles.gridItem}>
            <Text style={styles.gridLabel}>Efectivo USD Inicial</Text>
            <Text style={[styles.gridValue, typography.tabularNumeric]}>
              {formatUsd(initialUsd)}
            </Text>
          </View>
          <View style={styles.gridItem}>
            <Text style={styles.gridLabel}>Efectivo VES Inicial</Text>
            <Text style={[styles.gridValue, typography.tabularNumeric]}>
              {formatVes(initialVes)}
            </Text>
          </View>
        </View>

        <View style={styles.divider} />

        {isOpen ? (
          <View style={styles.closeSection}>
            <Text style={styles.subTitle}>Cierre Z — Arqueo Ciego Independiente</Text>
            <Text style={styles.blindNotice}>
              Ingrese el efectivo total contado físicamente en caja. El sistema verificará los
              cuadres exactos por moneda.
            </Text>

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
              <Text style={styles.zButtonText}>EJECUTAR CIERRE Z</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.reportSection}>
            <Text style={styles.subTitle}>Resultados del Arqueo</Text>
            {closeReport && (
              <View style={styles.reportGrid}>
                <View style={styles.reportItem}>
                  <Text style={styles.gridLabel}>Diferencia USD</Text>
                  <Text
                    style={[
                      styles.reportValue,
                      typography.tabularNumeric,
                      toDecimal(closeReport.diffUsd).isNegative()
                        ? styles.negativeDiff
                        : styles.positiveDiff,
                    ]}
                  >
                    {formatUsd(closeReport.diffUsd)}
                  </Text>
                </View>
                <View style={styles.reportItem}>
                  <Text style={styles.gridLabel}>Diferencia VES</Text>
                  <Text
                    style={[
                      styles.reportValue,
                      typography.tabularNumeric,
                      toDecimal(closeReport.diffVes).isNegative()
                        ? styles.negativeDiff
                        : styles.positiveDiff,
                    ]}
                  >
                    {formatVes(closeReport.diffVes)}
                  </Text>
                </View>
              </View>
            )}
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.xl,
    backgroundColor: colors.dark.surfaceBase,
    justifyContent: "center",
    alignItems: "center",
  },
  card: {
    width: "100%",
    maxWidth: 720,
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
  subTitle: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    color: colors.dark.textPrimary,
    marginBottom: spacing.sm,
  },
  grid2: {
    flexDirection: "row",
    gap: spacing.md,
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
    marginTop: spacing.sm,
  },
  blindNotice: {
    fontSize: typography.sizes.caption,
    color: colors.dark.textSecondary,
    marginBottom: spacing.md,
  },
  inputsRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginBottom: spacing.lg,
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
    height: spacing.touchTargetHero, // 64px para cierre Z
    backgroundColor: colors.dark.error,
    borderRadius: spacing.radiusLg,
    justifyContent: "center",
    alignItems: "center",
  },
  zButtonText: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    color: colors.dark.textPrimary,
    letterSpacing: 1,
  },
  reportSection: {
    marginTop: spacing.sm,
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
  positiveDiff: {
    color: colors.dark.hero,
  },
  negativeDiff: {
    color: colors.dark.error,
  },
});

