import React, { useState, useEffect, useCallback, useMemo } from "react";
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
import { getOrCreateDefaultSqlDriver } from "../database/connection";
import type { SqlDriver } from "../database/connection";
import {
  listInventoryWithStock,
  insertProduct,
  updateProduct,
  addStockMovement,
  getProductKardex,
  listCategories,
  createCategory,
  deleteCategory,
  deleteProduct,
} from "../database/repositories/product.repository";
import type {
  InventoryItemWithStock,
  StockMovementEntity,
  CategoryEntity,
} from "../database/repositories/product.repository";
import { getLatestRate } from "../database/repositories/exchange.repository";
import {
  createDefaultFileStore,
  createDefaultImageEncoder,
  resolveProductImageUri,
  setProductImage,
  removeProductImage,
  uint8ToBase64,
} from "../services/image-compressor.service";
import type { FileStore, ImageEncoder } from "../services/image-compressor.service";
import { useBarcodeScanner } from "../services/barcode-scanner.service";
import type { KeyEventTargetLike } from "../services/barcode-scanner.service";

export interface InventoryScreenProps {
  db?: SqlDriver;
  tenantId?: string;
  terminalId?: string;
  fileStore?: FileStore;
  imageEncoder?: ImageEncoder;
  keyEventTarget?: KeyEventTargetLike;
  onPickImage?: () => Promise<Uint8Array | null>;
  onScanBarcode?: (barcode: string) => void;
  onProductSaved?: (productId: string) => void;
  onStockAdjusted?: (movementId: string) => void;
  onProductDeleted?: (productId: string) => void;
  onCategoryDeleted?: (categoryId: string) => void;
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

export type InventorySortBy =
  | "NAME_ASC"
  | "STOCK_ASC"
  | "STOCK_DESC"
  | "PRICE_ASC"
  | "PRICE_DESC"
  | "RECENT";

export type StockFilterMode = "ALL" | "LOW_STOCK" | "OUT_OF_STOCK";

export type DeleteTargetState =
  | { kind: "PRODUCT"; product: InventoryItemWithStock }
  | { kind: "CATEGORY"; category: CategoryEntity; affectedCount: number };

export const InventoryScreen: React.FC<InventoryScreenProps> = ({
  db: propDb,
  tenantId = "TENANT-001",
  terminalId = "TERM-01",
  fileStore: customFileStore,
  imageEncoder: customImageEncoder,
  keyEventTarget,
  onPickImage,
  onScanBarcode,
  onProductSaved,
  onStockAdjusted,
  onProductDeleted,
  onCategoryDeleted,
}) => {
  const db = propDb ?? getOrCreateDefaultSqlDriver({ tenantId, terminalId });
  const [fileStore] = useState<FileStore>(() => customFileStore ?? createDefaultFileStore());
  const [imageEncoder] = useState<ImageEncoder>(
    () => customImageEncoder ?? createDefaultImageEncoder(),
  );
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<InventoryItemWithStock[]>(DEFAULT_ITEMS);
  const [categories, setCategories] = useState<CategoryEntity[]>([]);
  const [exchangeRate, setExchangeRate] = useState<string>("36.5000");

  // Estados de Organización (Categoría, Filtro de Stock y Ordenamiento)
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [stockFilter, setStockFilter] = useState<StockFilterMode>("ALL");
  const [sortBy, setSortBy] = useState<InventorySortBy>("NAME_ASC");
  const [isCreatingCategoryInline, setIsCreatingCategoryInline] = useState(false);
  const [inlineCategoryName, setInlineCategoryName] = useState("");

  // Estado del Modal de Eliminación Segura (con validación "BORRAR")
  const [deleteTarget, setDeleteTarget] = useState<DeleteTargetState | null>(null);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState("");
  const [clearStockOnDelete, setClearStockOnDelete] = useState(true);
  const [ackImpactCheckbox, setAckImpactCheckbox] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Estado del Modal de Producto (Crear / Editar)
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formSku, setFormSku] = useState("");
  const [formBarcode, setFormBarcode] = useState("");
  const [formCategoryId, setFormCategoryId] = useState<string | null>(null);
  const [newModalCategoryName, setNewModalCategoryName] = useState("");
  const [formPriceUsd, setFormPriceUsd] = useState("");
  const [formCostUsd, setFormCostUsd] = useState("");
  const [formMinStock, setFormMinStock] = useState("5.0000");
  const [formInitialStock, setFormInitialStock] = useState("0.0000");
  const [formImagePath, setFormImagePath] = useState<string | null>(null);
  const [pendingImageBytes, setPendingImageBytes] = useState<Uint8Array | null>(null);
  const [removeExistingImage, setRemoveExistingImage] = useState(false);
  const [productFormError, setProductFormError] = useState<string | null>(null);

  // Estado del Modal de Ajuste de Kardex
  const [isKardexModalOpen, setIsKardexModalOpen] = useState(false);
  const [kardexProduct, setKardexProduct] = useState<InventoryItemWithStock | null>(null);
  const [kardexDelta, setKardexDelta] = useState("");
  const [kardexType, setKardexType] = useState<"RESTOCK" | "ADJUSTMENT" | "RETURN">("RESTOCK");
  const [kardexReason, setKardexReason] = useState("");
  const [kardexHistory, setKardexHistory] = useState<StockMovementEntity[]>([]);
  const [kardexError, setKardexError] = useState<string | null>(null);

  // Carga reactiva de inventario, categorías y tasa desde SQLite
  const reloadData = useCallback(() => {
    if (db) {
      const list = listInventoryWithStock(db, { search, tenantId });
      setItems(list);
      const cats = listCategories(db);
      setCategories(cats);
      const rateRecord = getLatestRate(db);
      if (rateRecord) {
        setExchangeRate(rateRecord.rateToVes);
      }
    }
  }, [db, search, tenantId]);

  useEffect(() => {
    reloadData();
  }, [reloadData]);

