import React, { useState, useEffect, useMemo, useCallback } from "react";
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
import { ButtonHero } from "../components/ButtonHero";
import { TouchStepper } from "../components/TouchStepper";
import { Numpad } from "../components/Numpad";
import {
  formatUsd,
  formatVes,
  convertUsdToVes,
  toDecimal,
  formatFixed4,
} from "../utils/decimal";
import type { SqlDriver } from "../database/connection";
import { getCatalogWithBimonetaryPrices } from "../services/catalog.service";
import type { BimonetaryProduct } from "../services/catalog.service";
import { registerManualRate } from "../services/bcv-exchange.service";
import { createInvoice } from "../database/repositories/invoice.repository";
import type { PaymentMethod } from "../database/repositories/invoice.repository";
import { getOpenShift } from "../database/repositories/shift.repository";
import {
  useBarcodeScanner,
  findProductByBarcode,
} from "../services/barcode-scanner.service";
import type { KeyEventTargetLike } from "../services/barcode-scanner.service";
import { listCategories } from "../database/repositories/product.repository";
import type { CategoryEntity } from "../database/repositories/product.repository";
import {
  createDefaultFileStore,
  resolveProductImageUri,
} from "../services/image-compressor.service";
import type { FileStore } from "../services/image-compressor.service";

export interface PosProductItem {
  id: string;
  sku: string;
  barcode?: string | null;
  name: string;
  priceUsd: string;
  category?: string;
  categoryId?: string | null;
  categoryName?: string | null;
  currentStock?: string;
  minStock?: string;
  isLowStock?: boolean;
  unit?: string;
  imagePath?: string | null;
  taxRate?: string;
}

export interface PosTicketItem {
  productId: string;
  sku: string;
  name: string;
  unitPriceUsd: string;
  quantity: string;
  lineTotalUsd: string;
  unit?: string;
  taxRate?: string;
}

export interface PosScreenProps {
  db?: SqlDriver;
  terminalId?: string;
  tenantId?: string;
  fileStore?: FileStore;
  initialExchangeRate?: string;
  initialProducts?: PosProductItem[];
  keyEventTarget?: KeyEventTargetLike;
  onRateChange?: (newRate: string) => void;
  onInvoiceCreated?: (invoiceId: string) => void;
}

const DEFAULT_PRODUCTS: PosProductItem[] = [
  { id: "1", sku: "HAR-01", name: "Harina PAN 1kg", priceUsd: "1.2500", category: "Víveres", currentStock: "24.0000", minStock: "5.0000", isLowStock: false, unit: "und" },
  { id: "2", sku: "ARR-02", name: "Arroz Primor 1kg", priceUsd: "1.5000", category: "Granos", currentStock: "3.0000", minStock: "5.0000", isLowStock: true, unit: "und" },
  { id: "3", sku: "ACE-03", name: "Aceite Mazeite 1L", priceUsd: "3.8000", category: "Aceites", currentStock: "0.0000", minStock: "5.0000", isLowStock: true, unit: "und" },
  { id: "4", sku: "CAF-04", name: "Café Fama de América 500g", priceUsd: "4.2000", category: "Bebidas", currentStock: "15.0000", minStock: "5.0000", isLowStock: false, unit: "und" },
  { id: "5", sku: "PAS-05", name: "Pasta Primor Corta 1kg", priceUsd: "1.7500", category: "Víveres", currentStock: "18.0000", minStock: "5.0000", isLowStock: false, unit: "und" },
  { id: "6", sku: "AZU-06", name: "Azúcar Montalbán 1kg", priceUsd: "1.3500", category: "Víveres", currentStock: "9.0000", minStock: "5.0000", isLowStock: false, unit: "und" },
];

