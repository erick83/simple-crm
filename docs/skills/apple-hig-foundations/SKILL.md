---
name: apple-hig-foundations
description: "Evaluate accessibility, layout, color, typography, materials, and iconography."
---

# apple-hig-foundations

## Workflow

1. Define semantic roles for surfaces, text, actions, borders, and spacing.
2. Use typographic roles; test enlarged text and long content.
3. Check contrast and alternatives to color-only information.
4. Preserve hierarchy and legibility across themes and reduced transparency.
5. Verify reading order, accessible names, and focus.
6. Adapt layout to available space, localization, and inputs.
7. Do not impose universal conversions between native points and CSS pixels.
8. Verify asset and font licenses before adoption.

## Starting sources

https://developer.apple.com/design/human-interface-guidelines/foundations
https://developer.apple.com/design/human-interface-guidelines/accessibility
https://developer.apple.com/design/human-interface-guidelines/layout
https://developer.apple.com/design/human-interface-guidelines/typography
https://developer.apple.com/design/human-interface-guidelines/color

## Shared contract

- These are original operational instructions inspired by Apple HIG topics,
  not official Apple documentation or a certification of compliance.
- Verify relevant official sources before attributing a requirement to Apple.
  Distinguish verified Apple guidance, cross-platform adaptation, and project
  decisions. Never invent citations, availability, or platform requirements.
- Respect intellectual property and licensing. Do not redistribute proprietary
  documentation, fonts, symbols, or assets without appropriate permission.
- Remain framework-agnostic. Describe intent, observable behavior, states,
  platform variants, and acceptance criteria before choosing implementation.
- Do not require a framework name for design or auditing. When implementing,
  inspect and preserve the existing stack and repository conventions.
- Do not introduce dependencies, replace architecture, or change frameworks
  without authorization.
- Share product language, domain behavior, and semantic token names. Allow
  platform-specific navigation, density, controls, units, and integrations.
- Framework-agnostic does not mean platform-agnostic.
- Prioritize accessibility, task completion, and host conventions over effects.
- Consider loading, empty, error, success, unavailable, and offline states
  where relevant.
- Never claim accessibility, native integration, or HIG compliance based only
  on a successful build.
- Follow the user's requested response language. English skill instructions
  do not require English user-facing responses.

## Composition

Explicitly load or read relevant sibling SKILL.md files. Do not assume that
mentioning a dependency automatically loads it. Read references on demand.

## Output

Report scope, decisions, platform differences, acceptance criteria, changes,
executed checks, untested scenarios, and verified sources.

## Extension

Add focused references under references/<topic>.md. Record scope, official
sources, review date, availability, fallback behavior, and acceptance checks.
Link the reference from this file. Create a sibling skill for an independent
capability. Avoid duplicating shared rules.