import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";
import { typography } from "../theme/typography";

export type SyncState = "online" | "syncing" | "offline" | "error";

export interface SyncBadgeProps {
  state: SyncState;
  pendingCount?: number;
  lastSyncText?: string;
}

export const SyncBadge: React.FC<SyncBadgeProps> = ({
  state,
  pendingCount = 0,
  lastSyncText = "hace 1m",
}) => {
  const getBadgeConfig = () => {
    switch (state) {
      case "online":
        return {
          color: colors.dark.hero,
          dot: "●",
          text: `En línea | ${lastSyncText} (${pendingCount} pendientes)`,
        };
      case "syncing":
        return {
          color: colors.dark.primaryGlow,
          dot: "↻",
          text: `Sincronizando ${pendingCount} operaciones...`,
        };
      case "offline":
        return {
          color: colors.dark.warning,
          dot: "⚡",
          text: `Offline (${pendingCount} en cola local)`,
        };
      case "error":
        return {
          color: colors.dark.error,
          dot: "⚠",
          text: `Error de sincronización`,
        };
    }
  };

  const config = getBadgeConfig();

  return (
    <View style={[styles.badge, { borderColor: config.color }]}>
      <Text style={[styles.dot, { color: config.color }]}>{config.dot}</Text>
      <Text style={styles.text}>{config.text}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.dark.surfaceContainerLow,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: spacing.radiusFull,
    borderWidth: 1,
    gap: spacing.xs,
  },
  dot: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
  },
  text: {
    fontSize: typography.sizes.caption,
    color: colors.dark.textSecondary,
    fontWeight: typography.weights.semibold,
  },
});

