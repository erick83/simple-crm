import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTheme, useThemedStyles } from "../theme/ThemeContext";
import type { Palette } from "../theme/tokens";
import { spacing } from "../theme/spacing";
import { typography } from "../theme/typography";

export type SyncState = "online" | "syncing" | "offline" | "error";

export interface SyncBadgeProps {
  state: SyncState;
  pendingCount?: number;
  /** Timestamp real de la última réplica exitosa; null/undefined si nunca hubo una. */
  lastSyncAt?: number | null;
  /** Etiqueta corta para cabeceras de móvil. */
  compact?: boolean;
}

export function formatSyncAge(lastSyncAt: number, now: number = Date.now()): string {
  const minutes = Math.floor(Math.max(0, now - lastSyncAt) / 60000);
  if (minutes < 1) return "hace instantes";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.floor(hours / 24)} d`;
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/**
 * "En línea" exige una réplica previa y la cola vacía: con eventos sin replicar el
 * shell declara offline aunque exista un último sync (evita "En línea | 5 pendientes").
 */
export function deriveSyncState(lastSyncAt: number | null, pendingCount: number): SyncState {
  return lastSyncAt !== null && pendingCount === 0 ? "online" : "offline";
}

export const SyncBadge: React.FC<SyncBadgeProps> = ({
  state,
  pendingCount = 0,
  lastSyncAt = null,
  compact = false,
}) => {
  const { colors: theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const getBadgeConfig = () => {
    switch (state) {
      case "online":
        return {
          color: theme.heroText,
          dot: "●",
          text: `En línea | ${lastSyncAt ? formatSyncAge(lastSyncAt) : "sin sincronizar"} (${plural(pendingCount, "pendiente", "pendientes")})`,
        };
      case "syncing":
        return {
          color: theme.primaryGlow,
          dot: "↻",
          text: `Sincronizando ${plural(pendingCount, "operación", "operaciones")}...`,
        };
      case "offline":
        return {
          color: theme.warningText,
          dot: "⚡",
          text: lastSyncAt
            ? `Trabajando offline | ${pendingCount} en cola local | Última sinc: ${formatSyncAge(lastSyncAt)}`
            : `Trabajando offline | ${pendingCount} en cola local | Sin pares P2P`,
        };
      case "error":
        return {
          color: theme.errorText,
          dot: "⚠",
          text: `Error de sincronización | ${pendingCount} en cola local`,
        };
    }
  };

  const config = getBadgeConfig();
  const compactText =
    state === "online"
      ? "En línea"
      : state === "syncing"
        ? "Sincronizando"
        : state === "error"
          ? "Error"
          : "Offline";

  return (
    <View
      style={[styles.badge, { borderColor: config.color }]}
      accessibilityLabel={config.text}
    >
      <Text style={[styles.dot, { color: config.color }]}>{config.dot}</Text>
      <Text style={styles.text} numberOfLines={1}>
        {compact
          ? `${compactText}${pendingCount > 0 ? ` · ${pendingCount}` : ""}`
          : config.text}
      </Text>
    </View>
  );
};

const makeStyles = (c: Palette) =>
  StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: c.surfaceContainerLow,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: spacing.radiusMd,
    borderWidth: 1,
    gap: spacing.xs,
  },
  dot: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
  },
  text: {
    fontSize: typography.sizes.caption,
    color: c.textSecondary,
    fontWeight: typography.weights.semibold,
  },
});
