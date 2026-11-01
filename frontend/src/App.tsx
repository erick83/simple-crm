import React, { useState, useEffect } from "react";
import { SafeAreaView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { colors } from "./theme/colors";
import { spacing } from "./theme/spacing";
import { typography } from "./theme/typography";
import { SyncBadge } from "./components/SyncBadge";
import type { SyncState } from "./components/SyncBadge";
import { PosScreen } from "./screens/PosScreen";
import { ShiftsScreen } from "./screens/ShiftsScreen";
import { InventoryScreen } from "./screens/InventoryScreen";
import { MonthlyBalanceScreen } from "./screens/MonthlyBalanceScreen";
import type { SqlDriver } from "./database/connection";
import { createDefaultFileStore } from "./services/image-compressor.service";
import type { FileStore } from "./services/image-compressor.service";
import { P2pSyncService } from "./services/p2p-sync.service";

type NavTab = "pos" | "inventory" | "shifts" | "balance";

export interface AppProps {
  initialDb?: SqlDriver;
  tenantId?: string;
  terminalId?: string;
  fileStore?: FileStore;
  [key: string]: unknown;
}

export const App: React.FC<AppProps> = ({
  initialDb,
  tenantId = "TENANT-001",
  terminalId = "TERM-01",
  fileStore: customFileStore,
}) => {
  const [currentTab, setCurrentTab] = useState<NavTab>("pos");
  const [db] = useState<SqlDriver | undefined>(initialDb);
  const [fileStore] = useState<FileStore>(() => customFileStore ?? createDefaultFileStore());
  const [pendingCount, setPendingCount] = useState<number>(() =>
    db ? P2pSyncService.getPendingCount(db) : 0,
  );
  const [syncState] = useState<SyncState>("online");

  const refreshPendingCount = () => {
    if (!db) return;
    try {
      setPendingCount(P2pSyncService.getPendingCount(db));
    } catch {
      // Ignorar si db aún no inicializada
    }
  };

  useEffect(() => {
    refreshPendingCount();
  }, [currentTab, db]);

  const renderScreen = () => {
    switch (currentTab) {
      case "pos":
        return (
          <PosScreen
            db={db}
            terminalId={terminalId}
            onInvoiceCreated={() => refreshPendingCount()}
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
        return <ShiftsScreen db={db} terminalId={terminalId} />;
      case "balance":
        return <MonthlyBalanceScreen db={db} />;
    }
  };

  const navItem = (tab: NavTab, label: string, icon: string) => {
    const isActive = currentTab === tab;
    return (
      <TouchableOpacity
        key={tab}
        activeOpacity={0.8}
        onPress={() => setCurrentTab(tab)}
        style={[styles.navItem, isActive && styles.navItemActive]}
      >
        <Text style={styles.navIcon}>{icon}</Text>
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
          <View style={styles.shiftFooter}>
            <View style={styles.shiftDot} />
            <View>
              <Text style={styles.shiftCashier}>Erick (C01)</Text>
              <Text style={styles.shiftNumber}>Turno Activo #402</Text>
            </View>
          </View>
        </View>

        {/* Contenido Principal y Header */}
        <View style={styles.mainArea}>
          {/* Top Header */}
          <View style={styles.topHeader}>
            <View style={styles.headerLeft}>
              <Text style={styles.locationText}>📍 Sede Principal — Maracaibo</Text>
            </View>
            <View style={styles.headerRight}>
              <SyncBadge
                state={syncState}
                pendingCount={pendingCount}
                lastSyncText="hace 1m"
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

