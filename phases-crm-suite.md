# Phases — CRM Suite Backend Wiring

Cluster B of the 12-module backend-wiring effort. Wires the 3 remaining stub CRM
screens (Templates, Settings, Sequences) onto the real leads/messaging stack.
**One phase per context**, committed individually; clear context between phases.
Spec: `docs/superpowers/specs/2026-06-09-crm-suite-design.md`. Context + integration
detail: `BUILD-CRM-SUITE.md`.

Branch: `feat/crm-cluster`. Resume after `/clear`: read this file + `BUILD-CRM-SUITE.md`
+ the spec, then build the next ⬜ phase.

| Phase | Module | Migration | New integration | Status | Commit |
|---|---|---|---|---|---|
| B1 | Templates | 000062 | none | ✅ done | 186239e |
| B2 | Settings (config + aggregator) | 000063 | none | ⬜ | — |
| B3 | Sequences (full live drip engine) | 000064 | Twilio inbound webhook (STOP) | ⬜ | — |

> Suite migration numbers shifted +1: wealth_inputs claimed 000061 mid-flight, so B1=000062, B2=000063, B3=000064.

Out of scope: Landing Pages (dropped), Workflows/Automations (already built).

## Per-phase done-criteria
Backend: formula (+ test + FORMULAS.md if new calc) → repo → service → controller →
route (gated) → API.md. Frontend: api → hook → screen → page → nav + route-perm.
Verify: backend `npm test` green + frontend `tsc --noEmit` clean. Migration applied on
hosted + `NOTIFY pgrst, 'reload schema';`. Then commit + tick this table.

## Decisions
- Sequences = **full live engine** (real sends). Safety: `is_active` default-false,
  marketing-consent gate, opt-out/STOP suppression, quiet-hours defer, per-org sender.
- Landing Pages dropped from CRM Suite scope.
- Sender identity already solved by `lib/messaging.js` (per-org, platform fallback).

## Log
- 2026-06-09 — Spec approved, trackers created. Order B1 → B2 → B3. Next: B1 (Templates).
- 2026-06-09 — B1 (Templates) built + verified (backend tests green, tsc/lint clean).
  Migration 000062 (renumbered from 000061 to dodge wealth_inputs) applied on hosted +
  schema reloaded; crm_templates verified (10 cols, trigger, partial index). Next: B2 (Settings).
