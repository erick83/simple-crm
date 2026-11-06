import React, { useState, useEffect, useCallback } from "react";
import { SafeAreaView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { ThemeProvider, useTheme, useThemedStyles } from "./theme/ThemeContext";
import type { Palette } from "./theme/tokens";
import { spacing } from "./theme/spacing";
import { typography } from "./theme/typography";
import { useBreakpoint } from "./theme/responsive";
import { SyncBadge, deriveSyncState } from "./components/SyncBadge";
import type { SyncState } from "./components/SyncBadge";
import { ThemeToggle } from "./components/ThemeToggle";
import { BrandLogo } from "./components/BrandLogo";
import { NavIcon } from "./components/NavIcon";
import type { NavIconName } from "./components/NavIcon";
import { PosScreen } from "./screens/PosScreen";
import { ShiftsScreen } from "./screens/ShiftsScreen";
import { InventoryScreen } from "./screens/InventoryScreen";
import { MonthlyBalanceScreen } from "./screens/MonthlyBalanceScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { LockScreen } from "./screens/LockScreen";
import { getOrCreateDefaultSqlDriver } from "./database/connection";
import type { SqlDriver } from "./database/connection";
import { createDefaultFileStore } from "./services/image-compressor.service";
import type { FileStore } from "./services/image-compressor.service";
import { P2pSyncService } from "./services/p2p-sync.service";
import { getOpenShift } from "./database/repositories/shift.repository";
import type { ShiftEntity } from "./database/repositories/shift.repository";
import type { OperatorEntity } from "./database/repositories/operator.repository";
import { logOperatorAction } from "./database/repositories/operator.repository";

type NavTab = "pos" | "inventory" | "shifts" | "balance" | "settings";

/** Fila completa (escritorio), riel vertical (tablet) o barra inferior (móvil). */
type NavVariant = "row" | "rail" | "bottom";

const NAV_ITEMS: ReadonlyArray<{ tab: NavTab; label: string; icon: NavIconName }> = [
  { tab: "pos", label: "Caja", icon: "pos" },
  { tab: "inventory", label: "Inventario", icon: "inventory" },
  { tab: "shifts", label: "Turnos", icon: "shifts" },
  { tab: "balance", label: "Balance", icon: "balance" },
  { tab: "settings", label: "Configuración", icon: "settings" },
];

export interface AppProps {
  initialDb?: SqlDriver;
  tenantId?: string;
  terminalId?: string;
  branchName?: string;
  fileStore?: FileStore;
  initialOperator?: OperatorEntity | null;
  [key: string]: unknown;
}

export const App: React.FC<AppProps> = (props) => (
  <ThemeProvider>
    <AppShell {...props} />
  </ThemeProvider>
);

const AppShell: React.FC<AppProps> = ({
  initialDb,
  tenantId = "TENANT-001",
  terminalId = "TERM-01",
  branchName,
  fileStore: customFileStore,
  initialOperator = null,
}) => {
  const { colors: theme, mode } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { isMobile, isTablet } = useBreakpoint();
  const [currentOperator, setCurrentOperator] = useState<OperatorEntity | null>(
    () => initialOperator,
  );
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

  const handleLockTerminal = useCallback(() => {
    if (db && currentOperator) {
      try {
        logOperatorAction(db, {
          operatorId: currentOperator.id,
          operatorName: currentOperator.name,
          action: "LOGOUT",
          entityType: "AUTH",
          details: { terminalId },
        });
      } catch {
        // Ignorar si la bitácora falla
      }
    }
    setCurrentOperator(null);
  }, [db, currentOperator, terminalId]);

  if (!currentOperator) {
    return (
      <LockScreen
        db={db}
        terminalId={terminalId}
        tenantId={tenantId}
        onUnlock={(operator) => {
          setCurrentOperator(operator);
          if (operator.role === "CASHIER") {
            try {
              const shift = db ? getOpenShift(db, terminalId) : null;
              if (!shift) {
                setCurrentTab("shifts");
              } else {
                setCurrentTab("pos");
              }
            } catch {
              setCurrentTab("shifts");
            }
          } else {
            setCurrentTab("pos");
          }
        }}
      />
    );
  }

  const allowedTabs: NavTab[] =
    currentOperator.role === "ADMIN"
      ? ["pos", "inventory", "shifts", "balance", "settings"]
      : ["pos", "shifts"];

  const visibleNavItems = NAV_ITEMS.filter((item) => allowedTabs.includes(item.tab));

  const renderScreen = () => {
    const activeTab = allowedTabs.includes(currentTab) ? currentTab : "pos";

    switch (activeTab) {
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
            initialCashierName={currentOperator.name}
            onShiftChanged={(shift) => {
              setActiveShift(shift);
            }}
          />
        );
      case "balance":
        return <MonthlyBalanceScreen db={db} />;
      case "settings":
        return <SettingsScreen db={db} tenantId={tenantId} terminalId={terminalId} />;
    }
  };

  // "En línea" exige cola vacía: con ventas sin replicar el shell declara offline
  // aunque exista una réplica previa (evita el chip "En línea | 5 pendientes").
  const syncState: SyncState = deriveSyncState(lastSyncAt, pendingCount);

  const shiftLabel = activeShift
    ? `Turno Activo #${activeShift.id.slice(-4).toUpperCase()}`
    : "Sin Turno Abierto";

  const navItem = (tab: NavTab, label: string, icon: NavIconName, variant: NavVariant) => {
    const isActive = currentTab === tab;
    const stacked = variant !== "row";
    return (
      <TouchableOpacity
        key={tab}
        activeOpacity={0.8}
        onPress={() => setCurrentTab(tab)}
        style={[
          variant === "row" && styles.navItem,
          variant === "rail" && styles.navItemRail,
          variant === "bottom" && styles.navItemBottom,
          isActive && styles.navItemActive,
        ]}
        accessibilityRole="tab"
        accessibilityState={{ selected: isActive }}
        accessibilityLabel={`${label}${isActive ? ", sección activa" : ""}`}
      >
        <NavIcon
          name={icon}
          size={stacked ? 20 : 22}
          color={isActive ? theme.primaryGlow : theme.textSecondary}
        />
        <Text
          style={[
            stacked ? styles.navLabelStacked : styles.navLabel,
            isActive && styles.navLabelActive,
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar
        barStyle={mode === "dark" ? "light-content" : "dark-content"}
        backgroundColor={theme.surfaceContainerLow}
      />
      <View style={[styles.shell, isMobile && styles.shellMobile]}>
        {/* Navegación lateral (PC) o riel compacto (tablet) */}
        {isMobile ? null : (
          <View style={[styles.sidebar, isTablet && styles.sidebarRail]}>
            <View style={[styles.brandContainer, isTablet && styles.brandContainerRail]}>
              <BrandLogo variant={isTablet ? "mark" : "lockup"} width={isTablet ? 38 : 120} />
              {isTablet ? null : (
                <Text style={styles.brandCaption}>POS · P2P Local-First</Text>
              )}
            </View>

            <View style={styles.navGroup} accessibilityRole="tablist">
              {visibleNavItems.map((item) =>
                navItem(item.tab, item.label, item.icon, isTablet ? "rail" : "row"),
              )}
            </View>

            <View style={styles.sidebarFooter}>
              <View style={[styles.operatorBox, isTablet && styles.operatorBoxRail]}>
                {isTablet ? null : (
                  <View style={styles.operatorInfo}>
                    <Text style={styles.operatorRole}>
                      {currentOperator.role === "ADMIN" ? "👑 Admin" : "👤 Cajero"}
                    </Text>
                    <Text style={styles.operatorName} numberOfLines={1}>
                      {currentOperator.name}
                    </Text>
                  </View>
                )}
                <TouchableOpacity
                  style={styles.lockBtn}
                  onPress={handleLockTerminal}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel="Bloquear terminal y cambiar operador"
                >
                  <Text style={styles.lockBtnText}>🔒</Text>
                </TouchableOpacity>
              </View>

              <ThemeToggle compact={isTablet} />
              <TouchableOpacity
                style={[styles.shiftFooter, isTablet && styles.shiftFooterRail]}
                activeOpacity={0.8}
                onPress={() => setCurrentTab("shifts")}
                accessibilityRole="button"
                accessibilityLabel={`Gestionar turno, ${shiftLabel}`}
              >
                <View
                  style={[styles.shiftDot, !activeShift && styles.shiftDotInactive]}
                />
                {isTablet ? null : (
                  <View style={styles.shiftTexts}>
                    <Text style={styles.shiftCashier} numberOfLines={1}>
                      {activeShift ? activeShift.cashierName : `Terminal: ${terminalId}`}
                    </Text>
                    <Text style={styles.shiftNumber} numberOfLines={1}>
                      {shiftLabel}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Contenido Principal y Header */}
        <View style={styles.mainArea}>
          <View style={[styles.topHeader, isMobile && styles.topHeaderMobile]}>
            <View style={styles.headerLeft}>
              <Text style={styles.locationText} numberOfLines={1}>
                📍 {branchName ?? `Terminal ${terminalId}`}
              </Text>
            </View>
            <View style={styles.headerRight}>
              <SyncBadge
                state={syncState}
                pendingCount={pendingCount}
                lastSyncAt={lastSyncAt}
                compact={isMobile}
              />
            </View>
          </View>

          {/* Vista Activa */}
          <View style={styles.screenContainer}>{renderScreen()}</View>
        </View>

        {/* Navegación inferior (móvil): pulgar primero, targets de 64 px */}
        {isMobile ? (
          <View style={styles.bottomNav}>
            {visibleNavItems.map((item) => navItem(item.tab, item.label, item.icon, "bottom"))}
            <TouchableOpacity
              style={styles.bottomLockBtn}
              onPress={handleLockTerminal}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Bloquear terminal"
            >
              <Text style={styles.bottomLockIcon}>🔒</Text>
            </TouchableOpacity>
            <ThemeToggle compact />
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
};

const makeStyles = (c: Palette) =>
  StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: c.surfaceBase,
  },
  shell: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: c.surfaceBase,
  },
  shellMobile: {
    flexDirection: "column",
  },
  sidebar: {
    width: spacing.sidebarWidth, // 240px
    backgroundColor: c.surfaceContainerLow,
    borderRightWidth: 1,
    borderRightColor: c.border,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    justifyContent: "space-between",
  },
  sidebarRail: {
    width: spacing.sidebarRailWidth, // 88px en tablet
    paddingHorizontal: spacing.xs,
  },
  brandContainer: {
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.xl,
  },
  brandContainerRail: {
    alignItems: "center",
    paddingHorizontal: 0,
  },
  brandCaption: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: c.textMuted,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginTop: spacing.sm,
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
  navItemRail: {
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    minHeight: 56,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
    borderRadius: spacing.radiusMd,
  },
  navItemBottom: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    minHeight: spacing.touchTargetMin,
    paddingVertical: 2,
    paddingHorizontal: spacing.xs,
    borderRadius: spacing.radiusMd,
  },
  navItemActive: {
    backgroundColor: c.primarySoft,
  },
  navLabel: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.medium,
    color: c.textSecondary,
  },
  navLabelStacked: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.medium,
    color: c.textSecondary,
  },
  navLabelActive: {
    color: c.primaryGlow,
    fontWeight: typography.weights.bold,
  },
  sidebarFooter: {
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  operatorBox: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: c.surfaceContainer,
    borderRadius: spacing.radiusMd,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: c.border,
  },
  operatorBoxRail: {
    justifyContent: "center",
    paddingHorizontal: 0,
    paddingVertical: spacing.xs,
  },
  operatorInfo: {
    flex: 1,
    marginRight: spacing.xs,
  },
  operatorRole: {
    fontSize: 10,
    fontWeight: typography.weights.bold,
    color: c.primaryGlow,
    textTransform: "uppercase",
  },
  operatorName: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.semibold,
    color: c.textPrimary,
  },
  lockBtn: {
    width: 36,
    height: 36,
    borderRadius: spacing.radiusSm,
    backgroundColor: c.surfaceContainerHigh,
    alignItems: "center",
    justifyContent: "center",
  },
  lockBtnText: {
    fontSize: 16,
  },
  bottomLockBtn: {
    width: spacing.touchTargetMin,
    height: spacing.touchTargetMin,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: spacing.radiusMd,
    backgroundColor: c.surfaceContainer,
  },
  bottomLockIcon: {
    fontSize: 20,
  },
  shiftFooter: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: c.surfaceContainer,
    padding: spacing.md,
    borderRadius: spacing.radiusMd,
    gap: spacing.sm,
    minHeight: spacing.touchTargetMin,
  },
  shiftFooterRail: {
    width: spacing.touchTargetMin,
    height: spacing.touchTargetMin,
    alignSelf: "center",
    justifyContent: "center",
    alignItems: "center",
    padding: 0,
    borderRadius: spacing.radiusFull,
  },
  shiftDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: c.hero,
  },
  shiftDotInactive: {
    backgroundColor: c.warning,
  },
  shiftTexts: {
    flex: 1,
  },
  shiftCashier: {
    fontSize: typography.sizes.subText,
    fontWeight: typography.weights.bold,
    color: c.textPrimary,
  },
  shiftNumber: {
    fontSize: typography.sizes.caption,
    color: c.textSecondary,
  },
  mainArea: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
  },
  topHeader: {
    height: spacing.topHeaderHeight, // 64px
    backgroundColor: c.surfaceContainerLow,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  topHeaderMobile: {
    height: 56,
    paddingHorizontal: spacing.md,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 1,
  },
  locationText: {
    fontSize: typography.sizes.subText,
    fontWeight: typography.weights.semibold,
    color: c.textSecondary,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
  },
  screenContainer: {
    flex: 1,
  },
  bottomNav: {
    flexDirection: "row",
    alignItems: "stretch",
    height: spacing.bottomNavHeight, // 64px
    backgroundColor: c.surfaceContainerLow,
    borderTopWidth: 1,
    borderTopColor: c.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    gap: 2,
  },
});

export default App;
