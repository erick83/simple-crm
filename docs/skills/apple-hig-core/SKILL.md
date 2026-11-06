---
name: apple-hig-core
description: "Coordinate Apple HIG-inspired design and audits through complementary, framework-agnostic skills."
---

# apple-hig-core

## Workflow

1. Identify users, primary tasks, target surfaces, operating systems, and constraints.
2. Inspect existing product conventions before proposing changes.
3. Load apple-hig-platforms for cross-platform work and apple-hig-foundations
   for interface changes.
4. Add getting-started, patterns, components, inputs, or technologies as needed.
5. Before adopting recent guidance, verify the official updates and feature
   documentation. Record availability, fallback, and affected modules.
6. Distinguish Apple-like appearance from native integration and HIG compliance.
7. Prefer scoped improvements over unnecessary visual rewrites.

## Starting sources

https://developer.apple.com/design/human-interface-guidelines/
https://developer.apple.com/design/whats-new/

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