  // Crear nueva categoría rápidamente (desde la barra o el modal)
  const handleCreateQuickCategory = (rawName: string, selectInModal: boolean): string | null => {
    const clean = rawName.trim();
    if (!clean || !db) return null;
    const existing = categories.find((c) => c.name.toLowerCase() === clean.toLowerCase());
    if (existing) {
      if (selectInModal) setFormCategoryId(existing.id);
      else setSelectedCategory(existing.id);
      return existing.id;
    }
    const newId = createCategory(db, clean, Date.now());
    const updatedCats = listCategories(db);
    setCategories(updatedCats);
    if (selectInModal) {
      setFormCategoryId(newId);
      setNewModalCategoryName("");
    } else {
      setSelectedCategory(newId);
      setInlineCategoryName("");
      setIsCreatingCategoryInline(false);
    }
    return newId;
  };

  // Contadores por categoría y estado de stock sobre la lista activa
  const organizationCounts = useMemo(() => {
    const byCat: Record<string, number> = { ALL: items.length, UNCATEGORIZED: 0 };
    let lowStock = 0;
    let outOfStock = 0;

    for (const item of items) {
      if (item.categoryId) {
        byCat[item.categoryId] = (byCat[item.categoryId] ?? 0) + 1;
      } else {
        byCat.UNCATEGORIZED = (byCat.UNCATEGORIZED ?? 0) + 1;
      }
      if (item.isLowStock) lowStock += 1;
      if (toDecimal(item.currentStock).lte(0)) outOfStock += 1;
    }

    return { byCat, lowStock, outOfStock };
  }, [items]);

  // Lista filtrada y ordenada con precisión fija (Decimal)
  const organizedItems = useMemo(() => {
    const filtered = items.filter((item) => {
      if (selectedCategory !== "ALL") {
        if (selectedCategory === "UNCATEGORIZED") {
          if (item.categoryId !== null) return false;
        } else if (item.categoryId !== selectedCategory) {
          return false;
        }
      }

      if (stockFilter === "LOW_STOCK" && !item.isLowStock) return false;
      if (stockFilter === "OUT_OF_STOCK" && !toDecimal(item.currentStock).lte(0)) return false;

      return true;
    });

    return [...filtered].sort((a, b) => {
      switch (sortBy) {
        case "STOCK_ASC": {
          const cmp = toDecimal(a.currentStock).comparedTo(toDecimal(b.currentStock));
          return cmp !== 0 ? cmp : a.name.localeCompare(b.name);
        }
        case "STOCK_DESC": {
          const cmp = toDecimal(b.currentStock).comparedTo(toDecimal(a.currentStock));
          return cmp !== 0 ? cmp : a.name.localeCompare(b.name);
        }
        case "PRICE_ASC": {
          const cmp = toDecimal(a.priceUsd).comparedTo(toDecimal(b.priceUsd));
          return cmp !== 0 ? cmp : a.name.localeCompare(b.name);
        }
        case "PRICE_DESC": {
          const cmp = toDecimal(b.priceUsd).comparedTo(toDecimal(a.priceUsd));
          return cmp !== 0 ? cmp : a.name.localeCompare(b.name);
        }
        case "RECENT":
          return b.updatedAt - a.updatedAt;
        case "NAME_ASC":
        default:
          return a.name.localeCompare(b.name);
      }
    });
  }, [items, selectedCategory, stockFilter, sortBy]);

