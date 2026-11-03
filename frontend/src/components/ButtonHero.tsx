import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTheme, useThemedStyles } from "../theme/ThemeContext";
import type { Palette } from "../theme/tokens";
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
  const { colors: theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      disabled={disabled}
      onPress={onPress}
      style={[styles.container, disabled && styles.disabled]}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={`${label}, ${totalFormatted}${secondaryFormatted ? `, ${secondaryFormatted}` : ""}`}
    >
      <View style={styles.content}>
        <Text style={[styles.label, disabled && styles.textDisabled]} numberOfLines={1}>
          {label}
        </Text>
        <View style={styles.amounts}>
          <Text
            style={[styles.total, typography.tabularNumeric, disabled && styles.textDisabled]}
            numberOfLines={1}
          >
            {totalFormatted}
          </Text>
          {secondaryFormatted ? (
            <Text style={[styles.secondary, typography.tabularNumeric, disabled && styles.textDisabled]}>
              {secondaryFormatted}
            </Text>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
};

const makeStyles = (c: Palette) =>
  StyleSheet.create({
  container: {
    height: spacing.touchTargetHero, // 64px exactos
    backgroundColor: c.hero,
    borderRadius: spacing.radiusLg,
    paddingHorizontal: spacing.xl,
    justifyContent: "center",
    shadowColor: c.hero,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  disabled: {
    backgroundColor: c.surfaceContainerHigh,
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
    color: c.onHero,
    letterSpacing: 1.5,
  },
  amounts: {
    alignItems: "flex-end",
  },
  total: {
    fontSize: typography.sizes.titleMd,
    fontWeight: typography.weights.bold,
    color: c.onHero,
  },
  secondary: {
    fontSize: typography.sizes.caption,
    color: c.onHero,
    opacity: 0.8,
  },
  textDisabled: {
    color: c.textMuted,
    opacity: 1,
  },
});

