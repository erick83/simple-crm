import React, { useState } from "react";
import { FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";
import { typography } from "../theme/typography";
import { formatUsd, formatFixed4 } from "../utils/decimal";
import { useBarcodeScanner } from "../services/barcode-scanner.service";
import type { KeyEventTargetLike } from "../services/barcode-scanner.service";

export interface InventoryItem {
  id: string;
  sku: string;
  barcode: string;
  name: string;
  priceUsd: string;
  costUsd: string;
  stock: string;
  minStock: string;
}

export interface InventoryScreenProps {
  keyEventTarget?: KeyEventTargetLike;
  onScanBarcode?: (barcode: string) => void;
}

export const InventoryScreen: React.FC<InventoryScreenProps> = ({
  keyEventTarget,
  onScanBarcode,
}) => {
  const [search, setSearch] = useState("");

  useBarcodeScanner({
    target: keyEventTarget,
    onScan: (scannedCode) => {
      setSearch(scannedCode);
      onScanBarcode?.(scannedCode);
    },
  });
  const [items] = useState<InventoryItem[]>([
    {
      id: "1",
      sku: "HAR-01",
      barcode: "75910001",
      name: "Harina PAN 1kg",
      priceUsd: "1.2500",
      costUsd: "0.9500",
      stock: "24.0000",
      minStock: "5.0000",
    },
    {
      id: "2",
      sku: "ARR-02",
      barcode: "75910002",
      name: "Arroz Primor 1kg",
      priceUsd: "1.5000",
      costUsd: "1.1000",
      stock: "4.0000",
      minStock: "5.0000",
    },
    {
      id: "3",
      sku: "ACE-03",
      barcode: "75910003",
      name: "Aceite Mazeite 1L",
      priceUsd: "3.8000",
      costUsd: "2.9000",
      stock: "12.0000",
      minStock: "5.0000",
    },
  ]);

  const filtered = items.filter(
    (i) =>
      i.name.toLowerCase().includes(search.toLowerCase()) ||
      i.sku.toLowerCase().includes(search.toLowerCase()) ||
      i.barcode.includes(search),
  );

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Text style={styles.title}>Control de Inventario y Kardex</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar por Nombre, SKU o Código de Barras (HID)..."
          placeholderTextColor={colors.dark.textMuted}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const isLowStock = parseFloat(item.stock) <= parseFloat(item.minStock);
          return (
            <View style={styles.row}>
              <View style={styles.colInfo}>
                <Text style={styles.productName}>{item.name}</Text>
                <Text style={styles.metaText}>
                  SKU: {item.sku} | Barcode: {item.barcode}
                </Text>
              </View>

              <View style={styles.colPrice}>
                <Text style={[styles.priceText, typography.tabularNumeric]}>
                  {formatUsd(item.priceUsd)}
                </Text>
                <Text style={styles.costText}>Costo: {formatUsd(item.costUsd)}</Text>
              </View>

              <View style={styles.colStock}>
                <View
                  style={[
                    styles.stockBadge,
                    isLowStock ? styles.lowStockBadge : styles.normalStockBadge,
                  ]}
                >
                  <Text
                    style={[
                      styles.stockText,
                      typography.tabularNumeric,
                      isLowStock ? styles.lowStockText : styles.normalStockText,
                    ]}
                  >
                    {item.stock} unidades
                  </Text>
                </View>
                {isLowStock && <Text style={styles.alertText}>Alerta Stock Bajo</Text>}
              </View>
            </View>
          );
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.dark.surfaceBase,
    padding: spacing.lg,
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.lg,
    gap: spacing.md,
  },
  title: {
    fontSize: typography.sizes.titleLg,
    fontWeight: typography.weights.bold,
    color: colors.dark.textPrimary,
  },
  searchInput: {
    flex: 1,
    maxWidth: 420,
    height: spacing.touchTargetMin,
    backgroundColor: colors.dark.surfaceContainerHigh,
    borderRadius: spacing.radiusMd,
    paddingHorizontal: spacing.md,
    color: colors.dark.textPrimary,
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.dark.surfaceContainerLow,
    borderRadius: spacing.radiusLg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  colInfo: {
    flex: 3,
  },
  productName: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.semibold,
    color: colors.dark.textPrimary,
  },
  metaText: {
    fontSize: typography.sizes.caption,
    color: colors.dark.textSecondary,
    marginTop: 2,
  },
  colPrice: {
    flex: 2,
    alignItems: "flex-end",
    paddingRight: spacing.lg,
  },
  priceText: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    color: colors.dark.textPrimary,
  },
  costText: {
    fontSize: typography.sizes.caption,
    color: colors.dark.textSecondary,
  },
  colStock: {
    flex: 2,
    alignItems: "flex-end",
  },
  stockBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: spacing.radiusFull,
  },
  normalStockBadge: {
    backgroundColor: colors.dark.surfaceContainer,
  },
  lowStockBadge: {
    backgroundColor: "rgba(245, 158, 11, 0.15)",
  },
  stockText: {
    fontSize: typography.sizes.subText,
    fontWeight: typography.weights.bold,
  },
  normalStockText: {
    color: colors.dark.textPrimary,
  },
  lowStockText: {
    color: colors.dark.warning,
  },
  alertText: {
    fontSize: typography.sizes.caption,
    color: colors.dark.warning,
    marginTop: 2,
  },
});

