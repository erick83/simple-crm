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
import { spacing } from "../theme/spacing";
import { typography } from "../theme/typography";
import { useTheme, useThemedStyles } from "../theme/ThemeContext";
import { useBreakpoint } from "../theme/responsive";
import type { Palette } from "../theme/tokens";
import {
  formatUsd,
  formatVes,
  formatExchangeRate,
  convertUsdToVes,
  formatFixed4,
  toDecimal,
  formatQuantity,
} from "../utils/decimal";
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
  getDefaultTaxRate,
  taxPercentToRate,
  taxRateToPercent,
} from "../database/repositories/settings.repository";
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
    unit: "paq",
    minStock: "5.0000",
    currentStock: "24.0000",
    isLowStock: false,
    tracksInventory: true,
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
    unit: "kg",
    minStock: "5.0000",
    currentStock: "4.0000",
    isLowStock: true,
    tracksInventory: true,
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
    unit: "l",
    minStock: "5.0000",
    currentStock: "12.0000",
    isLowStock: false,
    tracksInventory: true,
    isActive: true,
    updatedAt: Date.now(),
  },
];

export const UNIT_OPTIONS = [
  { id: "und", label: "Unidad (und)" },
  { id: "kg", label: "Kilogramo (kg)" },
  { id: "g", label: "Gramo (g)" },
  { id: "l", label: "Litro (l)" },
  { id: "caja", label: "Caja" },
  { id: "paq", label: "Paquete (paq)" },
] as const;

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
  const { colors: theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { isMobile } = useBreakpoint();
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
  const [formUnit, setFormUnit] = useState<string>("und");
  const [formPriceUsd, setFormPriceUsd] = useState("");
  const [formCostUsd, setFormCostUsd] = useState("");
  const [formTaxRate, setFormTaxRate] = useState("");
  const [formMinStock, setFormMinStock] = useState("5");
  const [formInitialStock, setFormInitialStock] = useState("0");
  /** false = rubro sin control de inventario (sin costo de reposición, sin kardex, sin alerta). */
  const [formTracksInventory, setFormTracksInventory] = useState(true);
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
      // Los rubros sin control de inventario quedan fuera del semáforo.
      if (item.tracksInventory === false) continue;
      if (item.isLowStock) lowStock += 1;
      if (toDecimal(item.currentStock).lte(0)) outOfStock += 1;
    }

    return { byCat, lowStock, outOfStock };
  }, [items]);

  // Categoría seleccionada como entidad (para acciones de eliminar en barra fija)
  const selectedCategoryObj = useMemo(() => {
    if (selectedCategory === "ALL" || selectedCategory === "UNCATEGORIZED") return null;
    return categories.find((c) => c.id === selectedCategory) ?? null;
  }, [categories, selectedCategory]);

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

      if (stockFilter === "LOW_STOCK" && (!item.isLowStock || item.tracksInventory === false)) return false;
      if (
        stockFilter === "OUT_OF_STOCK" &&
        (item.tracksInventory === false || !toDecimal(item.currentStock).lte(0))
      ) {
        return false;
      }

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
      // Un rubro sin control de inventario no forma parte de la valorización.
      if (item.tracksInventory === false) continue;
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
    setFormUnit("und");
    setFormPriceUsd("");
    setFormCostUsd("");
    setFormTaxRate(taxRateToPercent(getDefaultTaxRate(db)));
    setFormMinStock("5");
    setFormInitialStock("0");
    setFormTracksInventory(true);
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
    setFormUnit(item.unit || "und");
    setFormPriceUsd(item.priceUsd);
    setFormCostUsd(item.costUsd);
    setFormTaxRate(taxRateToPercent(item.taxRate));
    setFormMinStock(formatQuantity(item.minStock));
    setFormInitialStock(formatQuantity(item.currentStock));
    setFormTracksInventory(item.tracksInventory !== false);
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

      // Un rubro sin control de inventario no conserva costo de reposición, umbral ni stock inicial.
      const tracksInventory = formTracksInventory;
      const priceDec = toDecimal(rawPrice, "Precio");
      const costDec = tracksInventory ? toDecimal(rawCost, "Costo") : toDecimal("0");
      const minStockDec = tracksInventory ? toDecimal(rawMinStock, "Stock Mínimo") : toDecimal("0");
      const initialStockDec = tracksInventory
        ? toDecimal(rawInitialStock, "Stock Inicial")
        : toDecimal("0");

      if (priceDec.isNegative() || costDec.isNegative()) {
        throw new Error("El precio y el costo no pueden ser negativos");
      }

      // IVA explícito del formulario; vacío = IVA sugerido global
      const taxRateStr = formTaxRate.trim()
        ? taxPercentToRate(formTaxRate)
        : getDefaultTaxRate(db);

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
              unit: formUnit.trim() || "und",
              priceUsd: priceDec.toFixed(4),
              costUsd: costDec.toFixed(4),
              taxRate: taxRateStr,
              minStock: minStockDec.toFixed(4),
              tracksInventory,
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
              unit: formUnit.trim() || "und",
              priceUsd: priceDec.toFixed(4),
              costUsd: costDec.toFixed(4),
              taxRate: taxRateStr,
              minStock: minStockDec.toFixed(4),
              tracksInventory,
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
            `El producto "${prod.name}" tiene ${formatQuantity(prod.currentStock, prod.unit)} en stock. Debe marcar la casilla de verificación de impacto antes de borrar.`,
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
    <View style={[styles.container, isMobile && styles.containerMobile]}>
      {/* Barra Superior con Buscador y Botón de Nuevo Producto */}
      <View style={styles.topBar}>
        <View style={[styles.titleContainer, isMobile && styles.fullWidth]}>
          <Text style={styles.title}>Control de Inventario y Kardex</Text>
          <Text style={styles.subtitle}>
            Stock computado por deltas conmutativos • Tasa: {formatExchangeRate(exchangeRate)}
          </Text>
        </View>

        <TextInput
          style={[styles.searchInput, isMobile && styles.fullWidth]}
          placeholder="Buscar por Nombre, SKU o Código de Barras (HID)..."
          placeholderTextColor={theme.textMuted}
          value={search}
          onChangeText={setSearch}
        />

        <TouchableOpacity
          activeOpacity={0.8}
          onPress={handleOpenCreateProduct}
          style={[styles.newProductBtn, isMobile && styles.fullWidth]}
        >
          <Text style={styles.newProductBtnText}>+ NUEVO PRODUCTO</Text>
        </TouchableOpacity>
      </View>

      {/* Panel de Organización: Categorías, Estado de Stock y Ordenamiento */}
      <View style={styles.organizationPanel}>
            {/* Fila 1: Píldoras Táctiles de Categorías (scroll) + Acciones fijadas a la derecha */}
        <View style={styles.categoryBarRow}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.categoryScrollView}
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
                    <TouchableOpacity
                      key={cat.id}
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
      </ScrollView>

          {/* Acciones flotantes a la derecha al final de la barra */}
          <View style={styles.categoryActionsRight}>
            {selectedCategoryObj && (
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => handleOpenDeleteCategory(selectedCategoryObj)}
                style={styles.deleteCategoryFixedBtn}
              >
                <Text style={styles.deleteCategoryFixedBtnText}>🗑 Eliminar Categoría</Text>
              </TouchableOpacity>
            )}

            {isCreatingCategoryInline ? (
              <View style={styles.inlineCategoryBox}>
                <TextInput
                  style={styles.inlineCategoryInput}
                  placeholder="Nueva categoría..."
                  placeholderTextColor={theme.textMuted}
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
    </View>
        </View>

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
                      ? { color: theme.warning }
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
{
  (
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
  })
}
          </View>

  {/* Resumen de Valorización de la vista actual */}
  <View style={styles.kpiStrip}>
            <View style={styles.kpiItem}>
              <Text style={styles.kpiLabel}>MOSTRANDO</Text>
              <Text style={[styles.kpiValue, typography.tabularNumeric]}>
                {inventorySummary.skuCount} SKUs ({formatQuantity(inventorySummary.totalUnits)} unds)
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
    <View style={[styles.row, isMobile && styles.rowMobile]}>
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
      <View style={[styles.colInfo, isMobile && styles.colInfoMobile]}>
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
      <View style={[styles.colPrice, isMobile && styles.colPriceMobile]}>
        <Text style={[styles.priceText, typography.tabularNumeric]}>
          {formatUsd(item.priceUsd)}
        </Text>
        <Text style={[styles.priceVesText, typography.tabularNumeric]}>
          ≈ {formatVes(priceVes)}
        </Text>
        {item.tracksInventory === false ? (
          <Text style={styles.noTrackingText}>Costo: no aplica</Text>
        ) : (
          <Text style={styles.costText}>Costo: {formatUsd(item.costUsd)}</Text>
        )}
      </View>

      {/* Stock Actual y Badge */}
      <View style={[styles.colStock, isMobile && styles.colStockMobile]}>
        {item.tracksInventory === false ? (
          <View style={[styles.stockBadge, styles.noTrackingBadge]}>
            <Text style={styles.noTrackingBadgeText}>Sin inventario</Text>
          </View>
        ) : (
          <>
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
                {formatQuantity(item.currentStock, item.unit)}
              </Text>
            </View>
            {item.isLowStock && <Text style={styles.alertText}>Alerta Stock Bajo</Text>}
          </>
        )}
      </View>

      {/* Acciones Táctiles (>= 48px) */}
      <View style={[styles.colActions, isMobile && styles.colActionsMobile]}>
        {item.tracksInventory !== false && (
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => handleOpenKardex(item)}
            style={[styles.kardexBtn, isMobile && styles.actionBtnMobile]}
          >
            <Text style={styles.kardexBtnText}>Ajustar Stock</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => handleOpenEditProduct(item)}
          style={[styles.editBtn, isMobile && styles.actionBtnMobile]}
        >
          <Text style={styles.editBtnText}>✎ Editar</Text>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => handleOpenDeleteProduct(item)}
          style={[styles.deleteRowBtn, isMobile && styles.actionBtnMobile]}
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
{
  (selectedCategory !== "ALL" || stockFilter !== "ALL" || search.trim() !== "") && (
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
  )
}
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
            placeholderTextColor={theme.textMuted}
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
              placeholderTextColor={theme.textMuted}
              value={formSku}
              onChangeText={setFormSku}
            />
          </View>

          <View style={[styles.inputGroup, { flex: 1 }]}>
            <Text style={styles.inputLabel}>Código de Barras (Lector HID)</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Escanee con el lector..."
              placeholderTextColor={theme.textMuted}
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
              placeholderTextColor={theme.textMuted}
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

        {/* Selector Táctil de Unidad de Medida */}
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Unidad de Medida *</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.modalCategoryRow}
          >
            {UNIT_OPTIONS.map((u) => {
              const isSelected = formUnit === u.id;
              return (
                <TouchableOpacity
                  key={u.id}
                  activeOpacity={0.8}
                  onPress={() => setFormUnit(u.id)}
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
                    {u.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Rubro sin control de inventario: sin costo de reposición, sin kardex, sin alertas */}
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => setFormTracksInventory((prev) => !prev)}
          style={styles.checkboxRow}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: formTracksInventory }}
          accessibilityLabel="Controlar inventario de este rubro (kardex, costo y alertas)"
        >
          <View
            style={[
              styles.checkboxSquare,
              formTracksInventory && styles.checkboxSquareActive,
            ]}
          >
            {formTracksInventory && <Text style={styles.checkboxMark}>✓</Text>}
          </View>
          <Text style={styles.checkboxLabel}>
            Controlar inventario (kardex, costo de reposición y alertas de stock)
          </Text>
        </TouchableOpacity>

        {!formTracksInventory && (
          <Text style={styles.noTrackingHint}>
            Sin inventario: no se guarda costo de reposición, las ventas no descuentan stock y
            este rubro no aparece en alertas ni en la valorización.
          </Text>
        )}

        <View style={styles.rowInputs}>
          <View style={[styles.inputGroup, { flex: 1 }]}>
            <Text style={styles.inputLabel}>Precio Base USD ($) *</Text>
            <TextInput
              style={[styles.modalInput, typography.tabularNumeric]}
              placeholder="0.0000"
              keyboardType="decimal-pad"
              placeholderTextColor={theme.textMuted}
              value={formPriceUsd}
              onChangeText={setFormPriceUsd}
            />
          </View>

          {formTracksInventory && (
            <View style={[styles.inputGroup, { flex: 1 }]}>
              <Text style={styles.inputLabel}>Costo Reposición USD ($) *</Text>
              <TextInput
                style={[styles.modalInput, typography.tabularNumeric]}
                placeholder="0.0000"
                keyboardType="decimal-pad"
                placeholderTextColor={theme.textMuted}
                value={formCostUsd}
                onChangeText={setFormCostUsd}
              />
            </View>
          )}

          <View style={[styles.inputGroup, { flex: 1 }]}>
            <Text style={styles.inputLabel}>IVA (% sugerido)</Text>
            <TextInput
              style={[styles.modalInput, typography.tabularNumeric]}
              placeholder={taxRateToPercent(getDefaultTaxRate(db))}
              keyboardType="decimal-pad"
              placeholderTextColor={theme.textMuted}
              value={formTaxRate}
              onChangeText={setFormTaxRate}
              accessibilityLabel="Alícuota de IVA del producto en porcentaje"
            />
          </View>

          {formTracksInventory && (
            <View style={[styles.inputGroup, { flex: 1 }]}>
              <Text style={styles.inputLabel}>Stock Mínimo ({formUnit})</Text>
              <TextInput
                style={[styles.modalInput, typography.tabularNumeric]}
                placeholder="5"
                keyboardType="decimal-pad"
                placeholderTextColor={theme.textMuted}
                value={formMinStock}
                onChangeText={setFormMinStock}
              />
            </View>
          )}

          {formTracksInventory &&
            !editingProductId && (
              <View style={[styles.inputGroup, { flex: 1 }]}>
                <Text style={styles.inputLabel}>Stock Inicial ({formUnit})</Text>
                <TextInput
                  style={[styles.modalInput, typography.tabularNumeric]}
                  placeholder="0"
                  keyboardType="decimal-pad"
                  placeholderTextColor={theme.textMuted}
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
          <Text style={{ color: theme.heroText, fontWeight: "bold" }}>
            {formatQuantity(kardexProduct.currentStock, kardexProduct.unit)}
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
          <Text style={styles.inputLabel}>
            Cantidad Delta {kardexProduct?.unit ? `(${kardexProduct.unit})` : ""}:
          </Text>
          <TextInput
            style={[styles.modalInput, typography.tabularNumeric]}
            placeholder="0"
            keyboardType="decimal-pad"
            placeholderTextColor={theme.textMuted}
            value={kardexDelta}
            onChangeText={setKardexDelta}
          />
        </View>

        <View style={[styles.inputGroup, { flex: 2 }]}>
          <Text style={styles.inputLabel}>Motivo / Referencia (Opcional):</Text>
          <TextInput
            style={styles.modalInput}
            placeholder="Ej. Factura proveedor #1234"
            placeholderTextColor={theme.textMuted}
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
                {formatQuantity(mov.quantityDelta, kardexProduct?.unit)}
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
              {formatQuantity(deleteTarget.product.currentStock, deleteTarget.product.unit)}
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
                {formatQuantity(deleteTarget.product.currentStock, deleteTarget.product.unit)})
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
                  Registrar ajuste automático en Kardex para dejar el stock en 0 {deleteTarget.product.unit}
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
          <Text style={{ color: theme.error }}>BORRAR</Text> en el campo:
        </Text>
        <TextInput
          style={[
            styles.modalInput,
            deleteConfirmInput.trim().toUpperCase() === "BORRAR" &&
            styles.deleteInputConfirmed,
          ]}
          placeholder='Escriba "BORRAR" aquí...'
          placeholderTextColor={theme.textMuted}
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

const makeStyles = (c: Palette) =>
  StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: c.surfaceBase,
    padding: spacing.lg,
  },
  containerMobile: {
    padding: spacing.md,
  },
  fullWidth: {
    flexBasis: "100%",
    maxWidth: undefined,
    flexGrow: 0,
    flexShrink: 0,
  },
  topBar: {
    flexDirection: "row",
    flexWrap: "wrap",
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
    color: c.textPrimary,
  },
  subtitle: {
    fontSize: typography.sizes.caption,
    color: c.textSecondary,
    marginTop: 2,
  },
  searchInput: {
    flex: 2,
    maxWidth: 400,
    height: spacing.touchTargetMin, // 48px
    backgroundColor: c.surfaceContainerHigh,
    borderRadius: spacing.radiusMd,
    paddingHorizontal: spacing.md,
    color: c.textPrimary,
    borderWidth: 1,
    borderColor: c.border,
  },
  newProductBtn: {
    height: spacing.touchTargetMin, // 48px
    backgroundColor: c.primary, // #1D61E0
    borderRadius: spacing.radiusMd,
    paddingHorizontal: spacing.lg,
    justifyContent: "center",
    alignItems: "center",
  },
  newProductBtnText: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    color: c.onPrimary,
  },
  organizationPanel: {
    backgroundColor: c.surfaceContainerLow,
    borderRadius: spacing.radiusLg,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: c.border,
    gap: spacing.sm,
  },
  categoryBarRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  categoryScrollView: {
    flex: 1,
  },
  categoryActionsRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingLeft: spacing.sm,
  },
  deleteCategoryFixedBtn: {
    height: spacing.touchTargetMin, // 48px
    backgroundColor: c.errorSoft,
    paddingHorizontal: spacing.md,
    borderRadius: spacing.radiusFull,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: c.error,
  },
  deleteCategoryFixedBtnText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: c.errorText,
  },
  categoryScrollContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingBottom: 2,
  },
  categoryChip: {
    height: spacing.touchTargetMin, // 48px
    backgroundColor: c.surfaceContainer,
    paddingHorizontal: spacing.md,
    borderRadius: spacing.radiusFull,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: c.border,
  },
  categoryChipActive: {
    backgroundColor: c.primary,
    borderColor: c.primaryGlow,
  },
  categoryChipText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.semibold,
    color: c.textSecondary,
  },
  categoryChipTextActive: {
    color: c.onPrimary,
    fontWeight: typography.weights.bold,
  },
  addCategoryChip: {
    height: spacing.touchTargetMin, // 48px
    backgroundColor: c.surfaceContainerHigh,
    paddingHorizontal: spacing.md,
    borderRadius: spacing.radiusFull,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: c.primaryGlow,
  },
  addCategoryChipText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: c.primaryGlow,
  },
  inlineCategoryBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  inlineCategoryInput: {
    height: spacing.touchTargetMin,
    minWidth: 160,
    backgroundColor: c.surfaceContainerHigh,
    borderRadius: spacing.radiusMd,
    paddingHorizontal: spacing.md,
    color: c.textPrimary,
    borderWidth: 1,
    borderColor: c.primaryGlow,
  },
  inlineCategoryConfirmBtn: {
    height: spacing.touchTargetMin,
    backgroundColor: c.hero,
    paddingHorizontal: spacing.md,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
  },
  inlineCategoryConfirmText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: c.onHero,
  },
  inlineCategoryCancelBtn: {
    height: spacing.touchTargetMin,
    width: spacing.touchTargetMin,
    backgroundColor: c.surfaceContainer,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: c.border,
  },
  inlineCategoryCancelText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: c.textSecondary,
  },
  controlsAndKpiRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: c.border,
    paddingTop: spacing.sm,
  },
  filterGroup: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.xs,
    maxWidth: "100%",
    flexShrink: 1,
  },
  controlGroupLabel: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: c.textMuted,
    marginRight: 4,
  },
  filterPill: {
    minHeight: 40,
    backgroundColor: c.surfaceContainer,
    paddingHorizontal: spacing.md,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: c.border,
  },
  filterPillActive: {
    backgroundColor: c.surfaceContainerHighest,
    borderColor: c.primaryGlow,
  },
  filterPillWarningActive: {
    backgroundColor: c.warningSoft,
    borderColor: c.warning,
  },
  filterPillErrorActive: {
    backgroundColor: c.errorSoft,
    borderColor: c.error,
  },
  filterPillText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.semibold,
    color: c.textSecondary,
  },
  filterPillTextActive: {
    color: c.textPrimary,
    fontWeight: typography.weights.bold,
  },
  filterPillWarningTextActive: {
    color: c.warningText,
    fontWeight: typography.weights.bold,
  },
  filterPillErrorTextActive: {
    color: c.errorText,
    fontWeight: typography.weights.bold,
  },
  sortPill: {
    minHeight: 40,
    backgroundColor: c.surfaceContainer,
    paddingHorizontal: spacing.sm,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: c.border,
  },
  sortPillActive: {
    backgroundColor: c.primary,
    borderColor: c.primaryGlow,
  },
  sortPillText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.semibold,
    color: c.textSecondary,
  },
  sortPillTextActive: {
    color: c.onPrimary,
    fontWeight: typography.weights.bold,
  },
  kpiStrip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: c.surfaceContainer,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: spacing.radiusMd,
    borderWidth: 1,
    borderColor: c.border,
    gap: spacing.md,
  },
  kpiItem: {
    alignItems: "flex-end",
  },
  kpiLabel: {
    fontSize: 12,
    fontWeight: typography.weights.bold,
    color: c.textMuted,
  },
  kpiValue: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: c.textPrimary,
  },
  kpiValueHero: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: c.heroText,
  },
  kpiDivider: {
    width: 1,
    height: 24,
    backgroundColor: c.border,
  },
  productHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  rowCategoryTag: {
    backgroundColor: c.surfaceContainerHighest,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: spacing.radiusFull,
  },
  rowCategoryTagText: {
    fontSize: 12,
    fontWeight: typography.weights.bold,
    color: c.primaryGlow,
  },
  resetFiltersBtn: {
    marginTop: spacing.md,
    height: spacing.touchTargetMin,
    backgroundColor: c.surfaceContainerHigh,
    paddingHorizontal: spacing.lg,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: c.primaryGlow,
  },
  resetFiltersBtnText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: c.primaryGlow,
  },
  modalCategoryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 4,
  },
  modalCategoryOption: {
    height: spacing.touchTargetMin, // 48px
    backgroundColor: c.surfaceContainerHigh,
    paddingHorizontal: spacing.md,
    borderRadius: spacing.radiusFull,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: c.border,
  },
  modalCategoryOptionActive: {
    backgroundColor: c.primary,
    borderColor: c.primaryGlow,
  },
  modalCategoryOptionText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.semibold,
    color: c.textSecondary,
  },
  modalCategoryOptionTextActive: {
    color: c.onPrimary,
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
    backgroundColor: c.primary,
    paddingHorizontal: spacing.md,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
  },
  modalCreateCatBtnText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: c.onPrimary,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: c.surfaceContainerLow,
    borderRadius: spacing.radiusLg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: c.border,
    gap: spacing.md,
  },
  rowMobile: {
    flexWrap: "wrap",
  },
  colInfoMobile: {
    flex: 1,
    minWidth: 0,
  },
  colPriceMobile: {
    flex: 0,
    flexBasis: "auto",
    alignItems: "flex-start",
  },
  colStockMobile: {
    flex: 0,
    flexBasis: "auto",
  },
  colActionsMobile: {
    flexBasis: "100%",
  },
  actionBtnMobile: {
    flex: 1,
  },
  imageCol: {
    width: 56,
    height: 56,
    borderRadius: spacing.radiusMd,
    overflow: "hidden",
    backgroundColor: c.surfaceContainer,
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
    color: c.textPrimary,
  },
  metaText: {
    fontSize: typography.sizes.caption,
    color: c.textSecondary,
    marginTop: 2,
  },
  metaHighlight: {
    color: c.primaryGlow,
    fontWeight: typography.weights.bold,
  },
  colPrice: {
    flex: 2,
    alignItems: "flex-end",
  },
  priceText: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    color: c.textPrimary,
  },
  priceVesText: {
    fontSize: typography.sizes.caption,
    color: c.primaryGlow,
    fontWeight: typography.weights.semibold,
  },
  costText: {
    fontSize: typography.sizes.caption,
    color: c.textMuted,
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
    backgroundColor: c.surfaceContainer,
  },
  lowStockBadge: {
    backgroundColor: c.warningSoft,
  },
  stockText: {
    fontSize: typography.sizes.subText,
    fontWeight: typography.weights.bold,
  },
  normalStockText: {
    color: c.textPrimary,
  },
  lowStockText: {
    color: c.warningText,
  },
  alertText: {
    fontSize: typography.sizes.caption,
    color: c.warningText,
    marginTop: 2,
  },
  noTrackingText: {
    fontSize: typography.sizes.caption,
    color: c.textMuted,
    marginTop: 2,
    fontStyle: "italic",
  },
  noTrackingBadge: {
    backgroundColor: c.surfaceContainerHigh,
    borderWidth: 1,
    borderColor: c.border,
  },
  noTrackingBadgeText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.semibold,
    color: c.textMuted,
  },
  noTrackingHint: {
    fontSize: typography.sizes.caption,
    color: c.textMuted,
    marginBottom: spacing.sm,
    lineHeight: 18,
  },
  colActions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  kardexBtn: {
    height: spacing.touchTargetMin, // 48px
    backgroundColor: c.surfaceContainerHigh,
    paddingHorizontal: spacing.md,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: c.border,
  },
  kardexBtnText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: c.textPrimary,
  },
  editBtn: {
    height: spacing.touchTargetMin, // 48px
    backgroundColor: c.surfaceContainer,
    paddingHorizontal: spacing.md,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: c.border,
  },
  editBtnText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.semibold,
    color: c.textSecondary,
  },
  emptyContainer: {
    paddingVertical: 80,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    fontSize: typography.sizes.titleMd,
    color: c.textSecondary,
    fontWeight: typography.weights.semibold,
  },
  emptySubText: {
    fontSize: typography.sizes.caption,
    color: c.textMuted,
    marginTop: spacing.xs,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: c.overlay,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.xl,
  },
  modalCard: {
    width: "100%",
    maxWidth: 620,
    backgroundColor: c.surfaceContainerLow,
    borderRadius: spacing.radiusXl,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: c.border,
  },
  modalTitle: {
    fontSize: typography.sizes.titleLg,
    fontWeight: typography.weights.bold,
    color: c.textPrimary,
  },
  modalSubtitle: {
    fontSize: typography.sizes.caption,
    color: c.textSecondary,
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
    color: c.textSecondary,
    marginBottom: 4,
  },
  modalInput: {
    height: spacing.touchTargetMin, // 48px
    backgroundColor: c.surfaceContainerHigh,
    borderRadius: spacing.radiusMd,
    paddingHorizontal: spacing.md,
    color: c.textPrimary,
    borderWidth: 1,
    borderColor: c.border,
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
    backgroundColor: c.surfaceContainerHigh,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: "center",
    justifyContent: "center",
  },
  pickImageBtn: {
    height: spacing.touchTargetMin, // 48px
    backgroundColor: c.surfaceContainerHigh,
    paddingHorizontal: spacing.lg,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: c.primaryGlow,
  },
  pickImageBtnText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: c.primaryGlow,
  },
  removeImageBtn: {
    height: spacing.touchTargetMin, // 48px
    paddingHorizontal: spacing.md,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: c.error,
  },
  removeImageBtnText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: c.errorText,
  },
  movementTypeRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  typeBtn: {
    flex: 1,
    height: spacing.touchTargetMin, // 48px
    backgroundColor: c.surfaceContainerHigh,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: c.border,
  },
  typeBtnActive: {
    backgroundColor: c.primary,
    borderColor: c.primaryGlow,
  },
  typeBtnText: {
    fontSize: typography.sizes.caption,
    color: c.textSecondary,
    fontWeight: typography.weights.medium,
  },
  typeBtnTextActive: {
    color: c.onPrimary,
    fontWeight: typography.weights.bold,
  },
  historyBox: {
    backgroundColor: c.surfaceContainer,
    borderRadius: spacing.radiusMd,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: 4,
  },
  historyTitle: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: c.textSecondary,
    marginBottom: 4,
  },
  historyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  historyType: {
    fontSize: typography.sizes.caption,
    color: c.textPrimary,
  },
  historyDelta: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
  },
  historyPositive: {
    color: c.heroText,
  },
  historyNegative: {
    color: c.errorText,
  },
  errorText: {
    fontSize: typography.sizes.caption,
    color: c.errorText,
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
    borderColor: c.border,
  },
  cancelBtnText: {
    fontSize: typography.sizes.body,
    color: c.textSecondary,
  },
  saveBtn: {
    height: spacing.touchTargetMin, // 48px
    backgroundColor: c.hero, // #00B074
    paddingHorizontal: spacing.xl,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
  },
  saveBtnText: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    color: c.onHero,
  },
  categoryChipWrapper: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  deleteCategoryChipBtn: {
    height: spacing.touchTargetMin, // 48px
    backgroundColor: c.errorSoft,
    paddingHorizontal: spacing.md,
    borderRadius: spacing.radiusFull,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: c.error,
  },
  deleteCategoryChipBtnText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: c.errorText,
  },
  deleteRowBtn: {
    height: spacing.touchTargetMin, // 48px
    backgroundColor: c.errorSoft,
    paddingHorizontal: spacing.md,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: c.error,
  },
  deleteRowBtnText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: c.errorText,
  },
  modalDeleteProductBtn: {
    height: spacing.touchTargetMin, // 48px
    backgroundColor: c.errorSoft,
    paddingHorizontal: spacing.md,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: c.error,
    marginRight: "auto",
  },
  modalDeleteProductBtnText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: c.errorText,
  },
  dangerModalCard: {
    borderColor: c.error,
    borderWidth: 1.5,
  },
  dangerModalTitle: {
    fontSize: typography.sizes.titleLg,
    fontWeight: typography.weights.bold,
    color: c.errorText,
    marginBottom: spacing.sm,
  },
  deleteSummaryBox: {
    backgroundColor: c.surfaceContainer,
    borderRadius: spacing.radiusMd,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: c.border,
    gap: 6,
  },
  deleteEntityName: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    color: c.textPrimary,
  },
  deleteEntitySub: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.semibold,
    color: c.primaryGlow,
  },
  deleteNoticeText: {
    fontSize: typography.sizes.caption,
    color: c.textSecondary,
    marginTop: 2,
  },
  stockWarningBox: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    backgroundColor: c.warningSoft,
    borderRadius: spacing.radiusMd,
    borderWidth: 1,
    borderColor: c.warning,
    gap: spacing.xs,
  },
  stockWarningTitle: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: c.warningText,
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
    borderColor: c.textSecondary,
    backgroundColor: c.surfaceContainerHigh,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxSquareActive: {
    backgroundColor: c.primary,
    borderColor: c.primaryGlow,
  },
  checkboxSquareDangerActive: {
    backgroundColor: c.error,
    borderColor: c.error,
  },
  checkboxMark: {
    fontSize: 14,
    fontWeight: typography.weights.bold,
    color: c.textPrimary,
  },
  checkboxLabel: {
    flex: 1,
    fontSize: typography.sizes.caption,
    color: c.textPrimary,
    fontWeight: typography.weights.medium,
  },
  deleteInputConfirmed: {
    borderColor: c.error,
    backgroundColor: c.errorSoft,
  },
  confirmDeleteBtn: {
    height: spacing.touchTargetMin, // 48px
    backgroundColor: c.error,
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
    color: c.onPrimary,
  },
});
