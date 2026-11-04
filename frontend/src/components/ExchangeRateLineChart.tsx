import React, { useState } from "react";
import {
  LayoutChangeEvent,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { spacing } from "../theme/spacing";
import { typography } from "../theme/typography";
import { useTheme, useThemedStyles } from "../theme/ThemeContext";
import type { Palette } from "../theme/tokens";
import { formatVes } from "../utils/decimal";
import type { ExchangeRateHistoryItem } from "../database/repositories/exchange.repository";

export interface ExchangeRateLineChartProps {
  rates: ExchangeRateHistoryItem[];
  height?: number;
  onSelectRate?: (rate: ExchangeRateHistoryItem) => void;
}

function formatShortDate(dateStr: string): string {
  const parts = dateStr.split("-");
  if (parts.length === 3) {
    const [, month, day] = parts;
    return `${day}/${month}`;
  }
  return dateStr;
}

export const ExchangeRateLineChart: React.FC<ExchangeRateLineChartProps> = ({
  rates,
  height = 280,
  onSelectRate,
}) => {
  const { colors: theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [containerWidth, setContainerWidth] = useState<number>(700);

  // Ordenar cronológicamente (antiguo -> reciente, izquierda -> derecha)
  const chronologicalRates = React.useMemo(() => {
    return [...rates].sort((a, b) => a.rateDate.localeCompare(b.rateDate));
  }, [rates]);

  // Selección activa (por defecto el último día / más reciente)
  const [selectedIndex, setSelectedIndex] = useState<number>(() => {
    return chronologicalRates.length > 0 ? chronologicalRates.length - 1 : -1;
  });

  // Sincronizar selección si cambian los datos
  React.useEffect(() => {
    if (chronologicalRates.length > 0) {
      setSelectedIndex(chronologicalRates.length - 1);
    } else {
      setSelectedIndex(-1);
    }
  }, [chronologicalRates]);

  const handleLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && Math.abs(w - containerWidth) > 5) {
      setContainerWidth(w);
    }
  };

  if (chronologicalRates.length === 0) {
    return (
      <View style={[styles.emptyContainer, { height }]}>
        <Text style={styles.emptyText}>
          No hay suficientes registros cambiarios para trazar el gráfico.
        </Text>
      </View>
    );
  }

  // Dimensiones del área de trazado
  const paddingLeft = 90;
  const paddingRight = 32;
  const paddingTop = 32;
  const paddingBottom = 48;
  const plotWidth = Math.max(containerWidth - paddingLeft - paddingRight, 100);
  const plotHeight = Math.max(height - paddingTop - paddingBottom, 100);

  // Valores numéricos para cálculo de escala
  const values = chronologicalRates.map((r) => parseFloat(r.rateToVes));
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);

  // Margen de escala vertical dinámico
  const diff = rawMax - rawMin;
  const margin = diff === 0 ? (rawMax === 0 ? 1 : rawMax * 0.05) : diff * 0.15;
  const minY = Math.max(0, rawMin - margin);
  const maxY = rawMax + margin;
  const rangeY = maxY - minY || 1;

  // Coordenadas (x, y) de cada punto
  const count = chronologicalRates.length;
  const points = chronologicalRates.map((item, i) => {
    const val = parseFloat(item.rateToVes);
    const x =
      count === 1
        ? paddingLeft + plotWidth / 2
        : paddingLeft + (i / (count - 1)) * plotWidth;
    const y = paddingTop + (1 - (val - minY) / rangeY) * plotHeight;
    return { x, y, item, i };
  });

  // Líneas de guía horizontales (Mínimo, Medio, Máximo)
  const midYValue = (minY + maxY) / 2;
  const gridLines = [
    { label: maxY.toFixed(4), y: paddingTop },
    { label: midYValue.toFixed(4), y: paddingTop + plotHeight / 2 },
    { label: minY.toFixed(4), y: paddingTop + plotHeight },
  ];

  // Selección actual
  const activePoint = selectedIndex >= 0 && selectedIndex < points.length
    ? points[selectedIndex]
    : null;

  // Filtrado de etiquetas X para evitar solapamientos
  const maxLabels = Math.min(count, Math.max(2, Math.floor(plotWidth / 70)));
  const step = Math.ceil(count / maxLabels);

  return (
    <View style={styles.wrapper} onLayout={handleLayout}>
      {/* Panel de Inspección Táctil (Día Seleccionado) */}
      {activePoint ? (
        <View style={styles.inspectCard}>
          <View style={styles.inspectHeader}>
            <View>
              <Text style={styles.inspectDateLabel}>Punto Seleccionado</Text>
              <Text style={[styles.inspectDate, typography.tabularNumeric]}>
                📅 {activePoint.item.rateDate}
              </Text>
            </View>

            <View style={styles.inspectRateBlock}>
              <Text style={[styles.inspectRate, typography.tabularNumeric]}>
                {formatVes(activePoint.item.rateToVes)}
              </Text>
              {activePoint.item.deltaPreviousDay ? (
                <Text
                  style={[
                    styles.inspectDelta,
                    activePoint.item.deltaPreviousDay.startsWith("+")
                      ? styles.deltaWarn
                      : styles.deltaGood,
                    typography.tabularNumeric,
                  ]}
                >
                  {activePoint.item.deltaPreviousDay} ({activePoint.item.percentPreviousDay})
                </Text>
              ) : (
                <Text style={styles.inspectDeltaBase}>— Base del período</Text>
              )}
            </View>

            <View
              style={[
                styles.sourceTag,
                activePoint.item.source === "BCV_AUTO"
                  ? styles.sourceTagBcv
                  : styles.sourceTagManual,
              ]}
            >
              <Text
                style={[
                  styles.sourceTagText,
                  activePoint.item.source === "BCV_AUTO"
                    ? styles.sourceTextBcv
                    : styles.sourceTextManual,
                ]}
              >
                {activePoint.item.source === "BCV_AUTO" ? "🏛️ BCV Oficial" : "✍️ Manual"}
              </Text>
            </View>
          </View>

          {activePoint.item.notes ? (
            <Text style={styles.inspectNotes} numberOfLines={1}>
              Motivo: {activePoint.item.notes}
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* Contenedor del Gráfico */}
      <View style={[styles.chartContainer, { height }]}>
        {/* Líneas de Guía Horizontales (Eje Y) */}
        {gridLines.map((gl, idx) => (
          <View key={`grid-${idx}`} style={[styles.gridRow, { top: gl.y }]}>
            <Text style={[styles.axisLabel, typography.tabularNumeric]}>
              Bs. {gl.label}
            </Text>
            <View style={styles.gridLine} />
          </View>
        ))}

        {/* Línea Guía Vertical del Punto Seleccionado */}
        {activePoint ? (
          <View
            style={[
              styles.activeGuideLine,
              {
                left: activePoint.x,
                top: paddingTop,
                height: plotHeight,
              },
            ]}
          />
        ) : null}

        {/* Segmentos de Línea Conectora */}
        {points.map((p, idx) => {
          if (idx === points.length - 1) return null;
          const next = points[idx + 1]!;
          const dx = next.x - p.x;
          const dy = next.y - p.y;
          const length = Math.sqrt(dx * dx + dy * dy);
          const angle = Math.atan2(dy, dx) * (180 / Math.PI);
          const midX = (p.x + next.x) / 2;
          const midY = (p.y + next.y) / 2;

          return (
            <View
              key={`segment-${idx}`}
              pointerEvents="none"
              style={[
                styles.lineSegment,
                {
                  left: midX - length / 2,
                  top: midY - 1.5,
                  width: length,
                  transform: [{ rotate: `${angle}deg` }],
                },
              ]}
            />
          );
        })}

        {/* Nodos Táctiles de Datos */}
        {points.map((p) => {
          const isSelected = p.i === selectedIndex;
          const isManual = p.item.source === "MANUAL";

          return (
            <TouchableOpacity
              key={`dot-${p.item.rateDate}`}
              activeOpacity={0.8}
              onPress={() => {
                setSelectedIndex(p.i);
                onSelectRate?.(p.item);
              }}
              style={[
                styles.touchTarget,
                {
                  left: p.x - 24,
                  top: p.y - 24,
                },
              ]}
            >
              {isSelected ? <View style={styles.dotGlowRing} /> : null}
              <View
                style={[
                  styles.dot,
                  isManual ? styles.dotManual : styles.dotBcv,
                  isSelected && styles.dotSelected,
                ]}
              />
            </TouchableOpacity>
          );
        })}

        {/* Etiquetas del Eje X (Fechas) */}
        {points.map((p, idx) => {
          const isEdge = idx === 0 || idx === count - 1;
          const isStep = idx % step === 0;
          if (!isEdge && !isStep) return null;

          return (
            <View
              key={`xlabel-${p.item.rateDate}`}
              style={[
                styles.xAxisLabelBox,
                {
                  left: p.x - 30,
                  top: paddingTop + plotHeight + 10,
                },
              ]}
            >
              <Text
                style={[
                  styles.xAxisLabel,
                  p.i === selectedIndex && styles.xAxisLabelActive,
                  typography.tabularNumeric,
                ]}
              >
                {formatShortDate(p.item.rateDate)}
              </Text>
            </View>
          );
        })}
      </View>

      {/* Leyenda de Referencia */}
      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, styles.dotBcv]} />
          <Text style={styles.legendText}>🏛️ Tasa Oficial BCV Automática</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, styles.dotManual]} />
          <Text style={styles.legendText}>✍️ Captura Manual Auditada</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={styles.legendLine} />
          <Text style={styles.legendText}>Curva de Variación Diaria</Text>
        </View>
      </View>
    </View>
  );
};

