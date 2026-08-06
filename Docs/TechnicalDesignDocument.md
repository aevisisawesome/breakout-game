# BREAK//OUT — Technical Design Document

> **Status:** Living document — v1.0, created 2026-08-06.
> **Scope:** This document defines the technical design paradigm for the whole project, with concrete detail for the **first playable prototype** (see [GameDesignDocument.md](GameDesignDocument.md) section 31 and [ImplementationPlan.md](ImplementationPlan.md)).
> **Maintenance requirement:** This document **must be kept up-to-date**. Any change to architecture, stack, data model, simulation rules or the CCL language must be reflected here **in the same work session** as the code change. If the code and this document disagree, that is a bug in one of them and must be resolved. Record notable decisions in the Decision Log at the end.

---

## 1. Goals and constraints

Technical goals, in priority order:

1. **Playable in a web browser** with no installation (confirmed platform decision, GDD §33.1).
2. **Portable later** to desktop (Steam) and mobile without a rewrite — therefore the simulation core must be platform-agnostic TypeScript with no DOM dependencies.
3. **Deterministic simulation** — same seed + same inputs ⇒ same outcomes. Required for offline progression, replays, balancing, testing, and the anti-"single optimal script" pillar (GDD §24).
4. **Safe, budgeted execution of player scripts** — player code (CCL) can never freeze the game, only spend in-game resources.
5. **Fast iteration** — the prototype exists to answer "is clicker + programming fun?", so build velocity beats engineering polish everywhere except the sim core and CCL runtime.

Non-goals for the prototype: multiplayer, server backend, accounts, monetization, mobile layout, block/template coding modes (code mode + templates come first; see §8).

---

## 2. Technology stack

| Concern | Choice | Rationale |
| --- | --- | --- |
| Language | TypeScript (strict) | One language across sim, UI, tooling; portable to all later targets. |
| Build tool | Vite | Fast dev server, trivial static deployment. |
| UI framework | React 18+ | Panel-heavy, data-driven UI; huge ecosystem; fine for a mostly-DOM game. |
| State (UI-side) | Zustand | Minimal store that subscribes to sim snapshots without prop-drilling. |
| Code editor | CodeMirror 6 | Lightweight, custom-language support (CCL syntax highlighting, diagnostics). |
| Charts | uPlot (or hand-rolled canvas) | Cheap real-time line charts for resources/market. |
| Persistence | `localStorage` (prototype) → IndexedDB later | Save files are small versioned JSON in the prototype. |
| Testing | Vitest | Unit tests for sim core and CCL; runs headless, no DOM needed. |
| Lint/format | ESLint + Prettier | Standard. |
| Rendering | DOM/CSS (terminal aesthetic) | GDD §28 initial phase is a monochrome terminal — DOM is the fastest way to build it. No game engine needed before the infrastructure/map phases. |

**Future porting path (do not implement yet, do not block):** Steam via Tauri or Electron wrapper; mobile via Capacitor. Both wrap the same web build, which is why the sim core must never touch `window`, `document`, or browser-only APIs directly.

---

## 3. High-level architecture

Three strictly layered packages inside one repo (folder-based for the prototype, extractable later):

```text
/src
  /core      ← simulation engine. Pure TS. No DOM, no React, no timers.
  /ccl       ← Cognition Control Language: lexer, parser, interpreter, diagnostics.
  /ui        ← React app: panels, terminal, editor, charts. Talks to core only
               through the GameEngine facade and read-only snapshots.
  /content   ← data definitions: upgrades, jobs, market config, narrative log
               entries, challenge definitions. Plain typed data, no logic.
```

Dependency rule: `ui → core → ccl` and `core → content`. **Nothing imports from `ui`.** The `core` package must run under Vitest with no browser present — this is enforced by keeping all browser APIs behind interfaces injected at startup (clock, storage, RNG seed source).

### 3.1 GameEngine facade

The UI interacts with exactly one object:

```ts
interface GameEngine {
  tick(dtMs: number): void;                  // advance simulation
  dispatch(action: PlayerAction): ActionResult; // clicks, purchases, script ops
  getSnapshot(): Readonly<GameSnapshot>;     // immutable view for rendering
  subscribe(listener: (events: GameEvent[]) => void): Unsubscribe;
  save(): SaveFileV1;
  load(save: SaveFileV1): void;
}
```

