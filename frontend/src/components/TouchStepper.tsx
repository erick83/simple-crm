import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { colors } from "../theme/colors";
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
  return (
    <View style={styles.container}>
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={onDecrement}
        style={styles.button}
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
      >
        <Text style={styles.buttonText}>+</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.dark.surfaceContainerHigh,
    borderRadius: spacing.radiusMd,
    borderWidth: 1,
    borderColor: colors.dark.border,
    overflow: "hidden",
  },
  button: {
    width: spacing.touchTargetMin, // 48px
    height: spacing.touchTargetMin, // 48px
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.dark.surfaceContainerHighest,
  },
  buttonText: {
    fontSize: typography.sizes.titleMd,
    fontWeight: typography.weights.bold,
    color: colors.dark.textPrimary,
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
    color: colors.dark.textPrimary,
  },
});