export const PosScreen: React.FC<PosScreenProps> = ({
  db,
  terminalId = "TERM-01",
  tenantId = "TENANT-001",
  fileStore: customFileStore,
  initialExchangeRate = "36.5000",
  initialProducts,
  keyEventTarget,
  onRateChange,
  onInvoiceCreated,
}) => {
  const [exchangeRate, setExchangeRate] = useState<string>(initialExchangeRate);
  const [catalog, setCatalog] = useState<PosProductItem[]>(initialProducts ?? DEFAULT_PRODUCTS);
  const [categories, setCategories] = useState<CategoryEntity[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [ticketItems, setTicketItems] = useState<PosTicketItem[]>([]);
  const [stockNotice, setStockNotice] = useState<string | null>(null);

  const fileStore = useMemo(() => customFileStore ?? createDefaultFileStore(), [customFileStore]);

  // Carga reactiva de catálogo, categorías y tasa desde SQLite si el driver está presente
  const refreshCatalog = useCallback(() => {
    if (db) {
      const result = getCatalogWithBimonetaryPrices(db, initialExchangeRate, { tenantId });
      if (result.products.length > 0) {
        setCatalog(
          result.products.map((p) => ({
            id: p.id,
            sku: p.sku,
            barcode: p.barcode,
            name: p.name,
            priceUsd: p.priceUsd,
            category: p.categoryName ?? undefined,
            categoryId: p.categoryId,
            categoryName: p.categoryName,
            currentStock: p.currentStock,
            minStock: p.minStock,
            isLowStock: p.isLowStock,
            unit: p.unit,
            imagePath: p.imagePath,
            taxRate: p.taxRate,
          })),
        );
      }
      setExchangeRate(result.activeRate);

      try {
        const cats = listCategories(db);
        setCategories(cats);
      } catch {
        // Ignorar si la tabla no está lista
      }
    }
  }, [db, initialExchangeRate, tenantId]);

  useEffect(() => {
    refreshCatalog();
  }, [refreshCatalog]);

  const addToCart = useCallback((product: PosProductItem) => {
    // Verificar si el producto tiene stock <= 0 para advertir
    const stockVal = toDecimal(product.currentStock ?? "100.0000");
    if (stockVal.lte(0)) {
      setStockNotice(`Aviso: "${product.name}" se encuentra sin stock (0.0000). Se añade al ticket en modo contingencia.`);
      setTimeout(() => setStockNotice(null), 3000);
    }

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
          unit: product.unit ?? "und",
          taxRate: product.taxRate ?? "0.1600",
        },
      ];
    });
  }, []);

  // Escaneo reactivo mediante lector HID de código de barras
  useBarcodeScanner({
    target: keyEventTarget,
    onScan: (scannedBarcode) => {
      if (db) {
        const found = findProductByBarcode(db, scannedBarcode);
        if (found) {
          // Buscar producto en catálogo en memoria para heredar currentStock y unit
          const catItem = catalog.find((p) => p.id === found.productId);
          addToCart({
            id: found.productId,
            sku: found.sku,
            name: found.name,
            priceUsd: found.priceUsd,
            currentStock: catItem?.currentStock,
            minStock: catItem?.minStock,
            unit: catItem?.unit,
            taxRate: catItem?.taxRate,
          });
          return;
        }
      }
      const match = catalog.find((p) => p.sku === scannedBarcode || p.barcode === scannedBarcode);
      if (match) {
        addToCart(match);
      }
    },
  });

  // Filtrado reactivo por texto y categoría seleccionada
  const filteredCatalog = useMemo(() => {
    return catalog.filter((item) => {
      const matchesSearch =
        searchQuery.trim() === "" ||
        item.name.toLowerCase().includes(searchQuery.toLowerCase().trim()) ||
        item.sku.toLowerCase().includes(searchQuery.toLowerCase().trim()) ||
        (item.barcode && item.barcode.toLowerCase().includes(searchQuery.toLowerCase().trim()));

      const matchesCat =
        selectedCategory === "ALL" ||
        item.categoryId === selectedCategory ||
        item.category === selectedCategory ||
        item.categoryName === selectedCategory;

      return matchesSearch && matchesCat;
    });
  }, [catalog, searchQuery, selectedCategory]);

  // Estado del modal de actualización de tasa
  const [isRateModalOpen, setIsRateModalOpen] = useState(false);
  const [newRateInput, setNewRateInput] = useState("");
  const [rateReasonInput, setRateReasonInput] = useState("");
  const [rateError, setRateError] = useState<string | null>(null);

  // Estado del modal de cobro (Checkout)
  const [isCheckoutModalOpen, setIsCheckoutModalOpen] = useState(false);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethod>("CASH_USD");
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [lastInvoiceSuccess, setLastInvoiceSuccess] = useState<string | null>(null);

  // Estado del modal táctil Numpad para edición de cantidad de línea
  const [editingTicketItem, setEditingTicketItem] = useState<PosTicketItem | null>(null);
  const [numpadValue, setNumpadValue] = useState("");
  const [numpadError, setNumpadError] = useState<string | null>(null);

  // Estado del modal de confirmación para vaciar ticket
  const [isClearTicketModalOpen, setIsClearTicketModalOpen] = useState(false);

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

  const removeTicketItem = (productId: string) => {
    setTicketItems((prev) => prev.filter((i) => i.productId !== productId));
  };

  const openNumpadForLine = (item: PosTicketItem) => {
    setEditingTicketItem(item);
    setNumpadValue(item.quantity);
    setNumpadError(null);
  };

  const handleNumpadDigit = (digit: string) => {
    setNumpadValue((prev) => {
      if (prev === "0" || prev === "0.0000") return digit;
      return prev + digit;
    });
  };

  const handleNumpadDecimal = () => {
    setNumpadValue((prev) => {
      if (!prev) return "0.";
      if (prev.includes(".")) return prev;
      return prev + ".";
    });
  };

  const handleNumpadBackspace = () => {
    setNumpadValue((prev) => {
      if (prev.length <= 1) return "";
      return prev.slice(0, -1);
    });
  };

  const handleNumpadClear = () => {
    setNumpadValue("");
    setNumpadError(null);
  };

  const handleConfirmNumpadQuantity = () => {
    if (!editingTicketItem) return;
    try {
      const val = toDecimal(numpadValue || "0", "Cantidad");
      if (val.lte(0)) {
        throw new Error("La cantidad debe ser mayor a cero");
      }
      const qtyStr = val.toFixed(4);
      const lineTotal = val.times(toDecimal(editingTicketItem.unitPriceUsd)).toFixed(4);

      setTicketItems((prev) =>
        prev.map((i) =>
          i.productId === editingTicketItem.productId
            ? { ...i, quantity: qtyStr, lineTotalUsd: lineTotal }
            : i,
        ),
      );
      setEditingTicketItem(null);
      setNumpadValue("");
    } catch (err) {
      setNumpadError((err as Error).message);
    }
  };

  const handleClearAllTicket = () => {
    setTicketItems([]);
    setIsClearTicketModalOpen(false);
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

  // Cálculo reactivo en vivo de subtotales, IVA y totales bimoneda
  const subtotalUsd = useMemo(() => {
    return ticketItems
      .reduce((acc, item) => acc.plus(toDecimal(item.lineTotalUsd)), toDecimal("0"))
      .toFixed(4);
  }, [ticketItems]);

  const taxUsd = useMemo(() => {
    return ticketItems
      .reduce((acc, item) => {
        const lineVal = toDecimal(item.lineTotalUsd);
        const rateVal = toDecimal(item.taxRate ?? "0.1600");
        return acc.plus(lineVal.times(rateVal));
      }, toDecimal("0"))
      .toFixed(4);
  }, [ticketItems]);

  const totalUsd = useMemo(() => {
    return toDecimal(subtotalUsd).plus(toDecimal(taxUsd)).toFixed(4);
  }, [subtotalUsd, taxUsd]);

  const subtotalVes = useMemo(() => {
    return convertUsdToVes(subtotalUsd, exchangeRate).toFixed(4);
  }, [subtotalUsd, exchangeRate]);

  const taxVes = useMemo(() => {
    return convertUsdToVes(taxUsd, exchangeRate).toFixed(4);
  }, [taxUsd, exchangeRate]);

  const totalVes = useMemo(() => {
    return convertUsdToVes(totalUsd, exchangeRate).toFixed(4);
  }, [totalUsd, exchangeRate]);

  const handleOpenCheckout = () => {
    if (ticketItems.length === 0) return;
    setCheckoutError(null);
    setLastInvoiceSuccess(null);
    setIsCheckoutModalOpen(true);
  };

  const handleConfirmCheckout = () => {
    try {
      setCheckoutError(null);

      if (db) {
        const openShift = getOpenShift(db, terminalId);
        if (!openShift) {
          throw new Error("No hay un turno de caja abierto. Vaya a 'Turnos' para abrir la sesión.");
        }

        const itemsInput = ticketItems.map((item) => {
          const unitVes = convertUsdToVes(item.unitPriceUsd, exchangeRate).toFixed(4);
          const lineVes = convertUsdToVes(item.lineTotalUsd, exchangeRate).toFixed(4);
          return {
            productId: item.productId,
            quantity: item.quantity,
            unitPriceUsd: item.unitPriceUsd,
            unitPriceVes: unitVes,
            lineTotalUsd: item.lineTotalUsd,
            lineTotalVes: lineVes,
            taxRate: item.taxRate ?? "0.1600",
          };
        });

        const invoiceId = createInvoice(db, {
          shiftId: openShift.id,
          terminalId,
          exchangeRate,
          subtotalUsd,
          taxUsd,
          totalUsd,
          subtotalVes,
          taxVes,
          totalVes,
          paymentMethod: selectedPaymentMethod,
          items: itemsInput,
        });

        onInvoiceCreated?.(invoiceId);
      }

      setLastInvoiceSuccess(`¡Venta cobrada con éxito!`);
      setTicketItems([]);
      setTimeout(() => {
        setIsCheckoutModalOpen(false);
        setLastInvoiceSuccess(null);
      }, 1200);
    } catch (err) {
      setCheckoutError((err as Error).message);
    }
  };

  return (
    <View style={styles.container}>
      {/* Columna Izquierda: Catálogo de Productos */}
      <View style={styles.catalogColumn}>
        <View style={styles.catalogHeader}>
          <View>
            <Text style={styles.sectionTitle}>Catálogo de Productos</Text>
            <Text style={styles.catalogCountSub}>
              {filteredCatalog.length} {filteredCatalog.length === 1 ? "producto" : "productos"}
            </Text>
          </View>

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

        {/* Notificación flotante de stock si se añade un producto agotado */}
        {stockNotice ? (
          <View style={styles.stockNoticeBox}>
            <Text style={styles.stockNoticeText}>⚠️ {stockNotice}</Text>
          </View>
        ) : null}

        {/* Barra de Búsqueda Reactiva */}
        <View style={styles.searchContainer}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Buscar por nombre, SKU o código de barras..."
            placeholderTextColor={colors.dark.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            clearButtonMode="while-editing"
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery("")} style={styles.searchClearBtn}>
              <Text style={styles.searchClearText}>✕</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Chips de Filtro por Categorías */}
        <View style={styles.categoryBarContainer}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categoryScroll}
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
                Todas ({catalog.length})
              </Text>
            </TouchableOpacity>

            {categories.map((cat) => {
              const isSelected = selectedCategory === cat.id || selectedCategory === cat.name;
              const count = catalog.filter(
                (p) => p.categoryId === cat.id || p.category === cat.name || p.categoryName === cat.name,
              ).length;
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
          </ScrollView>
        </View>

        <FlatList
          data={filteredCatalog}
          keyExtractor={(item) => item.id}
          numColumns={2}
          contentContainerStyle={styles.catalogGrid}
          renderItem={({ item }) => {
            const priceVes = convertUsdToVes(item.priceUsd, exchangeRate).toFixed(4);
            const stockDecimal = toDecimal(item.currentStock ?? "0.0000");
            const isOutOfStock = stockDecimal.lte(0);
            const isLowStock = item.isLowStock || (stockDecimal.lte(toDecimal(item.minStock ?? "0.0000")) && !isOutOfStock);
            const imageUri = resolveProductImageUri(fileStore, item.imagePath ?? null);

            return (
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => addToCart(item)}
                style={[styles.productCard, isOutOfStock && styles.productCardOutStock]}
              >
                {/* Cabecera de la tarjeta: Imagen + SKU + Badge de Stock */}
                <View style={styles.cardTopRow}>
                  {imageUri ? (
                    <Image source={{ uri: imageUri }} style={styles.productThumb} resizeMode="cover" />
                  ) : (
                    <View style={styles.productThumbPlaceholder}>
                      <Text style={styles.productThumbPlaceholderText}>📦</Text>
                    </View>
                  )}

                  <View style={styles.cardHeaderMeta}>
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{item.sku}</Text>
                    </View>

                    {/* Badge de Stock */}
                    {isOutOfStock ? (
                      <View style={[styles.stockBadge, styles.stockBadgeOut]}>
                        <Text style={styles.stockBadgeTextOut}>● Agotado (0)</Text>
                      </View>
                    ) : isLowStock ? (
                      <View style={[styles.stockBadge, styles.stockBadgeLow]}>
                        <Text style={styles.stockBadgeTextLow}>
                          ● {formatFixed4(item.currentStock ?? "0")} {item.unit ?? "und"}
                        </Text>
                      </View>
                    ) : (
                      <View style={[styles.stockBadge, styles.stockBadgeOk]}>
                        <Text style={styles.stockBadgeTextOk}>
                          ● {formatFixed4(item.currentStock ?? "0")} {item.unit ?? "und"}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>

                {/* Nombre del Producto */}
                <Text style={styles.productName} numberOfLines={2}>
                  {item.name}
                </Text>

                {/* Precios bimoneda y Unidad */}
                <View style={styles.priceRow}>
                  <View style={styles.priceContainer}>
                    <Text style={[styles.priceUsd, typography.tabularNumeric]}>
                      {formatUsd(item.priceUsd)}
                    </Text>
                    <Text style={[styles.priceVes, typography.tabularNumeric]}>
                      {formatVes(priceVes)}
                    </Text>
                  </View>
                  <Text style={styles.unitTag}>/ {item.unit ?? "und"}</Text>
                </View>
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyCatalogContainer}>
              <Text style={styles.emptyCatalogText}>No se encontraron productos</Text>
              <Text style={styles.emptyCatalogSub}>
                {searchQuery
                  ? `Sin resultados para "${searchQuery}"`
                  : "No hay productos en esta categoría"}
              </Text>
            </View>
          }
        />
      </View>

      {/* Columna Derecha: Ticket Activo de Venta */}
      <View style={styles.ticketColumn}>
        {/* Encabezado de Ticket con Contador y Botón Vaciar */}
        <View style={styles.ticketHeader}>
          <View>
            <Text style={styles.sectionTitle}>Ticket Actual</Text>
            <Text style={styles.itemCountText}>
              {ticketItems.length} {ticketItems.length === 1 ? "ítem" : "ítems"}
            </Text>
          </View>
          {ticketItems.length > 0 ? (
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => setIsClearTicketModalOpen(true)}
              style={styles.clearTicketBtn}
            >
              <Text style={styles.clearTicketText}>🗑️ Vaciar</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <FlatList
          data={ticketItems}
          keyExtractor={(item) => item.productId}
          style={styles.ticketList}
          renderItem={({ item }) => {
            const lineVes = convertUsdToVes(item.lineTotalUsd, exchangeRate).toFixed(4);
            const isDecimalQty = !toDecimal(item.quantity).isInteger();
            return (
              <View style={styles.ticketLine}>
                <View style={styles.ticketLineInfo}>
                  <Text style={styles.ticketLineName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <View style={styles.ticketLineMeta}>
                    <Text style={[styles.ticketLineUnit, typography.tabularNumeric]}>
                      {formatUsd(item.unitPriceUsd)} c/u
                    </Text>
                    {item.taxRate && toDecimal(item.taxRate).gt(0) ? (
                      <View style={styles.taxBadge}>
                        <Text style={styles.taxBadgeText}>IVA {toDecimal(item.taxRate).times(100).toFixed(0)}%</Text>
                      </View>
                    ) : (
                      <View style={[styles.taxBadge, styles.taxBadgeExempt]}>
                        <Text style={styles.taxBadgeTextExempt}>Exento</Text>
                      </View>
                    )}
                  </View>
                </View>

                {/* TouchStepper y botón de edición Numpad */}
                <View style={styles.stepperAndNumpadRow}>
                  <TouchStepper
                    value={isDecimalQty ? item.quantity : toDecimal(item.quantity).toFixed(0)}
                    onIncrement={() => updateQuantity(item.productId, 1)}
                    onDecrement={() => updateQuantity(item.productId, -1)}
                  />

                  {/* Botón táctil para abrir Numpad */}
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => openNumpadForLine(item)}
                    style={styles.numpadTriggerBtn}
                  >
                    <Text style={styles.numpadTriggerText}>🔢</Text>
                  </TouchableOpacity>
                </View>

                {/* Totales de línea y botón eliminar */}
                <View style={styles.ticketLineRight}>
                  <View style={styles.ticketLineTotalContainer}>
                    <Text style={[styles.ticketLineTotal, typography.tabularNumeric]}>
                      {formatUsd(item.lineTotalUsd)}
                    </Text>
                    <Text style={[styles.ticketLineTotalVes, typography.tabularNumeric]}>
                      {formatVes(lineVes)}
                    </Text>
                  </View>

                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => removeTicketItem(item.productId)}
                    style={styles.deleteLineBtn}
                  >
                    <Text style={styles.deleteLineText}>✕</Text>
                  </TouchableOpacity>
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

        {/* Resumen Financiero: Subtotal, IVA y Botón Maestro de Cobro */}
        <View style={styles.checkoutFooter}>
          {ticketItems.length > 0 ? (
            <View style={styles.financialSummaryCard}>
              <View style={styles.financialSummaryRow}>
                <Text style={styles.finLabel}>Subtotal:</Text>
                <Text style={[styles.finValue, typography.tabularNumeric]}>
                  {formatUsd(subtotalUsd)} <Text style={styles.finSub}>({formatVes(subtotalVes)})</Text>
                </Text>
              </View>

              <View style={styles.financialSummaryRow}>
                <Text style={styles.finLabel}>IVA Estimado:</Text>
                <Text style={[styles.finValue, typography.tabularNumeric]}>
                  {formatUsd(taxUsd)} <Text style={styles.finSub}>({formatVes(taxVes)})</Text>
                </Text>
              </View>
            </View>
          ) : null}

          <ButtonHero
            label="COBRAR TICKET"
            totalFormatted={formatUsd(totalUsd)}
            secondaryFormatted={`≈ ${formatVes(totalVes)}`}
            disabled={ticketItems.length === 0}
            onPress={handleOpenCheckout}
          />
        </View>
      </View>

      {/* Modal Táctil de Cobro / Emisión de Factura */}
      <Modal visible={isCheckoutModalOpen} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Confirmar Cobro de Venta</Text>
            <Text style={styles.modalNotice}>
              Al confirmar, se congelarán de forma inmutable la tasa del segundo de cobro y los
              totales legales en ambas monedas, descontando el inventario atómicamente.
            </Text>

            {checkoutError ? <Text style={styles.errorText}>{checkoutError}</Text> : null}
            {lastInvoiceSuccess ? (
              <View style={styles.successBox}>
                <Text style={styles.successText}>{lastInvoiceSuccess}</Text>
              </View>
            ) : null}

            {/* Resumen de Importes Bimoneda con desglose de IVA */}
            <View style={styles.checkoutSummaryCard}>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Subtotal Base Imponible:</Text>
                <Text style={[styles.summarySubtotalUsd, typography.tabularNumeric]}>
                  {formatUsd(subtotalUsd)}
                </Text>
              </View>

              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Impuesto IVA Calculado:</Text>
                <Text style={[styles.summaryTaxUsd, typography.tabularNumeric]}>
                  {formatUsd(taxUsd)}
                </Text>
              </View>

              <View style={styles.summaryDivider} />

              <View style={styles.summaryRow}>
                <Text style={styles.summaryTotalHeroLabel}>Total Legal en Dólares (USD):</Text>
                <Text style={[styles.summaryTotalUsd, typography.tabularNumeric]}>
                  {formatUsd(totalUsd)}
                </Text>
              </View>

              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Equivalente Legal en Bolívares (VES):</Text>
                <Text style={[styles.summaryTotalVes, typography.tabularNumeric]}>
                  {formatVes(totalVes)}
                </Text>
              </View>

              <View style={styles.summaryRowSmall}>
                <Text style={styles.summaryLabelSmall}>Tasa Oficial Congelada:</Text>
                <Text style={[styles.summaryValueSmall, typography.tabularNumeric]}>
                  {formatVes(exchangeRate)}
                </Text>
              </View>
            </View>

            {/* Selección de Método de Pago */}
            <Text style={styles.paymentMethodTitle}>Seleccione Método de Pago:</Text>
            <View style={styles.paymentMethodsGrid}>
              {[
                { id: "CASH_USD", label: "Efectivo USD ($)" },
                { id: "CASH_VES", label: "Efectivo VES (Bs.)" },
                { id: "PAGO_MOVIL", label: "Pago Móvil (Bs.)" },
                { id: "CARD_VES", label: "Punto / Tarjeta (Bs.)" },
              ].map((m) => {
                const isSelected = selectedPaymentMethod === m.id;
                return (
                  <TouchableOpacity
                    key={m.id}
                    activeOpacity={0.8}
                    onPress={() => setSelectedPaymentMethod(m.id as PaymentMethod)}
                    style={[styles.paymentMethodBtn, isSelected && styles.paymentMethodBtnActive]}
                  >
                    <Text
                      style={[
                        styles.paymentMethodText,
                        isSelected && styles.paymentMethodTextActive,
                      ]}
                    >
                      {m.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => setIsCheckoutModalOpen(false)}
                style={styles.cancelBtn}
              >
                <Text style={styles.cancelBtnText}>Volver al Ticket</Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.8}
                onPress={handleConfirmCheckout}
                style={styles.confirmCheckoutBtn}
              >
                <Text style={styles.confirmCheckoutBtnText}>CONFIRMAR COBRO</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

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

      {/* Modal Táctil: Teclado Numérico para Cantidad (Pesables / Bultos) */}
      <Modal visible={editingTicketItem !== null} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.numpadModalCard}>
            <View style={styles.numpadHeader}>
              <View>
                <Text style={styles.modalTitle}>Editar Cantidad</Text>
                <Text style={styles.numpadProductName} numberOfLines={1}>
                  {editingTicketItem?.name}
                </Text>
                <Text style={styles.numpadProductSub}>
                  Precio unitario: {formatUsd(editingTicketItem?.unitPriceUsd ?? "0")} / {editingTicketItem?.unit ?? "und"}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setEditingTicketItem(null)}
                style={styles.numpadCloseBtn}
              >
                <Text style={styles.numpadCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            {numpadError ? <Text style={styles.errorText}>{numpadError}</Text> : null}

            {/* Display de valor actual */}
            <View style={styles.numpadDisplay}>
              <Text style={styles.numpadDisplayLabel}>Cantidad ({editingTicketItem?.unit ?? "und"}):</Text>
              <Text style={[styles.numpadDisplayValue, typography.tabularNumeric]}>
                {numpadValue || "0"}
              </Text>
              {editingTicketItem ? (
                <Text style={[styles.numpadDisplaySub, typography.tabularNumeric]}>
                  Total estimado: {formatUsd(toDecimal(numpadValue || "0").times(toDecimal(editingTicketItem.unitPriceUsd)).toFixed(4))}
                </Text>
              ) : null}
            </View>

            {/* Numpad táctil con botón decimal para pesables */}
            <Numpad
              onDigit={handleNumpadDigit}
              onClear={handleNumpadClear}
              onBackspace={handleNumpadBackspace}
              onDecimal={handleNumpadDecimal}
              showDecimal={true}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => setEditingTicketItem(null)}
                style={styles.cancelBtn}
              >
                <Text style={styles.cancelBtnText}>Cancelar</Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.8}
                onPress={handleConfirmNumpadQuantity}
                style={styles.applyBtn}
              >
                <Text style={styles.applyBtnText}>APLICAR CANTIDAD</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal Táctil: Confirmar Vaciar Ticket Completo */}
      <Modal visible={isClearTicketModalOpen} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.confirmModalCard}>
            <Text style={styles.modalTitle}>¿Vaciar Ticket de Venta?</Text>
            <Text style={styles.modalNotice}>
              Se eliminarán los {ticketItems.length} {ticketItems.length === 1 ? "ítem" : "ítems"} agregados al carrito actual. Esta acción no se puede deshacer.
            </Text>

            <View style={styles.modalActions}>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => setIsClearTicketModalOpen(false)}
                style={styles.cancelBtn}
              >
                <Text style={styles.cancelBtnText}>Volver al Ticket</Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.8}
                onPress={handleClearAllTicket}
                style={styles.deleteConfirmBtn}
              >
                <Text style={styles.deleteConfirmBtnText}>SÍ, VACIAR TICKET</Text>
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
  catalogCountSub: {
    fontSize: typography.sizes.caption,
    color: colors.dark.textSecondary,
    marginTop: 2,
  },
  stockNoticeBox: {
    backgroundColor: "rgba(245, 158, 11, 0.15)",
    borderWidth: 1,
    borderColor: colors.dark.warning,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: spacing.radiusMd,
    marginBottom: spacing.sm,
  },
  stockNoticeText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.semibold,
    color: colors.dark.warning,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.dark.surfaceContainerLow,
    borderRadius: spacing.radiusMd,
    borderWidth: 1,
    borderColor: colors.dark.border,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    height: 44,
  },
  searchIcon: {
    fontSize: 16,
    marginRight: spacing.sm,
  },
  searchInput: {
    flex: 1,
    height: "100%",
    color: colors.dark.textPrimary,
    fontSize: typography.sizes.body,
  },
  searchClearBtn: {
    padding: spacing.xs,
  },
  searchClearText: {
    color: colors.dark.textMuted,
    fontSize: 14,
    fontWeight: typography.weights.bold,
  },
  categoryBarContainer: {
    marginBottom: spacing.sm,
  },
  categoryScroll: {
    gap: spacing.xs,
    paddingVertical: 2,
  },
  categoryChip: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.dark.surfaceContainerLow,
    borderRadius: spacing.radiusFull,
    borderWidth: 1,
    borderColor: colors.dark.border,
    justifyContent: "center",
    alignItems: "center",
  },
  categoryChipActive: {
    backgroundColor: colors.dark.primary,
    borderColor: colors.dark.primaryGlow,
  },
  categoryChipText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.medium,
    color: colors.dark.textSecondary,
  },
  categoryChipTextActive: {
    color: colors.dark.textPrimary,
    fontWeight: typography.weights.bold,
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
    minHeight: 140,
    backgroundColor: colors.dark.surfaceContainer,
    borderRadius: spacing.radiusLg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.dark.border,
    justifyContent: "space-between",
  },
  productCardOutStock: {
    opacity: 0.75,
    borderStyle: "dashed",
    borderColor: "rgba(239, 68, 68, 0.4)",
  },
  cardTopRow: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "flex-start",
    marginBottom: spacing.xs,
  },
  productThumb: {
    width: 44,
    height: 44,
    borderRadius: spacing.radiusMd,
    backgroundColor: colors.dark.surfaceContainerHigh,
  },
  productThumbPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: spacing.radiusMd,
    backgroundColor: colors.dark.surfaceContainerHigh,
    justifyContent: "center",
    alignItems: "center",
  },
  productThumbPlaceholderText: {
    fontSize: 20,
  },
  cardHeaderMeta: {
    flex: 1,
    gap: 4,
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
  stockBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: spacing.radiusSm,
  },
  stockBadgeOk: {
    backgroundColor: "rgba(0, 176, 116, 0.15)",
  },
  stockBadgeTextOk: {
    fontSize: 10,
    fontWeight: typography.weights.bold,
    color: colors.dark.hero,
  },
  stockBadgeLow: {
    backgroundColor: "rgba(245, 158, 11, 0.15)",
  },
  stockBadgeTextLow: {
    fontSize: 10,
    fontWeight: typography.weights.bold,
    color: colors.dark.warning,
  },
  stockBadgeOut: {
    backgroundColor: "rgba(239, 68, 68, 0.15)",
  },
  stockBadgeTextOut: {
    fontSize: 10,
    fontWeight: typography.weights.bold,
    color: colors.dark.error,
  },
  productName: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.semibold,
    color: colors.dark.textPrimary,
    marginVertical: spacing.xs,
  },
  priceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginTop: spacing.xs,
  },
  priceContainer: {
    flex: 1,
  },
  unitTag: {
    fontSize: typography.sizes.caption,
    color: colors.dark.textMuted,
    fontWeight: typography.weights.medium,
    marginLeft: spacing.xs,
  },
  emptyCatalogContainer: {
    flex: 1,
    paddingVertical: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyCatalogText: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    color: colors.dark.textSecondary,
  },
  emptyCatalogSub: {
    fontSize: typography.sizes.caption,
    color: colors.dark.textMuted,
    marginTop: 4,
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
    maxWidth: 560,
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
  successBox: {
    backgroundColor: "rgba(0, 176, 116, 0.2)",
    padding: spacing.sm,
    borderRadius: spacing.radiusMd,
    marginBottom: spacing.sm,
    alignItems: "center",
  },
  successText: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    color: colors.dark.hero,
  },
  checkoutSummaryCard: {
    backgroundColor: colors.dark.surfaceContainer,
    padding: spacing.md,
    borderRadius: spacing.radiusLg,
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  summaryLabel: {
    fontSize: typography.sizes.body,
    color: colors.dark.textSecondary,
  },
  summaryTotalUsd: {
    fontSize: typography.sizes.titleMd,
    fontWeight: typography.weights.bold,
    color: colors.dark.textPrimary,
  },
  summaryTotalVes: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    color: colors.dark.primaryGlow,
  },
  summaryRowSmall: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: colors.dark.border,
    paddingTop: 4,
  },
  summaryLabelSmall: {
    fontSize: typography.sizes.caption,
    color: colors.dark.textMuted,
  },
  summaryValueSmall: {
    fontSize: typography.sizes.caption,
    color: colors.dark.textSecondary,
    fontWeight: typography.weights.semibold,
  },
  paymentMethodTitle: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: colors.dark.textSecondary,
    marginBottom: spacing.xs,
  },
  paymentMethodsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  paymentMethodBtn: {
    flex: 1,
    minWidth: "45%",
    height: spacing.touchTargetMin, // 48px
    backgroundColor: colors.dark.surfaceContainerHigh,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  paymentMethodBtnActive: {
    backgroundColor: colors.dark.primary,
    borderColor: colors.dark.primaryGlow,
  },
  paymentMethodText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.medium,
    color: colors.dark.textSecondary,
  },
  paymentMethodTextActive: {
    color: colors.dark.textPrimary,
    fontWeight: typography.weights.bold,
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
    height: spacing.touchTargetHero, // 64px
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
  clearTicketBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    borderRadius: spacing.radiusMd,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.3)",
  },
  clearTicketText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: colors.dark.error,
  },
  ticketLineMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: 2,
  },
  taxBadge: {
    backgroundColor: "rgba(29, 97, 224, 0.15)",
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: spacing.radiusSm,
  },
  taxBadgeText: {
    fontSize: 9,
    fontWeight: typography.weights.bold,
    color: colors.dark.primaryGlow,
  },
  taxBadgeExempt: {
    backgroundColor: "rgba(148, 163, 184, 0.15)",
  },
  taxBadgeTextExempt: {
    fontSize: 9,
    fontWeight: typography.weights.bold,
    color: colors.dark.textMuted,
  },
  stepperAndNumpadRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  numpadTriggerBtn: {
    width: 36,
    height: 48,
    backgroundColor: colors.dark.surfaceContainerHighest,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  numpadTriggerText: {
    fontSize: 16,
  },
  ticketLineRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  deleteLineBtn: {
    width: 28,
    height: 28,
    borderRadius: spacing.radiusFull,
    backgroundColor: "rgba(239, 68, 68, 0.1)",
    justifyContent: "center",
    alignItems: "center",
  },
  deleteLineText: {
    fontSize: 12,
    fontWeight: typography.weights.bold,
    color: colors.dark.error,
  },
  financialSummaryCard: {
    backgroundColor: colors.dark.surfaceContainer,
    borderRadius: spacing.radiusMd,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    gap: 4,
  },
  financialSummaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  finLabel: {
    fontSize: typography.sizes.caption,
    color: colors.dark.textSecondary,
  },
  finValue: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: colors.dark.textPrimary,
  },
  finSub: {
    fontSize: 10,
    color: colors.dark.textMuted,
    fontWeight: typography.weights.regular,
  },
  summarySubtotalUsd: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.semibold,
    color: colors.dark.textSecondary,
  },
  summaryTaxUsd: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.semibold,
    color: colors.dark.primaryGlow,
  },
  summaryDivider: {
    height: 1,
    backgroundColor: colors.dark.border,
    marginVertical: 4,
  },
  summaryTotalHeroLabel: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    color: colors.dark.textPrimary,
  },
  numpadModalCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: colors.dark.surfaceContainerLow,
    borderRadius: spacing.radiusXl,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  numpadHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: spacing.md,
  },
  numpadProductName: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    color: colors.dark.textPrimary,
    marginTop: 2,
  },
  numpadProductSub: {
    fontSize: typography.sizes.caption,
    color: colors.dark.textSecondary,
    marginTop: 2,
  },
  numpadCloseBtn: {
    padding: spacing.xs,
  },
  numpadCloseText: {
    fontSize: 18,
    color: colors.dark.textMuted,
    fontWeight: typography.weights.bold,
  },
  numpadDisplay: {
    backgroundColor: colors.dark.surfaceContainer,
    borderRadius: spacing.radiusMd,
    padding: spacing.md,
    alignItems: "center",
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.dark.primaryGlow,
  },
  numpadDisplayLabel: {
    fontSize: typography.sizes.caption,
    color: colors.dark.textSecondary,
    marginBottom: 4,
  },
  numpadDisplayValue: {
    fontSize: 32,
    fontWeight: typography.weights.extraBold,
    color: colors.dark.textPrimary,
  },
  numpadDisplaySub: {
    fontSize: typography.sizes.caption,
    color: colors.dark.hero,
    marginTop: 4,
  },
  confirmModalCard: {
    width: "100%",
    maxWidth: 460,
    backgroundColor: colors.dark.surfaceContainerLow,
    borderRadius: spacing.radiusXl,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  deleteConfirmBtn: {
    height: spacing.touchTargetHero,
    backgroundColor: colors.dark.error,
    paddingHorizontal: spacing.xl,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: spacing.radiusLg,
  },
  deleteConfirmBtnText: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    color: colors.dark.textPrimary,
    letterSpacing: 1,
  },
  confirmCheckoutBtn: {
    height: spacing.touchTargetHero, // 64px hero height para cobro (AGENTS.md)
    backgroundColor: colors.dark.hero, // Verde maestro #00B074
    paddingHorizontal: spacing.xl,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: spacing.radiusLg,
  },
  confirmCheckoutBtnText: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.extraBold,
    color: colors.dark.textPrimary,
    letterSpacing: 1,
  },
});