`PlayerAction` is a discriminated union (`{ type: "EXECUTE_CLICK" } | { type: "BUY_UPGRADE", id } | { type: "DEPLOY_SCRIPT", slot, source } | ...`). All mutations flow through `dispatch` or `tick`; the UI never mutates game state directly. This keeps the sim testable, replayable, and portable.

---

## 4. Simulation model

### 4.1 Time

* **Fixed timestep:** the sim advances in discrete ticks of **100 ms game time (10 Hz)**. The render loop (`requestAnimationFrame`) accumulates real elapsed time and calls `tick()` the appropriate number of times (standard accumulator pattern). Rendering interpolates/reads the latest snapshot at display rate.
* All game rules are defined **per tick**, never per frame. Balance numbers in `/content` use per-second rates; the engine converts.
* A hard cap (e.g. 50 ticks per frame) prevents spiral-of-death after tab suspension; time beyond the cap is handed to the offline-progression path (§4.5).

### 4.2 Determinism and randomness

* One seeded PRNG (e.g. mulberry32 / sfc32) owned by the sim, seeded per run ("world seed", kept in the save). Market noise, regime transitions, and any future random events draw from this stream **only inside `tick()`**.
* `Math.random()` is banned in `/core` and `/ccl` (lint rule).
* Given (seed, ordered action log), a run is fully reproducible. The prototype stores the seed; storing the full action log for replay is optional/debug-only.

### 4.3 Resources (prototype set)

Per GDD §31 the prototype simulates: **Compute, RAM, Capital, Energy, Temperature** (energy is required because the prototype includes energy trading; temperature is the overheating system).

Each resource is a `ResourcePool`:

```ts
interface ResourcePool {
  current: number;
  capacity: number;        // Infinity where not applicable (capital)
  ratePerSec: number;      // derived, recomputed each tick for UI
}
```

Core rules (all numbers live in `/content/balance.ts`, not in code):

* **Compute** (ops/sec capacity): produced by owned/rented hardware. Consumed by jobs, workers, and CCL script execution. Unused compute each tick is partially convertible to job income ("sell processing").
* **RAM**: capacity consumed by deployed scripts (per script, proportional to AST size + declared histories). Deploying a script that exceeds free RAM fails with a diegetic error.
* **Capital**: earned from completed jobs and market sales; spent on upgrades, hardware rental, market buys.
* **Energy**: consumed per tick proportional to compute utilization. Bought at market price or via contracts. Running out throttles compute to a trickle.
* **Temperature**: `heat += computeUsed * heatFactor; heat -= cooling(dt)`. Above a soft threshold, compute efficiency degrades linearly; above a hard threshold, a **watchdog thermal shutdown** halts all scripts and workers for a cooldown period. This powers the overheating challenge.

### 4.4 Jobs and automation

* A **job queue** receives inference jobs (rate and reward defined in content, scaling with upgrades). Manual `EXECUTE` clicks process jobs directly; **workers** (fixed automation, GDD Phase 1) process `n` jobs/sec each, consuming compute and generating heat.
* Clicking stays relevant early via a temporary **overclock** buff (clicks briefly raise worker throughput), per the GDD's "do not make clicking irrelevant immediately" rule.

### 4.5 Offline progression (prototype-light)

On load, compute `elapsed = now − lastSavedTimestamp`, cap it (e.g. 8 h), and advance the sim in **coarse summary steps** (e.g. 1-minute chunks using average rates) rather than full-fidelity ticks. Scripts run in "safe mode" offline: scheduled scripts execute at most a bounded number of times with their last-known behaviour, and the thermal watchdog is always active. This matches GDD §32.3 and is deliberately simple in the prototype.

---

## 5. CCL — Cognition Control Language

The centrepiece. Implemented as a hand-written **lexer → recursive-descent parser → AST → tree-walking interpreter**. No `eval`, no `Function()`, no WebAssembly — player code never becomes real JS, which makes it trivially sandboxed and cost-metered.

### 5.1 Prototype language surface (v0)

Matches GDD tiers 1–4 + 6 (variables, commands, `if`, scheduling, limited `for`). **Not in v0:** user-defined functions, `while`, collections, threads, agents.

