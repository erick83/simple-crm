import React, { useState, useEffect, useCallback } from "react";
import {
  FlatList,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";
import { typography } from "../theme/typography";
import { formatUsd, formatVes, convertUsdToVes, formatFixed4, toDecimal } from "../utils/decimal";
import type { SqlDriver } from "../database/connection";
import {
  listInventoryWithStock,
  insertProduct,
  updateProduct,
  addStockMovement,
  getProductKardex,
} from "../database/repositories/product.repository";
import type {
  InventoryItemWithStock,
  StockMovementEntity,
} from "../database/repositories/product.repository";
import { getLatestRate } from "../database/repositories/exchange.repository";
import {
  createDefaultFileStore,
  resolveProductImageUri,
} from "../services/image-compressor.service";
import type { FileStore } from "../services/image-compressor.service";
import { useBarcodeScanner } from "../services/barcode-scanner.service";
import type { KeyEventTargetLike } from "../services/barcode-scanner.service";

export interface InventoryScreenProps {
  db?: SqlDriver;
  tenantId?: string;
  terminalId?: string;
  fileStore?: FileStore;
  keyEventTarget?: KeyEventTargetLike;
  onScanBarcode?: (barcode: string) => void;
  onProductSaved?: (productId: string) => void;
  onStockAdjusted?: (movementId: string) => void;
}

const DEFAULT_ITEMS: InventoryItemWithStock[] = [
  {
    id: "1",
    tenantId: "T01",
    sku: "HAR-01",
    barcode: "75910001",
    name: "Harina PAN 1kg",
    categoryId: null,
    categoryName: "Víveres",
    priceUsd: "1.2500",
    costUsd: "0.9500",
    taxRate: "0.1600",
    imagePath: null,
    minStock: "5.0000",
    currentStock: "24.0000",
    isLowStock: false,
    isActive: true,
    updatedAt: Date.now(),
  },
  {
    id: "2",
    tenantId: "T01",
    sku: "ARR-02",
    barcode: "75910002",
    name: "Arroz Primor 1kg",
    categoryId: null,
    categoryName: "Granos",
    priceUsd: "1.5000",
    costUsd: "1.1000",
    taxRate: "0.1600",
    imagePath: null,
    minStock: "5.0000",
    currentStock: "4.0000",
    isLowStock: true,
    isActive: true,
    updatedAt: Date.now(),
  },
  {
    id: "3",
    tenantId: "T01",
    sku: "ACE-03",
    barcode: "75910003",
    name: "Aceite Mazeite 1L",
    categoryId: null,
    categoryName: "Aceites",
    priceUsd: "3.8000",
    costUsd: "2.9000",
    taxRate: "0.1600",
    imagePath: null,
    minStock: "5.0000",
    currentStock: "12.0000",
    isLowStock: false,
    isActive: true,
    updatedAt: Date.now(),
  },
];

export const InventoryScreen: React.FC<InventoryScreenProps> = ({
  db,
  tenantId = "T01",
  terminalId = "C01",
  fileStore: customFileStore,
  keyEventTarget,
  onScanBarcode,
  onProductSaved,
  onStockAdjusted,
}) => {
  const [fileStore] = useState<FileStore>(() => customFileStore ?? createDefaultFileStore());
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<InventoryItemWithStock[]>(DEFAULT_ITEMS);
  const [exchangeRate, setExchangeRate] = useState<string>("36.5000");

  // Estado del Modal de Producto (Crear / Editar)
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formSku, setFormSku] = useState("");
  const [formBarcode, setFormBarcode] = useState("");
  const [formPriceUsd, setFormPriceUsd] = useState("");
  const [formCostUsd, setFormCostUsd] = useState("");
  const [formMinStock, setFormMinStock] = useState("5.0000");
  const [formImagePath, setFormImagePath] = useState<string | null>(null);
  const [productFormError, setProductFormError] = useState<string | null>(null);

  // Estado del Modal de Ajuste de Kardex
  const [isKardexModalOpen, setIsKardexModalOpen] = useState(false);
  const [kardexProduct, setKardexProduct] = useState<InventoryItemWithStock | null>(null);
  const [kardexDelta, setKardexDelta] = useState("");
  const [kardexType, setKardexType] = useState<"RESTOCK" | "ADJUSTMENT" | "RETURN">("RESTOCK");
  const [kardexReason, setKardexReason] = useState("");
  const [kardexHistory, setKardexHistory] = useState<StockMovementEntity[]>([]);
  const [kardexError, setKardexError] = useState<string | null>(null);

  // Carga reactiva de inventario y tasa desde SQLite
  const reloadData = useCallback(() => {
    if (db) {
      const list = listInventoryWithStock(db, { search, tenantId });
      setItems(list);
      const rateRecord = getLatestRate(db);
      if (rateRecord) {
        setExchangeRate(rateRecord.rateToVes);
      }
    }
  }, [db, search, tenantId]);

  useEffect(() => {
    reloadData();
  }, [reloadData]);

  // Listener para pistola/lector HID
  useBarcodeScanner({
    target: keyEventTarget,
    onScan: (scannedCode) => {
      if (isProductModalOpen) {
        setFormBarcode(scannedCode);
      } else {
        setSearch(scannedCode);
        onScanBarcode?.(scannedCode);
      }
    },
  });

  // Abrir modal para Crear Producto
  const handleOpenCreateProduct = () => {
    setEditingProductId(null);
    setFormName("");
    setFormSku("");
    setFormBarcode(search ? search.trim() : "");
    setFormPriceUsd("");
    setFormCostUsd("");
    setFormMinStock("5.0000");
    setFormImagePath(null);
    setProductFormError(null);
    setIsProductModalOpen(true);
  };

  // Abrir modal para Editar Producto
  const handleOpenEditProduct = (item: InventoryItemWithStock) => {
    setEditingProductId(item.id);
    setFormName(item.name);
    setFormSku(item.sku);
    setFormBarcode(item.barcode ?? "");
    setFormPriceUsd(item.priceUsd);
    setFormCostUsd(item.costUsd);
    setFormMinStock(item.minStock);
    setFormImagePath(item.imagePath);
    setProductFormError(null);
    setIsProductModalOpen(true);
  };

  // Guardar Producto (Crear o Actualizar)
  const handleSaveProduct = () => {
    try {
      setProductFormError(null);
      if (!formName.trim()) throw new Error("El nombre del producto es obligatorio");
      if (!formSku.trim()) throw new Error("El SKU es obligatorio");

      const priceDec = toDecimal(formPriceUsd || "0", "Precio");
      const costDec = toDecimal(formCostUsd || "0", "Costo");
      if (priceDec.isNegative() || costDec.isNegative()) {
        throw new Error("El precio y el costo no pueden ser negativos");
      }

      if (db) {
        let savedId = editingProductId;
        if (!editingProductId) {
          savedId = insertProduct(
            db,
            {
              tenantId,
              name: formName.trim(),
              sku: formSku.trim(),
              barcode: formBarcode.trim() || undefined,
              priceUsd: priceDec.toFixed(4),
              costUsd: costDec.toFixed(4),
              minStock: toDecimal(formMinStock || "5", "Stock Mínimo").toFixed(4),
            },
            Date.now(),
            terminalId,
          );
        } else {
          updateProduct(
            db,
            {
              id: editingProductId,
              name: formName.trim(),
              sku: formSku.trim(),
              barcode: formBarcode.trim() || null,
              priceUsd: priceDec.toFixed(4),
              costUsd: costDec.toFixed(4),
              minStock: toDecimal(formMinStock || "5", "Stock Mínimo").toFixed(4),
              imagePath: formImagePath,
              terminalId,
            },
            Date.now(),
          );
        }
        reloadData();
        if (savedId) onProductSaved?.(savedId);
      }
      setIsProductModalOpen(false);
    } catch (err) {
      setProductFormError((err as Error).message);
    }
  };

  // Abrir modal de Kardex
  const handleOpenKardex = (item: InventoryItemWithStock) => {
    setKardexProduct(item);
    setKardexDelta("");
    setKardexType("RESTOCK");
    setKardexReason("");
    setKardexError(null);
    if (db) {
      const history = getProductKardex(db, item.id, 5);
      setKardexHistory(history);
    }
    setIsKardexModalOpen(true);
  };

  // Guardar movimiento de Kardex
  const handleSaveKardex = () => {
    try {
      setKardexError(null);
      if (!kardexProduct) return;
      const parsedDelta = toDecimal(kardexDelta, "Cantidad");
      if (parsedDelta.isZero()) {
        throw new Error("La cantidad debe ser distinta de cero");
      }

      // Si es devolución o reabastecimiento positivo, nos aseguramos del signo
      let finalDelta = parsedDelta;
      if (kardexType === "RESTOCK" || kardexType === "RETURN") {
        if (finalDelta.isNegative()) finalDelta = finalDelta.abs();
      }

      if (db) {
        const movId = addStockMovement(
          db,
          {
            productId: kardexProduct.id,
            terminalId,
            delta: finalDelta.toFixed(4),
            type: kardexType,
            referenceId: kardexReason.trim() || undefined,
          },
          Date.now(),
        );
        reloadData();
        onStockAdjusted?.(movId);
      }
      setIsKardexModalOpen(false);
    } catch (err) {
      setKardexError((err as Error).message);
    }
  };

  return (
    <View style={styles.container}>
      {/* Barra Superior con Buscador y Botón de Nuevo Producto */}
      <View style={styles.topBar}>
        <View style={styles.titleContainer}>
          <Text style={styles.title}>Control de Inventario y Kardex</Text>
          <Text style={styles.subtitle}>
            Stock computado por deltas conmutativos • Tasa: {formatVes(exchangeRate)}
          </Text>
        </View>

        <TextInput
          style={styles.searchInput}
          placeholder="Buscar por Nombre, SKU o Código de Barras (HID)..."
          placeholderTextColor={colors.dark.textMuted}
          value={search}
          onChangeText={setSearch}
        />

        <TouchableOpacity
          activeOpacity={0.8}
          onPress={handleOpenCreateProduct}
          style={styles.newProductBtn}
        >
          <Text style={styles.newProductBtnText}>+ NUEVO PRODUCTO</Text>
        </TouchableOpacity>
      </View>

      {/* Listado de Productos con Stock Actual */}
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const priceVes = convertUsdToVes(item.priceUsd, exchangeRate).toFixed(4);
          const imageUri = resolveProductImageUri(fileStore, item.imagePath);

          return (
            <View style={styles.row}>
              {/* Miniatura de Imagen Local */}
              <View style={styles.imageCol}>
                {imageUri ? (
                  <Image source={{ uri: imageUri }} style={styles.thumbnail} />
                ) : (
                  <View style={styles.thumbnailPlaceholder}>
                    <Text style={styles.thumbnailPlaceholderText}>📦</Text>
                  </View>
                )}
              </View>

              {/* Información del Producto */}
              <View style={styles.colInfo}>
                <Text style={styles.productName}>{item.name}</Text>
                <Text style={styles.metaText}>
                  SKU: <Text style={styles.metaHighlight}>{item.sku}</Text>
                  {item.barcode ? ` | Barcode: ${item.barcode}` : " | Sin código"}
                  {item.categoryName ? ` | Cat: ${item.categoryName}` : ""}
                </Text>
              </View>

              {/* Precios Bimoneda */}
              <View style={styles.colPrice}>
                <Text style={[styles.priceText, typography.tabularNumeric]}>
                  {formatUsd(item.priceUsd)}
                </Text>
                <Text style={[styles.priceVesText, typography.tabularNumeric]}>
                  ≈ {formatVes(priceVes)}
                </Text>
                <Text style={styles.costText}>Costo: {formatUsd(item.costUsd)}</Text>
              </View>

              {/* Stock Actual y Badge */}
              <View style={styles.colStock}>
                <View
                  style={[
                    styles.stockBadge,
                    item.isLowStock ? styles.lowStockBadge : styles.normalStockBadge,
                  ]}
                >
                  <Text
                    style={[
                      styles.stockText,
                      typography.tabularNumeric,
                      item.isLowStock ? styles.lowStockText : styles.normalStockText,
                    ]}
                  >
                    {item.currentStock} unds
                  </Text>
                </View>
                {item.isLowStock && <Text style={styles.alertText}>Alerta Stock Bajo</Text>}
              </View>

              {/* Acciones Táctiles (>= 48px) */}
              <View style={styles.colActions}>
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => handleOpenKardex(item)}
                  style={styles.kardexBtn}
                >
                  <Text style={styles.kardexBtnText}>Ajustar Stock</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => handleOpenEditProduct(item)}
                  style={styles.editBtn}
                >
                  <Text style={styles.editBtnText}>✎ Editar</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No se encontraron productos en el inventario</Text>
            <Text style={styles.emptySubText}>
              Presione "+ NUEVO PRODUCTO" o escanee un código de barras para darlo de alta
            </Text>
          </View>
        }
      />

      {/* Modal 1: Crear / Editar Producto */}
      <Modal visible={isProductModalOpen} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {editingProductId ? "Editar Producto" : "Nuevo Producto en Inventario"}
            </Text>
            <Text style={styles.modalSubtitle}>
              Soporta captura directa con pistola/lector HID y almacenamiento de foto local
            </Text>

            {productFormError && <Text style={styles.errorText}>{productFormError}</Text>}

            <ScrollView style={styles.formScroll}>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Descripción / Nombre del Producto *</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="Ej. Harina PAN 1kg"
                  placeholderTextColor={colors.dark.textMuted}
                  value={formName}
                  onChangeText={setFormName}
                />
              </View>

              <View style={styles.rowInputs}>
                <View style={[styles.inputGroup, { flex: 1 }]}>
                  <Text style={styles.inputLabel}>SKU (Código Interno) *</Text>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="HAR-01"
                    placeholderTextColor={colors.dark.textMuted}
                    value={formSku}
                    onChangeText={setFormSku}
                  />
                </View>

                <View style={[styles.inputGroup, { flex: 1 }]}>
                  <Text style={styles.inputLabel}>Código de Barras (Lector HID)</Text>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="Escanee con el lector..."
                    placeholderTextColor={colors.dark.textMuted}
                    value={formBarcode}
                    onChangeText={setFormBarcode}
                  />
                </View>
              </View>

              <View style={styles.rowInputs}>
                <View style={[styles.inputGroup, { flex: 1 }]}>
                  <Text style={styles.inputLabel}>Precio Base USD ($) *</Text>
                  <TextInput
                    style={[styles.modalInput, typography.tabularNumeric]}
                    placeholder="0.0000"
                    keyboardType="decimal-pad"
                    placeholderTextColor={colors.dark.textMuted}
                    value={formPriceUsd}
                    onChangeText={setFormPriceUsd}
                  />
                </View>

                <View style={[styles.inputGroup, { flex: 1 }]}>
                  <Text style={styles.inputLabel}>Costo Reposición USD ($) *</Text>
                  <TextInput
                    style={[styles.modalInput, typography.tabularNumeric]}
                    placeholder="0.0000"
                    keyboardType="decimal-pad"
                    placeholderTextColor={colors.dark.textMuted}
                    value={formCostUsd}
                    onChangeText={setFormCostUsd}
                  />
                </View>

                <View style={[styles.inputGroup, { flex: 1 }]}>
                  <Text style={styles.inputLabel}>Stock Mínimo (Alerta)</Text>
                  <TextInput
                    style={[styles.modalInput, typography.tabularNumeric]}
                    placeholder="5.0000"
                    keyboardType="decimal-pad"
                    placeholderTextColor={colors.dark.textMuted}
                    value={formMinStock}
                    onChangeText={setFormMinStock}
                  />
                </View>
              </View>
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => setIsProductModalOpen(false)}
                style={styles.cancelBtn}
              >
                <Text style={styles.cancelBtnText}>Cancelar</Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.8}
                onPress={handleSaveProduct}
                style={styles.saveBtn}
              >
                <Text style={styles.saveBtnText}>GUARDAR PRODUCTO</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal 2: Ajuste de Kardex (Entradas / Ajustes de Inventario) */}
      <Modal visible={isKardexModalOpen} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Ajuste de Stock y Kardex</Text>
            {kardexProduct && (
              <Text style={styles.modalSubtitle}>
                {kardexProduct.name} (SKU: {kardexProduct.sku}) — Stock actual:{" "}
                <Text style={{ color: colors.dark.hero, fontWeight: "bold" }}>
                  {kardexProduct.currentStock} unds
                </Text>
              </Text>
            )}

            {kardexError && <Text style={styles.errorText}>{kardexError}</Text>}

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Tipo de Movimiento:</Text>
              <View style={styles.movementTypeRow}>
                {(["RESTOCK", "ADJUSTMENT", "RETURN"] as const).map((type) => {
                  const isSelected = kardexType === type;
                  const label =
                    type === "RESTOCK"
                      ? "Entrada (Reabastecer)"
                      : type === "ADJUSTMENT"
                        ? "Ajuste Directo"
                        : "Devolución";
                  return (
                    <TouchableOpacity
                      key={type}
                      activeOpacity={0.8}
                      onPress={() => setKardexType(type)}
                      style={[styles.typeBtn, isSelected && styles.typeBtnActive]}
                    >
                      <Text style={[styles.typeBtnText, isSelected && styles.typeBtnTextActive]}>
                        {label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View style={styles.rowInputs}>
              <View style={[styles.inputGroup, { flex: 1 }]}>
                <Text style={styles.inputLabel}>Cantidad Delta (ej. 10.0000 o -2.0000):</Text>
                <TextInput
                  style={[styles.modalInput, typography.tabularNumeric]}
                  placeholder="0.0000"
                  keyboardType="decimal-pad"
                  placeholderTextColor={colors.dark.textMuted}
                  value={kardexDelta}
                  onChangeText={setKardexDelta}
                />
              </View>

              <View style={[styles.inputGroup, { flex: 2 }]}>
                <Text style={styles.inputLabel}>Motivo / Referencia (Opcional):</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="Ej. Factura proveedor #1234"
                  placeholderTextColor={colors.dark.textMuted}
                  value={kardexReason}
                  onChangeText={setKardexReason}
                />
              </View>
            </View>

            {/* Historial Reciente de Kardex */}
            {kardexHistory.length > 0 && (
              <View style={styles.historyBox}>
                <Text style={styles.historyTitle}>Últimos Movimientos:</Text>
                {kardexHistory.map((mov) => (
                  <View key={mov.id} style={styles.historyRow}>
                    <Text style={styles.historyType}>{mov.movementType}</Text>
                    <Text
                      style={[
                        styles.historyDelta,
                        typography.tabularNumeric,
                        mov.quantityDelta.startsWith("-")
                          ? styles.historyNegative
                          : styles.historyPositive,
                      ]}
                    >
                      {mov.quantityDelta} unds
                    </Text>
                  </View>
                ))}
              </View>
            )}

            <View style={styles.modalActions}>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => setIsKardexModalOpen(false)}
                style={styles.cancelBtn}
              >
                <Text style={styles.cancelBtnText}>Cancelar</Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.8}
                onPress={handleSaveKardex}
                style={styles.saveBtn}
              >
                <Text style={styles.saveBtnText}>REGISTRAR EN KARDEX</Text>
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
    backgroundColor: colors.dark.surfaceBase,
    padding: spacing.lg,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.lg,
    gap: spacing.md,
  },
  titleContainer: {
    flex: 1,
  },
  title: {
    fontSize: typography.sizes.titleLg,
    fontWeight: typography.weights.bold,
    color: colors.dark.textPrimary,
  },
  subtitle: {
    fontSize: typography.sizes.caption,
    color: colors.dark.textSecondary,
    marginTop: 2,
  },
  searchInput: {
    flex: 2,
    maxWidth: 400,
    height: spacing.touchTargetMin, // 48px
    backgroundColor: colors.dark.surfaceContainerHigh,
    borderRadius: spacing.radiusMd,
    paddingHorizontal: spacing.md,
    color: colors.dark.textPrimary,
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  newProductBtn: {
    height: spacing.touchTargetMin, // 48px
    backgroundColor: colors.dark.primary, // #1D61E0
    borderRadius: spacing.radiusMd,
    paddingHorizontal: spacing.lg,
    justifyContent: "center",
    alignItems: "center",
  },
  newProductBtnText: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    color: colors.dark.textPrimary,
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
    gap: spacing.md,
  },
  imageCol: {
    width: 56,
    height: 56,
    borderRadius: spacing.radiusMd,
    overflow: "hidden",
    backgroundColor: colors.dark.surfaceContainer,
  },
  thumbnail: {
    width: "100%",
    height: "100%",
    resizeMode: "cover",
  },
  thumbnailPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  thumbnailPlaceholderText: {
    fontSize: 24,
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
  metaHighlight: {
    color: colors.dark.primaryGlow,
    fontWeight: typography.weights.bold,
  },
  colPrice: {
    flex: 2,
    alignItems: "flex-end",
  },
  priceText: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    color: colors.dark.textPrimary,
  },
  priceVesText: {
    fontSize: typography.sizes.caption,
    color: colors.dark.primaryGlow,
    fontWeight: typography.weights.semibold,
  },
  costText: {
    fontSize: typography.sizes.caption,
    color: colors.dark.textMuted,
    marginTop: 2,
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
  colActions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  kardexBtn: {
    height: spacing.touchTargetMin, // 48px
    backgroundColor: colors.dark.surfaceContainerHigh,
    paddingHorizontal: spacing.md,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  kardexBtnText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: colors.dark.textPrimary,
  },
  editBtn: {
    height: spacing.touchTargetMin, // 48px
    backgroundColor: colors.dark.surfaceContainer,
    paddingHorizontal: spacing.md,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  editBtnText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.semibold,
    color: colors.dark.textSecondary,
  },
  emptyContainer: {
    paddingVertical: 80,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    fontSize: typography.sizes.titleMd,
    color: colors.dark.textSecondary,
    fontWeight: typography.weights.semibold,
  },
  emptySubText: {
    fontSize: typography.sizes.caption,
    color: colors.dark.textMuted,
    marginTop: spacing.xs,
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
    maxWidth: 620,
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
  },
  modalSubtitle: {
    fontSize: typography.sizes.caption,
    color: colors.dark.textSecondary,
    marginBottom: spacing.md,
    marginTop: 2,
  },
  formScroll: {
    maxHeight: 400,
  },
  inputGroup: {
    marginBottom: spacing.md,
  },
  rowInputs: {
    flexDirection: "row",
    gap: spacing.md,
  },
  inputLabel: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: colors.dark.textSecondary,
    marginBottom: 4,
  },
  modalInput: {
    height: spacing.touchTargetMin, // 48px
    backgroundColor: colors.dark.surfaceContainerHigh,
    borderRadius: spacing.radiusMd,
    paddingHorizontal: spacing.md,
    color: colors.dark.textPrimary,
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  movementTypeRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  typeBtn: {
    flex: 1,
    height: spacing.touchTargetMin, // 48px
    backgroundColor: colors.dark.surfaceContainerHigh,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  typeBtnActive: {
    backgroundColor: colors.dark.primary,
    borderColor: colors.dark.primaryGlow,
  },
  typeBtnText: {
    fontSize: typography.sizes.caption,
    color: colors.dark.textSecondary,
    fontWeight: typography.weights.medium,
  },
  typeBtnTextActive: {
    color: colors.dark.textPrimary,
    fontWeight: typography.weights.bold,
  },
  historyBox: {
    backgroundColor: colors.dark.surfaceContainer,
    borderRadius: spacing.radiusMd,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: 4,
  },
  historyTitle: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: colors.dark.textSecondary,
    marginBottom: 4,
  },
  historyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  historyType: {
    fontSize: typography.sizes.caption,
    color: colors.dark.textPrimary,
  },
  historyDelta: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
  },
  historyPositive: {
    color: colors.dark.hero,
  },
  historyNegative: {
    color: colors.dark.error,
  },
  errorText: {
    fontSize: typography.sizes.caption,
    color: colors.dark.error,
    fontWeight: typography.weights.bold,
    marginBottom: spacing.sm,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.md,
    marginTop: spacing.md,
  },
  cancelBtn: {
    height: spacing.touchTargetMin, // 48px
    paddingHorizontal: spacing.lg,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  cancelBtnText: {
    fontSize: typography.sizes.body,
    color: colors.dark.textSecondary,
  },
  saveBtn: {
    height: spacing.touchTargetMin, // 48px
    backgroundColor: colors.dark.hero, // #00B074
    paddingHorizontal: spacing.xl,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
  },
  saveBtnText: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    color: colors.dark.textPrimary,
  },
});
