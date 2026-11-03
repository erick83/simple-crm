import React, { useState, useEffect, useCallback } from "react";
import { SafeAreaView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { colors } from "./theme/colors";
import { spacing } from "./theme/spacing";
import { typography } from "./theme/typography";
import { SyncBadge, deriveSyncState } from "./components/SyncBadge";
import type { SyncState } from "./components/SyncBadge";
import { PosScreen } from "./screens/PosScreen";
import { ShiftsScreen } from "./screens/ShiftsScreen";
import { InventoryScreen } from "./screens/InventoryScreen";
import { MonthlyBalanceScreen } from "./screens/MonthlyBalanceScreen";
import { getOrCreateDefaultSqlDriver } from "./database/connection";
import type { SqlDriver } from "./database/connection";
import { createDefaultFileStore } from "./services/image-compressor.service";
import type { FileStore } from "./services/image-compressor.service";
import { P2pSyncService } from "./services/p2p-sync.service";
import { getOpenShift } from "./database/repositories/shift.repository";
import type { ShiftEntity } from "./database/repositories/shift.repository";

type NavTab = "pos" | "inventory" | "shifts" | "balance";

export interface AppProps {
  initialDb?: SqlDriver;
  tenantId?: string;
  terminalId?: string;
  branchName?: string;
  fileStore?: FileStore;
  [key: string]: unknown;
}

export const App: React.FC<AppProps> = ({
  initialDb,
  tenantId = "TENANT-001",
  terminalId = "TERM-01",
  branchName,
  fileStore: customFileStore,
}) => {
  const [currentTab, setCurrentTab] = useState<NavTab>("pos");
  const db = initialDb ?? getOrCreateDefaultSqlDriver({ tenantId, terminalId });
  const [fileStore] = useState<FileStore>(() => customFileStore ?? createDefaultFileStore());
  const [pendingCount, setPendingCount] = useState<number>(() =>
    db ? P2pSyncService.getUnreplicatedCount(db) : 0,
  );
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(() =>
    P2pSyncService.getLastSyncAt(),
  );
  const [activeShift, setActiveShift] = useState<ShiftEntity | null>(null);

  const refreshPendingCount = useCallback(() => {
    if (!db) return;
    try {
      setPendingCount(P2pSyncService.getUnreplicatedCount(db));
      setLastSyncAt(P2pSyncService.getLastSyncAt());
    } catch {
      // Ignorar si db aún no inicializada
    }
  }, [db]);

  const refreshActiveShift = useCallback(() => {
    if (!db) {
      setActiveShift(null);
      return;
    }
    try {
      const shift = getOpenShift(db, terminalId);
      setActiveShift(shift ?? null);
    } catch {
      setActiveShift(null);
    }
  }, [db, terminalId]);

  useEffect(() => {
    refreshPendingCount();
    refreshActiveShift();
  }, [currentTab, refreshPendingCount, refreshActiveShift]);

  const renderScreen = () => {
    switch (currentTab) {
      case "pos":
        return (
          <PosScreen
            db={db}
            tenantId={tenantId}
            terminalId={terminalId}
            fileStore={fileStore}
            onInvoiceCreated={() => {
              refreshPendingCount();
              refreshActiveShift();
            }}
            onNavigateToShifts={() => setCurrentTab("shifts")}
            onNavigateToInventory={() => setCurrentTab("inventory")}
          />
        );
      case "inventory":
        return (
          <InventoryScreen
            db={db}
            tenantId={tenantId}
            terminalId={terminalId}
            fileStore={fileStore}
            onProductSaved={() => refreshPendingCount()}
            onStockAdjusted={() => refreshPendingCount()}
          />
        );
      case "shifts":
        return (
          <ShiftsScreen
            db={db}
            terminalId={terminalId}
            onShiftChanged={(shift) => {
              setActiveShift(shift);
            }}
          />
        );
      case "balance":
        return <MonthlyBalanceScreen db={db} />;
    }
  };

  // "En línea" exige cola vacía: con ventas sin replicar el shell declara offline
  // aunque exista una réplica previa (evita el chip "En línea | 5 pendientes").
  const syncState: SyncState = deriveSyncState(lastSyncAt, pendingCount);

  const navItem = (tab: NavTab, label: string, icon: string) => {
    const isActive = currentTab === tab;
    return (
      <TouchableOpacity
        key={tab}
        activeOpacity={0.8}
        onPress={() => setCurrentTab(tab)}
        style={[styles.navItem, isActive && styles.navItemActive]}
        accessibilityRole="button"
        accessibilityState={{ selected: isActive }}
        accessibilityLabel={`${label}${isActive ? ", sección activa" : ""}`}
      >
        <Text style={styles.navIcon} accessibilityElementsHidden importantForAccessibility="no">
          {icon}
        </Text>
        <Text style={[styles.navLabel, isActive && styles.navLabelActive]}>{label}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={colors.dark.surfaceBase} />
      <View style={styles.shell}>
        {/* Barra Lateral Izquierda (Persistent Sidebar) */}
        <View style={styles.sidebar}>
          <View style={styles.brandContainer}>
            <Text style={styles.brandTitle}>BISYNC</Text>
            <Text style={styles.brandSubtitle}>POS P2P Local-First</Text>
          </View>

          <View style={styles.navGroup}>
            {navItem("pos", "Caja (POS)", "🛒")}
            {navItem("inventory", "Inventario", "📦")}
            {navItem("shifts", "Turnos", "⏱")}
            {navItem("balance", "Balance", "📊")}
          </View>

          {/* Indicador de Turno Activo */}
          <TouchableOpacity
            style={styles.shiftFooter}
            activeOpacity={0.8}
            onPress={() => setCurrentTab("shifts")}
            accessibilityRole="button"
            accessibilityLabel="Gestionar Turno"
          >
            <View
              style={[
                styles.shiftDot,
                !activeShift && styles.shiftDotInactive,
              ]}
            />
            <View>
              <Text style={styles.shiftCashier}>
                {activeShift ? activeShift.cashierName : `Terminal: ${terminalId}`}
              </Text>
              <Text style={styles.shiftNumber}>
                {activeShift
                  ? `Turno Activo #${activeShift.id.slice(-4).toUpperCase()}`
                  : "Sin Turno Abierto"}
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Contenido Principal y Header */}
        <View style={styles.mainArea}>
          {/* Top Header */}
          <View style={styles.topHeader}>
            <View style={styles.headerLeft}>
              <Text style={styles.locationText}>📍 {branchName ?? `Terminal ${terminalId}`}</Text>
            </View>
            <View style={styles.headerRight}>
              <SyncBadge
                state={syncState}
                pendingCount={pendingCount}
                lastSyncAt={lastSyncAt}
              />
            </View>
          </View>

          {/* Vista Activa */}
          <View style={styles.screenContainer}>{renderScreen()}</View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.dark.surfaceBase,
  },
  shell: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: colors.dark.surfaceBase,
  },
  sidebar: {
    width: spacing.sidebarWidth, // 240px
    backgroundColor: colors.dark.surfaceContainerLow,
    borderRightWidth: 1,
    borderRightColor: colors.dark.border,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    justifyContent: "space-between",
  },
  brandContainer: {
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.xl,
  },
  brandTitle: {
    fontSize: typography.sizes.titleLg,
    fontWeight: typography.weights.extraBold,
    color: colors.dark.textPrimary,
    letterSpacing: 2,
  },
  brandSubtitle: {
    fontSize: typography.sizes.caption,
    color: colors.dark.primaryGlow,
    fontWeight: typography.weights.bold,
    marginTop: 2,
  },
  navGroup: {
    flex: 1,
    gap: spacing.sm,
  },
  navItem: {
    flexDirection: "row",
    alignItems: "center",
    height: 52, // Mínimo 52px táctil
    paddingHorizontal: spacing.md,
    borderRadius: spacing.radiusLg,
    gap: spacing.md,
  },
  navItemActive: {
    backgroundColor: colors.dark.primary, // Cobalt Blue #1D61E0
  },
  navIcon: {
    fontSize: 20,
  },
  navLabel: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.medium,
    color: colors.dark.textSecondary,
  },
  navLabelActive: {
    color: colors.dark.textPrimary,
    fontWeight: typography.weights.bold,
  },
  shiftFooter: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.dark.surfaceContainer,
    padding: spacing.md,
    borderRadius: spacing.radiusMd,
    gap: spacing.sm,
  },
  shiftDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.dark.hero,
  },
  shiftDotInactive: {
    backgroundColor: colors.dark.warning,
  },
  shiftCashier: {
    fontSize: typography.sizes.subText,
    fontWeight: typography.weights.bold,
    color: colors.dark.textPrimary,
  },
  shiftNumber: {
    fontSize: typography.sizes.caption,
    color: colors.dark.textSecondary,
  },
  mainArea: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
  },
  topHeader: {
    height: spacing.topHeaderHeight, // 64px
    backgroundColor: colors.dark.surfaceContainerLow,
    borderBottomWidth: 1,
    borderBottomColor: colors.dark.border,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
  },
  locationText: {
    fontSize: typography.sizes.subText,
    fontWeight: typography.weights.semibold,
    color: colors.dark.textSecondary,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
  },
  screenContainer: {
    flex: 1,
  },
});

export default App;