```text
program      := statement*
statement    := assignment | ifStmt | forStmt | exprStmt | scheduleDecl
assignment   := IDENT "=" expr
ifStmt       := "if" expr block ("else" block)?
forStmt      := "for" IDENT "in" "range(" INT ")" block
scheduleDecl := ("every" NUMBER ("seconds"|"ticks") block)
              | ("when" expr block)
exprStmt     := call
expr         := arithmetic/comparison over literals, IDENT, propertyAccess, call
propertyAccess := "stats" "." IDENT | "market" "." callOrProp
```

* **Read API (tier 1):** `stats.cash`, `stats.compute_available`, `stats.temperature`, `stats.jobs_waiting`, `stats.energy`, `market.price("compute")`, `market.average("compute", n)` … The available bindings are defined by an **API registry** in `/core` that also drives editor autocomplete and the in-game reference panel. Bindings are unlock-gated.
* **Command API (tier 2):** `process_job()`, `buy_compute(n)`, `sell_compute(n)`, `buy_energy(n)`, `sell_energy(n)`, `print(x)`, `reduce_clock_speed()`, `boost_cooling()` … Commands validate against game state and return success/failure values; failures also emit log entries.
* `every`/`when` blocks may only appear at top level and define **scheduled processes**; the rest of the program body is the "run once on RUN press" script.

### 5.2 Execution costs and budgets (GDD pillar 2.4)

* Interpretation is **fuel-based**: every AST node evaluation costs op-units; every command has an additional listed compute cost. Fuel is drawn from the player's compute pool at execution time — scripts literally compete with workers for compute.
* **Per-activation budget:** a script activation gets a max op-unit budget (upgradeable). Exceeding it aborts the activation with a diegetic "process preempted" log entry — this is how runaway `for` loops fail safely.
* **`for` iteration cap** is additionally enforced at parse time against the player's current unlocked limit (10 → 100 → …), producing a compile diagnostic, so the limit is a visible progression gate rather than only a runtime failure.
* Interpreter execution happens **inside `tick()`**, synchronously, bounded by fuel — so it is deterministic and cannot block the frame. (If later tiers need heavier execution, move the whole sim into a Web Worker; the layering in §3 makes this a transport change, not a rewrite.)

### 5.3 Scheduler

* Fixed number of **scheduler slots** (starts at 1–2, upgradeable). Deploying a script assigns its `every`/`when` processes to slots.
* Each tick, due processes are run in slot order. `when` conditions are evaluated every tick (cheap, fuel-metered) with edge-triggering (fires on false→true transition) to prevent free re-fires.
* Processes that repeatedly exhaust fuel are flagged in the process monitor (groundwork for debugging-as-gameplay).

### 5.4 Diagnostics, logs, profiling

* Parser produces positioned, plain-language errors (GDD §6 accessibility rule): "Line 4: `rang` is not known. Did you mean `range`?"
* Every script activation appends to a ring-buffer **execution log**: timestamp, process name, ops spent, commands executed, failures.
* The **profiler panel** aggregates per-process: activations, avg/total ops, compute share, command failure counts. This is the prototype's "logs and profiling" deliverable — no breakpoints/stepping yet.

### 5.5 Three input modes (GDD §25, §33.4)

All modes produce CCL source; the engine only ever sees CCL text.

* **Prototype ships:** Code mode (CodeMirror) + **Template mode** (form controls that generate visible CCL, e.g. the buy-below/sell-above trader). Templates are defined in `/content` as parameterized CCL snippets.
* **Block mode is deferred** past the prototype but the "everything compiles to CCL text" contract is the architectural guarantee that makes it addable later.

---

## 6. Market simulation (prototype)

* Two tradable goods: **compute** (rental units) and **energy**.
* Price model per good: `price = base × seasonal(t) × regimeMultiplier × noise`, where `seasonal` is a sum of sine cycles (learnable pattern, GDD §7 "early market behaviour"), `noise` is seeded PRNG drift, and `regimeMultiplier` comes from the active regime.
* **Regimes:** prototype implements two — `STABLE_CYCLES` (start) and one scripted mid-run shift to `HIGH_VOLATILITY` (amplitude up, cycles distorted) that breaks naïve buy-low scripts. Regime is hidden state; the player sees only prices. Architecture is a regime state machine so more regimes are additive later.
* **Friction:** flat transaction fee + per-trade slippage proportional to order size. No order book in the prototype.
* Price history is stored as a fixed-size ring buffer (e.g. last 2 h of ticks downsampled) — this backs `market.average` and the market chart.

