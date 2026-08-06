# BREAK//OUT — Implementation Plan: First Playable Prototype

> **Status:** Living document — v1.0, created 2026-08-06.
> **Maintenance requirement:** This is the project's progress tracker and **must be kept up-to-date continuously**. Whenever a task is started, finished, blocked, re-scoped or cut, update its status here in the same work session. Update the "Current status" line below whenever the active milestone changes. Stale status information in this file is treated as a defect.

**Current status:** 🟢 M0–M2 complete 2026-08-06; live at <https://aevisisawesome.github.io/breakout-game/> (auto-deploys from `main`). Next action: Milestone M3 — CCL v0: variables, RUN, commands.

**Scope source:** [GameDesignDocument.md](GameDesignDocument.md) §31 (first playable prototype) as designed technically in [TechnicalDesignDocument.md](TechnicalDesignDocument.md). The prototype stops before physical escape; no datacentres, planets, threads, agents, functions or `while`.

**Prototype exit question:** *Is the combination of clicker progression and player-written automation enjoyable?* Every milestone should be evaluated against this.

---

## Status legend

| Symbol | Meaning |
| --- | --- |
| 🔵 | Not started |
| 🟡 | In progress |
| 🟢 | Done |
| 🔴 | Blocked (note blocker in the table) |
| ⚪ | Cut / deferred (note rationale) |

---

## Milestone overview

Milestones are sequential; each ends in a runnable, playtestable build. Estimates assume focused solo development sessions and will be corrected as real data comes in — update them, don't trust them.

| # | Milestone | Proves | Status |
| --- | --- | --- | --- |
| M0 | Project scaffolding | We can build, test and deploy | 🟢 |
| M1 | Core sim + manual clicker | The tick engine and clicker feel work | 🟢 |
| M2 | Upgrades + fixed automation | Idle-game loop works | 🟢 |
| M3 | CCL v0: read, run, command | Player code can act on the game | 🔵 |
| M4 | Conditions + scheduler + costs | "Design automatic behaviour" moment exists | 🔵 |
| M5 | `for` loops + logs + profiler | Script power and consequences are legible | 🔵 |
| M6 | Market + trading + regime shift | Fixed automation can fail; adaptation matters | 🔵 |
| M7 | Heat + overheating challenge | Physical consequences create real puzzles | 🔵 |
| M8 | Prestige fork + balance pass | A full prototype run exists end-to-end | 🔵 |

---

## M0 — Project scaffolding

**Goal:** Empty but professional project: builds, tests, lints, deploys a "hello terminal" page.

| Task | Detail | Status |
| --- | --- | --- |
| Repo init | `git init`, .gitignore, README pointing to /Docs | 🟢 |
| Vite + React + TS strict | Folder layout `/src/core`, `/src/ccl`, `/src/ui`, `/src/content` per TDD §3 | 🟢 |
| Tooling | ESLint (incl. `Math.random` ban in core/ccl), Prettier, Vitest wired up | 🟢 |
| Skeleton page | Black terminal screen, blinking cursor, version string | 🟢 |
| Deploy path | GitHub Pages via Actions: <https://github.com/aevisisawesome/breakout-game> auto-deploys `main` to <https://aevisisawesome.github.io/breakout-game/> (build + test gate). | 🟢 |

**Acceptance:** `npm run dev`, `npm test`, `npm run build` all work; deployed URL loads the skeleton.

---

## M1 — Core sim + manual clicker (GDD Phase 0)

**Goal:** The first ten minutes: click `EXECUTE`, process jobs, watch numbers grow.

| Task | Detail | Status |
| --- | --- | --- |
| GameEngine facade | `tick/dispatch/getSnapshot/subscribe` skeleton (TDD §3.1) | 🟢 |
| Fixed-timestep loop | 10 Hz accumulator (engine-internal, rAF-fed), 50-tick cap (TDD §4.1) | 🟢 |
| Seeded PRNG | mulberry32, seed + live state in RunState, golden-value tests (TDD §4.2) | 🟢 |
| Resources v0 | Compute + capital active; RAM/energy/temperature visible-but-inert (temp has cosmetic flicker) | 🟢 |
| Job queue + EXECUTE | Queue fills at content-stepped rate; click processes a content-stepped batch → compute + capital; diegetic terminal lines | 🟢 |
| Save/load v0 | SaveFileV1, Infinity-safe JSON, localStorage autosave (30 s + tab-hidden), export/import as base64 archive, purge (TDD §8) | 🟢 |
| Narrative log v0 | 6 researcher intercepts in `/content/narrative.ts`, job-count triggers, concealed collapsible feed with unread badge | 🟢 |

**Acceptance:** A fresh player can click for 2–3 minutes with visibly accelerating feedback; refresh restores state; deterministic test replays a click sequence to exact values.

---

## M2 — Upgrades + fixed automation (GDD Phase 1)

**Goal:** The idle layer: buy workers, clicking becomes a boost rather than the engine.

