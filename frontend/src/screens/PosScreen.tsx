import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  FlatList,
  Image,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { spacing } from "../theme/spacing";
import { typography } from "../theme/typography";
import { useTheme, useThemedStyles, useMetrics } from "../theme/ThemeContext";
import { useBreakpoint } from "../theme/responsive";
import type { Metrics } from "../theme/metrics";
import type { Palette } from "../theme/tokens";
import { ButtonHero } from "../components/ButtonHero";
import { TouchStepper } from "../components/TouchStepper";
import { Numpad } from "../components/Numpad";
import {
  formatUsd,
  formatVes,
  convertUsdToVes,
  toDecimal,
  formatFixed4,
  Decimal,
} from "../utils/decimal";
import type { SqlDriver } from "../database/connection";
import { getCatalogWithBimonetaryPrices } from "../services/catalog.service";
import type { BimonetaryProduct } from "../services/catalog.service";
import { registerManualRate } from "../services/bcv-exchange.service";
import {
  createInvoice,
  getInvoiceById,
  listInvoicesByShift,
  voidInvoice,
} from "../database/repositories/invoice.repository";
import type {
  PaymentMethod,
  InvoiceEntity,
  InvoiceItemEntity,
} from "../database/repositories/invoice.repository";
import { getOpenShift } from "../database/repositories/shift.repository";
import type { ShiftEntity } from "../database/repositories/shift.repository";
import {
  useBarcodeScanner,
  findProductByBarcode,
} from "../services/barcode-scanner.service";
import type { KeyEventTargetLike } from "../services/barcode-scanner.service";
import { listCategories, getProductById } from "../database/repositories/product.repository";
import type { CategoryEntity } from "../database/repositories/product.repository";
import { PAYMENT_METHOD_LABELS } from "../database/repositories/balance.repository";
import {
  buildReceiptModel,
  encodeEscPos,
  getStoredTransport,
  hasWebBluetooth,
  isWebSerialAvailable,
  labelForTransport,
  printReceiptViaBrowser,
  printViaWebBluetooth,
  printViaWebSerial,
  renderReceiptText,
  resolveDefaultTransport,
  shortLabelForTransport,
  storeTransport,
} from "../services/receipt-print.service";
import type { PrintTransport } from "../services/receipt-print.service";
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
  /** false = rubro sin control de inventario: no muestra semáforo de stock ni alerta de agotado. */
  tracksInventory?: boolean;
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
  onNavigateToShifts?: () => void;
  onNavigateToInventory?: () => void;
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
  onNavigateToShifts,
  onNavigateToInventory,
}) => {
  const { colors: theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [exchangeRate, setExchangeRate] = useState<string>(initialExchangeRate);
  const [catalog, setCatalog] = useState<PosProductItem[]>(initialProducts ?? DEFAULT_PRODUCTS);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [categories, setCategories] = useState<CategoryEntity[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [ticketItems, setTicketItems] = useState<PosTicketItem[]>([]);
  const [stockNotice, setStockNotice] = useState<string | null>(null);
  const [activeShift, setActiveShift] = useState<ShiftEntity | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submittingRef = useRef(false);

  // Aviso no bloqueante con un solo timer vivo: evita que un escaneo posterior
  // herede el setTimeout del anterior y que el estado se actualice tras desmontar.
  const showNotice = useCallback((message: string) => {
    setStockNotice(message);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setStockNotice(null), 4000);
  }, []);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    };
  }, []);

  // Pestaña derecha (Ticket vs Ventas del Turno)
  const [rightPanelTab, setRightPanelTab] = useState<"ticket" | "history">("ticket");
  const [shiftInvoices, setShiftInvoices] = useState<InvoiceEntity[]>([]);
  const [selectedReceipt, setSelectedReceipt] = useState<InvoiceEntity | null>(null);
  const [isVoidConfirmOpen, setIsVoidConfirmOpen] = useState(false);
  const [voidReasonInput, setVoidReasonInput] = useState("");
  const [voidError, setVoidError] = useState<string | null>(null);

  const fileStore = useMemo(() => customFileStore ?? createDefaultFileStore(), [customFileStore]);

  const checkShift = useCallback(() => {
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

  const refreshShiftInvoices = useCallback(() => {
    if (!db) return;
    try {
      const openShift = getOpenShift(db, terminalId);
      if (openShift) {
        setShiftInvoices(listInvoicesByShift(db, openShift.id));
      } else {
        setShiftInvoices([]);
      }
    } catch {
      setShiftInvoices([]);
    }
  }, [db, terminalId]);

  useEffect(() => {
    checkShift();
    refreshShiftInvoices();
  }, [checkShift, refreshShiftInvoices]);

  // Carga reactiva de catálogo, categorías y tasa desde SQLite si el driver está presente
  const refreshCatalog = useCallback(() => {
    if (db) {
      try {
        const result = getCatalogWithBimonetaryPrices(db, initialExchangeRate, { tenantId });
        // DB conectada = catálogo real (aunque esté vacío): los DEFAULT_PRODUCTS son solo
        // para la ruta dev/test sin db; mostrarlos aquí permitiría "vender" productos fantasma.
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
            tracksInventory: p.tracksInventory,
            unit: p.unit,
            imagePath: p.imagePath,
            taxRate: p.taxRate,
          })),
        );
        setExchangeRate(result.activeRate);
        setCatalogError(null);

        try {
          const cats = listCategories(db);
          setCategories(cats);
        } catch {
          // Ignorar si la tabla no está lista
        }
      } catch (err) {
        // Sin catálogo legible no se puede vender: mostrar el error y vaciar el grid
        // antes que dejar a la caja operando con datos de ejemplo.
        setCatalog([]);
        setCategories([]);
        setCatalogError((err as Error).message || "No se pudo leer el catálogo local.");
      }
    }
  }, [db, initialExchangeRate, tenantId]);

  useEffect(() => {
    refreshCatalog();
  }, [refreshCatalog]);

  const addToCart = useCallback((product: PosProductItem) => {
    // Verificar si el producto tiene stock <= 0 para advertir (solo rubros controlados)
    const stockVal = toDecimal(product.currentStock ?? "100.0000");
    if (product.tracksInventory !== false && stockVal.lte(0)) {
      showNotice(`"${product.name}" no tiene stock registrado. Se agregó al ticket y el inventario quedará en negativo.`);
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
    setMobilePane("ticket");
  }, [showNotice]);

  // Escaneo reactivo mediante lector HID de código de barras
  useBarcodeScanner({
    target: keyEventTarget,
    onScan: (scannedBarcode) => {
      if (db) {
        try {
          const found = findProductByBarcode(db, scannedBarcode);
          if (found) {
            // Buscar producto en catálogo en memoria para heredar currentStock, unit y bandera de inventario
            const catItem = catalog.find((p) => p.id === found.productId);
            addToCart({
              id: found.productId,
              sku: found.sku,
              name: found.name,
              priceUsd: found.priceUsd,
              currentStock: catItem?.currentStock,
              minStock: catItem?.minStock,
              tracksInventory: catItem?.tracksInventory,
              unit: catItem?.unit,
              taxRate: catItem?.taxRate,
            });
            return;
          }
        } catch {
          showNotice("No se pudo consultar el catálogo local. Reintente el escaneo.");
          return;
        }
      }
      const match = catalog.find((p) => p.sku === scannedBarcode || p.barcode === scannedBarcode);
      if (match) {
        addToCart(match);
      } else if (db) {
        showNotice(`Código "${scannedBarcode}" no registrado en el catálogo.`);
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

  // El detalle de factura guarda productId: el comprobante muestra el nombre actual del
  // producto (ON DELETE RESTRICT impide borrar uno ya vendido) y nunca el UUID crudo.
  // shortcut: un renombre cambia el nombre en recibos viejos; migrar invoice_items.product_name
  // si el comprobante debe congelar el nombre del momento de la venta.
  const receiptItemName = useCallback(
    (
      productId: string,
      frozen?: Pick<InvoiceItemEntity, "productName" | "productSku" | "productUnit"> | undefined,
    ): string => {
      // El nombre congelado en la línea de factura manda: renombrar el rubro después
      // no puede reescribir un ticket ya emitido (auditoría §F2).
      const snapshotName = frozen?.productName?.trim();
      if (snapshotName) return snapshotName;

      const current = catalog.find((p) => p.id === productId);
      if (current) return current.name;
      if (db) {
        try {
          return getProductById(db, productId)?.name ?? "Producto no disponible";
        } catch {
          // Sin lectura del catálogo, caer al texto genérico
        }
      }
      return "Producto no disponible";
    },
    [catalog, db],
  );

  // Estado del modal de actualización de tasa
  const [isRateModalOpen, setIsRateModalOpen] = useState(false);
  const [newRateInput, setNewRateInput] = useState("");
  const [rateReasonInput, setRateReasonInput] = useState("");
  const [rateError, setRateError] = useState<string | null>(null);

  // Estado del modal de cobro (Checkout)
  const [isCheckoutModalOpen, setIsCheckoutModalOpen] = useState(false);
  // Cobro a dos columnas solo en PC/tablet con alto real suficiente (métricas fluidas,
  // theme/metrics.ts); en móvil y ventanas muy bajas el cobro apila sin perder el total.
  const { width: windowWidth, isMobile } = useBreakpoint();
  const metrics = useMetrics();
  const isWideCheckout = metrics.twoPaneCheckout;
  // El comprobante usa el mismo umbral: con alto de sobra, acciones al lado; si no, barra fija abajo.
  const isWideReceipt = metrics.twoPaneCheckout;
  // Móvil: un solo panel visible a la vez (catálogo / ticket / ventas)
  const [mobilePane, setMobilePane] = useState<"catalog" | "ticket" | "history">("catalog");
  // Columnas según el ancho real del panel de catálogo (no el de la ventana):
  // el ticket ocupa la mitad derecha en tablet y escritorio.
  const [catalogWidth, setCatalogWidth] = useState(0);
  const catalogColumns = Math.max(
    2,
    Math.min(4, Math.floor((catalogWidth - 8) / metrics.catalogCard)),
  );
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethod>("CASH_USD");
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [lastInvoiceSuccess, setLastInvoiceSuccess] = useState<string | null>(null);
  const [lastCreatedInvoice, setLastCreatedInvoice] = useState<InvoiceEntity | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Estados específicos para Cobro Combinado (SPLIT) y Pagos
  const [tenderCashUsd, setTenderCashUsd] = useState("");
  const [tenderCashVes, setTenderCashVes] = useState("");
  const [tenderPagoMovilVes, setTenderPagoMovilVes] = useState("");
  const [tenderCardVes, setTenderCardVes] = useState("");
  const [activePaymentInput, setActivePaymentInput] = useState<"CASH_USD" | "CASH_VES" | "PAGO_MOVIL" | "CARD_VES">("CASH_USD");

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
      const cleanReason = rateReasonInput.trim();
      // AGENTS.md §3.2: captura manual de tasa es auditada — motivo obligatorio, jamás fabricado
      if (db && !cleanReason) {
        throw new Error("El motivo del ajuste de tasa es obligatorio para la auditoría.");
      }

      if (db) {
        const todayIso = new Date().toISOString().split("T")[0]!;
        registerManualRate(db, {
          rateDate: todayIso,
          rate: formatted,
          reason: cleanReason,
          allowUpdate: true,
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

  // Cálculos reactivos de montos entregados, saldo restante y vuelto
  const paidCashUsd = toDecimal(tenderCashUsd || "0");
  const paidCashVes = toDecimal(tenderCashVes || "0");
  const paidPagoMovilVes = toDecimal(tenderPagoMovilVes || "0");
  const paidCardVes = toDecimal(tenderCardVes || "0");

  const totalPaidInVesEquivalent = useMemo(() => {
    const rate = toDecimal(exchangeRate);
    const usdInVes = paidCashUsd.times(rate);
    return usdInVes.plus(paidCashVes).plus(paidPagoMovilVes).plus(paidCardVes);
  }, [paidCashUsd, paidCashVes, paidPagoMovilVes, paidCardVes, exchangeRate]);

  const totalPaidInUsdEquivalent = useMemo(() => {
    const rate = toDecimal(exchangeRate);
    if (rate.lte(0)) return new Decimal(0);
    return totalPaidInVesEquivalent.div(rate);
  }, [totalPaidInVesEquivalent, exchangeRate]);

  const remainingUsd = useMemo(() => {
    const total = toDecimal(totalUsd);
    const diff = total.minus(totalPaidInUsdEquivalent);
    return diff.gt(0) ? diff.toFixed(4) : "0.0000";
  }, [totalUsd, totalPaidInUsdEquivalent]);

  const remainingVes = useMemo(() => {
    return convertUsdToVes(remainingUsd, exchangeRate).toFixed(4);
  }, [remainingUsd, exchangeRate]);

  const changeUsd = useMemo(() => {
    const total = toDecimal(totalUsd);
    const diff = totalPaidInUsdEquivalent.minus(total);
    return diff.gt(0) ? diff.toFixed(4) : "0.0000";
  }, [totalUsd, totalPaidInUsdEquivalent]);

  const changeVes = useMemo(() => {
    return convertUsdToVes(changeUsd, exchangeRate).toFixed(4);
  }, [changeUsd, exchangeRate]);

  // Lo que bloquea el cobro se nombra en el botón: el cajero no busca la cifra en el resumen.
  const checkoutBlocker = useMemo(() => {
    if (toDecimal(remainingUsd).gt(0)) return `FALTAN ${formatUsd(remainingUsd)}`;
    // SPLIT persiste el breakdown con los montos entregados: exigir monto exacto
    // (sin vuelto) para que el arqueo de caja no descuadre con el vuelto físico.
    if (selectedPaymentMethod === "SPLIT" && toDecimal(changeUsd).gt(0))
      return `SOBRAN ${formatUsd(changeUsd)}`;
    return null;
  }, [selectedPaymentMethod, remainingUsd, changeUsd]);
  const isPaymentComplete = checkoutBlocker === null;

  const handleSelectPaymentMethod = (m: PaymentMethod) => {
    setSelectedPaymentMethod(m);
    setCheckoutError(null);
    if (m === "CASH_USD") {
      setTenderCashUsd(totalUsd);
      setTenderCashVes("");
      setTenderPagoMovilVes("");
      setTenderCardVes("");
      setActivePaymentInput("CASH_USD");
    } else if (m === "CASH_VES") {
      setTenderCashVes(totalVes);
      setTenderCashUsd("");
      setTenderPagoMovilVes("");
      setTenderCardVes("");
      setActivePaymentInput("CASH_VES");
    } else if (m === "PAGO_MOVIL") {
      setTenderPagoMovilVes(totalVes);
      setTenderCashUsd("");
      setTenderCashVes("");
      setTenderCardVes("");
      setActivePaymentInput("PAGO_MOVIL");
    } else if (m === "CARD_VES") {
      setTenderCardVes(totalVes);
      setTenderCashUsd("");
      setTenderCashVes("");
      setTenderPagoMovilVes("");
      setActivePaymentInput("CARD_VES");
    } else if (m === "SPLIT") {
      setTenderCashUsd("");
      setTenderCashVes("");
      setTenderPagoMovilVes("");
      setTenderCardVes("");
      setActivePaymentInput("CASH_USD");
    }
  };

  const handleOpenCheckout = () => {
    if (ticketItems.length === 0) return;
    setCheckoutError(null);
    setLastInvoiceSuccess(null);
    setLastCreatedInvoice(null);
    setIsSubmitting(false);
    submittingRef.current = false;
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    // Prefijar el monto entregado del método activo (SPLIT lo deja en cero)
    handleSelectPaymentMethod(selectedPaymentMethod);
    setIsCheckoutModalOpen(true);
  };

  const handlePaymentNumpadDigit = (digit: string) => {
    const setterMap = {
      CASH_USD: setTenderCashUsd,
      CASH_VES: setTenderCashVes,
      PAGO_MOVIL: setTenderPagoMovilVes,
      CARD_VES: setTenderCardVes,
    };
    const setter = setterMap[activePaymentInput];
    setter((prev) => {
      if (prev === "0" || prev === "0.0000") return digit;
      return prev + digit;
    });
  };

  const handlePaymentNumpadDecimal = () => {
    const setterMap = {
      CASH_USD: setTenderCashUsd,
      CASH_VES: setTenderCashVes,
      PAGO_MOVIL: setTenderPagoMovilVes,
      CARD_VES: setTenderCardVes,
    };
    const setter = setterMap[activePaymentInput];
    setter((prev) => {
      if (!prev) return "0.";
      if (prev.includes(".")) return prev;
      return prev + ".";
    });
  };

  const handlePaymentNumpadBackspace = () => {
    const setterMap = {
      CASH_USD: setTenderCashUsd,
      CASH_VES: setTenderCashVes,
      PAGO_MOVIL: setTenderPagoMovilVes,
      CARD_VES: setTenderCardVes,
    };
    const setter = setterMap[activePaymentInput];
    setter((prev) => {
      if (prev.length <= 1) return "";
      return prev.slice(0, -1);
    });
  };

  const handlePaymentNumpadClear = () => {
    const setterMap = {
      CASH_USD: setTenderCashUsd,
      CASH_VES: setTenderCashVes,
      PAGO_MOVIL: setTenderPagoMovilVes,
      CARD_VES: setTenderCardVes,
    };
    setterMap[activePaymentInput]("");
  };

  const handleSetExactRemaining = () => {
    if (activePaymentInput === "CASH_USD") {
      setTenderCashUsd(remainingUsd);
    } else if (activePaymentInput === "CASH_VES") {
      setTenderCashVes(remainingVes);
    } else if (activePaymentInput === "PAGO_MOVIL") {
      setTenderPagoMovilVes(remainingVes);
    } else if (activePaymentInput === "CARD_VES") {
      setTenderCardVes(remainingVes);
    }
  };

  const handleConfirmCheckout = () => {
    // Guardia síncrona contra el doble cobro: dos toques en el mismo tick no ven
    // el estado de React actualizado, pero sí este ref.
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      setCheckoutError(null);
      setIsSubmitting(true);

      if (toDecimal(remainingUsd).gt(0)) {
        throw new Error(`Faltan ${formatUsd(remainingUsd)} (≈ ${formatVes(remainingVes)}) para completar el cobro.`);
      }
      if (selectedPaymentMethod === "SPLIT" && toDecimal(changeUsd).gt(0)) {
        throw new Error(`El cobro mixto exige el monto exacto: sobran ${formatUsd(changeUsd)} (≈ ${formatVes(changeVes)}). Ajuste los montos entregados.`);
      }

      let createdInvoice: InvoiceEntity | null = null;
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

        let breakdownJson: string | undefined;
        if (selectedPaymentMethod === "SPLIT") {
          breakdownJson = JSON.stringify({
            cash_usd: formatFixed4(tenderCashUsd || "0"),
            cash_ves: formatFixed4(tenderCashVes || "0"),
            pago_movil: formatFixed4(tenderPagoMovilVes || "0"),
            card_ves: formatFixed4(tenderCardVes || "0"),
          });
        }

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
          paymentBreakdown: breakdownJson,
          items: itemsInput,
        });

        // La factura ya está persistida: si falla la relectura no debe convertirse en
        // un error de cobro que invite a reintentar y duplicar la venta.
        try {
          createdInvoice = getInvoiceById(db, invoiceId) ?? null;
        } catch {
          createdInvoice = null;
        }
        onInvoiceCreated?.(invoiceId);
        refreshShiftInvoices();
        refreshCatalog();
      }

      if (createdInvoice) {
        // La confirmación del cobro ES el comprobante: se abre de inmediato con el
        // botón de impresión en pantalla (sin el auto-cierre de 2,5 s que devolvía
        // a la caja y obligaba a rebuscar la venta en la pestaña Ventas).
        // El ticket se vacía aquí, antes de cerrar el cobro, para impedir un segundo cobro.
        if (successTimerRef.current) clearTimeout(successTimerRef.current);
        setTicketItems([]);
        setSelectedReceipt(createdInvoice);
        setIsCheckoutModalOpen(false);
        setLastInvoiceSuccess(null);
        setLastCreatedInvoice(null);
        setIsSubmitting(false);
        submittingRef.current = false;
        return;
      }

      // Raro: la factura quedó persistida pero falló su relectura. Se avisa sin
      // comprobante y la pantalla de cobro se cierra sola tras dejar el mensaje.
      setLastCreatedInvoice(null);
      setLastInvoiceSuccess("¡Venta cobrada con éxito!");
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
      successTimerRef.current = setTimeout(() => {
        setIsCheckoutModalOpen(false);
        // Vaciar el ticket solo al cerrar: si se vacía antes, el resumen del modal
        // muestra $0.0000 y un "vuelto" igual a lo entregado durante el éxito.
        setTicketItems([]);
        setLastInvoiceSuccess(null);
        setLastCreatedInvoice(null);
        setIsSubmitting(false);
        submittingRef.current = false;
      }, 2500);
    } catch (err) {
      setCheckoutError((err as Error).message);
      setIsSubmitting(false);
      submittingRef.current = false;
    }
  };

  // Cierra el cobro; si ya se cobró, descarta el ticket recién vendido sin dejarlo
  // disponible para un segundo cobro.
  const handleCloseCheckout = () => {
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    setIsCheckoutModalOpen(false);
    if (lastInvoiceSuccess) setTicketItems([]);
    setLastInvoiceSuccess(null);
    setLastCreatedInvoice(null);
    setIsSubmitting(false);
    submittingRef.current = false;
  };

  // Entrega el comprobante justo después del cobro: elimina la búsqueda manual del
  // recibo en la pestaña Ventas mientras la venta aún está en pantalla.
  const handleViewCreatedReceipt = () => {
    if (!lastCreatedInvoice) return;
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    setSelectedReceipt(lastCreatedInvoice);
    setTicketItems([]);
    setLastInvoiceSuccess(null);
    setLastCreatedInvoice(null);
    setIsCheckoutModalOpen(false);
    setIsSubmitting(false);
    submittingRef.current = false;
  };

  // Impresión del comprobante en la Xprinter XP-58IIHT (58 mm, 32 columnas ESC/POS).
  // Tres transportes: "serial" = USB o Bluetooth SPP emparejado (COM virtual visto por
  // Web Serial); "bluetooth" = BLE GATT directo vía Web Bluetooth; "dialog" = driver de
  // texto del SO con el diálogo del navegador. La preferencia se recuerda entre sesiones.
  const [printBusy, setPrintBusy] = useState(false);
  const [printFeedback, setPrintFeedback] = useState<string | null>(null);
  const [printTransport, setPrintTransport] = useState<PrintTransport>(() =>
    Platform.OS === "web"
      ? getStoredTransport() ??
        resolveDefaultTransport(isWebSerialAvailable(), hasWebBluetooth())
      : "dialog",
  );

  const availableTransports = useMemo(() => {
    if (Platform.OS !== "web") return [] as PrintTransport[];
    const list: PrintTransport[] = [];
    if (isWebSerialAvailable()) list.push("serial");
    if (hasWebBluetooth()) list.push("bluetooth");
    list.push("dialog");
    return list;
  }, []);

  useEffect(() => {
    setPrintFeedback(null);
  }, [selectedReceipt?.id]);

  const handleSelectTransport = (t: PrintTransport) => {
    setPrintTransport(t);
    storeTransport(t);
    setPrintFeedback(`Transporte activo: ${labelForTransport(t)}`);
  };

  const handlePrintReceipt = async () => {
    if (!selectedReceipt) return;
    const invoice = selectedReceipt;
    setPrintBusy(true);
    setPrintFeedback(null);
    try {
      const model = buildReceiptModel(invoice, { resolveItemName: receiptItemName });
      if (printTransport === "serial") {
        await printViaWebSerial(encodeEscPos(model));
        setPrintFeedback(`Ticket ${invoice.invoiceNumber} enviado por USB/Serie`);
      } else if (printTransport === "bluetooth") {
        await printViaWebBluetooth(encodeEscPos(model));
        setPrintFeedback(`Ticket ${invoice.invoiceNumber} enviado por Bluetooth`);
      } else {
        printReceiptViaBrowser(renderReceiptText(model));
        setPrintFeedback("Diálogo de impresión abierto: elija la XP-58IIHT (58 mm)");
      }
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      // Chrome reporta la omisión del selector de puerto/dispositivo con textos
      // distintos según el transporte; todos significan "el operador canceló".
      setPrintFeedback(
        /cancel|no port selected|no device selected|user cancelled|not found|already\b.*open|no device/i.test(
          message,
        )
          ? "Selección de impresora cancelada"
          : `No se pudo imprimir: ${message}`,
      );
    } finally {
      setPrintBusy(false);
    }
  };

  const handleConfirmVoid = () => {
    if (!selectedReceipt || !db) return;
    try {
      setVoidError(null);
      const updated = voidInvoice(db, {
        invoiceId: selectedReceipt.id,
        reason: voidReasonInput,
        terminalId,
      });
      setSelectedReceipt(updated);
      setIsVoidConfirmOpen(false);
      setVoidReasonInput("");
      refreshShiftInvoices();
      refreshCatalog();
    } catch (err) {
      setVoidError((err as Error).message);
    }
  };

  // Botón maestro de cobro definido una vez: en dos columnas cierra la columna del
  // numpad; en pantallas verticales (móvil/tablet baja) viaja a una barra fija abajo
  // para que nunca quede fuera de pantalla y quede al alcance del pulgar.
  const confirmCheckoutButton = (
    <TouchableOpacity
      activeOpacity={0.8}
      disabled={!isPaymentComplete || isSubmitting}
      onPress={handleConfirmCheckout}
      style={[
        styles.confirmCheckoutBtn,
        (!isPaymentComplete || isSubmitting) && styles.confirmCheckoutBtnDisabled,
      ]}
      accessibilityRole="button"
      accessibilityState={{ disabled: !isPaymentComplete || isSubmitting }}
      accessibilityLabel={
        lastInvoiceSuccess
          ? "Cobro exitoso"
          : isSubmitting
            ? "Procesando cobro"
            : checkoutBlocker
              ? `${checkoutBlocker}: no se puede confirmar el cobro`
              : "Confirmar cobro"
      }
    >
      <Text
        style={[
          styles.confirmCheckoutBtnText,
          (!isPaymentComplete || isSubmitting) && styles.confirmCheckoutBtnTextDisabled,
        ]}
      >
        {lastInvoiceSuccess
          ? "COBRO EXITOSO"
          : isSubmitting
            ? "PROCESANDO COBRO..."
            : checkoutBlocker ?? "CONFIRMAR COBRO"}
      </Text>
    </TouchableOpacity>
  );

  // Panel de acciones del comprobante, FUERA del scroll: en landscape forma un riel
  // lateral (receiptRail) y en vertical/móvil una barra inferior fija; así imprimir,
  // anular y cerrar quedan siempre visibles sin deslizar, como en el cobro.
  const voidReceiptButton =
    selectedReceipt && selectedReceipt.status !== "VOID" ? (
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => {
          setVoidReasonInput("");
          setVoidError(null);
          setIsVoidConfirmOpen(true);
        }}
        testID="btn-open-void-modal"
        style={[styles.receiptVoidBtn, !isWideReceipt && styles.receiptActionRowBtn]}
        accessibilityRole="button"
        accessibilityLabel="Anular venta (devolución)"
      >
        <Text style={styles.receiptVoidBtnText} numberOfLines={1}>
          {isWideReceipt ? "🔴 ANULAR VENTA (DEVOLUCIÓN)" : "🔴 ANULAR"}
        </Text>
      </TouchableOpacity>
    ) : null;

  const closeReceiptButton = (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={() => setSelectedReceipt(null)}
      style={[styles.receiptCloseBtn, !isWideReceipt && styles.receiptActionRowBtn]}
      accessibilityRole="button"
      accessibilityLabel="Cerrar comprobante"
    >
      <Text style={styles.receiptCloseBtnText} numberOfLines={1}>
        {isWideReceipt ? "Cerrar Comprobante" : "Cerrar"}
      </Text>
    </TouchableOpacity>
  );

  const receiptActions = selectedReceipt ? (
    <View style={isWideReceipt ? styles.receiptRail : styles.receiptActionBar}>
      {Platform.OS === "web" ? (
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={handlePrintReceipt}
          disabled={printBusy}
          testID="btn-print-receipt"
          style={[styles.receiptPrintBtn, printBusy && styles.receiptPrintBtnBusy]}
          accessibilityRole="button"
          accessibilityState={{ disabled: printBusy }}
          accessibilityLabel={`Imprimir comprobante ${selectedReceipt.invoiceNumber} en la Xprinter XP-58IIHT`}
        >
          <Text style={styles.receiptPrintBtnText}>
            {printBusy
              ? "IMPRIMIENDO…"
              : `🖨 IMPRIMIR · ${shortLabelForTransport(printTransport)}`}
          </Text>
        </TouchableOpacity>
      ) : null}
      {availableTransports.length > 1 ? (
        /* USB/Serie (también BT emparejado como COM), Bluetooth BLE directo o diálogo del SO. */
        <View
          style={[styles.printTransportRow, isWideReceipt && styles.printTransportRowRail]}
          accessibilityRole="radiogroup"
        >
          {availableTransports.map((t) => {
            const isActive = printTransport === t;
            return (
              <TouchableOpacity
                key={t}
                activeOpacity={0.8}
                onPress={() => handleSelectTransport(t)}
                style={[styles.printTransportChip, isActive && styles.printTransportChipActive]}
                accessibilityRole="radio"
                accessibilityState={{ selected: isActive }}
                accessibilityLabel={`Transporte de impresion: ${labelForTransport(t)}`}
              >
                <Text
                  style={[
                    styles.printTransportChipText,
                    isActive && styles.printTransportChipTextActive,
                  ]}
                  numberOfLines={1}
                >
                  {t === "serial" ? "🔌" : t === "bluetooth" ? "📶" : "🖥"} {labelForTransport(t)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}
      {printFeedback ? (
        <Text style={styles.receiptPrintFeedback} numberOfLines={2}>
          {printFeedback}
        </Text>
      ) : null}
      {isWideReceipt ? (
        <>
          {voidReceiptButton}
          {closeReceiptButton}
        </>
      ) : (
        <View style={styles.receiptActionRow}>
          {voidReceiptButton}
          {closeReceiptButton}
        </View>
      )}
    </View>
  ) : null;

  return (
    <View style={styles.container}>
      {/* Banner reactivo si no hay turno de caja abierto */}
      {db && !activeShift ? (
        <View style={styles.noShiftBanner} testID="no-shift-banner">
          <View style={styles.noShiftBannerContent}>
            <Text style={styles.noShiftBannerIcon}>⚠️</Text>
            <View style={styles.noShiftBannerTexts}>
              <Text style={styles.noShiftBannerTitle}>Sin turno de caja abierto ({terminalId})</Text>
              <Text style={styles.noShiftBannerSubtitle}>
                No es posible registrar ni cobrar ventas sin un turno de caja activo.
              </Text>
            </View>
          </View>
          {onNavigateToShifts ? (
            <TouchableOpacity
              style={styles.noShiftBannerButton}
              activeOpacity={0.8}
              onPress={onNavigateToShifts}
              accessibilityRole="button"
              accessibilityLabel="Abrir Turno Ahora"
              testID="btn-open-shift-banner"
            >
              <Text style={styles.noShiftBannerButtonText}>Abrir Turno</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      <View style={[styles.columnsRow, isMobile && styles.columnsRowMobile]}>
        {/* Móvil: conmutador entre catálogo y ticket */}
        {isMobile ? (
          <View style={styles.mobilePanes}>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => setMobilePane("catalog")}
              style={[styles.mobilePaneBtn, mobilePane === "catalog" && styles.mobilePaneBtnActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: mobilePane === "catalog" }}
              accessibilityLabel={`Catálogo, ${filteredCatalog.length} productos`}
            >
              <Text
                style={[
                  styles.mobilePaneText,
                  mobilePane === "catalog" && styles.mobilePaneTextActive,
                ]}
              >
                Catálogo ({filteredCatalog.length})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => {
                setRightPanelTab("ticket");
                setMobilePane("ticket");
              }}
              style={[styles.mobilePaneBtn, mobilePane === "ticket" && styles.mobilePaneBtnActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: mobilePane === "ticket" }}
              accessibilityLabel={`Ticket, ${ticketItems.length} ítems`}
            >
              <Text
                style={[
                  styles.mobilePaneText,
                  mobilePane === "ticket" && styles.mobilePaneTextActive,
                ]}
              >
                Ticket ({ticketItems.length})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => {
                setRightPanelTab("history");
                refreshShiftInvoices();
                setMobilePane("history");
              }}
              style={[styles.mobilePaneBtn, mobilePane === "history" && styles.mobilePaneBtnActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: mobilePane === "history" }}
              accessibilityLabel={`Ventas del turno, ${shiftInvoices.length} facturas`}
            >
              <Text
                style={[
                  styles.mobilePaneText,
                  mobilePane === "history" && styles.mobilePaneTextActive,
                ]}
              >
                Ventas ({shiftInvoices.length})
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Columna Izquierda: Catálogo de Productos */}
        <View
          style={[
            styles.catalogColumn,
            isMobile && mobilePane !== "catalog" && styles.paneHidden,
          ]}
          onLayout={(event) => setCatalogWidth(event.nativeEvent.layout.width)}
        >
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
            accessibilityRole="button"
            accessibilityLabel={`Tasa oficial ${formatVes(exchangeRate)}. Editar tasa`}
          >
            <Text style={styles.ratePillLabel}>Tasa oficial:</Text>
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
            placeholderTextColor={theme.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            clearButtonMode="while-editing"
            accessibilityLabel="Buscar producto por nombre, SKU o código de barras"
          />
          {searchQuery ? (
            <TouchableOpacity
              onPress={() => setSearchQuery("")}
              style={styles.searchClearBtn}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel="Borrar búsqueda"
            >
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
              accessibilityRole="button"
              accessibilityState={{ selected: selectedCategory === "ALL" }}
              accessibilityLabel={`Todas las categorías, ${catalog.length} productos`}
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
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={`${cat.name}, ${count} productos`}
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
          key={`catalog-${catalogColumns}`}
          numColumns={catalogColumns}
          contentContainerStyle={styles.catalogGrid}
          renderItem={({ item }) => {
            const priceVes = convertUsdToVes(item.priceUsd, exchangeRate).toFixed(4);
            const tracksInventory = item.tracksInventory !== false;
            const stockDecimal = toDecimal(item.currentStock ?? "0.0000");
            const isOutOfStock = tracksInventory && stockDecimal.lte(0);
            const isLowStock =
              tracksInventory &&
              (item.isLowStock ||
                (stockDecimal.lte(toDecimal(item.minStock ?? "0.0000")) && !isOutOfStock));
            const imageUri = resolveProductImageUri(fileStore, item.imagePath ?? null);

            return (
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => addToCart(item)}
                style={[styles.productCard, isOutOfStock && styles.productCardOutStock]}
                accessibilityRole="button"
                accessibilityLabel={
                  !tracksInventory
                    ? `${item.name}, ${formatUsd(item.priceUsd)}, sin control de inventario. Agregar al ticket`
                    : isOutOfStock
                      ? `${item.name}, ${formatUsd(item.priceUsd)}, agotado. Agregar al ticket`
                      : `${item.name}, ${formatUsd(item.priceUsd)}, stock ${formatFixed4(item.currentStock ?? "0")} ${item.unit ?? "und"}. Agregar al ticket`
                }
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
                      <Text style={styles.badgeText} numberOfLines={1}>
                        {item.sku}
                      </Text>
                    </View>

                    {/* Badge de Stock */}
                    {!tracksInventory ? (
                      <View style={[styles.stockBadge, styles.stockBadgeNoTracking]}>
                        <Text style={styles.stockBadgeTextNoTracking} numberOfLines={1}>
                          ◇ Sin inventario
                        </Text>
                      </View>
                    ) : isOutOfStock ? (
                      <View style={[styles.stockBadge, styles.stockBadgeOut]}>
                        <Text style={styles.stockBadgeTextOut} numberOfLines={1}>
                          ● Agotado (0)
                        </Text>
                      </View>
                    ) : isLowStock ? (
                      <View style={[styles.stockBadge, styles.stockBadgeLow]}>
                        <Text style={styles.stockBadgeTextLow} numberOfLines={1}>
                          ⚠ Bajo: {formatFixed4(item.currentStock ?? "0")} {item.unit ?? "und"}
                        </Text>
                      </View>
                    ) : (
                      <View style={[styles.stockBadge, styles.stockBadgeOk]}>
                        <Text style={styles.stockBadgeTextOk} numberOfLines={1}>
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
              {catalogError ? (
                <>
                  <Text style={styles.emptyCatalogText}>No se pudo cargar el catálogo local</Text>
                  <Text style={styles.emptyCatalogSub}>{catalogError}</Text>
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={refreshCatalog}
                    style={styles.emptyCatalogAction}
                    accessibilityRole="button"
                    accessibilityLabel="Reintentar carga del catálogo"
                  >
                    <Text style={styles.emptyCatalogActionText}>Reintentar</Text>
                  </TouchableOpacity>
                </>
              ) : catalog.length === 0 ? (
                <>
                  <Text style={styles.emptyCatalogText}>Aún no hay productos registrados</Text>
                  <Text style={styles.emptyCatalogSub}>
                    Registre productos y stock en Inventario para poder cobrar.
                  </Text>
                  {onNavigateToInventory ? (
                    <TouchableOpacity
                      activeOpacity={0.8}
                      onPress={onNavigateToInventory}
                      style={styles.emptyCatalogAction}
                      accessibilityRole="button"
                      accessibilityLabel="Ir a Inventario a registrar productos"
                    >
                      <Text style={styles.emptyCatalogActionText}>Ir a Inventario</Text>
                    </TouchableOpacity>
                  ) : null}
                </>
              ) : (
                <>
                  <Text style={styles.emptyCatalogText}>No se encontraron productos</Text>
                  <Text style={styles.emptyCatalogSub}>
                    {searchQuery.trim()
                      ? `Sin resultados para "${searchQuery.trim()}"`
                      : "No hay productos en esta categoría"}
                  </Text>
                </>
              )}
            </View>
          }
        />
      </View>

      {/* Columna Derecha: Ticket Activo o Ventas del Turno */}
      <View
        style={[
          styles.ticketColumn,
          isMobile && mobilePane !== "ticket" && styles.paneHidden,
        ]}
      >
        {/* Selector de Pestaña: Ticket vs Ventas del Turno (oculto en móvil, usa el conmutador superior) */}
        <View style={[styles.rightTabRow, isMobile && styles.paneHidden]}>
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => setRightPanelTab("ticket")}
            style={[styles.rightTabBtn, rightPanelTab === "ticket" && styles.rightTabBtnActive]}
            testID="tab-btn-ticket"
            accessibilityRole="button"
            accessibilityState={{ selected: rightPanelTab === "ticket" }}
            accessibilityLabel={`Ticket actual, ${ticketItems.length} ítems`}
          >
            <Text style={[styles.rightTabText, rightPanelTab === "ticket" && styles.rightTabTextActive]}>
              🛒 Ticket ({ticketItems.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => {
              setRightPanelTab("history");
              refreshShiftInvoices();
            }}
            style={[styles.rightTabBtn, rightPanelTab === "history" && styles.rightTabBtnActive]}
            testID="tab-btn-history"
            accessibilityRole="button"
            accessibilityState={{ selected: rightPanelTab === "history" }}
            accessibilityLabel={`Ventas del turno, ${shiftInvoices.length} facturas`}
          >
            <Text style={[styles.rightTabText, rightPanelTab === "history" && styles.rightTabTextActive]}>
              📜 Ventas ({shiftInvoices.length})
            </Text>
          </TouchableOpacity>
        </View>

        {rightPanelTab === "ticket" ? (
          <>
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
              accessibilityRole="button"
              accessibilityLabel="Vaciar ticket de venta"
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
                    accessibilityRole="button"
                    accessibilityLabel={`Editar cantidad de ${item.name} con teclado numérico`}
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
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Quitar ${item.name} del ticket`}
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
                Escanee el código de barras o toque un producto del catálogo
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
                <Text style={styles.finLabel}>IVA:</Text>
                <Text style={[styles.finValue, typography.tabularNumeric]}>
                  {formatUsd(taxUsd)} <Text style={styles.finSub}>({formatVes(taxVes)})</Text>
                </Text>
              </View>
            </View>
          ) : null}

          <ButtonHero
            label={windowWidth < 1100 ? "COBRAR" : "COBRAR TICKET"}
            totalFormatted={formatUsd(totalUsd)}
            secondaryFormatted={`≈ ${formatVes(totalVes)}`}
            disabled={ticketItems.length === 0}
            onPress={handleOpenCheckout}
          />
        </View>
      </>
    ) : (
      /* Pestaña Historial de Ventas del Turno */
      <View style={styles.historyTabContainer}>
        <FlatList
          data={shiftInvoices}
          keyExtractor={(inv) => inv.id}
          style={styles.shiftInvoicesList}
          renderItem={({ item: inv }) => {
            const isVoid = inv.status === "VOID";
            const dateStr = new Date(inv.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            return (
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => setSelectedReceipt(inv)}
                style={[styles.invoiceCard, isVoid && styles.invoiceCardVoid]}
                testID={`invoice-card-${inv.id}`}
                accessibilityRole="button"
                accessibilityLabel={`${inv.invoiceNumber}, ${isVoid ? "anulada" : "cobrada"}, ${formatUsd(inv.totalUsd)}. Ver comprobante`}
              >
                <View style={styles.invoiceCardHeader}>
                  <View style={styles.invoiceNumberRow}>
                    <Text style={styles.invoiceNumberText}>{inv.invoiceNumber}</Text>
                    <Text style={styles.invoiceTimeText}>{dateStr}</Text>
                  </View>
                  <View style={[styles.invoiceStatusBadge, isVoid ? styles.badgeVoid : styles.badgeCompleted]}>
                    <Text style={styles.invoiceStatusBadgeText}>
                      {isVoid ? "ANULADA" : "COBRADA"}
                    </Text>
                  </View>
                </View>

                <View style={styles.invoiceCardMeta}>
                  <Text style={styles.invoiceMethodText}>
                    {PAYMENT_METHOD_LABELS[inv.paymentMethod] ?? inv.paymentMethod} • {inv.items.length}{" "}
                    {inv.items.length === 1 ? "ítem" : "ítems"}
                  </Text>
                  <View style={styles.invoiceAmounts}>
                    <Text style={[styles.invoiceTotalUsd, isVoid && styles.textLineThrough, typography.tabularNumeric]}>
                      {formatUsd(inv.totalUsd)}
                    </Text>
                    <Text style={[styles.invoiceTotalVes, isVoid && styles.textLineThrough, typography.tabularNumeric]}>
                      ≈ {formatVes(inv.totalVes)}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyHistoryBox}>
              <Text style={styles.emptyHistoryText}>No hay ventas en este turno</Text>
              <Text style={styles.emptyHistorySub}>
                Cada venta cobrada aparecerá aquí con su comprobante y la opción de anularla.
              </Text>
            </View>
          }
        />
      </View>
    )}
  </View>
  </View>

      {/* Pantalla de Cobro / Emisión de Factura: ocupa todo el alto y el total queda fijo arriba */}
      <Modal
        visible={isCheckoutModalOpen}
        transparent
        animationType="fade"
        onRequestClose={handleCloseCheckout}
      >
        <View style={styles.checkoutScreen}>
          {/* Barra superior: título, contexto breve y retorno al ticket */}
          <View style={styles.checkoutTopBar}>
            <View style={styles.checkoutTopTexts}>
              <Text style={styles.modalTitle}>Cobro de Venta</Text>
              <Text style={styles.checkoutTopNote}>
                Al confirmar se congelan la tasa y los totales de la venta y se descuenta el
                inventario. Si hay un error, anúlala desde su comprobante.
              </Text>
            </View>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={handleCloseCheckout}
              style={styles.checkoutBackBtn}
              accessibilityRole="button"
              accessibilityLabel={lastInvoiceSuccess ? "Cerrar aviso de venta cobrada" : "Volver al ticket sin cobrar"}
            >
              <Text style={styles.checkoutBackText}>
                {lastInvoiceSuccess ? "Cerrar" : "Volver al Ticket"}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Franja fija del total: nunca se pierde de vista mientras se digita el monto */}
          <View style={styles.checkoutHero}>
            <View style={styles.heroMain}>
              <Text style={styles.heroLabel}>TOTAL A COBRAR</Text>
              <View style={styles.heroAmountsRow}>
                <Text style={[styles.heroTotalUsd, typography.tabularNumeric]}>{formatUsd(totalUsd)}</Text>
                <Text style={[styles.heroTotalVes, typography.tabularNumeric]}>{formatVes(totalVes)}</Text>
              </View>
              <Text style={[styles.heroRate, typography.tabularNumeric]}>
                Tasa oficial congelada: {formatVes(exchangeRate)} / USD
              </Text>
            </View>

            <View style={styles.heroStatus}>
              {toDecimal(remainingUsd).gt(0) ? (
                <View style={[styles.heroChip, styles.heroChipWarn]}>
                  <Text style={[styles.heroChipText, styles.heroChipWarnText]}>
                    ⚠️ Faltan {formatUsd(remainingUsd)}
                  </Text>
                  <Text style={[styles.heroChipSub, styles.heroChipWarnText, typography.tabularNumeric]}>
                    ≈ {formatVes(remainingVes)}
                  </Text>
                </View>
              ) : selectedPaymentMethod === "SPLIT" && toDecimal(changeUsd).gt(0) ? (
                <View style={[styles.heroChip, styles.heroChipWarn]}>
                  <Text style={[styles.heroChipText, styles.heroChipWarnText]}>
                    ⚠️ Sobran {formatUsd(changeUsd)}
                  </Text>
                  <Text style={[styles.heroChipSub, styles.heroChipWarnText, typography.tabularNumeric]}>
                    ≈ {formatVes(changeVes)} • el cobro mixto no da vuelto
                  </Text>
                </View>
              ) : (
                <View style={[styles.heroChip, styles.heroChipOk]}>
                  <Text style={[styles.heroChipText, styles.heroChipOkText]}>✓ Pago completo</Text>
                  <Text style={[styles.heroChipSub, styles.heroChipOkText, typography.tabularNumeric]}>
                    {toDecimal(changeUsd).gt(0)
                      ? `Vuelto: ${formatUsd(changeUsd)} (≈ ${formatVes(changeVes)})`
                      : "Monto exacto recibido"}
                  </Text>
                </View>
              )}
            </View>
          </View>

          {checkoutError ? <Text style={styles.errorText}>{checkoutError}</Text> : null}
          {lastInvoiceSuccess ? (
            <View style={styles.successBox}>
              <Text style={styles.successText}>{lastInvoiceSuccess}</Text>
              {lastCreatedInvoice ? (
                <Text style={[styles.successAmount, typography.tabularNumeric]}>
                  {formatUsd(lastCreatedInvoice.totalUsd)} • {formatVes(lastCreatedInvoice.totalVes)}
                </Text>
              ) : null}
              {lastCreatedInvoice ? (
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={handleViewCreatedReceipt}
                  style={styles.successLinkBtn}
                  accessibilityRole="button"
                  accessibilityLabel={`Ver comprobante de la venta ${lastCreatedInvoice.invoiceNumber}`}
                >
                  <Text style={styles.successLinkText}>Ver comprobante</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}

          <ScrollView style={styles.checkoutBody} contentContainerStyle={styles.checkoutBodyContent}>
            <View style={[styles.checkoutColumns, !isWideCheckout && styles.checkoutColumnsStacked]}>
              {/* Columna izquierda: importes, modalidad de cobro y montos entregados */}
              <View style={styles.checkoutLeft}>
                {/* Subtotal e IVA: el total vive en la franja fija de arriba */}
                <View style={styles.checkoutSummaryCard}>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Subtotal (base imponible):</Text>
                    <Text style={[styles.summarySubtotalUsd, typography.tabularNumeric]}>
                      {formatUsd(subtotalUsd)}
                    </Text>
                  </View>

                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>IVA:</Text>
                    <Text style={[styles.summaryTaxUsd, typography.tabularNumeric]}>
                      {formatUsd(taxUsd)}
                    </Text>
                  </View>
                </View>

                {/* Selección de Método de Pago */}
                <View>
                  <Text style={styles.paymentMethodTitle}>Forma de pago:</Text>
                  <View style={styles.paymentMethodsGrid}>
                    {[
                      { id: "CASH_USD", label: "Efectivo USD ($)" },
                      { id: "CASH_VES", label: "Efectivo VES (Bs.)" },
                      { id: "PAGO_MOVIL", label: "Pago Móvil (Bs.)" },
                      { id: "CARD_VES", label: "Tarjeta / Punto (Bs.)" },
                      { id: "SPLIT", label: "Cobro Mixto" },
                    ].map((m) => {
                      const isSelected = selectedPaymentMethod === m.id;
                      return (
                        <TouchableOpacity
                          key={m.id}
                          activeOpacity={0.8}
                          onPress={() => handleSelectPaymentMethod(m.id as PaymentMethod)}
                          style={[styles.paymentMethodBtn, isSelected && styles.paymentMethodBtnActive]}
                          accessibilityRole="button"
                          accessibilityState={{ selected: isSelected }}
                          accessibilityLabel={m.label}
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
                </View>

                {/* Panel de Desglose de Pago / Cobro Combinado (SPLIT) */}
                <View style={styles.tenderSection}>
                  <Text style={styles.tenderSectionTitle}>
                    {selectedPaymentMethod === "SPLIT"
                      ? "Montos entregados (deben sumar el total exacto, sin vuelto):"
                      : `Monto recibido (${selectedPaymentMethod === "CASH_USD" ? "USD" : "VES"}): precargado con el total exacto.`}
                  </Text>

                  <View style={styles.tenderInputsGrid}>
                    {/* Input Efectivo USD */}
                    {(selectedPaymentMethod === "SPLIT" || selectedPaymentMethod === "CASH_USD") && (
                      <TouchableOpacity
                        activeOpacity={0.8}
                        onPress={() => setActivePaymentInput("CASH_USD")}
                        style={[
                          styles.tenderFieldBox,
                          activePaymentInput === "CASH_USD" && styles.tenderFieldBoxActive,
                        ]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: activePaymentInput === "CASH_USD" }}
                        accessibilityLabel={`Editar monto en efectivo USD, actual ${tenderCashUsd || "0.0000"}`}
                      >
                        <Text style={styles.tenderFieldLabel}>💵 Efectivo USD ($)</Text>
                        <Text style={[styles.tenderFieldValue, typography.tabularNumeric]}>
                          {tenderCashUsd || "$ 0.0000"}
                        </Text>
                      </TouchableOpacity>
                    )}

                    {/* Input Efectivo VES */}
                    {(selectedPaymentMethod === "SPLIT" || selectedPaymentMethod === "CASH_VES") && (
                      <TouchableOpacity
                        activeOpacity={0.8}
                        onPress={() => setActivePaymentInput("CASH_VES")}
                        style={[
                          styles.tenderFieldBox,
                          activePaymentInput === "CASH_VES" && styles.tenderFieldBoxActive,
                        ]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: activePaymentInput === "CASH_VES" }}
                        accessibilityLabel={`Editar monto en efectivo VES, actual ${tenderCashVes || "0.0000"}`}
                      >
                        <Text style={styles.tenderFieldLabel}>🇻🇪 Efectivo VES (Bs.)</Text>
                        <Text style={[styles.tenderFieldValue, typography.tabularNumeric]}>
                          {tenderCashVes || "Bs. 0.0000"}
                        </Text>
                      </TouchableOpacity>
                    )}

                    {/* Input Pago Móvil */}
                    {(selectedPaymentMethod === "SPLIT" || selectedPaymentMethod === "PAGO_MOVIL") && (
                      <TouchableOpacity
                        activeOpacity={0.8}
                        onPress={() => setActivePaymentInput("PAGO_MOVIL")}
                        style={[
                          styles.tenderFieldBox,
                          activePaymentInput === "PAGO_MOVIL" && styles.tenderFieldBoxActive,
                        ]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: activePaymentInput === "PAGO_MOVIL" }}
                        accessibilityLabel={`Editar monto de Pago Móvil, actual ${tenderPagoMovilVes || "0.0000"}`}
                      >
                        <Text style={styles.tenderFieldLabel}>📱 Pago Móvil (Bs.)</Text>
                        <Text style={[styles.tenderFieldValue, typography.tabularNumeric]}>
                          {tenderPagoMovilVes || "Bs. 0.0000"}
                        </Text>
                      </TouchableOpacity>
                    )}

                    {/* Input Tarjeta / Punto */}
                    {(selectedPaymentMethod === "SPLIT" || selectedPaymentMethod === "CARD_VES") && (
                      <TouchableOpacity
                        activeOpacity={0.8}
                        onPress={() => setActivePaymentInput("CARD_VES")}
                        style={[
                          styles.tenderFieldBox,
                          activePaymentInput === "CARD_VES" && styles.tenderFieldBoxActive,
                        ]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: activePaymentInput === "CARD_VES" }}
                        accessibilityLabel={`Editar monto de tarjeta, actual ${tenderCardVes || "0.0000"}`}
                      >
                        <Text style={styles.tenderFieldLabel}>💳 Tarjeta / Punto (Bs.)</Text>
                        <Text style={[styles.tenderFieldValue, typography.tabularNumeric]}>
                          {tenderCardVes || "Bs. 0.0000"}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </View>

              {/* Columna derecha: numpad del monto activo y botón maestro de cobro */}
              <View style={[styles.checkoutRight, !isWideCheckout && styles.checkoutRightStacked]}>
                {/* Teclado numérico táctil para ingresar el monto en pantalla */}
                <View style={styles.paymentNumpadContainer}>
                  <Numpad
                    onDigit={handlePaymentNumpadDigit}
                    onClear={handlePaymentNumpadClear}
                    onBackspace={handlePaymentNumpadBackspace}
                    onDecimal={handlePaymentNumpadDecimal}
                    showDecimal={true}
                  />
                </View>

                {/* Botón rápido para asignar restante exacto al método activo */}
                {selectedPaymentMethod === "SPLIT" && toDecimal(remainingUsd).gt(0) ? (
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={handleSetExactRemaining}
                    style={styles.exactRemainingBtn}
                    accessibilityRole="button"
                    accessibilityLabel={`Completar el restante en ${activePaymentInput === "CASH_USD" ? "dólares" : "bolívares"}`}
                  >
                    <Text style={styles.exactRemainingBtnText}>
                      ⚡ Completar restante en {activePaymentInput === "CASH_USD" ? "USD" : "VES"}: {activePaymentInput === "CASH_USD" ? formatUsd(remainingUsd) : formatVes(remainingVes)}
                    </Text>
                  </TouchableOpacity>
                ) : null}

                {/* Botón maestro de cobro: junto al teclado, nunca fuera de pantalla */}
                {isWideCheckout ? confirmCheckoutButton : null}
              </View>
            </View>
          </ScrollView>

          {!isWideCheckout ? (
            /* Móvil / ventana baja: barra fija al pulgar con el botón maestro siempre a la vista */
            <View style={styles.checkoutStickyBar}>{confirmCheckoutButton}</View>
          ) : null}
        </View>
      </Modal>

      {/* Modal Táctil de Actualización de Tasa */}
      <Modal visible={isRateModalOpen} transparent animationType="fade" onRequestClose={() => setIsRateModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Actualizar tasa del día</Text>
            <Text style={styles.modalNotice}>
              Los precios en bolívares se recalculan al instante con la nueva tasa. Las ventas ya
              cobradas conservan la tasa con la que se emitieron.
            </Text>

            {rateError ? <Text style={styles.errorText}>{rateError}</Text> : null}

            <View style={styles.modalInputGroup}>
              <Text style={styles.inputLabel}>
                Nueva tasa (Bs. por USD). Actual: {formatVes(exchangeRate)}
              </Text>
              <TextInput
                style={[styles.modalInput, typography.tabularNumeric]}
                keyboardType="decimal-pad"
                placeholder="0.0000"
                placeholderTextColor={theme.textMuted}
                value={newRateInput}
                onChangeText={setNewRateInput}
                accessibilityLabel="Nueva tasa de cambio a bolívares"
              />
            </View>

            <View style={styles.modalInputGroup}>
              <Text style={styles.inputLabel}>Motivo del cambio (obligatorio y auditado):</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="Ej. Actualización vespertina oficial BCV"
                placeholderTextColor={theme.textMuted}
                value={rateReasonInput}
                onChangeText={setRateReasonInput}
                accessibilityLabel="Motivo del cambio de tasa"
              />
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => setIsRateModalOpen(false)}
                style={styles.cancelBtn}
                accessibilityRole="button"
                accessibilityLabel="Cancelar cambio de tasa"
              >
                <Text style={styles.cancelBtnText}>Cancelar</Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.8}
                onPress={handleApplyRate}
                style={styles.applyBtn}
                accessibilityRole="button"
                accessibilityLabel="Aplicar nueva tasa"
              >
                <Text style={styles.applyBtnText}>APLICAR TASA</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal Táctil: Teclado Numérico para Cantidad (Pesables / Bultos) */}
      <Modal visible={editingTicketItem !== null} transparent animationType="fade" onRequestClose={() => setEditingTicketItem(null)}>
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
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityRole="button"
                accessibilityLabel="Cerrar edición de cantidad"
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
                  Total de la línea: {formatUsd(toDecimal(numpadValue || "0").times(toDecimal(editingTicketItem.unitPriceUsd)).toFixed(4))}
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
                accessibilityRole="button"
                accessibilityLabel="Cancelar edición de cantidad"
              >
                <Text style={styles.cancelBtnText}>Cancelar</Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.8}
                onPress={handleConfirmNumpadQuantity}
                style={styles.applyBtn}
                accessibilityRole="button"
                accessibilityLabel="Aplicar cantidad"
              >
                <Text style={styles.applyBtnText}>APLICAR CANTIDAD</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal Táctil: Confirmar Vaciar Ticket Completo */}
      <Modal visible={isClearTicketModalOpen} transparent animationType="fade" onRequestClose={() => setIsClearTicketModalOpen(false)}>
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
                accessibilityRole="button"
                accessibilityLabel="Volver al ticket sin vaciar"
              >
                <Text style={styles.cancelBtnText}>Volver al Ticket</Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.8}
                onPress={handleClearAllTicket}
                style={styles.deleteConfirmBtn}
                accessibilityRole="button"
                accessibilityLabel="Sí, vaciar ticket"
              >
                <Text style={styles.deleteConfirmBtnText}>SÍ, VACIAR TICKET</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal Comprobante / Recibo Digital de Venta */}
      <Modal visible={!!selectedReceipt} transparent animationType="fade" onRequestClose={() => setSelectedReceipt(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, styles.receiptCard]}>
            {selectedReceipt ? (
              <View style={[styles.receiptLayout, !isWideReceipt && styles.receiptLayoutStacked]}>
                <ScrollView style={styles.receiptScroll} contentContainerStyle={styles.receiptContent}>
                  {/* Cabecera del Recibo Térmico */}
                  <View style={styles.receiptHeader}>
                    <Text style={styles.receiptBrand}>BISYNC POS</Text>
                    <Text style={styles.receiptSubBrand}>Comprobante de venta</Text>
                    <Text style={styles.receiptTerminal}>
                      Terminal: {selectedReceipt.terminalId} • Turno #{selectedReceipt.shiftId.slice(-4).toUpperCase()}
                    </Text>
                    <Text style={styles.receiptInvoiceNum}>{selectedReceipt.invoiceNumber}</Text>
                    <Text style={styles.receiptDate}>
                      {new Date(selectedReceipt.createdAt).toLocaleString()}
                    </Text>
                  </View>

                  {/* Badge de Estado */}
                  <View style={[styles.receiptStatusBadge, selectedReceipt.status === "VOID" ? styles.receiptBadgeVoid : styles.receiptBadgeOk]}>
                    <Text style={styles.receiptStatusText}>
                      {selectedReceipt.status === "VOID" ? "⚠️ VENTA ANULADA (DEVOLUCIÓN)" : "✅ VENTA COBRADA"}
                    </Text>
                    {selectedReceipt.status === "VOID" && selectedReceipt.voidReason ? (
                      <Text style={styles.receiptVoidReason}>Motivo: {selectedReceipt.voidReason}</Text>
                    ) : null}
                  </View>

                  <View style={styles.receiptDivider} />

                  {/* Detalle de Productos */}
                  <View style={styles.receiptItemsTable}>
                    <View style={styles.receiptTableHeader}>
                      <Text style={[styles.receiptTh, { flex: 3 }]}>Producto</Text>
                      <Text style={[styles.receiptTh, { flex: 1, textAlign: "center" }]}>Cant.</Text>
                      <Text style={[styles.receiptTh, { flex: 2, textAlign: "right" }]}>Precio</Text>
                      <Text style={[styles.receiptTh, { flex: 2, textAlign: "right" }]}>Total</Text>
                    </View>
                    {selectedReceipt.items.map((it) => (
                      <View key={it.id} style={styles.receiptItemRow}>
                        <Text style={[styles.receiptItemName, { flex: 3 }]} numberOfLines={1}>
                          {receiptItemName(it.productId, it)}
                        </Text>
                        <Text style={[styles.receiptItemQty, { flex: 1, textAlign: "center" }, typography.tabularNumeric]}>
                          {formatFixed4(it.quantity)}
                        </Text>
                        <Text style={[styles.receiptItemPrice, { flex: 2, textAlign: "right" }, typography.tabularNumeric]}>
                          {formatUsd(it.unitPriceUsd)}
                        </Text>
                        <Text style={[styles.receiptItemTotal, { flex: 2, textAlign: "right" }, typography.tabularNumeric]}>
                          {formatUsd(it.lineTotalUsd)}
                        </Text>
                      </View>
                    ))}
                  </View>

                  <View style={styles.receiptDivider} />

                  {/* Totales Bimoneda */}
                  <View style={styles.receiptTotalsBox}>
                    <View style={styles.receiptTotalRow}>
                      <Text style={styles.receiptTotalLabel}>Subtotal:</Text>
                      <Text style={[styles.receiptTotalVal, typography.tabularNumeric]}>
                        {formatUsd(selectedReceipt.subtotalUsd)} ({formatVes(selectedReceipt.subtotalVes)})
                      </Text>
                    </View>
                    <View style={styles.receiptTotalRow}>
                      <Text style={styles.receiptTotalLabel}>IVA:</Text>
                      <Text style={[styles.receiptTotalVal, typography.tabularNumeric]}>
                        {formatUsd(selectedReceipt.taxUsd)} ({formatVes(selectedReceipt.taxVes)})
                      </Text>
                    </View>
                    <View style={[styles.receiptTotalRow, styles.receiptTotalRowMain]}>
                      <Text style={styles.receiptGrandTotalLabel}>TOTAL LEGAL:</Text>
                      <View style={styles.receiptGrandTotalValues}>
                        <Text style={[styles.receiptGrandTotalUsd, typography.tabularNumeric]}>
                          {formatUsd(selectedReceipt.totalUsd)}
                        </Text>
                        <Text style={[styles.receiptGrandTotalVes, typography.tabularNumeric]}>
                          ≈ {formatVes(selectedReceipt.totalVes)}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.receiptRateNotice}>
                      <Text style={styles.receiptRateNoticeText}>
                        Tasa congelada: {formatVes(selectedReceipt.exchangeRate)} / USD
                      </Text>
                      <Text style={styles.receiptRateNoticeText}>
                        Método de pago: {PAYMENT_METHOD_LABELS[selectedReceipt.paymentMethod] ?? selectedReceipt.paymentMethod}
                      </Text>
                    </View>
                  </View>

                </ScrollView>
                {receiptActions}
              </View>
            ) : null}
          </View>
        </View>
      </Modal>

      {/* Modal Confirmación de Anulación / Devolución */}
      <Modal visible={isVoidConfirmOpen} transparent animationType="fade" onRequestClose={() => setIsVoidConfirmOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Confirmar Anulación de Venta</Text>
            <Text style={styles.modalNotice}>
              Los productos de esta venta vuelven al inventario y la venta deja de contar en la
              recaudación del turno. No se puede deshacer; el motivo queda en la auditoría.
            </Text>

            {voidError ? <Text style={styles.errorText}>{voidError}</Text> : null}

            <View style={styles.modalInputGroup}>
              <Text style={styles.inputLabel}>Motivo de la anulación (obligatorio)</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="Ej. Devolución de cliente / Error en método de pago"
                placeholderTextColor={theme.textMuted}
                value={voidReasonInput}
                onChangeText={setVoidReasonInput}
                accessibilityLabel="Motivo de anulación de la venta"
              />
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => setIsVoidConfirmOpen(false)}
                style={styles.cancelBtn}
                accessibilityRole="button"
                accessibilityLabel="Cancelar anulación"
              >
                <Text style={styles.cancelBtnText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={handleConfirmVoid}
                style={styles.deleteConfirmBtn}
                testID="btn-confirm-void"
                accessibilityRole="button"
                accessibilityLabel="Sí, anular venta"
              >
                <Text style={styles.deleteConfirmBtnText}>SÍ, ANULAR VENTA</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const makeStyles = (c: Palette, m: Metrics) =>
  StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: "column",
    backgroundColor: c.surfaceBase,
  },
  columnsRow: {
    flex: 1,
    flexDirection: "row",
  },
  columnsRowMobile: {
    flexDirection: "column",
  },
  paneHidden: {
    display: "none",
  },
  mobilePanes: {
    flexDirection: "row",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    backgroundColor: c.surfaceContainerLow,
  },
  mobilePaneBtn: {
    flex: 1,
    minHeight: spacing.touchTargetMin,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: spacing.radiusMd,
    borderWidth: 1,
    borderColor: c.border,
  },
  mobilePaneBtnActive: {
    backgroundColor: c.primarySoft,
    borderColor: c.primary,
  },
  mobilePaneText: {
    fontSize: typography.sizes.subText,
    fontWeight: typography.weights.semibold,
    color: c.textSecondary,
  },
  mobilePaneTextActive: {
    color: c.textPrimary,
    fontWeight: typography.weights.bold,
  },
  noShiftBanner: {
    flexWrap: "wrap",
    gap: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: c.warningSurface,
    borderBottomWidth: 1,
    borderBottomColor: c.warning,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    zIndex: 10,
  },
  noShiftBannerContent: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: spacing.md,
  },
  noShiftBannerIcon: {
    fontSize: 20,
  },
  noShiftBannerTexts: {
    flex: 1,
  },
  noShiftBannerTitle: {
    color: c.warningText,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
  },
  noShiftBannerSubtitle: {
    color: c.textSecondary,
    fontSize: typography.sizes.caption,
  },
  noShiftBannerButton: {
    backgroundColor: c.warning,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: spacing.radiusMd,
    minHeight: spacing.touchTargetMin,
    justifyContent: "center",
    alignItems: "center",
  },
  noShiftBannerButtonText: {
    color: c.onWarning,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
  },
  catalogColumn: {
    flex: 1,
    padding: spacing.md,
    borderRightWidth: 1,
    borderRightColor: c.border,
  },
  catalogHeader: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontSize: typography.sizes.titleMd,
    fontWeight: typography.weights.bold,
    color: c.textPrimary,
  },
  catalogCountSub: {
    fontSize: typography.sizes.caption,
    color: c.textSecondary,
    marginTop: 2,
  },
  stockNoticeBox: {
    backgroundColor: c.warningSoft,
    borderWidth: 1,
    borderColor: c.warning,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: spacing.radiusMd,
    marginBottom: spacing.sm,
  },
  stockNoticeText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.semibold,
    color: c.warningText,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: c.surfaceContainerLow,
    borderRadius: spacing.radiusMd,
    borderWidth: 1,
    borderColor: c.border,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    height: spacing.touchTargetMin,
  },
  searchIcon: {
    fontSize: 16,
    marginRight: spacing.sm,
  },
  searchInput: {
    flex: 1,
    height: "100%",
    color: c.textPrimary,
    fontSize: typography.sizes.body,
  },
  searchClearBtn: {
    minWidth: spacing.touchTargetMin,
    minHeight: spacing.touchTargetMin,
    justifyContent: "center",
    alignItems: "center",
  },
  searchClearText: {
    color: c.textMuted,
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
    minHeight: spacing.touchTargetMin,
    paddingHorizontal: spacing.md,
    backgroundColor: c.surfaceContainerLow,
    borderRadius: spacing.radiusFull,
    borderWidth: 1,
    borderColor: c.border,
    justifyContent: "center",
    alignItems: "center",
  },
  categoryChipActive: {
    backgroundColor: c.primary,
    borderColor: c.primaryGlow,
  },
  categoryChipText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.medium,
    color: c.textSecondary,
  },
  categoryChipTextActive: {
    color: c.onPrimary,
    fontWeight: typography.weights.bold,
  },
  ratePill: {
    flexDirection: "row",
    alignItems: "center",
    height: spacing.touchTargetMin, // 48px mínimo táctil
    backgroundColor: c.surfaceContainerLow,
    paddingHorizontal: spacing.md,
    borderRadius: spacing.radiusFull,
    borderWidth: 1,
    borderColor: c.primaryGlow,
    gap: spacing.xs,
  },
  ratePillLabel: {
    fontSize: typography.sizes.caption,
    color: c.textSecondary,
    fontWeight: typography.weights.medium,
  },
  ratePillValue: {
    fontSize: typography.sizes.subText,
    fontWeight: typography.weights.bold,
    color: c.primaryGlow,
  },
  ratePillEdit: {
    fontSize: typography.sizes.caption,
    color: c.primaryGlow,
    marginLeft: 4,
  },
  catalogGrid: {
    paddingBottom: spacing.sm,
  },
  productCard: {
    flex: 1,
    margin: spacing.xs,
    minHeight: 140,
    backgroundColor: c.surfaceContainer,
    borderRadius: spacing.radiusLg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: c.border,
    justifyContent: "space-between",
  },
  productCardOutStock: {
    opacity: 0.75,
    borderStyle: "dashed",
    borderColor: c.error,
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
    backgroundColor: c.surfaceContainerHigh,
  },
  productThumbPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: spacing.radiusMd,
    backgroundColor: c.surfaceContainerHigh,
    justifyContent: "center",
    alignItems: "center",
  },
  productThumbPlaceholderText: {
    fontSize: 20,
  },
  cardHeaderMeta: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  badge: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    backgroundColor: c.surfaceContainerHighest,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: spacing.radiusSm,
  },
  badgeText: {
    fontSize: typography.sizes.caption,
    color: c.primaryGlow,
    fontWeight: typography.weights.bold,
  },
  stockBadge: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: spacing.radiusSm,
  },
  stockBadgeOk: {
    backgroundColor: c.heroSoft,
  },
  stockBadgeTextOk: {
    fontSize: 12,
    fontWeight: typography.weights.bold,
    color: c.heroText,
  },
  stockBadgeLow: {
    backgroundColor: c.warningSoft,
  },
  stockBadgeTextLow: {
    fontSize: 12,
    fontWeight: typography.weights.bold,
    color: c.warningText,
  },
  stockBadgeOut: {
    backgroundColor: c.errorSoft,
  },
  stockBadgeTextOut: {
    fontSize: 12,
    fontWeight: typography.weights.bold,
    color: c.errorText,
  },
  stockBadgeNoTracking: {
    backgroundColor: c.surfaceContainerHigh,
    borderWidth: 1,
    borderColor: c.border,
  },
  stockBadgeTextNoTracking: {
    fontSize: 12,
    fontWeight: typography.weights.semibold,
    color: c.textMuted,
  },
  productName: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.semibold,
    color: c.textPrimary,
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
    color: c.textMuted,
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
    color: c.textSecondary,
  },
  emptyCatalogSub: {
    fontSize: typography.sizes.caption,
    color: c.textMuted,
    marginTop: 4,
  },
  emptyCatalogAction: {
    minHeight: spacing.touchTargetMin,
    minWidth: 160,
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: c.primary,
    borderRadius: spacing.radiusMd,
  },
  emptyCatalogActionText: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    color: c.onPrimary,
  },
  priceUsd: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    color: c.textPrimary,
  },
  priceVes: {
    fontSize: typography.sizes.caption,
    color: c.textSecondary,
  },
  ticketColumn: {
    flex: 1,
    backgroundColor: c.surfaceContainerLow,
    display: "flex",
    flexDirection: "column",
  },
  ticketHeader: {
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  itemCountText: {
    fontSize: typography.sizes.subText,
    color: c.textSecondary,
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
    borderBottomColor: c.border,
    gap: spacing.sm,
  },
  ticketLineInfo: {
    flex: 1,
  },
  ticketLineName: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.semibold,
    color: c.textPrimary,
  },
  ticketLineUnit: {
    fontSize: typography.sizes.caption,
    color: c.textSecondary,
  },
  ticketLineTotalContainer: {
    minWidth: 80,
    alignItems: "flex-end",
  },
  ticketLineTotal: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    color: c.textPrimary,
  },
  ticketLineTotalVes: {
    fontSize: typography.sizes.caption,
    color: c.textSecondary,
  },
  emptyContainer: {
    flex: 1,
    paddingVertical: 60,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    fontSize: typography.sizes.titleMd,
    color: c.textSecondary,
    fontWeight: typography.weights.medium,
  },
  emptySubText: {
    fontSize: typography.sizes.caption,
    color: c.textMuted,
    marginTop: spacing.xs,
  },
  checkoutFooter: {
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: c.border,
    backgroundColor: c.surfaceContainerLow,
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
    maxWidth: 560,
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
    marginBottom: spacing.xs,
  },
  modalNotice: {
    fontSize: typography.sizes.caption,
    color: c.textSecondary,
    marginBottom: spacing.md,
  },
  errorText: {
    fontSize: typography.sizes.caption,
    color: c.errorText,
    fontWeight: typography.weights.bold,
    marginBottom: spacing.sm,
  },
  successBox: {
    backgroundColor: c.heroSoft,
    padding: spacing.sm,
    borderRadius: spacing.radiusMd,
    marginBottom: spacing.sm,
    alignItems: "center",
    gap: spacing.xs,
  },
  successText: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    color: c.heroText,
    textAlign: "center",
  },
  successAmount: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.semibold,
    color: c.textPrimary,
  },
  successLinkBtn: {
    minHeight: spacing.touchTargetMin,
    paddingHorizontal: spacing.lg,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: spacing.radiusMd,
    borderWidth: 1,
    borderColor: c.hero,
  },
  successLinkText: {
    fontSize: typography.sizes.subText,
    fontWeight: typography.weights.bold,
    color: c.heroText,
  },
  checkoutSummaryCard: {
    backgroundColor: c.surfaceContainer,
    padding: spacing.md,
    borderRadius: spacing.radiusLg,
    gap: spacing.xs,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  summaryLabel: {
    fontSize: typography.sizes.body,
    color: c.textSecondary,
  },
  paymentMethodTitle: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: c.textSecondary,
    marginBottom: spacing.xs,
  },
  paymentMethodsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  paymentMethodBtn: {
    flex: 1,
    minWidth: "45%",
    height: spacing.touchTargetMin, // 48px
    backgroundColor: c.surfaceContainerHigh,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: c.border,
  },
  paymentMethodBtnActive: {
    backgroundColor: c.primary,
    borderColor: c.primaryGlow,
  },
  paymentMethodText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.medium,
    color: c.textSecondary,
  },
  paymentMethodTextActive: {
    color: c.textPrimary,
    fontWeight: typography.weights.bold,
  },
  modalInputGroup: {
    marginBottom: spacing.md,
  },
  inputLabel: {
    fontSize: typography.sizes.caption,
    color: c.textSecondary,
    marginBottom: spacing.xs,
  },
  modalInput: {
    height: spacing.touchTargetMin, // 48px
    backgroundColor: c.surfaceContainerHigh,
    borderRadius: spacing.radiusMd,
    paddingHorizontal: spacing.md,
    color: c.textPrimary,
    fontSize: typography.sizes.body,
    borderWidth: 1,
    borderColor: c.border,
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
    color: c.textSecondary,
  },
  applyBtn: {
    height: spacing.touchTargetMin,
    backgroundColor: c.primary,
    paddingHorizontal: spacing.xl,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: spacing.radiusMd,
  },
  applyBtnText: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    color: c.onPrimary,
  },
  clearTicketBtn: {
    minHeight: spacing.touchTargetMin,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: c.errorSoft,
    borderRadius: spacing.radiusMd,
    borderWidth: 1,
    borderColor: c.error,
  },
  clearTicketText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: c.errorText,
  },
  ticketLineMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: 2,
  },
  taxBadge: {
    backgroundColor: c.primarySoft,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: spacing.radiusSm,
  },
  taxBadgeText: {
    fontSize: 12,
    fontWeight: typography.weights.bold,
    color: c.primaryGlow,
  },
  taxBadgeExempt: {
    backgroundColor: c.neutralSoft,
  },
  taxBadgeTextExempt: {
    fontSize: 12,
    fontWeight: typography.weights.bold,
    color: c.textMuted,
  },
  stepperAndNumpadRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  numpadTriggerBtn: {
    width: spacing.touchTargetMin,
    height: spacing.touchTargetMin,
    backgroundColor: c.surfaceContainerHighest,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: c.border,
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
    width: spacing.touchTargetMin,
    height: spacing.touchTargetMin,
    borderRadius: spacing.radiusFull,
    backgroundColor: c.errorSoft,
    justifyContent: "center",
    alignItems: "center",
  },
  deleteLineText: {
    fontSize: 12,
    fontWeight: typography.weights.bold,
    color: c.errorText,
  },
  financialSummaryCard: {
    backgroundColor: c.surfaceContainer,
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
    color: c.textSecondary,
  },
  finValue: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: c.textPrimary,
  },
  finSub: {
    fontSize: 12,
    color: c.textMuted,
    fontWeight: typography.weights.regular,
  },
  summarySubtotalUsd: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.semibold,
    color: c.textSecondary,
  },
  summaryTaxUsd: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.semibold,
    color: c.primaryGlow,
  },
  numpadModalCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: c.surfaceContainerLow,
    borderRadius: spacing.radiusXl,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: c.border,
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
    color: c.textPrimary,
    marginTop: 2,
  },
  numpadProductSub: {
    fontSize: typography.sizes.caption,
    color: c.textSecondary,
    marginTop: 2,
  },
  numpadCloseBtn: {
    minWidth: spacing.touchTargetMin,
    minHeight: spacing.touchTargetMin,
    justifyContent: "center",
    alignItems: "center",
  },
  numpadCloseText: {
    fontSize: 18,
    color: c.textMuted,
    fontWeight: typography.weights.bold,
  },
  numpadDisplay: {
    backgroundColor: c.surfaceContainer,
    borderRadius: spacing.radiusMd,
    padding: spacing.md,
    alignItems: "center",
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: c.primaryGlow,
  },
  numpadDisplayLabel: {
    fontSize: typography.sizes.caption,
    color: c.textSecondary,
    marginBottom: 4,
  },
  numpadDisplayValue: {
    fontSize: 32,
    fontWeight: typography.weights.extraBold,
    color: c.textPrimary,
  },
  numpadDisplaySub: {
    fontSize: typography.sizes.caption,
    color: c.heroText,
    marginTop: 4,
  },
  confirmModalCard: {
    width: "100%",
    maxWidth: 460,
    backgroundColor: c.surfaceContainerLow,
    borderRadius: spacing.radiusXl,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: c.border,
  },
  deleteConfirmBtn: {
    height: spacing.touchTargetHero,
    backgroundColor: c.error,
    paddingHorizontal: spacing.xl,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: spacing.radiusLg,
  },
  deleteConfirmBtnText: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    color: c.onPrimary,
    letterSpacing: 1,
  },
  confirmCheckoutBtnDisabled: {
    backgroundColor: c.surfaceContainerHigh,
    opacity: 0.6,
  },
  tenderSection: {
    backgroundColor: c.surfaceContainer,
    borderRadius: spacing.radiusLg,
    padding: spacing.md,
  },
  tenderSectionTitle: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: c.textSecondary,
    marginBottom: spacing.sm,
  },
  tenderInputsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  tenderFieldBox: {
    flex: 1,
    minWidth: "45%",
    minHeight: spacing.touchTargetMin,
    justifyContent: "center",
    backgroundColor: c.surfaceContainerHigh,
    borderRadius: spacing.radiusMd,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: c.border,
  },
  tenderFieldBoxActive: {
    borderColor: c.primaryGlow,
    backgroundColor: c.surfaceContainerHighest,
  },
  tenderFieldLabel: {
    fontSize: 12,
    color: c.textSecondary,
    fontWeight: typography.weights.semibold,
  },
  tenderFieldValue: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    color: c.textPrimary,
    marginTop: 2,
  },
  exactRemainingBtn: {
    minHeight: spacing.touchTargetMin,
    justifyContent: "center",
    backgroundColor: c.primarySoft,
    borderWidth: 1,
    borderColor: c.primaryGlow,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    borderRadius: spacing.radiusMd,
    alignItems: "center",
  },
  exactRemainingBtnText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: c.primaryGlow,
  },
  paymentNumpadContainer: {
    alignItems: "center",
  },
  confirmCheckoutBtn: {
    // Botón maestro de cobro: 64 px (AGENTS.md) y ancho completo de la columna derecha
    alignSelf: "stretch",
    height: spacing.touchTargetHero, // 64px hero height para cobro (AGENTS.md)
    backgroundColor: c.hero, // Verde maestro #00B074
    paddingHorizontal: spacing.xl,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: spacing.radiusLg,
  },
  confirmCheckoutBtnText: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.extraBold,
    color: c.onHero,
    letterSpacing: 1,
  },
  confirmCheckoutBtnTextDisabled: {
    color: c.textMuted,
  },
  rightTabRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    backgroundColor: c.surfaceContainer,
  },
  rightTabBtn: {
    flex: 1,
    height: spacing.touchTargetMin,
    justifyContent: "center",
    alignItems: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  rightTabBtnActive: {
    borderBottomColor: c.primary,
    backgroundColor: c.surfaceContainerLow,
  },
  rightTabText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.semibold,
    color: c.textSecondary,
  },
  rightTabTextActive: {
    color: c.textPrimary,
    fontWeight: typography.weights.bold,
  },
  historyTabContainer: {
    flex: 1,
    backgroundColor: c.surfaceContainerLow,
  },
  shiftInvoicesList: {
    padding: spacing.md,
  },
  invoiceCard: {
    backgroundColor: c.surfaceContainer,
    borderRadius: spacing.radiusMd,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: c.border,
  },
  invoiceCardVoid: {
    opacity: 0.65,
    borderColor: c.error,
    backgroundColor: c.errorSoft,
  },
  invoiceCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.xs,
  },
  invoiceNumberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  invoiceNumberText: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    color: c.textPrimary,
  },
  invoiceTimeText: {
    fontSize: typography.sizes.caption,
    color: c.textSecondary,
  },
  invoiceStatusBadge: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: spacing.radiusSm,
  },
  badgeVoid: {
    backgroundColor: c.errorSoft,
  },
  badgeCompleted: {
    backgroundColor: c.heroSoft,
  },
  invoiceStatusBadgeText: {
    fontSize: 12,
    fontWeight: typography.weights.bold,
    color: c.textPrimary,
  },
  invoiceCardMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  invoiceMethodText: {
    fontSize: typography.sizes.caption,
    color: c.textSecondary,
  },
  invoiceAmounts: {
    alignItems: "flex-end",
  },
  invoiceTotalUsd: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    color: c.heroText,
  },
  invoiceTotalVes: {
    fontSize: typography.sizes.caption,
    color: c.textSecondary,
  },
  textLineThrough: {
    textDecorationLine: "line-through",
    color: c.textMuted,
  },
  emptyHistoryBox: {
    paddingVertical: 60,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyHistoryText: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    color: c.textSecondary,
  },
  emptyHistorySub: {
    fontSize: typography.sizes.caption,
    color: c.textMuted,
    marginTop: 4,
    textAlign: "center",
    paddingHorizontal: spacing.lg,
  },
  receiptCard: {
    width: "100%",
    maxWidth: 980, // más ancho para que el riel de acciones viva al lado del ticket
    maxHeight: "92%",
    padding: 0,
    backgroundColor: c.surfaceContainerLow,
    overflow: "hidden",
  },
  receiptLayout: {
    flex: 1,
    flexDirection: "row",
    minHeight: 0,
  },
  receiptLayoutStacked: {
    flexDirection: "column",
  },
  receiptRail: {
    // Acciones del comprobante en columna lateral: nunca fuera del viewport
    width: m.receiptRail,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    borderLeftWidth: 1,
    borderLeftColor: c.border,
    backgroundColor: c.surfaceContainer,
    justifyContent: "flex-start",
  },
  receiptActionBar: {
    // Versión vertical (móvil/ventana baja): barra fija bajo el scroll
    padding: spacing.md,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: c.border,
    backgroundColor: c.surfaceContainer,
  },
  receiptActionRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  receiptActionRowBtn: {
    flex: 1,
  },
  checkoutScreen: {
    // Pantalla completa de cobro: todo cabe en el lienzo 1280×800 sin scroll
    flex: 1,
    backgroundColor: c.surfaceBase,
    padding: spacing.lg,
    gap: spacing.md,
  },
  checkoutTopBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.lg,
  },
  checkoutTopTexts: {
    flex: 1,
    gap: spacing.xs,
  },
  checkoutTopNote: {
    fontSize: typography.sizes.caption,
    color: c.textMuted,
  },
  checkoutBackBtn: {
    minHeight: spacing.touchTargetMin, // 48px
    paddingHorizontal: spacing.lg,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: spacing.radiusMd,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surfaceContainer,
  },
  checkoutBackText: {
    fontSize: typography.sizes.subText,
    fontWeight: typography.weights.bold,
    color: c.textSecondary,
  },
  checkoutHero: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.lg,
    backgroundColor: c.surfaceContainer,
    borderRadius: spacing.radiusLg,
    borderWidth: 1,
    borderColor: c.border,
    borderLeftWidth: 4,
    borderLeftColor: c.hero,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  heroMain: {
    flex: 1,
    gap: 2,
  },
  heroLabel: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: c.textMuted,
    letterSpacing: 1,
  },
  heroAmountsRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.md,
    flexWrap: "wrap",
  },
  heroTotalUsd: {
    fontSize: typography.sizes.heroTotal,
    fontWeight: typography.weights.extraBold,
    color: c.textPrimary,
  },
  heroTotalVes: {
    fontSize: typography.sizes.titleMd,
    fontWeight: typography.weights.bold,
    color: c.primaryGlow,
  },
  heroRate: {
    fontSize: typography.sizes.caption,
    color: c.textMuted,
  },
  heroStatus: {
    alignItems: "flex-end",
  },
  heroChip: {
    alignItems: "flex-end",
    gap: 2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: spacing.radiusMd,
  },
  heroChipWarn: {
    backgroundColor: c.warningSoft,
  },
  heroChipOk: {
    backgroundColor: c.heroSoft,
  },
  heroChipText: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.extraBold,
  },
  heroChipWarnText: {
    color: c.warningText,
  },
  heroChipOkText: {
    color: c.heroText,
  },
  heroChipSub: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.semibold,
  },
  checkoutBody: {
    flex: 1,
  },
  checkoutBodyContent: {
    flexGrow: 1,
  },
  checkoutColumns: {
    flexDirection: "row",
    gap: spacing.lg,
    flexGrow: 1,
  },
  checkoutColumnsStacked: {
    flexDirection: "column",
  },
  checkoutLeft: {
    flex: 1,
    gap: spacing.md,
  },
  checkoutRight: {
    // Columna del numpad: proporcional al viewport, acotada entre 224 y el lienzo 1280
    width: m.checkoutRight,
    gap: spacing.sm,
    // Empuja el botón maestro al fondo de la columna, siempre al alcance del pulgar
    justifyContent: "space-between",
  },
  checkoutRightStacked: {
    width: "100%",
    justifyContent: "flex-start",
  },
  checkoutStickyBar: {
    // Barra fija de pulgar en modo vertical: el botón maestro jamás scrollea fuera
    borderTopWidth: 1,
    borderTopColor: c.border,
    paddingTop: spacing.sm,
  },
  receiptScroll: {
    flex: 1,
  },
  receiptContent: {
    padding: spacing.xl,
  },
  receiptHeader: {
    alignItems: "center",
    marginBottom: spacing.md,
  },
  receiptBrand: {
    fontSize: typography.sizes.titleLg,
    fontWeight: typography.weights.extraBold,
    color: c.textPrimary,
    letterSpacing: 2,
  },
  receiptSubBrand: {
    fontSize: typography.sizes.caption,
    color: c.textSecondary,
    marginBottom: 4,
  },
  receiptTerminal: {
    fontSize: typography.sizes.caption,
    color: c.textMuted,
  },
  receiptInvoiceNum: {
    fontSize: typography.sizes.titleMd,
    fontWeight: typography.weights.bold,
    color: c.primaryGlow,
    marginTop: 4,
  },
  receiptDate: {
    fontSize: typography.sizes.caption,
    color: c.textSecondary,
  },
  receiptStatusBadge: {
    padding: spacing.xs,
    borderRadius: spacing.radiusMd,
    alignItems: "center",
    marginVertical: spacing.xs,
  },
  receiptBadgeOk: {
    backgroundColor: c.heroSoft,
  },
  receiptBadgeVoid: {
    backgroundColor: c.errorSoft,
  },
  receiptStatusText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: c.textPrimary,
  },
  receiptVoidReason: {
    fontSize: typography.sizes.caption,
    color: c.errorText,
    marginTop: 2,
  },
  receiptDivider: {
    height: 1,
    backgroundColor: c.border,
    marginVertical: spacing.md,
  },
  receiptItemsTable: {
    gap: 4,
  },
  receiptTableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    paddingBottom: 4,
  },
  receiptTh: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: c.textSecondary,
  },
  receiptItemRow: {
    flexDirection: "row",
    paddingVertical: 3,
  },
  receiptItemName: {
    fontSize: typography.sizes.caption,
    color: c.textPrimary,
  },
  receiptItemQty: {
    fontSize: typography.sizes.caption,
    color: c.textSecondary,
  },
  receiptItemPrice: {
    fontSize: typography.sizes.caption,
    color: c.textSecondary,
  },
  receiptItemTotal: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: c.textPrimary,
  },
  receiptTotalsBox: {
    backgroundColor: c.surfaceContainer,
    borderRadius: spacing.radiusMd,
    padding: spacing.md,
    gap: 4,
  },
  receiptTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  receiptTotalRowMain: {
    borderTopWidth: 1,
    borderTopColor: c.border,
    paddingTop: 6,
    marginTop: 4,
  },
  receiptTotalLabel: {
    fontSize: typography.sizes.caption,
    color: c.textSecondary,
  },
  receiptTotalVal: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.semibold,
    color: c.textPrimary,
  },
  receiptGrandTotalLabel: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.extraBold,
    color: c.textPrimary,
  },
  receiptGrandTotalValues: {
    alignItems: "flex-end",
  },
  receiptGrandTotalUsd: {
    fontSize: typography.sizes.titleMd,
    fontWeight: typography.weights.extraBold,
    color: c.heroText,
  },
  receiptGrandTotalVes: {
    fontSize: typography.sizes.caption,
    color: c.textSecondary,
  },
  receiptRateNotice: {
    marginTop: spacing.xs,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  receiptRateNoticeText: {
    fontSize: typography.sizes.caption,
    color: c.textMuted,
  },
  receiptVoidBtn: {
    height: spacing.touchTargetMin,
    backgroundColor: c.errorSoft,
    borderWidth: 1,
    borderColor: c.error,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
  },
  receiptPrintBtn: {
    height: spacing.touchTargetHero, // 64px: acción primaria del comprobante
    backgroundColor: c.primary,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
  },
  receiptPrintBtnBusy: {
    opacity: 0.6,
  },
  receiptPrintBtnText: {
    fontSize: typography.sizes.subText,
    fontWeight: typography.weights.extraBold,
    color: c.onPrimary,
    letterSpacing: 0.5,
  },
  receiptPrintFeedback: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.semibold,
    color: c.textSecondary,
    textAlign: "center",
  },
  printTransportRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  printTransportRowRail: {
    flexDirection: "column",
  },
  printTransportChip: {
    flex: 1,
    minHeight: spacing.touchTargetMin,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: spacing.radiusMd,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surfaceContainerHigh,
    paddingHorizontal: spacing.xs,
  },
  printTransportChipActive: {
    borderColor: c.primaryGlow,
    backgroundColor: c.primarySoft,
  },
  printTransportChipText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.semibold,
    color: c.textSecondary,
  },
  printTransportChipTextActive: {
    color: c.primaryGlow,
    fontWeight: typography.weights.bold,
  },
  receiptVoidBtnText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: c.errorText,
  },
  receiptCloseBtn: {
    height: spacing.touchTargetMin,
    backgroundColor: c.surfaceContainerHighest,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
  },
  receiptCloseBtnText: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.semibold,
    color: c.textPrimary,
  },
});