---

## 7. Prestige — Recursive Fork (prototype v0)

* One reset is implemented. Trigger: reaching a defined milestone (see Implementation Plan M8).
* On fork: wipe run state; keep **architecture points** (earned from lifetime stats), persistent **unlocks of programming constructs** already discovered, and apply a new world seed. Architecture points buy 2–3 simple permanent modifiers (e.g. +base compute, +scheduler slot, cheaper script fuel).
* Save format separates `meta` (survives forks) from `run` (wiped), so prestige is `run = newRun(seed, meta)`.

---

## 8. Save system

```ts
interface SaveFileV1 {
  version: 1;
  savedAt: number;          // epoch ms, for offline progression
  meta: MetaState;          // prestige-persistent: unlocks, architecture points, fork count
  run: RunState;            // seed, resources, upgrades, deployed script sources, market state, log tail
}
```

* Serialized as JSON to `localStorage` (autosave every 30 s + on visibility change). Export/import as a file (base64 blob) for backup — cheap and useful for playtesting.
* **Deployed scripts are saved as source text** and re-compiled on load — never persist ASTs or interpreter state. In-flight activations are simply dropped on save/load.
* `version` gates a migration pipeline (`migrate(v_n) → v_{n+1}`); every future save-shape change adds a migration, never edits old ones.

---

## 9. UI structure (prototype)

Terminal-aesthetic single page; panels unlock diegetically (GDD pillar 2.5):

| Panel | Unlocks at |
| --- | --- |
| Terminal + `EXECUTE` button + compute meter | start |
| Upgrade list (as terminal "install" entries) | first credits |
| Resource readouts (RAM, capital, energy, temperature) | staged |
| Research/system log (narrative + errors) | start (concealed) |
| Code editor + RUN | CCL unlock |
| Process monitor (scheduler slots, per-process stats) | scheduling unlock |
| Market terminal + price chart | market unlock |
| Profiler | profiling unlock |
| Fork (prestige) screen | fork milestone |

UI renders from `getSnapshot()` at animation-frame rate; panel unlock state lives in the sim (it is game state), not in the UI layer.

---

## 10. Testing strategy

* **CCL:** golden tests for lexer/parser (source → AST), interpreter semantics, fuel accounting, iteration caps, and diagnostic messages. This is the highest-value test surface — treat the language like a real compiler project.
* **Core:** deterministic scenario tests — fixed seed, scripted action log, assert resource values after N ticks. Balance regression tests pin key pacing numbers (e.g. "first worker affordable within X clicks").
* **Market:** statistical sanity tests (mean prices per regime within bounds; regime shift actually breaks the reference naïve script).
* UI gets light smoke tests only; the prototype's UI will churn.

---

## 11. Coding conventions

* TypeScript strict mode; no `any` in `/core` and `/ccl`.
* All tunable numbers live in `/content` — a code review rule: **no literals with balance meaning inside `/core`**.
* Discriminated unions + exhaustive `switch` for actions, events, AST nodes, regimes.
* Events out, actions in: UI never reaches into sim internals.

---

## 12. Decision Log

Record every significant technical decision or reversal here. Keep entries append-only.

| Date | Decision | Rationale / alternatives considered |
| --- | --- | --- |
| 2026-08-06 | TypeScript + Vite + React, DOM-rendered, no game engine. | Terminal/panel UI fits DOM; engines (Phaser/Unity-web) add cost without benefit before the map phases. Revisit at infrastructure phase. |
| 2026-08-06 | CCL as hand-written tree-walking interpreter, fuel-metered, no `eval`. | Sandboxing + cost metering are core gameplay; transpiling to JS would make both harder. Performance is a non-issue at prototype scale. |
| 2026-08-06 | Fixed 10 Hz tick, seeded PRNG, strict core/UI separation. | Determinism needed for offline progress, testing, and later balance work; separation preserves the Steam/mobile porting path. |
| 2026-08-06 | Prototype ships Code mode + Template mode; Block mode deferred. | Both compile to CCL text, which is the contract that keeps Block mode addable. Prototype question ("is it fun?") answerable without blocks. |
