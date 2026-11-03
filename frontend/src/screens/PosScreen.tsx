import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  FlatList,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
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
  Decimal,
} from "../utils/decimal";
import type { SqlDriver } from "../database/connection";
import { getCatalogWithBimonetaryPrices } from "../services/catalog.service";
import type { BimonetaryProduct } from "../services/catalog.service";
import { registerManualRate } from "../services/bcv-exchange.service";
import {
  createInvoice,
  listInvoicesByShift,
  voidInvoice,
} from "../database/repositories/invoice.repository";
import type {
  PaymentMethod,
  InvoiceEntity,
} from "../database/repositories/invoice.repository";
import { getOpenShift } from "../database/repositories/shift.repository";
import type { ShiftEntity } from "../database/repositories/shift.repository";
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
    // Verificar si el producto tiene stock <= 0 para advertir
    const stockVal = toDecimal(product.currentStock ?? "100.0000");
    if (stockVal.lte(0)) {
      showNotice(`Aviso: "${product.name}" se encuentra sin stock (0.0000). Se añade al ticket en modo contingencia.`);
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
  }, [showNotice]);

  // Escaneo reactivo mediante lector HID de código de barras
  useBarcodeScanner({
    target: keyEventTarget,
    onScan: (scannedBarcode) => {
      if (db) {
        try {
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

  // Estado del modal de actualización de tasa
  const [isRateModalOpen, setIsRateModalOpen] = useState(false);
  const [newRateInput, setNewRateInput] = useState("");
  const [rateReasonInput, setRateReasonInput] = useState("");
  const [rateError, setRateError] = useState<string | null>(null);

  // Estado del modal de cobro (Checkout)
  const [isCheckoutModalOpen, setIsCheckoutModalOpen] = useState(false);
  // Tablet landscape (1280×800) usa dos columnas; pantallas angostas apilan el cobro
  const { width: windowWidth } = useWindowDimensions();
  const isWideCheckout = windowWidth >= 900;
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethod>("CASH_USD");
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [lastInvoiceSuccess, setLastInvoiceSuccess] = useState<string | null>(null);
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

  const isPaymentComplete = useMemo(() => {
    if (!toDecimal(remainingUsd).isZero()) return false;
    // SPLIT persiste el breakdown con los montos entregados: exigir monto exacto
    // (sin vuelto) para que el arqueo de caja no descuadre con el vuelto físico.
    return selectedPaymentMethod !== "SPLIT" || toDecimal(changeUsd).isZero();
  }, [selectedPaymentMethod, remainingUsd, changeUsd]);

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
        throw new Error(`El cobro mixto (SPLIT) exige el monto exacto: sobran ${formatUsd(changeUsd)} (≈ ${formatVes(changeVes)}). Ajuste los montos entregados.`);
      }

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

        onInvoiceCreated?.(invoiceId);
        refreshShiftInvoices();
        refreshCatalog();
      }

      setLastInvoiceSuccess(`¡Venta cobrada con éxito!`);
      setTicketItems([]);
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
      successTimerRef.current = setTimeout(() => {
        setIsCheckoutModalOpen(false);
        setLastInvoiceSuccess(null);
        setIsSubmitting(false);
        submittingRef.current = false;
      }, 1200);
    } catch (err) {
      setCheckoutError((err as Error).message);
      setIsSubmitting(false);
      submittingRef.current = false;
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

      <View style={styles.columnsRow}>
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
            <TouchableOpacity onPress={() => setSearchQuery("")} style={styles.searchClearBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
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
                          ⚠ Bajo: {formatFixed4(item.currentStock ?? "0")} {item.unit ?? "und"}
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
      <View style={styles.ticketColumn}>
        {/* Selector de Pestaña: Ticket vs Ventas del Turno */}
        <View style={styles.rightTabRow}>
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => setRightPanelTab("ticket")}
            style={[styles.rightTabBtn, rightPanelTab === "ticket" && styles.rightTabBtnActive]}
            testID="tab-btn-ticket"
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
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
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
                    {inv.paymentMethod} • {inv.items.length} {inv.items.length === 1 ? "ítem" : "ítems"}
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
                Las ventas cobradas se listarán aquí con opción de comprobante y devolución.
              </Text>
            </View>
          }
        />
      </View>
    )}
  </View>
  </View>

      {/* Modal Táctil de Cobro / Emisión de Factura */}
      <Modal
        visible={isCheckoutModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsCheckoutModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, styles.checkoutCard]}>
            {/* 1280×800: dos columnas — importes/método a la izquierda, numpad/vuelto a la derecha */}
            <View style={styles.checkoutHeader}>
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
            </View>

            <ScrollView style={styles.checkoutBody} contentContainerStyle={styles.checkoutBodyContent}>
              <View style={[styles.checkoutColumns, !isWideCheckout && styles.checkoutColumnsStacked]}>
                {/* Columna izquierda: importes, modalidad de cobro y montos entregados */}
                <View style={styles.checkoutLeft}>
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
                  <View>
                    <Text style={styles.paymentMethodTitle}>Seleccione Modalidad de Cobro:</Text>
                    <View style={styles.paymentMethodsGrid}>
                      {[
                        { id: "CASH_USD", label: "Efectivo USD ($)" },
                        { id: "CASH_VES", label: "Efectivo VES (Bs.)" },
                        { id: "PAGO_MOVIL", label: "Pago Móvil (Bs.)" },
                        { id: "CARD_VES", label: "Punto / Tarjeta (Bs.)" },
                        { id: "SPLIT", label: "Cobro Mixto (SPLIT)" },
                      ].map((m) => {
                        const isSelected = selectedPaymentMethod === m.id;
                        return (
                          <TouchableOpacity
                            key={m.id}
                            activeOpacity={0.8}
                            onPress={() => handleSelectPaymentMethod(m.id as PaymentMethod)}
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
                  </View>

                  {/* Panel de Desglose de Pago / Cobro Combinado (SPLIT) */}
                  <View style={styles.tenderSection}>
                    <Text style={styles.tenderSectionTitle}>
                      {selectedPaymentMethod === "SPLIT"
                        ? "Desglose de Montos Entregados por el Cliente:"
                        : `Monto Entregado (${selectedPaymentMethod === "CASH_USD" ? "USD" : "VES"}):`}
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

                {/* Columna derecha: numpad del monto activo y resultado (saldo/vuelto) */}
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
                    >
                      <Text style={styles.exactRemainingBtnText}>
                        ⚡ Completar restante en {activePaymentInput === "CASH_USD" ? "USD" : "VES"}: {activePaymentInput === "CASH_USD" ? formatUsd(remainingUsd) : formatVes(remainingVes)}
                      </Text>
                    </TouchableOpacity>
                  ) : null}

                  {/* Banner de Saldo Restante y Vuelto Calculado */}
                  <View style={styles.balanceSummaryBox}>
                    {toDecimal(remainingUsd).gt(0) ? (
                      <View style={styles.balanceRow}>
                        <Text style={styles.balanceWarnLabel}>⚠️ Saldo Restante por Pagar:</Text>
                        <View style={styles.balanceAmountsCol}>
                          <Text style={[styles.balanceWarnUsd, typography.tabularNumeric]}>
                            {formatUsd(remainingUsd)}
                          </Text>
                          <Text style={[styles.balanceWarnVes, typography.tabularNumeric]}>
                            ≈ {formatVes(remainingVes)}
                          </Text>
                        </View>
                      </View>
                    ) : selectedPaymentMethod === "SPLIT" && toDecimal(changeUsd).gt(0) ? (
                      <View style={styles.balanceRow}>
                        <Text style={styles.balanceWarnLabel}>⚠️ Cobro mixto exige monto exacto — sobran:</Text>
                        <View style={styles.balanceAmountsCol}>
                          <Text style={[styles.balanceWarnUsd, typography.tabularNumeric]}>
                            {formatUsd(changeUsd)}
                          </Text>
                          <Text style={[styles.balanceWarnVes, typography.tabularNumeric]}>
                            ≈ {formatVes(changeVes)}
                          </Text>
                        </View>
                      </View>
                    ) : (
                      <View style={styles.balanceRow}>
                        <Text style={styles.balanceSuccessLabel}>✓ Monto Cubierto Totalmente</Text>
                        <View style={styles.balanceAmountsCol}>
                          <Text style={styles.changeLabel}>Vuelto a entregar:</Text>
                          <Text style={[styles.changeUsd, typography.tabularNumeric]}>
                            {formatUsd(changeUsd)}
                          </Text>
                          <Text style={[styles.changeVes, typography.tabularNumeric]}>
                            ≈ {formatVes(changeVes)}
                          </Text>
                        </View>
                      </View>
                    )}
                  </View>
                </View>
              </View>
            </ScrollView>

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
                disabled={!isPaymentComplete || isSubmitting}
                onPress={handleConfirmCheckout}
                style={[
                  styles.confirmCheckoutBtn,
                  (!isPaymentComplete || isSubmitting) && styles.confirmCheckoutBtnDisabled,
                ]}
                accessibilityRole="button"
                accessibilityState={{ disabled: !isPaymentComplete || isSubmitting }}
              >
                <Text style={styles.confirmCheckoutBtnText}>
                  {isSubmitting
                    ? "PROCESANDO COBRO..."
                    : isPaymentComplete
                      ? "CONFIRMAR COBRO"
                      : "PAGO INCOMPLETO"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal Táctil de Actualización de Tasa */}
      <Modal visible={isRateModalOpen} transparent animationType="fade" onRequestClose={() => setIsRateModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Actualizar Tasa BCV / Moneda</Text>
            <Text style={styles.modalNotice}>
              Al modificar la tasa, todos los precios mostrados en Bolívares (VES) se
              recalcularán reactivamente al instante sin alterar los precios base en USD.
            </Text>

            {rateError ? <Text style={styles.errorText}>{rateError}</Text> : null}

            <View style={styles.modalInputGroup}>
              <Text style={styles.inputLabel}>
                Nueva Tasa a VES (actual: {formatVes(exchangeRate)}):
              </Text>
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

      {/* Modal Comprobante / Recibo Digital de Venta */}
      <Modal visible={!!selectedReceipt} transparent animationType="fade" onRequestClose={() => setSelectedReceipt(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, styles.receiptCard]}>
            {selectedReceipt ? (
              <ScrollView style={styles.receiptScroll} contentContainerStyle={styles.receiptContent}>
                {/* Cabecera del Recibo Térmico */}
                <View style={styles.receiptHeader}>
                  <Text style={styles.receiptBrand}>BISYNC POS</Text>
                  <Text style={styles.receiptSubBrand}>P2P Local-First • Comprobante de Venta</Text>
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
                    {selectedReceipt.status === "VOID" ? "⚠️ VENTA ANULADA (DEVOLUCIÓN)" : "✅ VENTA COBRADA VÁLIDA"}
                  </Text>
                  {selectedReceipt.status === "VOID" && selectedReceipt.voidReason ? (
                    <Text style={styles.receiptVoidReason}>Motivo: {selectedReceipt.voidReason}</Text>
                  ) : null}
                </View>

                <View style={styles.receiptDivider} />

                {/* Detalle de Productos */}
                <View style={styles.receiptItemsTable}>
                  <View style={styles.receiptTableHeader}>
                    <Text style={[styles.receiptTh, { flex: 3 }]}>Producto (ID)</Text>
                    <Text style={[styles.receiptTh, { flex: 1, textAlign: "center" }]}>Cant.</Text>
                    <Text style={[styles.receiptTh, { flex: 2, textAlign: "right" }]}>Precio</Text>
                    <Text style={[styles.receiptTh, { flex: 2, textAlign: "right" }]}>Total</Text>
                  </View>
                  {selectedReceipt.items.map((it) => (
                    <View key={it.id} style={styles.receiptItemRow}>
                      <Text style={[styles.receiptItemName, { flex: 3 }]} numberOfLines={1}>
                        {it.productId}
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
                    <Text style={styles.receiptTotalLabel}>Subtotal Base:</Text>
                    <Text style={[styles.receiptTotalVal, typography.tabularNumeric]}>
                      {formatUsd(selectedReceipt.subtotalUsd)} ({formatVes(selectedReceipt.subtotalVes)})
                    </Text>
                  </View>
                  <View style={styles.receiptTotalRow}>
                    <Text style={styles.receiptTotalLabel}>IVA Estimado:</Text>
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
                      Método de pago: {selectedReceipt.paymentMethod}
                    </Text>
                  </View>
                </View>

                {/* Acciones: Anular Venta o Cerrar Recibo */}
                <View style={styles.receiptActions}>
                  {selectedReceipt.status !== "VOID" ? (
                    <TouchableOpacity
                      activeOpacity={0.8}
                      onPress={() => {
                        setVoidReasonInput("");
                        setVoidError(null);
                        setIsVoidConfirmOpen(true);
                      }}
                      style={styles.receiptVoidBtn}
                      testID="btn-open-void-modal"
                    >
                      <Text style={styles.receiptVoidBtnText}>🔴 ANULAR VENTA (DEVOLUCIÓN)</Text>
                    </TouchableOpacity>
                  ) : null}

                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => setSelectedReceipt(null)}
                    style={styles.receiptCloseBtn}
                  >
                    <Text style={styles.receiptCloseBtnText}>Cerrar Comprobante</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
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
              Al anular esta factura, se generará inmediatamente un movimiento de inventario conmutativo
              tipo RETURN para reintegrar el stock vendido y se excluirá de la recaudación del turno.
            </Text>

            {voidError ? <Text style={styles.errorText}>{voidError}</Text> : null}

            <View style={styles.modalInputGroup}>
              <Text style={styles.inputLabel}>Motivo de Anulación Obligatorio</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="Ej. Devolución de cliente / Error en método de pago"
                placeholderTextColor={colors.dark.textMuted}
                value={voidReasonInput}
                onChangeText={setVoidReasonInput}
              />
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => setIsVoidConfirmOpen(false)}
                style={styles.cancelBtn}
              >
                <Text style={styles.cancelBtnText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={handleConfirmVoid}
                style={styles.deleteConfirmBtn}
                testID="btn-confirm-void"
              >
                <Text style={styles.deleteConfirmBtnText}>SÍ, ANULAR Y RESTITUIR STOCK</Text>
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
    flexDirection: "column",
    backgroundColor: colors.dark.surfaceBase,
  },
  columnsRow: {
    flex: 1,
    flexDirection: "row",
  },
  noShiftBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#2E1A08",
    borderBottomWidth: 1,
    borderBottomColor: colors.dark.warning,
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
    color: colors.dark.warning,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
  },
  noShiftBannerSubtitle: {
    color: colors.dark.textSecondary,
    fontSize: typography.sizes.caption,
  },
  noShiftBannerButton: {
    backgroundColor: colors.dark.warning,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: spacing.radiusMd,
    minHeight: 38,
    justifyContent: "center",
    alignItems: "center",
  },
  noShiftBannerButtonText: {
    color: "#061426",
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
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
    fontSize: 12,
    fontWeight: typography.weights.bold,
    color: colors.dark.hero,
  },
  stockBadgeLow: {
    backgroundColor: "rgba(245, 158, 11, 0.15)",
  },
  stockBadgeTextLow: {
    fontSize: 12,
    fontWeight: typography.weights.bold,
    color: colors.dark.warning,
  },
  stockBadgeOut: {
    backgroundColor: "rgba(239, 68, 68, 0.15)",
  },
  stockBadgeTextOut: {
    fontSize: 12,
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
  emptyCatalogAction: {
    minHeight: spacing.touchTargetMin,
    minWidth: 160,
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.dark.primary,
    borderRadius: spacing.radiusMd,
  },
  emptyCatalogActionText: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    color: colors.dark.textPrimary,
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
    fontSize: 12,
    fontWeight: typography.weights.bold,
    color: colors.dark.primaryGlow,
  },
  taxBadgeExempt: {
    backgroundColor: "rgba(148, 163, 184, 0.15)",
  },
  taxBadgeTextExempt: {
    fontSize: 12,
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
    fontSize: 12,
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
  confirmCheckoutBtnDisabled: {
    backgroundColor: colors.dark.surfaceContainerHigh,
    opacity: 0.6,
  },
  tenderSection: {
    backgroundColor: colors.dark.surfaceContainer,
    borderRadius: spacing.radiusLg,
    padding: spacing.md,
  },
  tenderSectionTitle: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: colors.dark.textSecondary,
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
    backgroundColor: colors.dark.surfaceContainerHigh,
    borderRadius: spacing.radiusMd,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  tenderFieldBoxActive: {
    borderColor: colors.dark.primaryGlow,
    backgroundColor: colors.dark.surfaceContainerHighest,
  },
  tenderFieldLabel: {
    fontSize: 12,
    color: colors.dark.textSecondary,
    fontWeight: typography.weights.semibold,
  },
  tenderFieldValue: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    color: colors.dark.textPrimary,
    marginTop: 2,
  },
  exactRemainingBtn: {
    backgroundColor: "rgba(29, 97, 224, 0.2)",
    borderWidth: 1,
    borderColor: colors.dark.primaryGlow,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    borderRadius: spacing.radiusMd,
    alignItems: "center",
  },
  exactRemainingBtnText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: colors.dark.primaryGlow,
  },
  paymentNumpadContainer: {
    alignItems: "center",
  },
  balanceSummaryBox: {
    backgroundColor: colors.dark.surfaceContainerLow,
    borderRadius: spacing.radiusMd,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  balanceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  balanceWarnLabel: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: colors.dark.warning,
    flex: 1,
  },
  balanceAmountsCol: {
    alignItems: "flex-end",
  },
  balanceWarnUsd: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    color: colors.dark.warning,
  },
  balanceWarnVes: {
    fontSize: typography.sizes.caption,
    color: colors.dark.warning,
  },
  balanceSuccessLabel: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: colors.dark.hero,
    flex: 1,
  },
  changeLabel: {
    fontSize: 12,
    color: colors.dark.textSecondary,
  },
  changeUsd: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    color: colors.dark.hero,
  },
  changeVes: {
    fontSize: typography.sizes.caption,
    color: colors.dark.hero,
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
  rightTabRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: colors.dark.border,
    backgroundColor: colors.dark.surfaceContainer,
  },
  rightTabBtn: {
    flex: 1,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  rightTabBtnActive: {
    borderBottomColor: colors.dark.primary,
    backgroundColor: colors.dark.surfaceContainerLow,
  },
  rightTabText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.semibold,
    color: colors.dark.textSecondary,
  },
  rightTabTextActive: {
    color: colors.dark.textPrimary,
    fontWeight: typography.weights.bold,
  },
  historyTabContainer: {
    flex: 1,
    backgroundColor: colors.dark.surfaceContainerLow,
  },
  shiftInvoicesList: {
    padding: spacing.md,
  },
  invoiceCard: {
    backgroundColor: colors.dark.surfaceContainer,
    borderRadius: spacing.radiusMd,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  invoiceCardVoid: {
    opacity: 0.65,
    borderColor: "rgba(239, 68, 68, 0.4)",
    backgroundColor: "rgba(239, 68, 68, 0.05)",
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
    color: colors.dark.textPrimary,
  },
  invoiceTimeText: {
    fontSize: typography.sizes.caption,
    color: colors.dark.textSecondary,
  },
  invoiceStatusBadge: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: spacing.radiusSm,
  },
  badgeVoid: {
    backgroundColor: "rgba(239, 68, 68, 0.2)",
  },
  badgeCompleted: {
    backgroundColor: "rgba(0, 176, 116, 0.2)",
  },
  invoiceStatusBadgeText: {
    fontSize: 12,
    fontWeight: typography.weights.bold,
    color: colors.dark.textPrimary,
  },
  invoiceCardMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  invoiceMethodText: {
    fontSize: typography.sizes.caption,
    color: colors.dark.textSecondary,
  },
  invoiceAmounts: {
    alignItems: "flex-end",
  },
  invoiceTotalUsd: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    color: colors.dark.hero,
  },
  invoiceTotalVes: {
    fontSize: typography.sizes.caption,
    color: colors.dark.textSecondary,
  },
  textLineThrough: {
    textDecorationLine: "line-through",
    color: colors.dark.textMuted,
  },
  emptyHistoryBox: {
    paddingVertical: 60,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyHistoryText: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    color: colors.dark.textSecondary,
  },
  emptyHistorySub: {
    fontSize: typography.sizes.caption,
    color: colors.dark.textMuted,
    marginTop: 4,
    textAlign: "center",
    paddingHorizontal: spacing.lg,
  },
  receiptCard: {
    maxWidth: 580,
    maxHeight: "92%",
    padding: 0,
    backgroundColor: colors.dark.surfaceContainerLow,
    overflow: "hidden",
  },
  checkoutCard: {
    width: "100%",
    maxWidth: 920,
    maxHeight: "92%",
    padding: spacing.lg,
  },
  checkoutHeader: {
    marginBottom: spacing.md,
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
  },
  checkoutColumnsStacked: {
    flexDirection: "column",
  },
  checkoutLeft: {
    flex: 1,
    gap: spacing.md,
  },
  checkoutRight: {
    width: 320,
    gap: spacing.sm,
  },
  checkoutRightStacked: {
    width: "100%",
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
    color: colors.dark.textPrimary,
    letterSpacing: 2,
  },
  receiptSubBrand: {
    fontSize: typography.sizes.caption,
    color: colors.dark.textSecondary,
    marginBottom: 4,
  },
  receiptTerminal: {
    fontSize: typography.sizes.caption,
    color: colors.dark.textMuted,
  },
  receiptInvoiceNum: {
    fontSize: typography.sizes.titleMd,
    fontWeight: typography.weights.bold,
    color: colors.dark.primary,
    marginTop: 4,
  },
  receiptDate: {
    fontSize: typography.sizes.caption,
    color: colors.dark.textSecondary,
  },
  receiptStatusBadge: {
    padding: spacing.xs,
    borderRadius: spacing.radiusMd,
    alignItems: "center",
    marginVertical: spacing.xs,
  },
  receiptBadgeOk: {
    backgroundColor: "rgba(0, 176, 116, 0.15)",
  },
  receiptBadgeVoid: {
    backgroundColor: "rgba(239, 68, 68, 0.2)",
  },
  receiptStatusText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: colors.dark.textPrimary,
  },
  receiptVoidReason: {
    fontSize: typography.sizes.caption,
    color: colors.dark.error,
    marginTop: 2,
  },
  receiptDivider: {
    height: 1,
    backgroundColor: colors.dark.border,
    marginVertical: spacing.md,
  },
  receiptItemsTable: {
    gap: 4,
  },
  receiptTableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: colors.dark.border,
    paddingBottom: 4,
  },
  receiptTh: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: colors.dark.textSecondary,
  },
  receiptItemRow: {
    flexDirection: "row",
    paddingVertical: 3,
  },
  receiptItemName: {
    fontSize: typography.sizes.caption,
    color: colors.dark.textPrimary,
  },
  receiptItemQty: {
    fontSize: typography.sizes.caption,
    color: colors.dark.textSecondary,
  },
  receiptItemPrice: {
    fontSize: typography.sizes.caption,
    color: colors.dark.textSecondary,
  },
  receiptItemTotal: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: colors.dark.textPrimary,
  },
  receiptTotalsBox: {
    backgroundColor: colors.dark.surfaceContainer,
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
    borderTopColor: colors.dark.border,
    paddingTop: 6,
    marginTop: 4,
  },
  receiptTotalLabel: {
    fontSize: typography.sizes.caption,
    color: colors.dark.textSecondary,
  },
  receiptTotalVal: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.semibold,
    color: colors.dark.textPrimary,
  },
  receiptGrandTotalLabel: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.extraBold,
    color: colors.dark.textPrimary,
  },
  receiptGrandTotalValues: {
    alignItems: "flex-end",
  },
  receiptGrandTotalUsd: {
    fontSize: typography.sizes.titleMd,
    fontWeight: typography.weights.extraBold,
    color: colors.dark.hero,
  },
  receiptGrandTotalVes: {
    fontSize: typography.sizes.caption,
    color: colors.dark.textSecondary,
  },
  receiptRateNotice: {
    marginTop: spacing.xs,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: colors.dark.border,
  },
  receiptRateNoticeText: {
    fontSize: typography.sizes.caption,
    color: colors.dark.textMuted,
  },
  receiptActions: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  receiptVoidBtn: {
    height: spacing.touchTargetMin,
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    borderWidth: 1,
    borderColor: colors.dark.error,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
  },
  receiptVoidBtnText: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    color: colors.dark.error,
  },
  receiptCloseBtn: {
    height: spacing.touchTargetMin,
    backgroundColor: colors.dark.surfaceContainerHighest,
    borderRadius: spacing.radiusMd,
    justifyContent: "center",
    alignItems: "center",
  },
  receiptCloseBtnText: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.semibold,
    color: colors.dark.textPrimary,
  },
});
