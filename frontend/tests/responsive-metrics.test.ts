import { afterEach, describe, expect, it } from "vitest";
import {
  applyMetrics,
  computeMetrics,
  screenTierFor,
} from "../src/theme/metrics";
import { SPACING_BASE, spacing } from "../src/theme/spacing";
import { TYPE_SIZES_BASE, typography } from "../src/theme/typography";

const REF = () => computeMetrics(1280, 800);

describe("Tiers de dispositivo (condición 1)", () => {
  it("clasifica móvil, tablet y PC por ancho", () => {
    expect(screenTierFor(390)).toBe("movil");
    expect(screenTierFor(719)).toBe("movil");
    expect(screenTierFor(720)).toBe("tablet");
    expect(screenTierFor(1023)).toBe("tablet");
    expect(screenTierFor(1024)).toBe("pc");
    expect(screenTierFor(1920)).toBe("pc");
  });
});

describe("Métricas fluidas por viewport (condiciones 2-4)", () => {
  it("en el lienzo 1280×800 los tokens valen exactamente el contrato base", () => {
    const m = REF();
    expect(m.scale).toBe(1);
    expect(m.fontScale).toBe(1);
    expect(m.heroTouch).toBe(SPACING_BASE.touchTargetHero);
    expect(m.checkoutRight).toBe(360);
    applyMetrics(m);
    expect(spacing.md).toBe(SPACING_BASE.md);
    expect(typography.sizes.heroTotal).toBe(TYPE_SIZES_BASE.heroTotal);
  });

  it("PC de 1920×1080 no influye más allá del lienzo (pc en px/rem fijos)", () => {
    const m = computeMetrics(1920, 1080);
    expect(m.tier).toBe("pc");
    expect(m.scale).toBe(1);
    expect(m.fontScale).toBe(1);
    expect(m.heroTouch).toBe(64);
  });

  it("ventana PC pequeña se comprime según el lado más corto, no se corta", () => {
    const m = computeMetrics(1024, 600);
    expect(m.tier).toBe("pc");
    expect(m.scale).toBeLessThan(1);
    expect(m.heroTouch).toBe(48); // 64 cede antes de sacar el botón de pantalla
    expect(m.twoPaneCheckout).toBe(true); // 600 ≥ 560: caben teclado y confirmación
    applyMetrics(m);
    expect(spacing.md).toBeLessThan(SPACING_BASE.md);
    expect(typography.sizes.body).toBeGreaterThanOrEqual(13);
  });

  it("tablet landscape usa métricas dependientes del viewport", () => {
    const m = computeMetrics(800, 600);
    expect(m.tier).toBe("tablet");
    expect(m.scale).toBe(0.7); // el lado más corto (0.625) se topa con el piso 0.7
    expect(m.checkoutRight).toBe(224);
    applyMetrics(m);
    expect(spacing.sidebarWidth).toBeLessThanOrEqual(SPACING_BASE.sidebarWidth);
    expect(spacing.sidebarWidth).toBeGreaterThanOrEqual(48);
  });

  it("móvil vertical: sólo el ancho manda, el texto conserva piso de legibilidad", () => {
    const m = computeMetrics(360, 800);
    expect(m.tier).toBe("movil");
    expect(m.scale).toBeCloseTo(360 / 390, 2);
    expect(m.heroTouch).toBeGreaterThanOrEqual(60); // en portrait hay alto: teclas casi completas
    expect(m.twoPaneCheckout).toBe(false); // estética propia vertical, una columna
    applyMetrics(m);
    expect(typography.sizes.caption).toBeGreaterThanOrEqual(10);
    expect(typography.sizes.body).toBeGreaterThanOrEqual(14);
  });

  it("respeta los pisos táctiles legales en cualquier viewport", () => {
    for (const [w, h] of [[320, 480], [720, 400], [1024, 500], [2560, 1440]] as const) {
      applyMetrics(computeMetrics(w, h));
      expect(spacing.touchTargetMin).toBe(48);
      expect(spacing.touchTargetHero).toBeGreaterThanOrEqual(48);
      expect(spacing.touchTargetHero).toBeLessThanOrEqual(64);
    }
  });

  it("la cubeta (bucket) es estable ante píxeles de diferencia", () => {
    const a = computeMetrics(1280, 800);
    const b = computeMetrics(1284, 803);
    expect(b.bucket).toBe(a.bucket);
    const c = computeMetrics(1000, 800);
    expect(c.bucket).not.toBe(a.bucket);
  });
});

describe("applyMetrics no degrada los tokens", () => {
  afterEach(() => applyMetrics(REF()));

  it("mantiene espaciados y radios dentro de límites sanos", () => {
    for (const [w, h] of [[320, 567], [800, 600], [1280, 800], [1920, 1080]] as const) {
      applyMetrics(computeMetrics(w, h));
      for (const key of ["xs", "sm", "md", "lg", "xl", "xxl", "xxxl"] as const) {
        expect(spacing[key]).toBeGreaterThanOrEqual(2);
        expect(spacing[key]).toBeLessThanOrEqual(SPACING_BASE[key]);
      }
      expect(spacing.radiusFull).toBe(SPACING_BASE.radiusFull);
    }
  });
});
