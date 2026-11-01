import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";
import { typography } from "../theme/typography";

export interface ButtonHeroProps {
  label?: string;
  totalFormatted: string;
  secondaryFormatted?: string;
  disabled?: boolean;
  onPress: () => void;
}

export const ButtonHero: React.FC<ButtonHeroProps> = ({
  label = "COBRAR",
  totalFormatted,
  secondaryFormatted,
  disabled = false,
  onPress,
}) => {
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      disabled={disabled}
      onPress={onPress}
      style={[styles.container, disabled && styles.disabled]}
    >
      <View style={styles.content}>
        <Text style={styles.label}>{label}</Text>
        <View style={styles.amounts}>
          <Text style={[styles.total, typography.tabularNumeric]}>{totalFormatted}</Text>
          {secondaryFormatted ? (
            <Text style={[styles.secondary, typography.tabularNumeric]}>
              {secondaryFormatted}
            </Text>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    height: spacing.touchTargetHero, // 64px exactos
    backgroundColor: colors.dark.hero,
    borderRadius: spacing.radiusLg,
    paddingHorizontal: spacing.xl,
    justifyContent: "center",
    shadowColor: colors.dark.hero,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  disabled: {
    backgroundColor: colors.dark.surfaceContainerHigh,
    shadowOpacity: 0,
    elevation: 0,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  label: {
    fontSize: typography.sizes.titleMd,
    fontWeight: typography.weights.extraBold,
    color: colors.dark.textPrimary,
    letterSpacing: 1.5,
  },
  amounts: {
    alignItems: "flex-end",
  },
  total: {
    fontSize: typography.sizes.titleMd,
    fontWeight: typography.weights.bold,
    color: colors.dark.textPrimary,
  },
  secondary: {
    fontSize: typography.sizes.caption,
    color: "rgba(255, 255, 255, 0.8)",
  },
});

