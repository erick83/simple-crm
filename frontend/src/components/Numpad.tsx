import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { colors } from "../theme/colors";
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
  const renderKey = (key: string, onPress: () => void, isAction = false) => (
    <TouchableOpacity
      key={key}
      activeOpacity={0.7}
      onPress={onPress}
      style={[styles.key, isAction && styles.actionKey]}
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
          ? renderKey(".", onDecimal, true)
          : renderKey("C", onClear, true)}
        {renderKey("0", () => onDigit("0"))}
        {showDecimal && onDecimal
          ? renderKey("⌫", onBackspace, true)
          : renderKey("⌫", onBackspace, true)}
      </View>
      {showDecimal && onDecimal ? (
        <View style={styles.row}>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={onClear}
            style={[styles.clearWideKey]}
          >
            <Text style={styles.clearWideText}>BORRAR TODO (C)</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
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
    backgroundColor: colors.dark.surfaceContainerHigh,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  actionKey: {
    backgroundColor: colors.dark.surfaceContainerHighest,
  },
  keyText: {
    fontSize: typography.sizes.numpadDigit,
    fontWeight: typography.weights.bold,
    color: colors.dark.textPrimary,
  },
  actionKeyText: {
    fontSize: typography.sizes.titleMd,
    color: colors.dark.primaryGlow,
  },
  clearWideKey: {
    flex: 1,
    height: 48,
    backgroundColor: colors.dark.surfaceContainerHighest,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  clearWideText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: colors.dark.textSecondary,
    letterSpacing: 0.5,
  },
});

