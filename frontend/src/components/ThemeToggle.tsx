import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTheme, useThemedStyles } from "../theme/ThemeContext";
import type { Palette } from "../theme/tokens";
import { spacing } from "../theme/spacing";
import { typography } from "../theme/typography";

export interface ThemeToggleProps {
  /** Apilado para la barra inferior móvil y el riel de tablet. */
  compact?: boolean;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({ compact = false }) => {
  const { colors: theme, mode, toggleMode } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const isDark = mode === "dark";

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={toggleMode}
      style={[styles.root, compact && styles.rootCompact]}
      accessibilityRole="switch"
      accessibilityState={{ checked: isDark }}
      accessibilityLabel="Tema oscuro"
      accessibilityHint={isDark ? "Activa el tema claro" : "Activa el tema oscuro"}
    >
      <View
        style={[styles.track, isDark && { backgroundColor: theme.primary, borderColor: theme.primary }]}
      >
        <View
          style={[
            styles.knob,
            isDark ? styles.knobOn : styles.knobOff,
            isDark && { backgroundColor: theme.onPrimary },
          ]}
        />
      </View>
      <Text style={styles.label}>{isDark ? "Oscuro" : "Claro"}</Text>
    </TouchableOpacity>
  );
};

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    root: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      minHeight: spacing.touchTargetMin,
      paddingHorizontal: spacing.sm,
      borderRadius: spacing.radiusFull,
    },
    rootCompact: {
      flexDirection: "column",
      justifyContent: "center",
      gap: spacing.xs,
      paddingHorizontal: spacing.xs,
      minWidth: spacing.touchTargetMin,
    },
    track: {
      width: 48,
      height: 28,
      borderRadius: spacing.radiusFull,
      backgroundColor: c.surfaceContainerHighest,
      borderWidth: 1,
      borderColor: c.borderSolid,
      justifyContent: "center",
    },
    knob: {
      width: 24,
      height: 24,
      borderRadius: spacing.radiusFull,
      backgroundColor: "#FFFFFF",
      shadowColor: "#000000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.2,
      shadowRadius: 2.5,
      elevation: 2,
    },
    knobOn: {
      alignSelf: "flex-end",
      marginRight: 2,
    },
    knobOff: {
      alignSelf: "flex-start",
      marginLeft: 2,
    },
    label: {
      fontSize: typography.sizes.caption,
      fontWeight: typography.weights.bold,
      color: c.textSecondary,
    },
  });
