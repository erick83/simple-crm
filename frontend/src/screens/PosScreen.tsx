import React, { useState } from "react";
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";
import { typography } from "../theme/typography";
import { ButtonHero } from "../components/ButtonHero";
import { TouchStepper } from "../components/TouchStepper";
import { formatUsd, formatVes, convertUsdToVes, toDecimal, formatFixed4 } from "../utils/decimal";

export interface PosProductItem {
  id: string;
  sku: string;
  name: string;
  priceUsd: string;
  category?: string;
}

export interface PosTicketItem {
  productId: string;
  sku: string;
  name: string;
  unitPriceUsd: string;
  quantity: string;
  lineTotalUsd: string;
}

interface PosScreenProps {
  exchangeRate?: string; // Tasa activa del día a VES
}

export const PosScreen: React.FC<PosScreenProps> = ({
  exchangeRate = "36.5000",
}) => {
  const [catalog] = useState<PosProductItem[]>([
    { id: "1", sku: "HAR-01", name: "Harina PAN 1kg", priceUsd: "1.2500", category: "Víveres" },
    { id: "2", sku: "ARR-02", name: "Arroz Primor 1kg", priceUsd: "1.5000", category: "Granos" },
    { id: "3", sku: "ACE-03", name: "Aceite Mazeite 1L", priceUsd: "3.8000", category: "Aceites" },
    { id: "4", sku: "CAF-04", name: "Café Fama de América 500g", priceUsd: "4.2000", category: "Bebidas" },
    { id: "5", sku: "PAS-05", name: "Pasta Primor Corta 1kg", priceUsd: "1.7500", category: "Víveres" },
    { id: "6", sku: "AZU-06", name: "Azúcar Montalbán 1kg", priceUsd: "1.3500", category: "Víveres" },
  ]);

  const [ticketItems, setTicketItems] = useState<PosTicketItem[]>([]);

  const addToCart = (product: PosProductItem) => {
    setTicketItems((prev) => {
      const existing = prev.find((i) => i.productId === product.id);
      if (existing) {
        const nextQty = toDecimal(existing.quantity).plus(1).toFixed(4);
        const nextTotal = toDecimal(nextQty).times(toDecimal(product.priceUsd)).toFixed(4);
        return prev.map((i) =>
          i.productId === product.id
            ? { ...i, quantity: nextQty, lineTotalUsd: nextTotal }
            : i,
        );
      }
      return [
        ...prev,
        {
          productId: product.id,
          sku: product.sku,
          name: product.name,
          unitPriceUsd: product.priceUsd,
          quantity: "1.0000",
          lineTotalUsd: product.priceUsd,
        },
      ];
    });
  };

  const updateQuantity = (productId: string, delta: number) => {
    setTicketItems((prev) => {
      return prev
        .map((item) => {
          if (item.productId !== productId) return item;
          const currentQty = toDecimal(item.quantity);
          const nextQty = currentQty.plus(delta);
          if (nextQty.lte(0)) return null;
          const qtyStr = nextQty.toFixed(4);
          const nextTotal = nextQty.times(toDecimal(item.unitPriceUsd)).toFixed(4);
          return { ...item, quantity: qtyStr, lineTotalUsd: nextTotal };
        })
        .filter((i): i is PosTicketItem => i !== null);
    });
  };

  const totalUsd = ticketItems
    .reduce((acc, item) => acc.plus(toDecimal(item.lineTotalUsd)), toDecimal("0"))
    .toFixed(4);

  const totalVes = convertUsdToVes(totalUsd, exchangeRate).toFixed(4);

  return (
    <View style={styles.container}>
      {/* Columna Izquierda: Catálogo de Productos */}
      <View style={styles.catalogColumn}>
        <View style={styles.catalogHeader}>
          <Text style={styles.sectionTitle}>Catálogo de Productos</Text>
          <Text style={styles.rateNotice}>
            Tasa activa: <Text style={typography.tabularNumeric}>{formatVes(exchangeRate)}</Text>
          </Text>
        </View>

        <FlatList
          data={catalog}
          keyExtractor={(item) => item.id}
          numColumns={2}
          contentContainerStyle={styles.catalogGrid}
          renderItem={({ item }) => {
            const priceVes = convertUsdToVes(item.priceUsd, exchangeRate).toFixed(4);
            return (
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => addToCart(item)}
                style={styles.productCard}
              >
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{item.sku}</Text>
                </View>
                <Text style={styles.productName} numberOfLines={2}>
                  {item.name}
                </Text>
                <View style={styles.priceRow}>
                  <Text style={[styles.priceUsd, typography.tabularNumeric]}>
                    {formatUsd(item.priceUsd)}
                  </Text>
                  <Text style={[styles.priceVes, typography.tabularNumeric]}>
                    {formatVes(priceVes)}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      </View>

      {/* Columna Derecha: Ticket Activo de Venta */}
      <View style={styles.ticketColumn}>
        <View style={styles.ticketHeader}>
          <Text style={styles.sectionTitle}>Ticket Actual</Text>
          <Text style={styles.itemCountText}>
            {ticketItems.length} {ticketItems.length === 1 ? "ítem" : "ítems"}
          </Text>
        </View>

        <FlatList
          data={ticketItems}
          keyExtractor={(item) => item.productId}
          style={styles.ticketList}
          renderItem={({ item }) => (
            <View style={styles.ticketLine}>
              <View style={styles.ticketLineInfo}>
                <Text style={styles.ticketLineName} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={[styles.ticketLineUnit, typography.tabularNumeric]}>
                  {formatUsd(item.unitPriceUsd)} c/u
                </Text>
              </View>

              <TouchStepper
                value={toDecimal(item.quantity).toFixed(0)}
                onIncrement={() => updateQuantity(item.productId, 1)}
                onDecrement={() => updateQuantity(item.productId, -1)}
              />

              <View style={styles.ticketLineTotalContainer}>
                <Text style={[styles.ticketLineTotal, typography.tabularNumeric]}>
                  {formatUsd(item.lineTotalUsd)}
                </Text>
              </View>
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No hay productos en el ticket</Text>
              <Text style={styles.emptySubText}>
                Escanee con la pistola HID o seleccione del catálogo
              </Text>
            </View>
          }
        />

        {/* Botón Maestro de Cobro */}
        <View style={styles.checkoutFooter}>
          <ButtonHero
            label="COBRAR TICKET"
            totalFormatted={formatUsd(totalUsd)}
            secondaryFormatted={`≈ ${formatVes(totalVes)}`}
            disabled={ticketItems.length === 0}
            onPress={() => {
              // PR-07: Integración con persistencia de invoices y kardex delta
            }}
          />
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: colors.dark.surfaceBase,
  },
  catalogColumn: {
    flex: 3,
    padding: spacing.md,
    borderRightWidth: 1,
    borderRightColor: colors.dark.border,
  },
  catalogHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontSize: typography.sizes.titleMd,
    fontWeight: typography.weights.bold,
    color: colors.dark.textPrimary,
  },
  rateNotice: {
    fontSize: typography.sizes.subText,
    color: colors.dark.textSecondary,
  },
  catalogGrid: {
    gap: spacing.md,
  },
  productCard: {
    flex: 1,
    margin: spacing.xs,
    minHeight: 120,
    backgroundColor: colors.dark.surfaceContainer,
    borderRadius: spacing.radiusLg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.dark.border,
    justifyContent: "space-between",
  },
  badge: {
    alignSelf: "flex-start",
    backgroundColor: colors.dark.surfaceContainerHighest,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: spacing.radiusSm,
  },
  badgeText: {
    fontSize: typography.sizes.caption,
    color: colors.dark.primaryGlow,
    fontWeight: typography.weights.bold,
  },
  productName: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.semibold,
    color: colors.dark.textPrimary,
    marginVertical: spacing.xs,
  },
  priceRow: {
    marginTop: spacing.xs,
  },
  priceUsd: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    color: colors.dark.textPrimary,
  },
  priceVes: {
    fontSize: typography.sizes.caption,
    color: colors.dark.textSecondary,
  },
  ticketColumn: {
    flex: 2,
    backgroundColor: colors.dark.surfaceContainerLow,
    display: "flex",
    flexDirection: "column",
  },
  ticketHeader: {
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.dark.border,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  itemCountText: {
    fontSize: typography.sizes.subText,
    color: colors.dark.textSecondary,
    fontWeight: typography.weights.medium,
  },
  ticketList: {
    flex: 1,
    padding: spacing.md,
  },
  ticketLine: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.dark.border,
    gap: spacing.sm,
  },
  ticketLineInfo: {
    flex: 1,
  },
  ticketLineName: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.semibold,
    color: colors.dark.textPrimary,
  },
  ticketLineUnit: {
    fontSize: typography.sizes.caption,
    color: colors.dark.textSecondary,
  },
  ticketLineTotalContainer: {
    minWidth: 80,
    alignItems: "flex-end",
  },
  ticketLineTotal: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    color: colors.dark.textPrimary,
  },
  emptyContainer: {
    flex: 1,
    paddingVertical: 60,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    fontSize: typography.sizes.titleMd,
    color: colors.dark.textSecondary,
    fontWeight: typography.weights.medium,
  },
  emptySubText: {
    fontSize: typography.sizes.caption,
    color: colors.dark.textMuted,
    marginTop: spacing.xs,
  },
  checkoutFooter: {
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.dark.border,
    backgroundColor: colors.dark.surfaceContainerLow,
  },
});

