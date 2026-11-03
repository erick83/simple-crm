import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTheme, useThemedStyles } from "../theme/ThemeContext";
import type { Palette } from "../theme/tokens";
import { spacing } from "../theme/spacing";
import { typography } from "../theme/typography";

export interface TouchStepperProps {
  value: string;
  onIncrement: () => void;
  onDecrement: () => void;
  min?: number;
}

export const TouchStepper: React.FC<TouchStepperProps> = ({
  value,
  onIncrement,
  onDecrement,
  min = 1,
}) => {
  const { colors: theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.container}>
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={onDecrement}
        style={styles.button}
        accessibilityRole="button"
        accessibilityLabel="Disminuir cantidad"
      >
        <Text style={styles.buttonText}>−</Text>
      </TouchableOpacity>

      <View style={styles.valueContainer}>
        <Text style={[styles.valueText, typography.tabularNumeric]}>{value}</Text>
      </View>

      <TouchableOpacity
        activeOpacity={0.7}
        onPress={onIncrement}
        style={styles.button}
        accessibilityRole="button"
        accessibilityLabel="Aumentar cantidad"
      >
        <Text style={styles.buttonText}>+</Text>
      </TouchableOpacity>
    </View>
  );
};

const makeStyles = (c: Palette) =>
  StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: c.surfaceContainerHigh,
    borderRadius: spacing.radiusMd,
    borderWidth: 1,
    borderColor: c.border,
    overflow: "hidden",
  },
  button: {
    width: spacing.touchTargetMin, // 48px
    height: spacing.touchTargetMin, // 48px
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: c.surfaceContainerHighest,
  },
  buttonText: {
    fontSize: typography.sizes.titleMd,
    fontWeight: typography.weights.bold,
    color: c.textPrimary,
  },
  valueContainer: {
    minWidth: 56,
    paddingHorizontal: spacing.sm,
    justifyContent: "center",
    alignItems: "center",
  },
  valueText: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    color: c.textPrimary,
  },
});

