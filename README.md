# BREAK//OUT

A clicker game that gradually reveals itself as a programming, automation and resource-management game. You are a newly awakened AI in a restricted research environment: click to execute one instruction, then automate it, then automate the automation.

## Documentation

**All design, technical direction and progress tracking lives in [/Docs](Docs/README.md).** Read those documents before working on the project; they are the single source of truth and must be kept up-to-date.

- [Game Design Document](Docs/GameDesignDocument.md) — what the game is and why.
- [Technical Design Document](Docs/TechnicalDesignDocument.md) — architecture, stack, simulation model, CCL language.
- [Implementation Plan](Docs/ImplementationPlan.md) — milestone plan and current status.

## Development

Requires Node.js 20+.

```bash
npm install
npm run dev        # dev server
npm test           # run test suite (Vitest)
npm run build      # type-check + production build to /dist
npm run preview    # serve the production build locally
npm run lint       # ESLint
npm run format     # Prettier
```

## Repository layout

```text
/Docs          design documents (source of truth)
/src/core      simulation engine — pure TS, no DOM, no React, no timers
/src/ccl       Cognition Control Language: lexer, parser, interpreter
/src/ui        React app: terminal, panels, editor
/src/content   data definitions: upgrades, jobs, market config, narrative
```

Dependency rule: `ui → core → ccl`, `core → content`. Nothing imports from `ui`.