  // KPIs de Valorización de la vista actual (Decimal exacto a 4 decimales)
  const inventorySummary = useMemo(() => {
    let totalUnits = toDecimal("0");
    let totalCostUsd = toDecimal("0");
    let totalSaleUsd = toDecimal("0");

    for (const item of organizedItems) {
      const stockDec = toDecimal(item.currentStock);
      const positiveStock = stockDec.isNegative() ? toDecimal("0") : stockDec;
      totalUnits = totalUnits.plus(positiveStock);
      totalCostUsd = totalCostUsd.plus(positiveStock.times(toDecimal(item.costUsd)));
      totalSaleUsd = totalSaleUsd.plus(positiveStock.times(toDecimal(item.priceUsd)));
    }

    const totalSaleVes = convertUsdToVes(totalSaleUsd.toFixed(4), exchangeRate);

    return {
      skuCount: organizedItems.length,
      totalUnits: totalUnits.toFixed(4),
      totalCostUsd: totalCostUsd.toFixed(4),
      totalSaleUsd: totalSaleUsd.toFixed(4),
      totalSaleVes: totalSaleVes.toFixed(4),
    };
  }, [organizedItems, exchangeRate]);

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
    setFormCategoryId(
      selectedCategory !== "ALL" && selectedCategory !== "UNCATEGORIZED"
        ? selectedCategory
        : null,
    );
    setNewModalCategoryName("");
    setFormPriceUsd("");
    setFormCostUsd("");
    setFormMinStock("5.0000");
    setFormInitialStock("0.0000");
    setFormImagePath(null);
    setPendingImageBytes(null);
    setRemoveExistingImage(false);
    setProductFormError(null);
    setIsProductModalOpen(true);
  };

  // Abrir modal para Editar Producto
  const handleOpenEditProduct = (item: InventoryItemWithStock) => {
    setEditingProductId(item.id);
    setFormName(item.name);
    setFormSku(item.sku);
    setFormBarcode(item.barcode ?? "");
    setFormCategoryId(item.categoryId);
    setNewModalCategoryName("");
    setFormPriceUsd(item.priceUsd);
    setFormCostUsd(item.costUsd);
    setFormMinStock(item.minStock);
    setFormInitialStock(item.currentStock);
    setFormImagePath(item.imagePath);
    setPendingImageBytes(null);
    setRemoveExistingImage(false);
    setProductFormError(null);
    setIsProductModalOpen(true);
  };

  // Seleccionar foto de producto desde el dispositivo
  const handlePickProductImage = async () => {
    try {
      setProductFormError(null);
      if (onPickImage) {
        const picked = await onPickImage();
        if (picked) {
          setPendingImageBytes(picked);
          setRemoveExistingImage(false);
        }
        return;
      }
      // En navegador / escritorio Web, abrir el selector de archivos nativo
      if (typeof document !== "undefined" && typeof document.createElement === "function") {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.onchange = async () => {
          const file = input.files?.[0];
          if (file) {
            const buf = await file.arrayBuffer();
            setPendingImageBytes(new Uint8Array(buf));
            setRemoveExistingImage(false);
          }
        };
        input.click();
      }
    } catch (err) {
      setProductFormError((err as Error).message);
    }
  };

  // Quitar foto actual del producto
  const handleClearProductImage = () => {
    setPendingImageBytes(null);
    setFormImagePath(null);
    setRemoveExistingImage(true);
  };

  // Guardar Producto (Crear o Actualizar + Imagen Local Comprimida)
  const handleSaveProduct = async () => {
    try {
      setProductFormError(null);
      if (!formName.trim()) throw new Error("El nombre del producto es obligatorio");
      if (!formSku.trim()) throw new Error("El SKU es obligatorio");

      const rawPrice = (formPriceUsd || "0").replace(",", ".");
      const rawCost = (formCostUsd || "0").replace(",", ".");
      const rawMinStock = (formMinStock || "5").replace(",", ".");
      const rawInitialStock = (formInitialStock || "0").replace(",", ".");

      const priceDec = toDecimal(rawPrice, "Precio");
      const costDec = toDecimal(rawCost, "Costo");
      const minStockDec = toDecimal(rawMinStock, "Stock Mínimo");
      const initialStockDec = toDecimal(rawInitialStock, "Stock Inicial");

      if (priceDec.isNegative() || costDec.isNegative()) {
        throw new Error("El precio y el costo no pueden ser negativos");
      }

      if (db) {
        const now = Date.now();
        let savedId = editingProductId;
        let finalCategoryId = formCategoryId;
        if (newModalCategoryName.trim()) {
          finalCategoryId = handleCreateQuickCategory(newModalCategoryName, true);
        }

        if (!editingProductId) {
          savedId = insertProduct(
            db,
            {
              tenantId,
              name: formName.trim(),
              sku: formSku.trim(),
              barcode: formBarcode.trim() || undefined,
              categoryId: finalCategoryId ?? undefined,
              priceUsd: priceDec.toFixed(4),
              costUsd: costDec.toFixed(4),
              minStock: minStockDec.toFixed(4),
            },
            now,
            terminalId,
          );

          if (!initialStockDec.isZero()) {
            addStockMovement(
              db,
              {
                productId: savedId,
                terminalId,
                delta: initialStockDec.toFixed(4),
                type: "RESTOCK",
                referenceId: "Stock Inicial de Alta",
              },
              now + 1,
            );
          }
        } else {
          updateProduct(
            db,
            {
              id: editingProductId,
              name: formName.trim(),
              sku: formSku.trim(),
              barcode: formBarcode.trim() || null,
              categoryId: finalCategoryId,
              priceUsd: priceDec.toFixed(4),
              costUsd: costDec.toFixed(4),
              minStock: minStockDec.toFixed(4),
              imagePath: formImagePath,
              terminalId,
            },
            now,
          );
        }

        if (savedId && pendingImageBytes) {
          await setProductImage(
            { db, encoder: imageEncoder, files: fileStore, terminalId },
            savedId,
            pendingImageBytes,
            now + 2,
          );
        } else if (savedId && removeExistingImage) {
          await removeProductImage(
            { db, files: fileStore, terminalId },
            savedId,
            now + 2,
          );
        }

        // Si había un filtro de búsqueda o categoría que ocultaría el producto recién guardado, limpiarlo
        const activeFilter = search.trim().toLowerCase();
        const matchesFilter =
          !activeFilter ||
          formName.toLowerCase().includes(activeFilter) ||
          formSku.toLowerCase().includes(activeFilter) ||
          formBarcode.toLowerCase().includes(activeFilter);

        const nextSearch = matchesFilter ? search : "";
        if (!matchesFilter) {
          setSearch("");
        }

        if (
          selectedCategory !== "ALL" &&
          ((selectedCategory === "UNCATEGORIZED" && finalCategoryId !== null) ||
            (selectedCategory !== "UNCATEGORIZED" && selectedCategory !== finalCategoryId))
        ) {
          setSelectedCategory("ALL");
        }

        const updatedList = listInventoryWithStock(db, { search: nextSearch, tenantId });
        setItems(updatedList);
        setCategories(listCategories(db));
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
      const parsedDelta = toDecimal((kardexDelta || "0").replace(",", "."), "Cantidad");
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

  // Abrir modal de confirmación para eliminar un producto
  const handleOpenDeleteProduct = (item: InventoryItemWithStock) => {
    setIsProductModalOpen(false);
    setDeleteTarget({ kind: "PRODUCT", product: item });
    setDeleteConfirmInput("");
    setClearStockOnDelete(true);
    setAckImpactCheckbox(false);
    setDeleteError(null);
  };

  // Abrir modal de confirmación para eliminar una categoría
  const handleOpenDeleteCategory = (category: CategoryEntity) => {
    const affectedCount = organizationCounts.byCat[category.id] ?? 0;
    setDeleteTarget({ kind: "CATEGORY", category, affectedCount });
    setDeleteConfirmInput("");
    setAckImpactCheckbox(false);
    setDeleteError(null);
  };

  // Ejecutar eliminación validada (requiere "BORRAR" y validaciones de impacto)
  const handleConfirmDelete = () => {
    try {
      setDeleteError(null);
      if (!deleteTarget) return;

      const normalizedWord = deleteConfirmInput.trim().toUpperCase();
      if (normalizedWord !== "BORRAR") {
        throw new Error('Por seguridad, debe escribir exactamente la palabra "BORRAR" para confirmar.');
      }

      if (deleteTarget.kind === "PRODUCT") {
        const prod = deleteTarget.product;
        const hasRemainingStock = !toDecimal(prod.currentStock).isZero();
        if (hasRemainingStock && !ackImpactCheckbox) {
          throw new Error(
            `El producto "${prod.name}" tiene ${prod.currentStock} unds en stock. Debe marcar la casilla de verificación de impacto antes de borrar.`,
          );
        }

        if (db) {
          deleteProduct(
            db,
            {
              productId: prod.id,
              confirmationWord: normalizedWord,
              clearRemainingStock: hasRemainingStock && clearStockOnDelete,
              terminalId,
            },
            Date.now(),
          );
          reloadData();
          onProductDeleted?.(prod.id);
        } else {
          setItems((prev) => prev.filter((p) => p.id !== prod.id));
        }
      } else {
        const { category, affectedCount } = deleteTarget;
        if (affectedCount > 0 && !ackImpactCheckbox) {
          throw new Error(
            `La categoría "${category.name}" contiene ${affectedCount} producto(s). Confirme la casilla para reasignarlos a "Sin Categoría".`,
          );
        }

        if (db) {
          deleteCategory(
            db,
            {
              categoryId: category.id,
              confirmationWord: normalizedWord,
            },
            Date.now(),
          );
          if (selectedCategory === category.id) {
            setSelectedCategory("ALL");
          }
          if (formCategoryId === category.id) {
            setFormCategoryId(null);
          }
          reloadData();
          onCategoryDeleted?.(category.id);
        } else {
          setCategories((prev) => prev.filter((c) => c.id !== category.id));
          if (selectedCategory === category.id) {
            setSelectedCategory("ALL");
          }
        }
      }

      setDeleteTarget(null);
      setDeleteConfirmInput("");
    } catch (err) {
      setDeleteError((err as Error).message);
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

      {/* Panel de Organización: Categorías, Estado de Stock y Ordenamiento */}
      <View style={styles.organizationPanel}>
        {/* Fila 1: Píldoras Táctiles de Categorías + Crear Categoría */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoryScrollContent}
        >
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => setSelectedCategory("ALL")}
            style={[
              styles.categoryChip,
              selectedCategory === "ALL" && styles.categoryChipActive,
            ]}
          >
            <Text
              style={[
                styles.categoryChipText,
                selectedCategory === "ALL" && styles.categoryChipTextActive,
              ]}
            >
              Todas ({organizationCounts.byCat.ALL ?? 0})
            </Text>
          </TouchableOpacity>

          {categories.map((cat) => {
            const isSelected = selectedCategory === cat.id;
            const count = organizationCounts.byCat[cat.id] ?? 0;
            return (
              <View key={cat.id} style={styles.categoryChipWrapper}>
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => setSelectedCategory(cat.id)}
                  style={[styles.categoryChip, isSelected && styles.categoryChipActive]}
                >
                  <Text
                    style={[
                      styles.categoryChipText,
                      isSelected && styles.categoryChipTextActive,
                    ]}
                  >
                    {cat.name} ({count})
                  </Text>
                </TouchableOpacity>
                {isSelected && (
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => handleOpenDeleteCategory(cat)}
                    style={styles.deleteCategoryChipBtn}
                  >
                    <Text style={styles.deleteCategoryChipBtnText}>🗑 Eliminar Categoría</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })}

          {(organizationCounts.byCat.UNCATEGORIZED ?? 0) > 0 && (
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => setSelectedCategory("UNCATEGORIZED")}
              style={[
                styles.categoryChip,
                selectedCategory === "UNCATEGORIZED" && styles.categoryChipActive,
              ]}
            >
              <Text
                style={[
                  styles.categoryChipText,
                  selectedCategory === "UNCATEGORIZED" && styles.categoryChipTextActive,
                ]}
              >
                Sin Categoría ({organizationCounts.byCat.UNCATEGORIZED})
              </Text>
            </TouchableOpacity>
          )}

          {isCreatingCategoryInline ? (
            <View style={styles.inlineCategoryBox}>
              <TextInput
                style={styles.inlineCategoryInput}
                placeholder="Nueva categoría..."
                placeholderTextColor={colors.dark.textMuted}
                value={inlineCategoryName}
                onChangeText={setInlineCategoryName}
                onSubmitEditing={() => handleCreateQuickCategory(inlineCategoryName, false)}
              />
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => handleCreateQuickCategory(inlineCategoryName, false)}
                style={styles.inlineCategoryConfirmBtn}
              >
                <Text style={styles.inlineCategoryConfirmText}>✓ Crear</Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => {
                  setIsCreatingCategoryInline(false);
                  setInlineCategoryName("");
                }}
                style={styles.inlineCategoryCancelBtn}
              >
                <Text style={styles.inlineCategoryCancelText}>✕</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => setIsCreatingCategoryInline(true)}
              style={styles.addCategoryChip}
            >
              <Text style={styles.addCategoryChipText}>+ Categoría</Text>
            </TouchableOpacity>
          )}
        </ScrollView>

        {/* Fila 2: Filtros Rápidos de Stock (Semáforo) + Ordenamiento + Valorización */}
        <View style={styles.controlsAndKpiRow}>
          {/* Filtro por estado de stock */}
          <View style={styles.filterGroup}>
            <Text style={styles.controlGroupLabel}>ESTADO:</Text>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => setStockFilter("ALL")}
              style={[styles.filterPill, stockFilter === "ALL" && styles.filterPillActive]}
            >
              <Text
                style={[
                  styles.filterPillText,
                  stockFilter === "ALL" && styles.filterPillTextActive,
                ]}
              >
                Todos
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() =>
                setStockFilter(stockFilter === "LOW_STOCK" ? "ALL" : "LOW_STOCK")
              }
              style={[
                styles.filterPill,
                stockFilter === "LOW_STOCK" && styles.filterPillWarningActive,
              ]}
            >
              <Text
                style={[
                  styles.filterPillText,
                  stockFilter === "LOW_STOCK"
                    ? styles.filterPillWarningTextActive
                    : organizationCounts.lowStock > 0
                      ? { color: colors.dark.warning }
                      : undefined,
                ]}
              >
                ⚠️ Stock Bajo ({organizationCounts.lowStock})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() =>
                setStockFilter(stockFilter === "OUT_OF_STOCK" ? "ALL" : "OUT_OF_STOCK")
              }
              style={[
                styles.filterPill,
                stockFilter === "OUT_OF_STOCK" && styles.filterPillErrorActive,
              ]}
            >
              <Text
                style={[
                  styles.filterPillText,
                  stockFilter === "OUT_OF_STOCK" && styles.filterPillErrorTextActive,
                ]}
              >
                🚫 Agotados ({organizationCounts.outOfStock})
              </Text>
            </TouchableOpacity>
          </View>

          {/* Selector táctil de ordenamiento */}
          <View style={styles.filterGroup}>
            <Text style={styles.controlGroupLabel}>ORDENAR POR:</Text>
            {(
              [
                { id: "NAME_ASC", label: "A → Z" },
                { id: "STOCK_ASC", label: "Stock ↑" },
                { id: "STOCK_DESC", label: "Stock ↓" },
                { id: "PRICE_ASC", label: "Precio ↑" },
                { id: "PRICE_DESC", label: "Precio ↓" },
                { id: "RECENT", label: "Recientes" },
              ] as const
            ).map((opt) => {
              const active = sortBy === opt.id;
              return (
                <TouchableOpacity
                  key={opt.id}
                  activeOpacity={0.8}
                  onPress={() => setSortBy(opt.id)}
                  style={[styles.sortPill, active && styles.sortPillActive]}
                >
                  <Text style={[styles.sortPillText, active && styles.sortPillTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Resumen de Valorización de la vista actual */}
          <View style={styles.kpiStrip}>
            <View style={styles.kpiItem}>
              <Text style={styles.kpiLabel}>MOSTRANDO</Text>
              <Text style={[styles.kpiValue, typography.tabularNumeric]}>
                {inventorySummary.skuCount} SKUs ({inventorySummary.totalUnits} unds)
              </Text>
            </View>
            <View style={styles.kpiDivider} />
            <View style={styles.kpiItem}>
              <Text style={styles.kpiLabel}>VALOR COSTO</Text>
              <Text style={[styles.kpiValue, typography.tabularNumeric]}>
                {formatUsd(inventorySummary.totalCostUsd)}
              </Text>
            </View>
            <View style={styles.kpiDivider} />
            <View style={styles.kpiItem}>
              <Text style={styles.kpiLabel}>VALOR VENTA</Text>
              <Text style={[styles.kpiValueHero, typography.tabularNumeric]}>
                {formatUsd(inventorySummary.totalSaleUsd)}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* Listado de Productos Organizado con Stock Actual */}
      <FlatList
        data={organizedItems}
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
                <View style={styles.productHeaderRow}>
                  <Text style={styles.productName}>{item.name}</Text>
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() =>
                      setSelectedCategory(item.categoryId ? item.categoryId : "UNCATEGORIZED")
                    }
                    style={styles.rowCategoryTag}
                  >
                    <Text style={styles.rowCategoryTagText}>
                      {item.categoryName ?? "Sin categoría"}
                    </Text>
                  </TouchableOpacity>
                </View>
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

                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => handleOpenDeleteProduct(item)}
                  style={styles.deleteRowBtn}
                >
                  <Text style={styles.deleteRowBtnText}>🗑 Eliminar</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No se encontraron productos en esta vista</Text>
            <Text style={styles.emptySubText}>
              {selectedCategory !== "ALL" || stockFilter !== "ALL" || search.trim()
                ? "Pruebe limpiando los filtros de categoría o estado de stock"
                : 'Presione "+ NUEVO PRODUCTO" o escanee un código de barras para darlo de alta'}
            </Text>
            {(selectedCategory !== "ALL" || stockFilter !== "ALL" || search.trim() !== "") && (
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => {
                  setSelectedCategory("ALL");
                  setStockFilter("ALL");
                  setSearch("");
                }}
                style={styles.resetFiltersBtn}
              >
                <Text style={styles.resetFiltersBtnText}>Restablecer Filtros</Text>
              </TouchableOpacity>
            )}
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

              {/* Selector Táctil de Categoría en el Modal */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Categoría de Organización</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.modalCategoryRow}
                >
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => setFormCategoryId(null)}
                    style={[
                      styles.modalCategoryOption,
                      formCategoryId === null &&
                        !newModalCategoryName.trim() &&
                        styles.modalCategoryOptionActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.modalCategoryOptionText,
                        formCategoryId === null &&
                          !newModalCategoryName.trim() &&
                          styles.modalCategoryOptionTextActive,
                      ]}
                    >
                      Sin categoría
                    </Text>
                  </TouchableOpacity>

                  {categories.map((cat) => {
                    const isSelected =
                      formCategoryId === cat.id && !newModalCategoryName.trim();
                    return (
                      <TouchableOpacity
                        key={cat.id}
                        activeOpacity={0.8}
                        onPress={() => {
                          setFormCategoryId(cat.id);
                          setNewModalCategoryName("");
                        }}
                        style={[
                          styles.modalCategoryOption,
                          isSelected && styles.modalCategoryOptionActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.modalCategoryOptionText,
                            isSelected && styles.modalCategoryOptionTextActive,
                          ]}
                        >
                          {cat.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>

                <View style={styles.modalNewCategoryRow}>
                  <TextInput
                    style={[styles.modalInput, { flex: 1 }]}
                    placeholder="O escriba una nueva categoría (ej. Lácteos, Charcutería)..."
                    placeholderTextColor={colors.dark.textMuted}
                    value={newModalCategoryName}
                    onChangeText={setNewModalCategoryName}
                  />
                  {newModalCategoryName.trim().length > 0 && (
                    <TouchableOpacity
                      activeOpacity={0.8}
                      onPress={() => handleCreateQuickCategory(newModalCategoryName, true)}
                      style={styles.modalCreateCatBtn}
                    >
                      <Text style={styles.modalCreateCatBtnText}>+ Agregar</Text>
                    </TouchableOpacity>
                  )}
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

                {!editingProductId && (
                  <View style={[styles.inputGroup, { flex: 1 }]}>
                    <Text style={styles.inputLabel}>Stock Inicial (Unds)</Text>
                    <TextInput
                      style={[styles.modalInput, typography.tabularNumeric]}
                      placeholder="0.0000"
                      keyboardType="decimal-pad"
                      placeholderTextColor={colors.dark.textMuted}
                      value={formInitialStock}
                      onChangeText={setFormInitialStock}
                    />
                  </View>
                )}
              </View>

              {/* Selector Táctil de Imagen Local (WebP/JPEG < 80 KB) */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>
                  Imagen del Producto (Almacenamiento Local &lt; 80 KB)
                </Text>
                <View style={styles.imageSelectorRow}>
                  <View style={styles.imagePreviewBox}>
                    {pendingImageBytes ? (
                      <Image
                        source={{
                          uri: `data:image/webp;base64,${uint8ToBase64(pendingImageBytes)}`,
                        }}
                        style={styles.thumbnail}
                      />
                    ) : formImagePath && resolveProductImageUri(fileStore, formImagePath) ? (
                      <Image
                        source={{ uri: resolveProductImageUri(fileStore, formImagePath)! }}
                        style={styles.thumbnail}
                      />
                    ) : (
                      <Text style={styles.thumbnailPlaceholderText}>📷</Text>
                    )}
                  </View>

                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={handlePickProductImage}
                    style={styles.pickImageBtn}
                  >
                    <Text style={styles.pickImageBtnText}>Seleccionar Foto Local</Text>
                  </TouchableOpacity>

                  {(pendingImageBytes || formImagePath) && (
                    <TouchableOpacity
                      activeOpacity={0.8}
                      onPress={handleClearProductImage}
                      style={styles.removeImageBtn}
                    >
                      <Text style={styles.removeImageBtnText}>✕ Quitar Foto</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            </ScrollView>

            <View style={styles.modalActions}>
              {editingProductId && (
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => {
                    const found = items.find((p) => p.id === editingProductId);
                    if (found) handleOpenDeleteProduct(found);
                  }}
                  style={styles.modalDeleteProductBtn}
                >
                  <Text style={styles.modalDeleteProductBtnText}>🗑 Eliminar Producto</Text>
                </TouchableOpacity>
              )}

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

      {/* Modal 3: Confirmación de Eliminación con Validación Estricta ("BORRAR") */}
      <Modal visible={deleteTarget !== null} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, styles.dangerModalCard]}>
            <Text style={styles.dangerModalTitle}>
              {deleteTarget?.kind === "PRODUCT"
                ? "⚠️ Confirmar Eliminación de Producto"
                : "⚠️ Confirmar Eliminación de Categoría"}
            </Text>

            {deleteTarget?.kind === "PRODUCT" && (
              <View style={styles.deleteSummaryBox}>
                <Text style={styles.deleteEntityName}>
                  {deleteTarget.product.name} (SKU: {deleteTarget.product.sku})
                </Text>
                <Text style={styles.deleteEntitySub}>
                  Stock actual:{" "}
                  <Text style={typography.tabularNumeric}>
                    {deleteTarget.product.currentStock} unds
                  </Text>{" "}
                  • Precio: {formatUsd(deleteTarget.product.priceUsd)}
                </Text>
                <Text style={styles.deleteNoticeText}>
                  El producto se dará de baja del catálogo activo (sincronizado por P2P) sin
                  alterar las facturas emitidas ni el historial de auditoría del Kardex.
                </Text>

                {!toDecimal(deleteTarget.product.currentStock).isZero() && (
                  <View style={styles.stockWarningBox}>
                    <Text style={styles.stockWarningTitle}>
                      ⚠️ Atención: Este producto tiene stock distinto de cero (
                      {deleteTarget.product.currentStock} unds)
                    </Text>

                    <TouchableOpacity
                      activeOpacity={0.8}
                      onPress={() => setClearStockOnDelete((prev) => !prev)}
                      style={styles.checkboxRow}
                    >
                      <View
                        style={[
                          styles.checkboxSquare,
                          clearStockOnDelete && styles.checkboxSquareActive,
                        ]}
                      >
                        {clearStockOnDelete && <Text style={styles.checkboxMark}>✓</Text>}
                      </View>
                      <Text style={styles.checkboxLabel}>
                        Registrar ajuste automático en Kardex para dejar el stock en 0.0000 unds
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      activeOpacity={0.8}
                      onPress={() => setAckImpactCheckbox((prev) => !prev)}
                      style={styles.checkboxRow}
                    >
                      <View
                        style={[
                          styles.checkboxSquare,
                          ackImpactCheckbox && styles.checkboxSquareDangerActive,
                        ]}
                      >
                        {ackImpactCheckbox && <Text style={styles.checkboxMark}>✓</Text>}
                      </View>
                      <Text style={styles.checkboxLabel}>
                        Confirmo que revisé las existencias físicas de este producto antes de
                        eliminarlo *
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}

            {deleteTarget?.kind === "CATEGORY" && (
              <View style={styles.deleteSummaryBox}>
                <Text style={styles.deleteEntityName}>
                  Categoría: {deleteTarget.category.name}
                </Text>
                <Text style={styles.deleteEntitySub}>
                  Productos asociados actualmente: {deleteTarget.affectedCount} SKU(s)
                </Text>
                <Text style={styles.deleteNoticeText}>
                  Los productos dentro de esta categoría NO serán eliminados; pasarán
                  automáticamente a &quot;Sin Categoría&quot;.
                </Text>

                {deleteTarget.affectedCount > 0 && (
                  <View style={styles.stockWarningBox}>
                    <TouchableOpacity
                      activeOpacity={0.8}
                      onPress={() => setAckImpactCheckbox((prev) => !prev)}
                      style={styles.checkboxRow}
                    >
                      <View
                        style={[
                          styles.checkboxSquare,
                          ackImpactCheckbox && styles.checkboxSquareDangerActive,
                        ]}
                      >
                        {ackImpactCheckbox && <Text style={styles.checkboxMark}>✓</Text>}
                      </View>
                      <Text style={styles.checkboxLabel}>
                        Entiendo que {deleteTarget.affectedCount} producto(s) quedarán bajo
                        &quot;Sin Categoría&quot; *
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}

            {deleteError && <Text style={styles.errorText}>{deleteError}</Text>}

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>
                Para prevenir errores accidentales, escriba exactamente{" "}
                <Text style={{ color: colors.dark.error }}>BORRAR</Text> en el campo:
              </Text>
              <TextInput
                style={[
                  styles.modalInput,
                  deleteConfirmInput.trim().toUpperCase() === "BORRAR" &&
                    styles.deleteInputConfirmed,
                ]}
                placeholder='Escriba "BORRAR" aquí...'
                placeholderTextColor={colors.dark.textMuted}
                autoCapitalize="characters"
                value={deleteConfirmInput}
                onChangeText={setDeleteConfirmInput}
              />
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => {
                  setDeleteTarget(null);
                  setDeleteConfirmInput("");
                  setDeleteError(null);
                }}
                style={styles.cancelBtn}
              >
                <Text style={styles.cancelBtnText}>Cancelar</Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.8}
                onPress={handleConfirmDelete}
                style={[
                  styles.confirmDeleteBtn,
                  deleteConfirmInput.trim().toUpperCase() !== "BORRAR" &&
                    styles.confirmDeleteBtnDisabled,
                ]}
              >
                <Text style={styles.confirmDeleteBtnText}>CONFIRMAR Y BORRAR</Text>
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
    marginBottom: spacing.md,
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
  organizationPanel: {
    backgroundColor: colors.dark.surfaceContainerLow,
    borderRadius: spacing.radiusLg,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.dark.border,
    gap: spacing.sm,
  },
  categoryScrollContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingBottom: 2,
  },
  categoryChip: {
    height: spacing.touchTargetMin, // 48px
    backgroundColor: colors.dark.surfaceContainer,
    paddingHorizontal: spacing.md,
    borderRadius: spacing.radiusFull,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  categoryChipActive: {
    backgroundColor: colors.dark.primary,
    borderColor: colors.dark.primaryGlow,
  },
  categoryChipText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.semibold,
    color: colors.dark.textSecondary,
  },
  categoryChipTextActive: {
    color: colors.dark.textPrimary,
    fontWeight: typography.weights.bold,
  },
  addCategoryChip: {
    height: spacing.touchTargetMin, // 48px
    backgroundColor: colors.dark.surfaceContainerHigh,
    paddingHorizontal: spacing.md,
    borderRadius: spacing.radiusFull,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.dark.primaryGlow,
  },
  addCategoryChipText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: colors.dark.primaryGlow,
  },
  inlineCategoryBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  inlineCategoryInput: {
    height: spacing.touchTargetMin,
    minWidth: 160,
    backgroundColor: colors.dark.surfaceContainerHigh,
    borderRadius: spacing.radiusMd,
    paddingHorizontal: spacing.md,
    color: colors.dark.textPrimary,
    borderWidth: 1,
    borderColor: colors.dark.primaryGlow,
  },
  inlineCategoryConfirmBtn: {
    height: spacing.touchTargetMin,
    backgroundColor: colors.dark.hero,
    paddingHorizontal: spacing.md,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
  },
  inlineCategoryConfirmText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: colors.dark.textPrimary,
  },
  inlineCategoryCancelBtn: {
    height: spacing.touchTargetMin,
    width: spacing.touchTargetMin,
    backgroundColor: colors.dark.surfaceContainer,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  inlineCategoryCancelText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: colors.dark.textSecondary,
  },
  controlsAndKpiRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.dark.border,
    paddingTop: spacing.sm,
  },
  filterGroup: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.xs,
  },
  controlGroupLabel: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: colors.dark.textMuted,
    marginRight: 4,
  },
  filterPill: {
    minHeight: 40,
    backgroundColor: colors.dark.surfaceContainer,
    paddingHorizontal: spacing.md,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  filterPillActive: {
    backgroundColor: colors.dark.surfaceContainerHighest,
    borderColor: colors.dark.primaryGlow,
  },
  filterPillWarningActive: {
    backgroundColor: "rgba(245, 158, 11, 0.2)",
    borderColor: colors.dark.warning,
  },
  filterPillErrorActive: {
    backgroundColor: "rgba(239, 68, 68, 0.2)",
    borderColor: colors.dark.error,
  },
  filterPillText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.semibold,
    color: colors.dark.textSecondary,
  },
  filterPillTextActive: {
    color: colors.dark.textPrimary,
    fontWeight: typography.weights.bold,
  },
  filterPillWarningTextActive: {
    color: colors.dark.warning,
    fontWeight: typography.weights.bold,
  },
  filterPillErrorTextActive: {
    color: colors.dark.error,
    fontWeight: typography.weights.bold,
  },
  sortPill: {
    minHeight: 40,
    backgroundColor: colors.dark.surfaceContainer,
    paddingHorizontal: spacing.sm,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  sortPillActive: {
    backgroundColor: colors.dark.primary,
    borderColor: colors.dark.primaryGlow,
  },
  sortPillText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.semibold,
    color: colors.dark.textSecondary,
  },
  sortPillTextActive: {
    color: colors.dark.textPrimary,
    fontWeight: typography.weights.bold,
  },
  kpiStrip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.dark.surfaceContainer,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: spacing.radiusMd,
    borderWidth: 1,
    borderColor: colors.dark.border,
    gap: spacing.md,
  },
  kpiItem: {
    alignItems: "flex-end",
  },
  kpiLabel: {
    fontSize: 10,
    fontWeight: typography.weights.bold,
    color: colors.dark.textMuted,
  },
  kpiValue: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: colors.dark.textPrimary,
  },
  kpiValueHero: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: colors.dark.hero,
  },
  kpiDivider: {
    width: 1,
    height: 24,
    backgroundColor: colors.dark.border,
  },
  productHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  rowCategoryTag: {
    backgroundColor: colors.dark.surfaceContainerHighest,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: spacing.radiusFull,
  },
  rowCategoryTagText: {
    fontSize: 11,
    fontWeight: typography.weights.bold,
    color: colors.dark.primaryGlow,
  },
  resetFiltersBtn: {
    marginTop: spacing.md,
    height: spacing.touchTargetMin,
    backgroundColor: colors.dark.surfaceContainerHigh,
    paddingHorizontal: spacing.lg,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.dark.primaryGlow,
  },
  resetFiltersBtnText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: colors.dark.primaryGlow,
  },
  modalCategoryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 4,
  },
  modalCategoryOption: {
    height: spacing.touchTargetMin, // 48px
    backgroundColor: colors.dark.surfaceContainerHigh,
    paddingHorizontal: spacing.md,
    borderRadius: spacing.radiusFull,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  modalCategoryOptionActive: {
    backgroundColor: colors.dark.primary,
    borderColor: colors.dark.primaryGlow,
  },
  modalCategoryOptionText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.semibold,
    color: colors.dark.textSecondary,
  },
  modalCategoryOptionTextActive: {
    color: colors.dark.textPrimary,
    fontWeight: typography.weights.bold,
  },
  modalNewCategoryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  modalCreateCatBtn: {
    height: spacing.touchTargetMin, // 48px
    backgroundColor: colors.dark.primary,
    paddingHorizontal: spacing.md,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
  },
  modalCreateCatBtnText: {
    fontSize: typography.sizes.caption,
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
  imageSelectorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  imagePreviewBox: {
    width: 56,
    height: 56,
    borderRadius: spacing.radiusMd,
    overflow: "hidden",
    backgroundColor: colors.dark.surfaceContainerHigh,
    borderWidth: 1,
    borderColor: colors.dark.border,
    alignItems: "center",
    justifyContent: "center",
  },
  pickImageBtn: {
    height: spacing.touchTargetMin, // 48px
    backgroundColor: colors.dark.surfaceContainerHigh,
    paddingHorizontal: spacing.lg,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.dark.primaryGlow,
  },
  pickImageBtnText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: colors.dark.primaryGlow,
  },
  removeImageBtn: {
    height: spacing.touchTargetMin, // 48px
    paddingHorizontal: spacing.md,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.dark.error,
  },
  removeImageBtnText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: colors.dark.error,
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
  categoryChipWrapper: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  deleteCategoryChipBtn: {
    height: spacing.touchTargetMin, // 48px
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    paddingHorizontal: spacing.md,
    borderRadius: spacing.radiusFull,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.dark.error,
  },
  deleteCategoryChipBtnText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: colors.dark.error,
  },
  deleteRowBtn: {
    height: spacing.touchTargetMin, // 48px
    backgroundColor: "rgba(239, 68, 68, 0.12)",
    paddingHorizontal: spacing.md,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.dark.error,
  },
  deleteRowBtnText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: colors.dark.error,
  },
  modalDeleteProductBtn: {
    height: spacing.touchTargetMin, // 48px
    backgroundColor: "rgba(239, 68, 68, 0.12)",
    paddingHorizontal: spacing.md,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.dark.error,
    marginRight: "auto",
  },
  modalDeleteProductBtnText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: colors.dark.error,
  },
  dangerModalCard: {
    borderColor: colors.dark.error,
    borderWidth: 1.5,
  },
  dangerModalTitle: {
    fontSize: typography.sizes.titleLg,
    fontWeight: typography.weights.bold,
    color: colors.dark.error,
    marginBottom: spacing.sm,
  },
  deleteSummaryBox: {
    backgroundColor: colors.dark.surfaceContainer,
    borderRadius: spacing.radiusMd,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.dark.border,
    gap: 6,
  },
  deleteEntityName: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    color: colors.dark.textPrimary,
  },
  deleteEntitySub: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.semibold,
    color: colors.dark.primaryGlow,
  },
  deleteNoticeText: {
    fontSize: typography.sizes.caption,
    color: colors.dark.textSecondary,
    marginTop: 2,
  },
  stockWarningBox: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    backgroundColor: "rgba(245, 158, 11, 0.12)",
    borderRadius: spacing.radiusMd,
    borderWidth: 1,
    borderColor: colors.dark.warning,
    gap: spacing.xs,
  },
  stockWarningTitle: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: colors.dark.warning,
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 40,
    paddingVertical: 4,
  },
  checkboxSquare: {
    width: 24,
    height: 24,
    borderRadius: spacing.radiusSm,
    borderWidth: 1.5,
    borderColor: colors.dark.textSecondary,
    backgroundColor: colors.dark.surfaceContainerHigh,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxSquareActive: {
    backgroundColor: colors.dark.primary,
    borderColor: colors.dark.primaryGlow,
  },
  checkboxSquareDangerActive: {
    backgroundColor: colors.dark.error,
    borderColor: colors.dark.error,
  },
  checkboxMark: {
    fontSize: 14,
    fontWeight: typography.weights.bold,
    color: colors.dark.textPrimary,
  },
  checkboxLabel: {
    flex: 1,
    fontSize: typography.sizes.caption,
    color: colors.dark.textPrimary,
    fontWeight: typography.weights.medium,
  },
  deleteInputConfirmed: {
    borderColor: colors.dark.error,
    backgroundColor: "rgba(239, 68, 68, 0.1)",
  },
  confirmDeleteBtn: {
    height: spacing.touchTargetMin, // 48px
    backgroundColor: colors.dark.error,
    paddingHorizontal: spacing.xl,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
  },
  confirmDeleteBtnDisabled: {
    opacity: 0.45,
  },
  confirmDeleteBtnText: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    color: colors.dark.textPrimary,
  },
});
