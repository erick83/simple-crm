---
target: PosScreen (POS terminal)
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:C:\\Users\\Erick\\Code\\myprojects\\bisync\\simple-crm\\frontend\\src\\screens\\PosScreen.tsx"
target_fingerprint: "sha256:cd091f1832830e4e84388fce9cd9ea9ca800e258e77e3e733cccc43a7807070b"
target_path: "C:\\Users\\Erick\\Code\\myprojects\\bisync\\simple-crm\\frontend\\src\\screens\\PosScreen.tsx"
timestamp: 2026-11-03T01-50-59Z
slug: src-screens-posscreen-tsx
---
# Critique — src/screens/PosScreen.tsx (POS Terminal, Caja)

Method: design review only (detector not applicable, native platform)

Run notes: Target resolved by subagent to the primary surface (PosScreen.tsx) from the codebase; reviewed with App.tsx shell, ButtonHero/Numpad/TouchStepper components, theme tokens, and docs/skills/bisync-pos-design-guide.md. impeccable detect not run per native-platform rule (React Native source is not web markup); no browser automation available; inspection is source-based. Surface mode: Operate (1280x800 landscape cashier tablet).

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Live bimoneda totals, remaining/change banner, shift gate; header sync badge hardcoded ("online", "hace 1m") |
| 2 | Match System / Real World | 2 | Receipt line items print raw productId instead of names; "SPLIT" jargon leaks into cashier copy |
| 3 | User Control and Freedom | 2 | No onRequestClose on any Modal (Android back dead); no undo for line delete / vaciar ticket |
| 4 | Consistency and Standards | 3 | Consistent tokens, uniform modals, 4-decimal tabular figures; emoji icons render per-platform |
| 5 | Error Prevention | 3 | Shift gating, balance block, SPLIT exact rule, qty>0 validation, destructive confirms; rate modal fabricates default audit reason |
| 6 | Recognition Rather Than Recall | 3 | Labeled chips with counts, visible numpads, dual prices; icon-only buttons (cross, numpad, backspace) unlabeled |
| 7 | Flexibility and Efficiency | 2 | Only accelerator is HID scan; no denomination quick-cash, no shortcuts, no path back to last receipt |
| 8 | Aesthetic and Minimalist Design | 2 | Checkout modal stacks 7 zones and overflows 800px target; 9-10px micro-type below 12px guide floor |
| 9 | Error Recovery | 3 | Specific, actionable, bilingual-amount errors near the action, state preserved; void errors surface raw repo messages |
| 10 | Help and Documentation | 1 | No contextual help; only empty-state hints teach |
| **Total** | | **24/40** | **Acceptable — significant improvements needed** |

Cognitive load: 3 checklist failures (single focus, one-thing-at-a-time, minimal choices — all in checkout modal: 5 methods + up to 4 tender fields + numpad + summary at once). Moderate.

Emotional journey: high-stakes reassurance copy is excellent (frozen-rate/immutability notice); peak-end weak — success is a generic 1.2s flash, no invoice number, no receipt handoff.

## Design Specificity Verdict

LLM assessment: genuinely authored for this product — BCV rate pill with audit reason, Pago Movil tender, per-line IVA/Exento badges, frozen-rate receipts, SPLIT exact-amount enforcement tied to arqueo integrity, shift-gate banner with direct "Abrir Turno" action. Not category-interchangeable. Falls short of the guide's "Industrial / FinTech tactil" bar via the all-emoji icon system (placeholder craft, per-platform rendering) where the guide specifies real iconography and brand assets.

Deterministic scan: not applicable (native platform — detect reads web markup only).

Visual overlays: not available (native platform; no browser target). No user-visible overlay was created.

## Overall Impression

Domain-sharp POS with honest money copy and disciplined tokens, undermined at the most important moment: the checkout modal is overloaded and overflows the 1280x800 target, and the post-payment success beat is a shrug. Biggest opportunity: restructure checkout into a two-column "tender -> confirm -> receipt" flow.

## What's Working

1. Bimoneda discipline everywhere: catalog, ticket, summary, checkout, receipt all show USD + VES with tabular 4-decimal figures and the frozen rate.
2. Reassurance copy at high-stakes moments: immutability notice at confirm, RETURN stock-movement explanation at void, SPLIT exact-amount rule with its why.
3. Shift gating + teaching empty states: no-shift banner blocks orphan sales and routes to Turnos; empty ticket teaches HID scan vs catalog.

## Priority Issues

1. [P1] Checkout modal overflows 1280x800 target, no scroll. Non-scrolling maxWidth 560 card stacks title+notice (~60), 5-row summary (~140), 5 payment methods 2-per-row (~160), tender fields (~80), 5-row numpad of 64px keys (~350), balance banner (~60), 64px actions — ~950px+ against ~730px usable. CONFIRMAR COBRO pushed off-screen at the money moment. Fix: two-column modal (~880px: left summary+methods+balance, right numpad+confirm) or hide numpad until a cash method needs editing; add maxHeight 92% + ScrollView safety net like receiptCard. Command: /impeccable layout (+ /impeccable adapt).

