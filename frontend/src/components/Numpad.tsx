import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTheme, useThemedStyles } from "../theme/ThemeContext";
import type { Palette } from "../theme/tokens";
import { spacing } from "../theme/spacing";
import { typography } from "../theme/typography";

export interface NumpadProps {
  onDigit: (digit: string) => void;
  onClear: () => void;
  onBackspace: () => void;
  onDecimal?: () => void;
  showDecimal?: boolean;
}

export const Numpad: React.FC<NumpadProps> = ({
  onDigit,
  onClear,
  onBackspace,
  onDecimal,
  showDecimal = false,
}) => {
  const { colors: theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const renderKey = (key: string, onPress: () => void, isAction = false, label?: string) => (
    <TouchableOpacity
      key={key}
      activeOpacity={0.7}
      onPress={onPress}
      style={[styles.key, isAction && styles.actionKey]}
      accessibilityRole="button"
      accessibilityLabel={label ?? key}
    >
      <Text
        style={[
          styles.keyText,
          isAction ? styles.actionKeyText : typography.tabularNumeric,
        ]}
      >
        {key}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        {renderKey("1", () => onDigit("1"))}
        {renderKey("2", () => onDigit("2"))}
        {renderKey("3", () => onDigit("3"))}
      </View>
      <View style={styles.row}>
        {renderKey("4", () => onDigit("4"))}
        {renderKey("5", () => onDigit("5"))}
        {renderKey("6", () => onDigit("6"))}
      </View>
      <View style={styles.row}>
        {renderKey("7", () => onDigit("7"))}
        {renderKey("8", () => onDigit("8"))}
        {renderKey("9", () => onDigit("9"))}
      </View>
      <View style={styles.row}>
        {showDecimal && onDecimal
          ? renderKey(".", onDecimal, true, "Punto decimal")
          : renderKey("C", onClear, true, "Borrar todo")}
        {renderKey("0", () => onDigit("0"))}
        {renderKey("⌫", onBackspace, true, "Borrar último dígito")}
      </View>
      {showDecimal && onDecimal ? (
        <View style={styles.row}>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={onClear}
            style={[styles.clearWideKey]}
            accessibilityRole="button"
            accessibilityLabel="Borrar todo"
          >
            <Text style={styles.clearWideText}>BORRAR TODO (C)</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
};

const makeStyles = (c: Palette) =>
  StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
  },
  key: {
    width: spacing.touchTargetHero, // 64px
    height: spacing.touchTargetHero, // 64px
    backgroundColor: c.surfaceContainerHigh,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: c.border,
  },
  actionKey: {
    backgroundColor: c.surfaceContainerHighest,
  },
  keyText: {
    fontSize: typography.sizes.numpadDigit,
    fontWeight: typography.weights.bold,
    color: c.textPrimary,
  },
  actionKeyText: {
    fontSize: typography.sizes.titleMd,
    color: c.primaryGlow,
  },
  clearWideKey: {
    flex: 1,
    height: 48,
    backgroundColor: c.surfaceContainerHighest,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: c.border,
  },
  clearWideText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: c.textSecondary,
    letterSpacing: 0.5,
  },
});

