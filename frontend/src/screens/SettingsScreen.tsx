import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useTheme, useThemedStyles } from "../theme/ThemeContext";
import type { Palette } from "../theme/tokens";
import { spacing } from "../theme/spacing";
import { typography } from "../theme/typography";
import { getOrCreateDefaultSqlDriver } from "../database/connection";
import type { SqlDriver } from "../database/connection";
import {
  getDefaultTaxRate,
  setDefaultTaxRate,
  taxRateToPercent,
} from "../database/repositories/settings.repository";

export interface SettingsScreenProps {
  db?: SqlDriver;
  tenantId?: string;
  terminalId?: string;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  db: propDb,
  tenantId = "TENANT-001",
  terminalId = "TERM-01",
}) => {
  const { colors: theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const db = propDb ?? getOrCreateDefaultSqlDriver({ tenantId, terminalId });

  const [taxPercent, setTaxPercent] = useState(() => taxRateToPercent(getDefaultTaxRate(db)));
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  const handleSaveTax = () => {
    setMessage(null);
    if (!db) {
      setIsError(true);
      setMessage("Sin base de datos local, no se puede guardar la configuración");
      return;
    }
    try {
      const rate = setDefaultTaxRate(db, taxPercent);
      setTaxPercent(taxRateToPercent(rate));
      setIsError(false);
      setMessage(`IVA sugerido guardado: ${taxRateToPercent(rate)}% se aplicará a los productos nuevos`);
    } catch (err) {
      setIsError(true);
      setMessage((err as Error).message);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Configuración</Text>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Impuestos</Text>
        <Text style={styles.sectionHelp}>
          IVA general sugerido (%) que se aplica automáticamente al crear productos. No modifica
          productos existentes ni facturas emitidas.
        </Text>

        <View style={styles.inputRow}>
          <TextInput
            style={[styles.input, typography.tabularNumeric]}
            placeholder="16"
            keyboardType="decimal-pad"
            placeholderTextColor={theme.textMuted}
            value={taxPercent}
            onChangeText={setTaxPercent}
            accessibilityLabel="IVA general sugerido en porcentaje"
          />
          <TouchableOpacity
            style={[styles.saveButton, !db && styles.saveButtonDisabled]}
            activeOpacity={0.85}
            onPress={handleSaveTax}
            disabled={!db}
            accessibilityRole="button"
            accessibilityLabel="Guardar IVA sugerido"
          >
            <Text style={styles.saveButtonText}>GUARDAR</Text>
          </TouchableOpacity>
        </View>

        {message ? (
          <Text style={[styles.message, isError ? styles.messageError : styles.messageOk]}>
            {isError ? "⚠" : "✓"} {message}
          </Text>
        ) : null}
      </View>
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
      padding: spacing.lg,
      gap: spacing.md,
    },
    title: {
      fontSize: typography.sizes.titleLg,
      fontWeight: typography.weights.bold,
      color: c.textPrimary,
    },
    card: {
      backgroundColor: c.surfaceContainerLow,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: spacing.radiusLg,
      padding: spacing.lg,
      gap: spacing.md,
    },
    sectionTitle: {
      fontSize: typography.sizes.titleMd,
      fontWeight: typography.weights.bold,
      color: c.textPrimary,
    },
    sectionHelp: {
      fontSize: typography.sizes.caption,
      color: c.textSecondary,
      lineHeight: 18,
    },
    inputRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
    },
    input: {
      flex: 1,
      minHeight: spacing.touchTargetMin,
      maxHeight: spacing.touchTargetMin,
      borderWidth: 1,
      borderColor: c.borderSolid,
      borderRadius: spacing.radiusMd,
      paddingHorizontal: spacing.md,
      fontSize: typography.sizes.body,
      color: c.textPrimary,
      backgroundColor: c.surfaceContainer,
    },
    saveButton: {
      minHeight: spacing.touchTargetMin,
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: spacing.xl,
      borderRadius: spacing.radiusMd,
      backgroundColor: c.primary,
    },
    saveButtonDisabled: {
      opacity: 0.5,
    },
    saveButtonText: {
      fontSize: typography.sizes.caption,
      fontWeight: typography.weights.bold,
      color: c.onPrimary,
      letterSpacing: 1,
    },
    message: {
      fontSize: typography.sizes.caption,
      fontWeight: typography.weights.medium,
    },
    messageOk: {
      color: c.heroText,
    },
    messageError: {
      color: c.errorText,
    },
  });
