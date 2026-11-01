import React, { useState, useEffect } from "react";
import {
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";
import { typography } from "../theme/typography";
import { ButtonHero } from "../components/ButtonHero";
import { TouchStepper } from "../components/TouchStepper";
import {
  formatUsd,
  formatVes,
  convertUsdToVes,
  toDecimal,
  formatFixed4,
} from "../utils/decimal";
import type { SqlDriver } from "../database/connection";
import { getCatalogWithBimonetaryPrices } from "../services/catalog.service";
import { registerManualRate } from "../services/bcv-exchange.service";

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

export interface PosScreenProps {
  db?: SqlDriver;
  initialExchangeRate?: string;
  initialProducts?: PosProductItem[];
  onRateChange?: (newRate: string) => void;
}

const DEFAULT_PRODUCTS: PosProductItem[] = [
  { id: "1", sku: "HAR-01", name: "Harina PAN 1kg", priceUsd: "1.2500", category: "Víveres" },
  { id: "2", sku: "ARR-02", name: "Arroz Primor 1kg", priceUsd: "1.5000", category: "Granos" },
  { id: "3", sku: "ACE-03", name: "Aceite Mazeite 1L", priceUsd: "3.8000", category: "Aceites" },
  { id: "4", sku: "CAF-04", name: "Café Fama de América 500g", priceUsd: "4.2000", category: "Bebidas" },
  { id: "5", sku: "PAS-05", name: "Pasta Primor Corta 1kg", priceUsd: "1.7500", category: "Víveres" },
  { id: "6", sku: "AZU-06", name: "Azúcar Montalbán 1kg", priceUsd: "1.3500", category: "Víveres" },
];

export const PosScreen: React.FC<PosScreenProps> = ({
  db,
  initialExchangeRate = "36.5000",
  initialProducts,
  onRateChange,
}) => {
  const [exchangeRate, setExchangeRate] = useState<string>(initialExchangeRate);
  const [catalog, setCatalog] = useState<PosProductItem[]>(initialProducts ?? DEFAULT_PRODUCTS);
  const [ticketItems, setTicketItems] = useState<PosTicketItem[]>([]);

  // Estado del modal de actualización de tasa
  const [isRateModalOpen, setIsRateModalOpen] = useState(false);
  const [newRateInput, setNewRateInput] = useState("");
  const [rateReasonInput, setRateReasonInput] = useState("");
  const [rateError, setRateError] = useState<string | null>(null);

  // Carga reactiva de catálogo y tasa desde SQLite si el driver está presente
  useEffect(() => {
    if (db) {
      const result = getCatalogWithBimonetaryPrices(db, initialExchangeRate);
      if (result.products.length > 0) {
        setCatalog(
          result.products.map((p) => ({
            id: p.id,
            sku: p.sku,
            name: p.name,
            priceUsd: p.priceUsd,
          })),
        );
      }
      setExchangeRate(result.activeRate);
    }
  }, [db, initialExchangeRate]);

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

  const handleApplyRate = () => {
    try {
      setRateError(null);
      const parsed = toDecimal(newRateInput, "Tasa");
      if (parsed.lte(0)) throw new Error("La tasa debe ser mayor a cero");
      const formatted = parsed.toFixed(4);

      if (db) {
        const todayIso = new Date().toISOString().split("T")[0]!;
        registerManualRate(db, {
          rateDate: todayIso,
          rate: formatted,
          reason: rateReasonInput.trim() || "Ajuste operativo en pantalla de caja",
        });
      }

      setExchangeRate(formatted);
      onRateChange?.(formatted);
      setIsRateModalOpen(false);
      setNewRateInput("");
      setRateReasonInput("");
    } catch (err) {
      setRateError((err as Error).message);
    }
  };

  // Cálculo reactivo en vivo de totales
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

          {/* Botón táctil para ver/ajustar la tasa de cambio reactiva */}
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => {
              setNewRateInput(exchangeRate);
              setRateReasonInput("");
              setRateError(null);
              setIsRateModalOpen(true);
            }}
            style={styles.ratePill}
          >
            <Text style={styles.ratePillLabel}>Tasa Oficial:</Text>
            <Text style={[styles.ratePillValue, typography.tabularNumeric]}>
              {formatVes(exchangeRate)}
            </Text>
            <Text style={styles.ratePillEdit}>✎</Text>
          </TouchableOpacity>
        </View>

        <FlatList
          data={catalog}
          keyExtractor={(item) => item.id}
          numColumns={2}
          contentContainerStyle={styles.catalogGrid}
          renderItem={({ item }) => {
            // Conversión instantánea reactiva: nunca altera item.priceUsd
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
              renderItem={({ item }) => {
                const lineVes = convertUsdToVes(item.lineTotalUsd, exchangeRate).toFixed(4);
                return (
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
                        <Text style={[styles.ticketLineTotalVes, typography.tabularNumeric]}>
                          {formatVes(lineVes)}
                        </Text>
                      </View>
                    </View>
            );
          }}
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
                    // PR-07: Emisión de facturas con inmutabilidad cambiaria
                  }}
                />
              </View>
            </View>

      {/* Modal Táctil de Actualización de Tasa */}
      <Modal visible={isRateModalOpen} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Actualizar Tasa BCV / Moneda</Text>
              <Text style={styles.modalNotice}>
                Al modificar la tasa, todos los precios mostrados en Bolívares (VES) se
                recalcularán reactivamente al instante sin alterar los precios base en USD.
              </Text>

              {rateError ? <Text style={styles.errorText}>{rateError}</Text> : null}

              <View style={styles.modalInputGroup}>
                <Text style={styles.inputLabel}>Nueva Tasa a VES (ej. 42.5000):</Text>
                <TextInput
                  style={[styles.modalInput, typography.tabularNumeric]}
                  keyboardType="decimal-pad"
                  placeholder="0.0000"
                  placeholderTextColor={colors.dark.textMuted}
                  value={newRateInput}
                  onChangeText={setNewRateInput}
                />
              </View>

              <View style={styles.modalInputGroup}>
                <Text style={styles.inputLabel}>Motivo del cambio (Auditoría obligatoria):</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="Ej. Actualización vespertina oficial BCV"
                  placeholderTextColor={colors.dark.textMuted}
                  value={rateReasonInput}
                  onChangeText={setRateReasonInput}
                />
              </View>

              <View style={styles.modalActions}>
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => setIsRateModalOpen(false)}
                  style={styles.cancelBtn}
                >
                  <Text style={styles.cancelBtnText}>Cancelar</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={handleApplyRate}
                  style={styles.applyBtn}
                >
                  <Text style={styles.applyBtnText}>APLICAR TASA</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
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
      ratePill: {
        flexDirection: "row",
      alignItems: "center",
      height: spacing.touchTargetMin, // 48px mínimo táctil
      backgroundColor: colors.dark.surfaceContainerLow,
      paddingHorizontal: spacing.md,
      borderRadius: spacing.radiusFull,
      borderWidth: 1,
      borderColor: colors.dark.primaryGlow,
      gap: spacing.xs,
  },
      ratePillLabel: {
        fontSize: typography.sizes.caption,
      color: colors.dark.textSecondary,
      fontWeight: typography.weights.medium,
  },
      ratePillValue: {
        fontSize: typography.sizes.subText,
      fontWeight: typography.weights.bold,
      color: colors.dark.primaryGlow,
  },
      ratePillEdit: {
        fontSize: typography.sizes.caption,
      color: colors.dark.primaryGlow,
      marginLeft: 4,
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
      ticketLineTotalVes: {
        fontSize: typography.sizes.caption,
      color: colors.dark.textSecondary,
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
      modalOverlay: {
        flex: 1,
      backgroundColor: colors.dark.surfaceDim,
      justifyContent: "center",
      alignItems: "center",
      padding: spacing.xl,
  },
      modalCard: {
        width: "100%",
      maxWidth: 520,
      backgroundColor: colors.dark.surfaceContainerLow,
      borderRadius: spacing.radiusXl,
      padding: spacing.xl,
      borderWidth: 1,
      borderColor: colors.dark.border,
  },
      modalTitle: {
        fontSize: typography.sizes.titleLg,
      fontWeight: typography.weights.bold,
      color: colors.dark.textPrimary,
      marginBottom: spacing.xs,
  },
      modalNotice: {
        fontSize: typography.sizes.caption,
      color: colors.dark.textSecondary,
      marginBottom: spacing.md,
  },
      errorText: {
        fontSize: typography.sizes.caption,
      color: colors.dark.error,
      fontWeight: typography.weights.bold,
      marginBottom: spacing.sm,
  },
      modalInputGroup: {
        marginBottom: spacing.md,
  },
      inputLabel: {
        fontSize: typography.sizes.caption,
      color: colors.dark.textSecondary,
      marginBottom: spacing.xs,
  },
      modalInput: {
        height: spacing.touchTargetMin, // 48px
      backgroundColor: colors.dark.surfaceContainerHigh,
      borderRadius: spacing.radiusMd,
      paddingHorizontal: spacing.md,
      color: colors.dark.textPrimary,
      fontSize: typography.sizes.body,
      borderWidth: 1,
      borderColor: colors.dark.border,
  },
      modalActions: {
        flexDirection: "row",
      justifyContent: "flex-end",
      gap: spacing.md,
      marginTop: spacing.md,
  },
      cancelBtn: {
        height: spacing.touchTargetMin,
      paddingHorizontal: spacing.lg,
      justifyContent: "center",
      alignItems: "center",
      borderRadius: spacing.radiusMd,
  },
      cancelBtnText: {
        fontSize: typography.sizes.body,
      color: colors.dark.textSecondary,
  },
      applyBtn: {
        height: spacing.touchTargetMin,
      backgroundColor: colors.dark.primary,
      paddingHorizontal: spacing.xl,
      justifyContent: "center",
      alignItems: "center",
      borderRadius: spacing.radiusMd,
  },
      applyBtnText: {
        fontSize: typography.sizes.body,
      fontWeight: typography.weights.bold,
      color: colors.dark.textPrimary,
  },
});
