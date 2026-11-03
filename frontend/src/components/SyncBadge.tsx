import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";
import { typography } from "../theme/typography";

export type SyncState = "online" | "syncing" | "offline" | "error";

export interface SyncBadgeProps {
  state: SyncState;
  pendingCount?: number;
  /** Timestamp real de la última réplica exitosa; null/undefined si nunca hubo una. */
  lastSyncAt?: number | null;
}

export function formatSyncAge(lastSyncAt: number, now: number = Date.now()): string {
  const minutes = Math.floor(Math.max(0, now - lastSyncAt) / 60000);
  if (minutes < 1) return "hace instantes";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.floor(hours / 24)} d`;
}

export const SyncBadge: React.FC<SyncBadgeProps> = ({
  state,
  pendingCount = 0,
  lastSyncAt = null,
}) => {
  const getBadgeConfig = () => {
    switch (state) {
      case "online":
        return {
          color: colors.dark.hero,
          dot: "●",
          text: `En línea | ${lastSyncAt ? formatSyncAge(lastSyncAt) : "sin sincronizar"} (${pendingCount} pendientes)`,
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
          text: lastSyncAt
            ? `Trabajando offline | ${pendingCount} en cola local | Última sinc: ${formatSyncAge(lastSyncAt)}`
            : `Trabajando offline | ${pendingCount} en cola local | Sin pares P2P`,
        };
      case "error":
        return {
          color: colors.dark.error,
          dot: "⚠",
          text: `Error de sincronización | ${pendingCount} en cola local`,
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