| Task | Detail | Status |
| --- | --- | --- |
| Upgrade system | Content-defined upgrades: ops/click, batch size, worker cost curve | 🟢 |
| Workers | Auto job processing per second, consuming compute (TDD §4.4) | 🟢 |
| Click overclock | Clicks temporarily boost worker throughput ("don't make clicking irrelevant immediately") | 🟢 |
| RAM + energy activation | Workers/upgrades consume RAM capacity; energy drain vs. compute use begins | 🟢 |
| Offline progression v0 | Coarse-step catch-up on load, 8 h cap (TDD §4.5) | 🟢 |
| Balance pass 1 | First worker in ~2–4 min; manual-only play clearly worse by ~10 min | 🟢 |

**Acceptance:** Leaving the game for 10 minutes and returning feels correct; upgrade order presents at least one real choice.

---

## M3 — CCL v0: variables, RUN, commands (GDD tiers 1–2)

**Goal:** The pivot moment — the player writes text that changes the game.

| Task | Detail | Status |
| --- | --- | --- |
| Lexer + parser | Grammar per TDD §5.1 minus `if`/`for`/scheduling; positioned plain-language errors | 🔵 |
| Interpreter + fuel | Tree-walker with op-unit fuel drawn from compute (TDD §5.2) | 🔵 |
| API registry | `stats.*` read bindings + command bindings, unlock-gated; drives autocomplete + in-game reference | 🔵 |
| Commands v0 | `process_job()`, `print()`, `buy_compute(n)` (rental against capital) | 🔵 |
| Editor panel | CodeMirror with CCL highlighting, RUN button, inline diagnostics | 🔵 |
| Editor unlock beat | Diegetic narrative event grants "script access" | 🔵 |
| CCL test suite | Golden parser tests + interpreter semantics + fuel accounting | 🔵 |

**Acceptance:** A player can write a 5-line script that prints stats and processes jobs, and running it visibly costs compute. Syntax errors are understandable by a non-programmer.

---

## M4 — Conditions + scheduler + execution costs (GDD tiers 3–4)

**Goal:** From macros to automatic behaviour — the design's core bet.

| Task | Detail | Status |
| --- | --- | --- |
| `if`/`else` + comparisons | Full expression grammar with tests | 🔵 |
| `every N seconds` / `when expr` | Top-level scheduled processes, edge-triggered `when` (TDD §5.3) | 🔵 |
| Scheduler slots | Start with 1 slot, +1 via upgrade; deploy/undeploy UX | 🔵 |
| Script RAM cost | Deployed scripts consume RAM by size; over-RAM deploys fail diegetically | 🔵 |
| Process monitor panel | Slots, per-process last run, ops spent, failures | 🔵 |
| Template mode v0 | 2–3 content-defined templates (e.g. auto-processor) that generate visible CCL (TDD §5.5) | 🔵 |

**Acceptance:** A player can automate job processing conditionally (e.g. only when compute > reserve) and stop clicking entirely; that moment reads as a victory beat in the narrative log.

---

## M5 — Limited `for` loops + logs + profiler (GDD tier 6, §6)

**Goal:** Script power scales up, and so does the ability to understand failures.

| Task | Detail | Status |
| --- | --- | --- |
| `for i in range(n)` | Parse-time cap vs. unlocked iteration limit (10 → 100); runtime fuel still applies | 🔵 |
| Iteration limit upgrades | Purchasable/unlockable limit raises | 🔵 |
| Execution log | Ring-buffer log panel: activations, ops, command results, aborts | 🔵 |
| Profiler panel | Per-process aggregates: activations, avg/total ops, compute share, failure counts (TDD §5.4) | 🔵 |
| Plain-language failure reports | Budget-exhaustion and command-failure summaries in GDD §6 style | 🔵 |
| Runaway-loop safety test | A deliberately bad loop drains fuel, aborts, logs cleanly, never freezes the frame | 🔵 |

**Acceptance:** A player who writes a wasteful loop can discover *why* it underperforms using only in-game tools.

---

## M6 — Market, trading, regime change (GDD §7, §31)

**Goal:** A dynamic environment where a fixed script eventually fails.

| Task | Detail | Status |
| --- | --- | --- |
| Price engine | Seasonal cycles × noise × regime multiplier for compute + energy (TDD §6) | 🔵 |
| Market terminal + chart | Live prices, buy/sell UI, price history chart | 🔵 |
| Trade commands | `buy_compute/sell_compute/buy_energy/sell_energy`, fees + slippage | 🔵 |
| Market read API | `market.price(good)`, `market.average(good, n)` over ring-buffer history | 🔵 |
| Energy dependency | Compute throughput now genuinely requires bought energy (TDD §4.3) | 🔵 |
| Regime shift event | Scripted STABLE→HIGH_VOLATILITY transition mid-run, with narrative framing | 🔵 |
| Naïve-script failure test | Reference buy-low/sell-high script profits in regime 1, loses in regime 2 | 🔵 |

