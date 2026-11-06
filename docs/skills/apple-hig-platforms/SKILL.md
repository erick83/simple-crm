---
name: apple-hig-platforms
description: "Coordinate web, desktop, tablet, and mobile differences independently of framework."
---

# apple-hig-platforms

## Classify the environment

Record surface (browser, PWA, native app, or container), operating system,
available space, and inputs. Web and device categories overlap: a browser on
a tablet combines web and tablet profiles.

## Load complementary profiles

Read apple-hig-platform-web, desktop, tablet, or mobile as appropriate.
Also load relevant thematic skills.

## Required decision matrix

For each change, describe shared behavior and differences across web, desktop,
tablet, and mobile. Cover navigation, layout, input, typography, overlays,
safe areas, and integration. Mark unknown and inapplicable items explicitly.

## Resolve conflicts

Prioritize accessibility and task completion, then host/browser conventions,
then actual space and input capabilities, then shared visual identity.
Do not assign layouts solely by device model or invent universal breakpoints.

## Starting source

https://developer.apple.com/design/human-interface-guidelines/layout

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