const makeStyles = (c: Palette) =>
  StyleSheet.create({
  wrapper: {
    backgroundColor: c.surfaceContainerLow,
    borderRadius: spacing.radiusLg,
    borderWidth: 1,
    borderColor: c.border,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  inspectCard: {
    backgroundColor: c.primarySoft,
    borderWidth: 1,
    borderColor: c.primary,
    borderRadius: spacing.radiusMd,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  inspectHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  inspectDateLabel: {
    fontSize: typography.sizes.caption,
    color: c.textSecondary,
    marginBottom: 2,
  },
  inspectDate: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    color: c.textPrimary,
  },
  inspectRateBlock: {
    alignItems: "center",
  },
  inspectRate: {
    fontSize: typography.sizes.titleMd,
    fontWeight: typography.weights.bold,
    color: c.primaryGlow,
  },
  inspectDelta: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    marginTop: 2,
  },
  inspectDeltaBase: {
    fontSize: typography.sizes.caption,
    color: c.textMuted,
    marginTop: 2,
  },
  deltaWarn: {
    color: c.warningText,
  },
  deltaGood: {
    color: c.heroText,
  },
  sourceTag: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: spacing.radiusSm,
  },
  sourceTagBcv: {
    backgroundColor: c.heroSoft,
    borderWidth: 1,
    borderColor: c.hero,
  },
  sourceTagManual: {
    backgroundColor: c.warningSoft,
    borderWidth: 1,
    borderColor: c.warning,
  },
  sourceTagText: {
    fontSize: 12,
    fontWeight: typography.weights.bold,
  },
  sourceTextBcv: {
    color: c.heroText,
  },
  sourceTextManual: {
    color: c.warningText,
  },
  inspectNotes: {
    fontSize: typography.sizes.caption,
    color: c.textSecondary,
    marginTop: spacing.xs,
    fontStyle: "italic",
  },
  chartContainer: {
    position: "relative",
    width: "100%",
    overflow: "hidden",
  },
  gridRow: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
  },
  axisLabel: {
    width: 82,
    fontSize: 10,
    color: c.textMuted,
    textAlign: "right",
    paddingRight: 8,
  },
  gridLine: {
    flex: 1,
    height: 1,
    backgroundColor: c.border,
  },
  activeGuideLine: {
    position: "absolute",
    width: 1,
    backgroundColor: c.primarySoft,
    borderStyle: "dashed",
  },
  lineSegment: {
    position: "absolute",
    height: 3,
    backgroundColor: c.primary,
    borderRadius: 1.5,
  },
  touchTarget: {
    position: "absolute",
    width: 48,
    height: 48,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 10,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: c.surfaceBase,
  },
  dotBcv: {
    backgroundColor: c.hero, // #00B074
  },
  dotManual: {
    backgroundColor: c.warning,
  },
  dotSelected: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2.5,
    borderColor: c.surfaceContainerLow,
  },
  dotGlowRing: {
    position: "absolute",
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: c.primarySoft,
  },
  xAxisLabelBox: {
    position: "absolute",
    width: 60,
    alignItems: "center",
  },
  xAxisLabel: {
    fontSize: 10,
    color: c.textMuted,
  },
  xAxisLabelActive: {
    color: c.textPrimary,
    fontWeight: typography.weights.bold,
  },
  legendRow: {
    flexDirection: "row",
    gap: spacing.lg,
    justifyContent: "center",
    alignItems: "center",
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: c.border,
    flexWrap: "wrap",
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendLine: {
    width: 16,
    height: 3,
    backgroundColor: c.primary,
    borderRadius: 1.5,
  },
  legendText: {
    fontSize: typography.sizes.caption,
    color: c.textSecondary,
  },
  emptyContainer: {
    backgroundColor: c.surfaceContainerLow,
    borderRadius: spacing.radiusLg,
    borderWidth: 1,
    borderColor: c.border,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.xl,
    marginBottom: spacing.lg,
  },
  emptyText: {
    color: c.textMuted,
    fontSize: typography.sizes.body,
  },
});
