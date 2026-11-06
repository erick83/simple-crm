---
name: apple-hig-inputs
description: "Evaluate touch, keyboard, pointer, and additional inputs using actual capabilities."
---

# apple-hig-inputs

## Workflow

1. Identify supported input modes without inferring them solely from device type.
2. Define visible focus and understandable navigation order.
3. Verify keyboard activation and escape paths where applicable.
4. Avoid exclusive dependence on hover, gestures, or motion.
5. Respect host shortcuts and system gestures.
6. Provide alternatives to dragging where appropriate.
7. Test virtual keyboard effects on focused content.
8. Add stylus or specialized input only when useful, with suitable alternatives.

## Starting source

https://developer.apple.com/design/human-interface-guidelines/inputs

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