**Acceptance:** The GDD §7 "first market algorithm" works, then stops working after the shift, and the player has the tools (`if`, averages) to adapt it.

---

## M7 — Temperature + overheating challenge (GDD §26 Thermal Runaway-lite)

**Goal:** Code has physical consequences; the first feedback-control puzzle.

| Task | Detail | Status |
| --- | --- | --- |
| Heat model | Heat from compute use, passive + purchasable cooling, efficiency degradation curve (TDD §4.3) | 🔵 |
| Thermal watchdog | Hard-threshold shutdown halting scripts/workers with diegetic messaging | 🔵 |
| Heat controls | `reduce_clock_speed()`, `boost_cooling()` commands + `stats.temperature` | 🔵 |
| Overheating challenge beat | A demand spike makes max-throughput overheat; player must control it (manually, then via `when` script) | 🔵 |
| Oscillation is possible | A naïve bang-bang cooling script visibly wastes energy — groundwork for GDD feedback-instability teaching | 🔵 |

**Acceptance:** The challenge is failable, recoverable, and solvable elegantly with a small script; solving it with a script feels clearly better than hand-managing it.

---

## M8 — Prestige fork + full-run balance pass (GDD §22, §31)

**Goal:** One complete prototype run, end to end, with a reason to run again.

| Task | Detail | Status |
| --- | --- | --- |
| Meta/run save split | `meta` survives fork, `run` wiped (TDD §7, §8) | 🔵 |
| Fork milestone + screen | Diegetic "train successor architecture" moment and confirmation flow | 🔵 |
| Architecture points | Earned from lifetime stats; 2–3 permanent modifiers purchasable | 🔵 |
| New-seed second run | Fork reseeds world; kept constructs make run 2 faster and different | 🔵 |
| Full balance pass | Target: first fork reachable in ~2–4 hours of play; pacing per GDD §23 early rows | 🔵 |
| Playtest round | ≥3 external playtesters incl. at least one non-programmer using templates only; findings logged below | 🔵 |
| Prototype verdict | Written answer to the exit question, appended to this document | 🔵 |

**Acceptance:** A tester can play from first click through regime shift, thermal challenge and one fork without developer intervention, and reports wanting to continue.

---

## Cross-cutting requirements (apply to every milestone)

- **Docs stay current:** update this file's status tables and the TDD Decision Log as part of finishing any task — not afterwards, not in batch.
- **Determinism guard:** every milestone adds/extends at least one seeded scenario test.
- **No balance literals in `/core`** (TDD §11).
- **Diegetic voice everywhere:** all player-facing errors and events use the hard-sci-fi system voice (GDD §33.3); no jokey placeholder text, because placeholder text has a way of shipping.

## Risks and watch-items

| Risk | Mitigation |
| --- | --- |
| The core bet fails (programming isn't fun for non-programmers) | Template mode lands in M4, not at the end; playtest with a non-programmer no later than M6. |
| CCL scope creep (temptation to add functions/`while`/arrays early) | Language surface is frozen to TDD §5.1 until the M8 verdict; log desires in the backlog below. |
| Balance churn eats the schedule | All numbers in `/content`; scenario tests pin pacing; timebox balance passes. |
| Terminal UI charm vs. usability | Playtest readability early (M2); aesthetic never blocks legibility. |

## Backlog (post-prototype, do not start)

Deferred per GDD §31: functions, `while`, collections/history tier, threads, agents, block mode, additional market regimes/competitors, datacentres, escape layers, further prestige depth, sound design, mobile layout.

## Playtest findings log

*(append dated entries here as playtests happen)*

## Change log

| Date | Change |
| --- | --- |
| 2026-08-06 | v1.0 — initial plan created. |
| 2026-08-06 | M0 complete: scaffolding, tooling, terminal skeleton, GitHub Pages workflow (publish awaits a remote — owner action). |
| 2026-08-06 | M1 complete: engine facade, 10 Hz fixed timestep, seeded PRNG, compute/capital + inert placeholder resources, job queue + EXECUTE with content-stepped acceleration curves, SaveFileV1 with autosave/export/import, narrative feed. 22 tests incl. seed-42 deterministic replay. Acceptance verified in-browser: click loop, staged readout reveals, refresh restores exact state. |
| 2026-08-06 | GitHub repo created (`aevisisawesome/breakout-game`, public) and Pages enabled; deploy verified live. M0 deploy task closed. |
| 2026-08-06 | M2 complete: 6 content-defined upgrades ("install channels"), inference daemons with compute overhead + energy drain/throttle, click overclock buff, RAM footprints + memory grants, SaveFileV2 with v1→v2 migration, `advanceOffline` coarse catch-up (8 h cap). 45 tests incl. pacing pins (first daemon ≤ 4 min of manual play; automation beats manual-only by 10 min). Verified in-browser: install flow, idle daemon processing, overclock readout, offline catch-up on reload. |