2. [P1] Demo products sellable when real catalog is empty — ghost invoices. catalog defaults to DEFAULT_PRODUCTS and is only replaced when DB returns >0 products; fresh install with open shift shows fake products and createInvoice runs with nonexistent product IDs. Fix: when db exists, empty catalog = empty state ("Registre productos en Inventario"); keep DEFAULT_PRODUCTS for dev/test path only. Command: /impeccable harden.

3. [P1] Accessibility and touch-target violations of the project's own hard rules. deleteLineBtn 28x28 (AGENTS.md mandates >=48); searchClearBtn/numpadCloseBtn padding-only; taxBadgeText/stockBadgeText at 9-10px (guide floor 12px); ok vs low stock badges identical text, color-only distinction; icon-only buttons and nearly every TouchableOpacity lack accessibilityRole/Label; no Modal sets onRequestClose (Android back dead); textMuted #64748B on surfaceContainerLow #0E1C2F ~3.5:1 (under AA at 12px). Fix: 48px hit areas, >=12px micro-type, word/shape difference on low-stock badge, a11y labels, onRequestClose wired to cancel. Command: /impeccable audit (native), then /impeccable harden.

4. [P2] Post-sale peak-end: no receipt handoff, generic success flash. "Venta cobrada con exito!" for 1.2s, then cashier must switch to Ventas and hunt the invoice; receipt lists it.productId (raw UUID) instead of names. Fix: success message with invoice number + total, "Ver comprobante" action opening the receipt modal for the new invoice, store/join product names into invoice items. Command: /impeccable polish (+ /impeccable clarify for receipt content).

5. [P2] Fake telemetry in the shell erodes trust. App.tsx hardcodes "Sede Principal — Maracaibo" and pins SyncBadge to online/"hace 1m" while P2pSyncService.getPendingCount tracks real state; the guide's four-state sync chip (the states that matter most for local-first P2P) is faked. Fix: derive badge state/last-sync from P2pSyncService; pull sede from config/tenant or drop it. Command: /impeccable harden.

## Persona Red Flags

Alex (Impatient Power User): HID scan respected, then zero accelerators — no quick-denomination chips ($1/$5/$10/$20/Exacto) in checkout, so every cash sale = tap tender field + peck numpad; no keyboard shortcuts; reopening the just-made receipt requires tab-switch + list scan. The 60-second sale takes 2 minutes.

Sam (Accessibility-Dependent): 28px line-delete; unlabeled icon-only buttons; no accessibilityRole on interactives; stock status color-only; 9-10px badge text; ~3.5:1 muted contrast; Android back dead in modals; no visible focus treatment for keyboard access on Windows. Sam cannot complete a sale independently.

Riley (Deliberate Stress Tester): ghost-invoice path in minute one (empty DB -> demo products -> cobro); receipt prints UUIDs as product names; header claims "online, hace 1m" with no sync ever performed; Agotado product addable with only a 3s toast as record; rate modal accepts empty reason and auto-fabricates "Ajuste operativo en pantalla de caja", defeating the mandatory-audit-reason rule.

## Minor Observations

- Numpad.tsx lines 62-64: identical branches of the backspace ternary — dead condition; with showDecimal, "C" only exists in the wide BORRAR TODO row, breaking the guide's stated C/0/00/Enter grid.
- typography.tabularNumeric falls back to fontFamily "monospace"; Plus Jakarta Sans is never loaded (no expo-font) — guide's primary family is aspirational.
- Rate modal allowUpdate:true silently overwrites today's registered rate; surface the previous value on same-day change.
- Ventas tab shows count but no accumulated shift totals; a "Recaudado: $X / Bs. Y" header line would remove mental math.
- Zero-stock contingency sales leave no persistent marker on the ticket line (toast only).
- handleSelectPaymentMethod prefills exact tender for cash methods (change=0 default); flag "asuma exacto" visually so cashiers don't confirm unedited.

## Questions to Consider

- What if CONFIRMAR COBRO were visible and thumb-reachable from every checkout state without scrolling — what would you cut to earn it?
- The receipt is a legal document; accept one that lists groceries by database ID?
- What would the four-state sync chip look like telling the truth — and what does the cashier do when it turns amber?
- If success auto-opened the comprobante with Print/Close, how many taps would that remove per sale?

Questions skipped: subagent running a brief — no interactive user to answer; findings and recommended actions returned to the parent session.

## Recommended Actions (default priority order)

1. /impeccable layout — restructure the checkout modal for 1280x800: two-column split or conditional numpad, maxHeight+ScrollView safety net, CONFIRMAR COBRO always visible.
2. /impeccable harden — kill ghost demo products on empty DB, wire real sync telemetry, validate rate-change reason, add onRequestClose to all modals.
3. /impeccable audit (native) — touch targets >=48px, >=12px type floor, contrast, a11y roles/labels, color-only stock states.
4. /impeccable polish — post-sale receipt handoff, success message with invoice number/total, receipt product names, denomination quick-cash chips.
5. /impeccable clarify — cashier-facing copy: drop "SPLIT" jargon, label exact-tender assumption, receipt content pass.
