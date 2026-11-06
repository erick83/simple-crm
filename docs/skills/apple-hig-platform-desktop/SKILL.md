---
name: apple-hig-platform-desktop
description: "Adapt desktop interfaces to windows, keyboard, pointer, and host operating-system conventions."
---

# apple-hig-platform-desktop

## Rules

- Identify macOS, Windows, or Linux; do not impose one system's conventions on another.
- Test resizable windows, including narrow arrangements.
- Consider focus, keyboard workflows, selection, and contextual menus.
- Use panels and denser layouts only when they improve tasks and remain legible.
- Respect host window decoration, menus, shortcuts, and integrations.
- Do not mechanically replace Command with Control without checking conflicts.
- In containers, distinguish rendered interface behavior from native integration.
- In browsers, do not assume control over system menus or application windows.

## Starting sources

https://developer.apple.com/design/human-interface-guidelines/designing-for-macos
https://developer.apple.com/design/human-interface-guidelines/windows

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