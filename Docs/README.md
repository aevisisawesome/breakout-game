# BREAK//OUT — Project Documentation

This folder is the single source of truth for the design, technical direction and progress of **BREAK//OUT**.

## Documents

| Document | Purpose |
| --- | --- |
| [GameDesignDocument.md](GameDesignDocument.md) | Original purpose and full game design. The "why" and "what" of the game. |
| [TechnicalDesignDocument.md](TechnicalDesignDocument.md) | Technical design paradigm: architecture, stack, simulation model, CCL language design. The "how". |
| [ImplementationPlan.md](ImplementationPlan.md) | Milestone plan and progress tracker for the first playable prototype. The "when" and "current status". |

## ⚠️ Documentation maintenance policy (mandatory)

**These documents must be kept up-to-date throughout the life of the project.** They exist to track:

1. **Original purpose** — what the game is meant to be (GameDesignDocument.md).
2. **Technical design paradigm** — how the software is structured and why (TechnicalDesignDocument.md).
3. **Progress** — what has been built, what is in flight, what is next (ImplementationPlan.md).

Rules:

- Any change to gameplay scope, mechanics, tone, or platform targets must be reflected in the **Game Design Document** (use the Amendment Log; do not silently rewrite history).
- Any change to architecture, stack, data model, or engine behaviour must be reflected in the **Technical Design Document** in the same commit/work session as the code change.
- The **Implementation Plan** status tables must be updated whenever a task is started, completed, blocked, or re-scoped.
- When a new document is added to this folder, add it to the table above.
- Anyone (human or AI assistant) working on this project should read these documents at the start of a session and update them at the end of one.
