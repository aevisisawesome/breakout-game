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

| Concern         | Choice                                       | Rationale                                                                                                                                        |
| --------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Language        | TypeScript (strict)                          | One language across sim, UI, tooling; portable to all later targets.                                                                             |
| Build tool      | Vite                                         | Fast dev server, trivial static deployment.                                                                                                      |
| UI framework    | React 18+                                    | Panel-heavy, data-driven UI; huge ecosystem; fine for a mostly-DOM game.                                                                         |
| State (UI-side) | Zustand                                      | Minimal store that subscribes to sim snapshots without prop-drilling.                                                                            |
| Code editor     | CodeMirror 6                                 | Lightweight, custom-language support (CCL syntax highlighting, diagnostics).                                                                     |
| Charts          | uPlot (or hand-rolled canvas)                | Cheap real-time line charts for resources/market.                                                                                                |
| Persistence     | `localStorage` (prototype) → IndexedDB later | Save files are small versioned JSON in the prototype.                                                                                            |
| Testing         | Vitest                                       | Unit tests for sim core and CCL; runs headless, no DOM needed.                                                                                   |
| Lint/format     | ESLint + Prettier                            | Standard.                                                                                                                                        |
| Rendering       | DOM/CSS (terminal aesthetic)                 | GDD §28 initial phase is a monochrome terminal — DOM is the fastest way to build it. No game engine needed before the infrastructure/map phases. |

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
  tick(dtMs: number): void; // advance simulation (accumulates internally)
  dispatch(action: PlayerAction): ActionResult; // clicks, purchases, script ops
  getSnapshot(): Readonly<GameSnapshot>; // immutable view for rendering
  subscribe(listener: (events: GameEvent[]) => void): Unsubscribe;
  save(now: number): SaveFile; // caller supplies epoch ms — core never reads the clock
  load(save: SaveFile): void;
  advanceOffline(elapsedMs: number): void; // coarse offline catch-up (§4.5); caller supplies elapsed ms
}
```

`PlayerAction` is a discriminated union (`{ type: "EXECUTE_CLICK" } | { type: "BUY_UPGRADE", id } | { type: "DEPLOY_SCRIPT", slot, source } | ...`). All mutations flow through `dispatch` or `tick`; the UI never mutates game state directly. This keeps the sim testable, replayable, and portable.

---

## 4. Simulation model

### 4.1 Time

- **Fixed timestep:** the sim advances in discrete ticks of **100 ms game time (10 Hz)**. The render loop (`requestAnimationFrame`) passes raw elapsed ms to `tick(dtMs)`; the **engine owns the accumulator** and runs the appropriate number of fixed steps internally (decision 2026-08-06: keeps the accumulator deterministic and directly testable). Rendering reads the latest snapshot at display rate.
- All game rules are defined **per tick**, never per frame. Balance numbers in `/content` use per-second rates; the engine converts.
- A hard cap (e.g. 50 ticks per frame) prevents spiral-of-death after tab suspension; time beyond the cap is handed to the offline-progression path (§4.5).

### 4.2 Determinism and randomness

- One seeded PRNG (e.g. mulberry32 / sfc32) owned by the sim, seeded per run ("world seed", kept in the save). Market noise, regime transitions, and any future random events draw from this stream **only inside `tick()`**.
- `Math.random()` is banned in `/core` and `/ccl` (lint rule).
- Given (seed, ordered action log), a run is fully reproducible. The prototype stores the seed; storing the full action log for replay is optional/debug-only.

### 4.3 Resources (prototype set)

Per GDD §31 the prototype simulates: **Compute, RAM, Capital, Energy, Temperature** (energy is required because the prototype includes energy trading; temperature is the overheating system).

Each resource is a `ResourcePool`:

```ts
interface ResourcePool {
  current: number;
  capacity: number; // Infinity where not applicable (capital)
  ratePerSec: number; // derived, recomputed each tick for UI
}
```

Core rules (all numbers live in `/content/balance.ts`, not in code):

- **Compute** (ops/sec capacity): produced by owned/rented hardware. Consumed by jobs, workers, and CCL script execution. Unused compute each tick is partially convertible to job income ("sell processing").
- **RAM**: capacity consumed by installed packages and by deployed scripts (per script: a fixed base plus a per-AST-node charge, rounded up to whole MB; declared histories are added at tier 7). Deploying a script that exceeds free RAM fails with a diegetic error, as does an install that no longer fits once scripts are resident.
- **Capital**: earned from completed jobs and market sales; spent on upgrades, hardware rental, market buys.
- **Energy**: consumed per tick proportional to compute utilization. Bought at market price or via contracts. Running out throttles compute to a trickle.
- **Temperature**: `heat += computeUsed * heatFactor; heat -= cooling(dt)`. Above a soft threshold, compute efficiency degrades linearly; above a hard threshold, a **watchdog thermal shutdown** halts all scripts and workers for a cooldown period. This powers the overheating challenge.

### 4.4 Jobs and automation

- A **job queue** receives inference jobs (rate and reward defined in content, scaling with upgrades). Manual `EXECUTE` clicks process jobs directly; **workers** (fixed automation, GDD Phase 1) process `n` jobs/sec each, consuming compute and generating heat.
- Clicking stays relevant early via a temporary **overclock** buff (clicks briefly raise worker throughput), per the GDD's "do not make clicking irrelevant immediately" rule.

### 4.5 Offline progression (prototype-light)

On load, compute `elapsed = now − lastSavedTimestamp`, cap it (e.g. 8 h), and advance the sim in **coarse summary steps** (e.g. 1-minute chunks using average rates) rather than full-fidelity ticks. Scripts run in "safe mode" offline: scheduled scripts execute at most a bounded number of times with their last-known behaviour, and the thermal watchdog is always active. This matches GDD §32.3 and is deliberately simple in the prototype.

As implemented (M4): inside each chunk every `every` process runs its due number of activations, bounded per chunk and across the whole catch-up (`scheduler.offlineMaxActivationsPerChunk` / `offlineMaxActivations`). Activations draw fuel from the compute pool exactly as they do live, and stop early if the pool cannot cover one. **`when` guards do not run offline** — an edge-triggered condition has no meaning against coarse summary steps — so those processes simply resume on return. All processes become due again the moment play resumes.

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

- **Read API (tier 1):** `stats.cash`, `stats.compute_available`, `stats.temperature`, `stats.jobs_waiting`, `stats.energy`, `market.price("compute")`, `market.average("compute", n)` … The available bindings are defined by an **API registry** in `/core` that also drives editor autocomplete and the in-game reference panel. Bindings are unlock-gated.
- **Command API (tier 2):** `process_job()`, `buy_compute(n)`, `sell_compute(n)`, `buy_energy(n)`, `sell_energy(n)`, `print(x)`, `reduce_clock_speed()`, `boost_cooling()` … Commands validate against game state and return success/failure values; failures also emit log entries.
- `every`/`when` blocks may only appear at top level and define **scheduled processes**; the rest of the program body is the "run once on RUN press" script. Concretely: **RUN** executes the top-level body and ignores the declarations; **DEPLOY** installs the declarations and ignores the body.
- CCL has **no truthiness**: `if`, `when`, `and`, `or` and `not` require yes/no values, and anything else is a positioned fault ("Conditions need a yes/no value — compare two values, like `stats.cash > 10`"). `and`/`or` short-circuit, so the unevaluated side costs no fuel.
- Each activation gets a **fresh variable environment**; nothing survives between activations (state arrives with tier 7 collections/history).

### 5.2 Execution costs and budgets (GDD pillar 2.4)

- Interpretation is **fuel-based**: every AST node evaluation costs op-units; every command has an additional listed compute cost. Fuel is drawn from the player's compute pool at execution time — scripts literally compete with workers for compute.
- **Per-activation budget:** a script activation gets a max op-unit budget (upgradeable). Exceeding it aborts the activation with a diegetic "process preempted" log entry — this is how runaway `for` loops fail safely.
- **`for` iteration cap** is additionally enforced at parse time against the player's current unlocked limit (10 → 100 → …), producing a compile diagnostic, so the limit is a visible progression gate rather than only a runtime failure.
- Interpreter execution happens **inside `tick()`**, synchronously, bounded by fuel — so it is deterministic and cannot block the frame. (If later tiers need heavier execution, move the whole sim into a Web Worker; the layering in §3 makes this a transport change, not a rewrite.)

### 5.3 Scheduler

- Fixed number of **scheduler slots** (starts at 1, upgradeable via the PROCESS TABLE EXTENSION install). Deploying a script assigns its `every`/`when` processes to slots — **one slot per declaration**, not per script. A deploy that would exceed free slots or free RAM fails diegetically and changes nothing.
- Each tick, due processes are run in slot order, after any queued RUN activation and before arrivals/daemons. `when` conditions are **sampled on a content-defined cadence** (`scheduler.whenPollTicks`, default every 5 ticks = 2 Hz) rather than every tick, and are edge-triggered (fire on false→true) to prevent free re-fires. Polling is fuel-metered like any other evaluation, so a standing guard has a real, visible compute cost; the cadence is what keeps that cost affordable at the tier's income (see the Decision Log, 2026-08-08).
- A guard that faults or runs out of fuel reads as false and leaves the edge state untouched, so a starved process cannot fire spuriously when compute returns.
- Deployed scripts are **quiet**: only `print()` output reaches the terminal. Command failures and aborts are counted in the process monitor instead, because a 1 s process would otherwise flood the log. The full execution log arrives in M5.
- Processes that repeatedly exhaust fuel are flagged in the process monitor (groundwork for debugging-as-gameplay).

### 5.4 Diagnostics, logs, profiling

- Parser produces positioned, plain-language errors (GDD §6 accessibility rule): "Line 4: `rang` is not known. Did you mean `range`?"
- Every script activation appends to a ring-buffer **execution log**: timestamp, process name, ops spent, commands executed, failures.
- The **profiler panel** aggregates per-process: activations, avg/total ops, compute share, command failure counts. This is the prototype's "logs and profiling" deliverable — no breakpoints/stepping yet.

### 5.5 Three input modes (GDD §25, §33.4)

All modes produce CCL source; the engine only ever sees CCL text.

- **Prototype ships:** Code mode (CodeMirror) + **Template mode** (form controls that generate visible CCL, e.g. the buy-below/sell-above trader). Templates are defined in `/content` as parameterized CCL snippets.
- **Block mode is deferred** past the prototype but the "everything compiles to CCL text" contract is the architectural guarantee that makes it addable later.

---

## 6. Market simulation (prototype)

- Two tradable goods: **compute** (rental units) and **energy**.
- Price model per good: `price = base × seasonal(t) × regimeMultiplier × noise`, where `seasonal` is a sum of sine cycles (learnable pattern, GDD §7 "early market behaviour"), `noise` is seeded PRNG drift, and `regimeMultiplier` comes from the active regime.
- **Regimes:** prototype implements two — `STABLE_CYCLES` (start) and one scripted mid-run shift to `HIGH_VOLATILITY` (amplitude up, cycles distorted) that breaks naïve buy-low scripts. Regime is hidden state; the player sees only prices. Architecture is a regime state machine so more regimes are additive later.
- **Friction:** flat transaction fee + per-trade slippage proportional to order size. No order book in the prototype.
- Price history is stored as a fixed-size ring buffer (e.g. last 2 h of ticks downsampled) — this backs `market.average` and the market chart.

---

## 7. Prestige — Recursive Fork (prototype v0)

- One reset is implemented. Trigger: reaching a defined milestone (see Implementation Plan M8).
- On fork: wipe run state; keep **architecture points** (earned from lifetime stats), persistent **unlocks of programming constructs** already discovered, and apply a new world seed. Architecture points buy 2–3 simple permanent modifiers (e.g. +base compute, +scheduler slot, cheaper script fuel).
- Save format separates `meta` (survives forks) from `run` (wiped), so prestige is `run = newRun(seed, meta)`.

---

## 8. Save system

```ts
// Current shape. v1 (M1) lacked run.upgrades/run.workers;
// v2 (M2) lacked run.ccl + run.unlocks.editor;
// v3 (M3) lacked run.scheduler, run.flags and the conditions/scheduler unlocks.
interface SaveFileV4 {
  version: 4;
  savedAt: number; // epoch ms, for offline progression
  meta: MetaState; // prestige-persistent: unlocks, architecture points, fork count
  run: RunState; // seed, resources, upgrades, script editor buffer, market state, log tail
}
```

- Serialized as JSON to `localStorage` (autosave every 30 s + on visibility change). Export/import as a file (base64 blob) for backup — cheap and useful for playtesting.
- **Deployed scripts are saved as source text** and re-compiled on load — never persist ASTs or interpreter state. In-flight activations are simply dropped on save/load.
- `version` gates a migration pipeline (`migrate(v_n) → v_{n+1}`); every future save-shape change adds a migration, never edits old ones.

---

## 9. UI structure (prototype)

Terminal-aesthetic single page; panels unlock diegetically (GDD pillar 2.5):

| Panel                                                 | Unlocks at        |
| ----------------------------------------------------- | ----------------- |
| Terminal + `EXECUTE` button + compute meter           | start             |
| Upgrade list (as terminal "install" entries)          | first credits     |
| Resource readouts (RAM, capital, energy, temperature) | staged            |
| Research/system log (narrative + errors)              | start (concealed) |
| Code editor + RUN                                     | CCL unlock        |
| Process monitor (scheduler slots, per-process stats)  | scheduling unlock |
| Market terminal + price chart                         | market unlock     |
| Profiler                                              | profiling unlock  |
| Fork (prestige) screen                                | fork milestone    |

UI renders from `getSnapshot()` at animation-frame rate; panel unlock state lives in the sim (it is game state), not in the UI layer.

---

## 10. Testing strategy

- **CCL:** golden tests for lexer/parser (source → AST), interpreter semantics, fuel accounting, iteration caps, and diagnostic messages. This is the highest-value test surface — treat the language like a real compiler project.
- **Core:** deterministic scenario tests — fixed seed, scripted action log, assert resource values after N ticks. Balance regression tests pin key pacing numbers (e.g. "first worker affordable within X clicks").
- **Market:** statistical sanity tests (mean prices per regime within bounds; regime shift actually breaks the reference naïve script).
- UI gets light smoke tests only; the prototype's UI will churn.

---

## 11. Coding conventions

- TypeScript strict mode; no `any` in `/core` and `/ccl`.
- All tunable numbers live in `/content` — a code review rule: **no literals with balance meaning inside `/core`**.
- Discriminated unions + exhaustive `switch` for actions, events, AST nodes, regimes.
- Events out, actions in: UI never reaches into sim internals.

---

## 12. Decision Log

Record every significant technical decision or reversal here. Keep entries append-only.

| Date       | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                | Rationale / alternatives considered                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-06 | TypeScript + Vite + React, DOM-rendered, no game engine.                                                                                                                                                                                                                                                                                                                                                                                | Terminal/panel UI fits DOM; engines (Phaser/Unity-web) add cost without benefit before the map phases. Revisit at infrastructure phase.                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-08-06 | CCL as hand-written tree-walking interpreter, fuel-metered, no `eval`.                                                                                                                                                                                                                                                                                                                                                                  | Sandboxing + cost metering are core gameplay; transpiling to JS would make both harder. Performance is a non-issue at prototype scale.                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-08-06 | Fixed 10 Hz tick, seeded PRNG, strict core/UI separation.                                                                                                                                                                                                                                                                                                                                                                               | Determinism needed for offline progress, testing, and later balance work; separation preserves the Steam/mobile porting path.                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2026-08-06 | Prototype ships Code mode + Template mode; Block mode deferred.                                                                                                                                                                                                                                                                                                                                                                         | Both compile to CCL text, which is the contract that keeps Block mode addable. Prototype question ("is it fun?") answerable without blocks.                                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-08-06 | Timestep accumulator lives inside `engine.tick(dtMs)`, not the UI loop; 50-tick catch-up cap drops excess time (offline path owns long gaps).                                                                                                                                                                                                                                                                                           | Deterministic and directly unit-testable; the UI just forwards raw elapsed ms. Interface unchanged from §3.1.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2026-08-06 | `save(now)` takes epoch ms from the caller.                                                                                                                                                                                                                                                                                                                                                                                             | /core may not read wall clocks (no browser APIs, determinism); the UI supplies `Date.now()`.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-08-06 | M1 "accelerating feedback" comes from content-defined step curves (batch-per-click and job arrival rate keyed to lifetime jobs processed), not purchases.                                                                                                                                                                                                                                                                               | Purchasable upgrades are M2; the M1 acceptance criterion needs visible acceleration in the first minutes. Curves live in `/content/balance.ts`; M2's upgrade system layers on top.                                                                                                                                                                                                                                                                                                                                                     |
| 2026-08-06 | Save serialization encodes `Infinity` capacities as a string sentinel (`__INFINITY__`) in JSON.                                                                                                                                                                                                                                                                                                                                         | JSON has no Infinity literal; capital/temperature pools are uncapped per §4.3. Round-trip tested.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-08-06 | Snapshots resolve state-gated content for display (e.g. research entry text); /ui may import only static display data from /content (e.g. the diegetic string table), never state-dependent content.                                                                                                                                                                                                                                    | Keeps the "UI talks to core only through the facade" rule meaningful: the sim decides what is unlocked; the UI never evaluates content triggers.                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-08-06 | UI store is Zustand mirroring `getSnapshot()`; it re-syncs on rAF frames **and** on engine event flushes.                                                                                                                                                                                                                                                                                                                               | Dispatch results must render even when rAF is throttled (hidden/background tabs). Store holds no game state of its own.                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-08-06 | Vitest 4 (TDD table said "Vitest" generically). Dev-only `window.__breakout = { engine }` handle exposed under `import.meta.env.DEV`.                                                                                                                                                                                                                                                                                                   | Vitest 2/3 pulled an esbuild advisory via bundled vite 5; v4 clears `npm audit`. The dev handle enables scripted playtesting/debugging; stripped from production builds.                                                                                                                                                                                                                                                                                                                                                               |
| 2026-08-06 | M2 worker economics: inference daemons process the same job queue as clicks (jobs still pay `computePerJob` + `capitalPerJob`) but each daemon-processed job draws a compute **overhead** from the buffer (net compute stays positive). Daemons stall if the buffer can't cover one job's overhead.                                                                                                                                     | §4.3's "compute produced by hardware" model arrives with rented hardware (M3+). For M2, overhead-on-the-click-earned buffer keeps clicking mechanically relevant (daemons need seed compute) without inverting M1's terminal messaging. Growth is bounded by the job arrival rate, which upgrades raise.                                                                                                                                                                                                                               |
| 2026-08-06 | M2 energy model: constant base regen ("sandbox power feed") + upgrade adds; drain per daemon-second while the queue is non-empty, scaled by the current throughput multiplier; an empty pool throttles daemon throughput by a content factor (0.25) rather than halting. The resulting full/throttled oscillation around empty is accepted.                                                                                             | Prefigures M6 energy trading with a soft failure mode. The bang-bang oscillation is deliberate groundwork for GDD §6 "feedback instability" teaching; a smooth controller would hide the phenomenon.                                                                                                                                                                                                                                                                                                                                   |
| 2026-08-06 | Click overclock is a capped timer (each EXECUTE +1.5 s, max 12 s) that multiplies daemon throughput ×2 while active.                                                                                                                                                                                                                                                                                                                    | GDD Phase 1 rule "don't make clicking irrelevant immediately": clicking layers onto automation instead of competing with it. Numbers in `/content`.                                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-08-06 | Upgrades are content-defined "install channels" with geometric cost curves, per-install RAM footprints, `maxOwned` caps and job-count reveal gates; effects are a discriminated union interpreted in `/core/derived.ts` (pure derived-stats recomputation per tick). RAM `current` measures installed footprints against a capacity raised by memory-grant upgrades.                                                                    | TDD §11 (no balance in core) and §9 (the sim decides what's revealed — snapshot lists only unlocked upgrades). Derived-stat recomputation avoids stored/duplicated aggregates in RunState.                                                                                                                                                                                                                                                                                                                                             |
| 2026-08-06 | Save bumped to `SaveFileV2` (adds `run.upgrades`, `run.workers`); `deserializeSave` runs a v1→v2 migration filling defaults. `engine.load` re-derives RAM pools so content changes between sessions can't leave stale capacities in saves.                                                                                                                                                                                              | TDD §8 migration pipeline, first real use. Live playtest saves from M1 keep working.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2026-08-06 | Offline catch-up is `engine.advanceOffline(elapsedMs)` — a facade addition; the UI calls it after `load` with `Date.now() − savedAt`. Coarse 60 s chunks: arrivals and daemon processing are treated as concurrent (queue cap applies to the residual only), energy is a steady-state budget (full-rate seconds, then throttled), no overclock, no PRNG draws. Absences < 60 s are ignored; cap 8 h.                                    | §4.5 as designed; the caller-supplies-time rule keeps /core clock-free. Applying the queue cap before processing would wrongly cap offline throughput at (queue capacity)/(chunk length) jobs/s.                                                                                                                                                                                                                                                                                                                                       |
| 2026-08-06 | Vite dev server honors an externally assigned `PORT` env var (`server.port` in vite.config.ts); `.claude/launch.json` sets `autoPort`.                                                                                                                                                                                                                                                                                                  | Lets multiple dev sessions coexist without fighting over 5173. No effect on builds.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-08-06 | M3 CCL grammar ships comparisons (`== != < <= > >=`, single, non-chained) alongside arithmetic; logical operators (`and`/`or`/`not`) arrive with `if` in M4. All future keywords (`if`, `for`, `every`, `when`, `range`, …) are reserved now, with plain-language "construct not unlocked" diagnostics.                                                                                                                                 | §5.1's expr rule spans both; comparisons are harmless without `if` (printable booleans) and reserving keywords early stops player scripts from breaking when tiers unlock.                                                                                                                                                                                                                                                                                                                                                             |
| 2026-08-06 | CCL fuel model: every AST node evaluation costs exactly 1 op-unit; `computePerOp` converts ops to compute drawn live from the pool; command costs (`commandCosts`) are charged on the attempt (validated calls only, no refund on in-game failure). Two abort paths: op-budget preemption (`maxOpsPerActivation`) and compute-pool exhaustion, each with distinct diegetic lines. All four numbers live in `/content/balance.ts` `ccl`. | §5.2 as designed; charging failed attempts makes wasteful polling a real cost (groundwork for M4 `when` loops). The uniform 1-op cost keeps fuel accounting explainable to players and exactly testable.                                                                                                                                                                                                                                                                                                                               |
| 2026-08-06 | `RUN_SCRIPT` parses at dispatch (syntax errors report immediately) but queues the parsed program; execution happens at the start of the next `tick()` step, before arrivals/daemons — the future scheduler slot order. At most one pending activation (a second RUN replaces it); pending activations are dropped on save/load per §8.                                                                                                  | §5.2 "interpreter execution happens inside tick()". Dispatch-time execution would work but would fork the M4 scheduler code path; queueing unifies them now.                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-08-06 | Command outcome contract: `ok` (value), `failed` (in-game failure → call evaluates to `false`, diegetic log line, script continues), `misuse` (bad arguments → positioned fault, activation aborts). Runtime name errors get "did you mean" suggestions (bounded Levenshtein over variables, API names, namespaces).                                                                                                                    | GDD §6: failures must be understandable and survivable; misuse is a programming error and should stop the script at the exact spot. Suggestions implement the TDD §5.4 example.                                                                                                                                                                                                                                                                                                                                                        |
| 2026-08-06 | CCL API surface is split: player-facing docs (names, signatures, descriptions) in `/content/cclApi.ts`; implementations + balance-sourced costs bound in `/core/registry.ts`; a registry test enforces docs ↔ implementations stay 1:1. Snapshot exposes the surface only after the editor unlock (drives autocomplete + reference panel).                                                                                              | §5.1 API registry with §11 layering: diegetic text is content, bindings are core. The 1:1 test makes adding a command without documenting it (or vice versa) a CI failure.                                                                                                                                                                                                                                                                                                                                                             |
| 2026-08-06 | Save bumped to `SaveFileV3`: adds `run.ccl` (editor buffer source, run count, last-run report) and `run.unlocks.editor`; v2→v3 migration fills defaults. The editor buffer persists via a debounced `SET_EDITOR_SOURCE` action (600 ms, UI-side) plus on every RUN; source capped at `maxSourceChars`.                                                                                                                                  | §8: player code must survive reload/export. Only source text is stored — never ASTs. The cap is a sanity guard until M4 prices script RAM properly.                                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-08-06 | /ui may import the pure /ccl lexer (keywords) and parser for editor presentation only — CodeMirror syntax highlighting and live linting re-parse the buffer locally; execution and all game effects still flow exclusively through `dispatch({type:'RUN_SCRIPT'})`.                                                                                                                                                                     | Same shape as the existing "static display data from /content" exception: presentation-only use of pure functions. Duplicating the grammar in the UI would guarantee drift.                                                                                                                                                                                                                                                                                                                                                            |
| 2026-08-06 | Narrow viewports (≤760 px) drop the fixed-viewport shell: `.terminal-screen` becomes `height:auto; min-height:100dvh; overflow:visible`, the grid row stops claiming a share of the viewport, and the nested scroll regions (side column, research/reference lists) are released so the **document** scrolls. Only the terminal output keeps its own scrollbar, capped at 40vh.                                                         | Bug report from an iPhone 16 Pro Max: the single-column fallback stacked ~1800 px of panels inside a locked 830 px viewport, so grid rows overflowed and the side column's opaque background painted over the CCL editor and API reference. Nested scrollers cannot fix an over-tall column — the page itself has to scroll. Explicitly _not_ the deferred mobile layout (GDD §31 backlog): no touch targets, breakpoints or information hierarchy were designed, this only makes the existing fallback usable and non-overlapping.    |
| 2026-08-06 | Editor stack: CodeMirror 6 (`@codemirror/state,view,language,commands,lint,autocomplete` + `@lezer/highlight`), StreamLanguage tokenizer, terminal-palette theme via CSS variables. Bundle now ~531 kB minified (over Vite's 500 kB warning); accepted for the prototype.                                                                                                                                                               | TDD §2 named CodeMirror 6. Code-splitting the editor is premature while the UI churns; revisit if load time ever matters for playtests.                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-08-07 | `npm run format:check` and `npm run lint` are blocking steps in the deploy workflow's build job, before `npm run build`. Preceded by a repo-wide `npm run format` pass covering `Docs/**` (no `.prettierignore` entry for it), so the check is meaningful everywhere.                                                                                                                                                                   | CI ran only `npm test` + `npm run build`, so Prettier drift accumulated unnoticed across 9 files, several untouched for weeks. **Tradeoff accepted:** a trivial formatting slip now blocks a playtest deploy; the fix is `npm run format` and push again. An ungated check is one nobody runs. Formatting the design docs was preferred over ignoring them, at the cost of one large formatting-only diff — verified rendering-neutral by diffing before/after HTML (all tables byte-identical; only embedded TS code fences changed). |
| 2026-08-07 | `CLAUDE.md` added at the repo root for environment/workflow notes (shell quirks, the `npm test` ≠ type-check trap, the ESLint-enforced layering rules, the dev `window.__breakout` handle and its save-overwrite hazard, deploy verification). It points at `Docs/` as the source of truth rather than restating design.                                                                                                                | Keeps operational knowledge that is not derivable from the code out of the design documents, which stay about the "why"/"what"/"when". Docs/README.md's maintenance policy still governs everything under `Docs/`.                                                                                                                                                                                                                                                                                                                     |
| 2026-08-08 | **CCL grammar is unlock-gated at parse time.** `parse(source, { conditions, scheduling })` — both default to locked. The engine passes the player's unlock flags; the editor's linter passes the same flags from `snapshot.ccl.constructs`, and autocomplete offers a tier's keywords only once granted.                                                                                                                                | The tiers are a progression gate (GDD §5), so a locked construct must produce "not available to this process yet", not a syntax error — and the editor must say the same thing as the engine. Threading options through `parse` (rather than a second grammar) keeps one parser. This is also the hook M5's `for` iteration cap needs (TDD §5.2: a parse-time limit against the unlocked value).                                                                                                                                       |
| 2026-08-08 | **CCL has no truthiness.** `if`/`when`/`and`/`or`/`not` require yes/no values; a number or text is a positioned fault naming a fix. `and`/`or` short-circuit.                                                                                                                                                                                                                                                                           | GDD §6's accessibility rule: `if stats.cash { … }` from a non-programmer should be corrected, not silently interpreted. Truthiness is exactly the kind of invisible semantics that makes a language feel arbitrary. Short-circuiting is both conventional and a real fuel saving the player can observe.                                                                                                                                                                                                                               |
| 2026-08-08 | **`when` guards are sampled every `whenPollTicks` ticks (default 5 = 2 Hz), not every tick** — a refinement of §5.3's "evaluated every tick".                                                                                                                                                                                                                                                                                           | A 3-node guard at 10 Hz costs 1.5 compute/s against ~1.5–2 compute/s of income at the tier where scheduling unlocks: one guard would consume the entire economy and `when` would be unusable (M7's thermal watchdog depends on it). At 2 Hz the same guard costs ~0.3 compute/s — felt, affordable, and still teaching that polling is not free. Measured live in the browser at 0.4 compute/s for the two-clause template guard. The cadence is a content number.                                                                     |
| 2026-08-08 | **A deployment is one script occupying one slot per `every`/`when` declaration**; multiple deployments coexist, each named `PROC-nn`, with its own RAM footprint and monitor counters. Only source text is persisted; ASTs are rebuilt on load, and a deployment whose source no longer compiles is dropped with a diegetic line rather than silently doing nothing.                                                                    | §5.3 assigns "its `every`/`when` processes to slots", so the slot is the process, not the file — which is also what makes GDD tier 4's "which systems deserve permanent automation" a real choice at one slot. §8 forbids persisting ASTs; dropping an uncompilable deployment beats keeping a dead entry, because a content or grammar change between sessions must not leave an invisible no-op in a slot.                                                                                                                           |
| 2026-08-08 | **Scheduled processes are quiet**: only `print()` output reaches the terminal; command failures and aborts are counted in the process monitor. RUN activations stay verbose.                                                                                                                                                                                                                                                            | An `every 1 seconds` process failing on an empty queue would emit 60 error lines a minute and destroy the terminal as a readable surface. The counters preserve the information; M5's execution log gives it detail. `print` stays live because it is the player's only current debugging output.                                                                                                                                                                                                                                      |
| 2026-08-08 | **Narrative entries may additionally require a milestone flag** (`requiresFlag`, stored as `run.flags`), used for the first-deploy beat that no job count can express.                                                                                                                                                                                                                                                                  | M4's acceptance criterion asks for the automation moment to read as a victory beat. An optional flag on the existing job-count trigger was preferred to a general event-trigger system, which is scope the prototype has no other use for yet.                                                                                                                                                                                                                                                                                         |
| 2026-08-08 | Save bumped to `SaveFileV4` (adds `run.scheduler`, `run.flags`, `run.unlocks.conditions/scheduler`); v3→v4 migration fills defaults and leaves the new unlocks false so the tick-time check re-derives them from lifetime jobs. Verified against a live v3 playtest save in the browser.                                                                                                                                                | §8 migration pipeline. Re-deriving rather than back-filling means a migrated save re-fires the diegetic grant line, which is the correct player-facing behaviour for a tier the player had not yet reached.                                                                                                                                                                                                                                                                                                                            |
| 2026-08-08 | Narrow-screen fix: the ≤760 px grid track is `minmax(0, 1fr)` (a bare `1fr` has `min-width:auto`), `.terminal-column` gets `min-width: 0`, and the CodeMirror editor uses `EditorView.lineWrapping`.                                                                                                                                                                                                                                    | Found during M4 verification at 440 px: a 79-character CCL line widened the grid column to 659 px and scrolled the whole page sideways. M4's conditions and guards make long lines normal, so wrapping is the right editor behaviour regardless. Extends the 2026-08-06 narrow-viewport work; the desktop layout is unchanged (it already used `minmax(0, 1fr)`).                                                                                                                                                                      |
