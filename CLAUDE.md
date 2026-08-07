# CLAUDE.md — working notes for BREAK//OUT

How to work in this repo. **Not** the design: `Docs/` is the single source of truth
([README](Docs/README.md) · [GDD](Docs/GameDesignDocument.md) ·
[TDD](Docs/TechnicalDesignDocument.md) · [Plan](Docs/ImplementationPlan.md)).
Read those at the start of a session; this file only covers the things that otherwise
have to be rediscovered every time.

## Environment

- Windows. **PowerShell 5.1** is the primary shell (a Bash tool is also available — each
  takes its own syntax; don't mix them).
- The repo path contains a `!`: `C:\Users\tomaa\Documents\!ClickerProgram`. Always quote it.
  Both shells handle it fine when quoted (bash history expansion is off in non-interactive
  shells, so `cd "/c/Users/tomaa/Documents/!ClickerProgram"` works) — but unquoted it will
  bite you, and some tools mangle it in globs.
- PowerShell wraps native-command stderr in red `NativeCommandError` blocks. A **successful**
  `npm run build` or `git push` still prints one (Vite writes its chunk-size warning to
  stderr; git writes progress there). Judge by `$LASTEXITCODE` and the actual output, not
  by the red text.

### Multi-line commit messages

Write the message to a file and use `git commit -F <file>`. That always works.

The failure mode to avoid is passing an **array** of strings to `-m`. PowerShell splats
array elements as separate arguments, so git reads lines 2..n as pathspecs:

```
git commit -m (Get-Content msg.txt)
# error: pathspec 'Body line' did not match any file(s) known to git
```

A genuine `@'…'@` here-string is a single string and does commit correctly (verified on
PowerShell 5.1.26100) — but its terminating `'@` must be at column 0, so it is fragile to
paste. `-F` avoids the whole question.

## Type checking — important

**`npm test` does not type-check.** Vitest transpiles without checking types. `npm run build`
runs `tsc -b` and is the only type gate — a change can have 100 passing tests and still fail
the build. **Always run `npm run build` before committing.**

TypeScript is strict, plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`
(`tsconfig.app.json`). Indexing an array or record yields `T | undefined`. Use `?? fallback`,
or `!` where an invariant guarantees presence — with a comment naming the invariant.

## Architecture rules (enforced by ESLint, see `eslint.config.js`)

Layering is `ui → core → ccl`, `core → content` (TDD §3):

- `/src/core`, `/src/ccl` and `/src/content` are pure: no `window`/`document`/`localStorage`,
  no `setTimeout`/`setInterval`/`requestAnimationFrame`, no `Math.random` (use the seeded
  PRNG), no React, no `any`.
- `/src/ccl` must not import from `/src/core` — the dependency runs core → ccl.
- **Nothing** imports from `/src/ui`.
- All tunable numbers live in `/src/content` — no balance literals in `/core`.

The UI talks to the sim only through the `GameEngine` facade and read-only snapshots.
Narrow exceptions (presentation-only imports of pure `/ccl` and static `/content` strings)
are recorded in the TDD Decision Log — extend that log rather than inventing new ones.

## Testing and playtesting

- `npm run dev` (or the `dev` config in `.claude/launch.json`, which auto-picks a port).
- Dev builds expose `window.__breakout.engine` for scripted testing from the console
  (`src/ui/session.ts`, stripped from production builds).
- The engine autosaves to `localStorage['breakout.save.v1']`. **Forcing state through the dev
  handle overwrites the playtest save** — back it up first and restore it afterwards.
- Check the layout at both desktop (~1280 px) and phone (~440 px) widths.

## Before you commit

All four must pass:

```bash
npm test && npm run lint && npm run format:check && npm run build
```

`format:check` and `lint` are **blocking gates on the deploy** (`.github/workflows/deploy.yml`).
A trivial formatting slip will fail the build job and block the playtest deploy; the fix is
`npm run format`.

## Deploy

Push to `main` → Actions → GitHub Pages → https://aevisisawesome.github.io/breakout-game/.

**A push does not guarantee a run.** Webhooks get dropped and queued jobs get cancelled during
GitHub incidents. After pushing, confirm a run exists **for your commit SHA** and succeeded:

```bash
gh run list --branch main --limit 5
```

and that the deployed site actually serves the new build. If no run appeared:

```bash
gh workflow run "Deploy to GitHub Pages" --ref main
```

Note `concurrency: group: pages, cancel-in-progress: true` — pushing twice in quick succession
cancels the first run, which is expected, not a failure.

## Docs

`Docs/` must be updated **in the same session** as the code it describes — this is a mandatory
policy, see [Docs/README.md](Docs/README.md). In practice:

- Architecture/stack/engine-behaviour change → TDD, and append to its **Decision Log**.
- Scope/mechanics/tone/platform change → GDD **Amendment Log** (never rewrite history).
- Task started/completed/blocked/re-scoped → ImplementationPlan status tables + **Change log**.
