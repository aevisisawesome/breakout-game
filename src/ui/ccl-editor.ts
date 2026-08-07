/**
 * CodeMirror 6 wiring for the CCL editor (TDD §2, §5.5): syntax highlighting,
 * live diagnostics, unlock-gated autocomplete, terminal-aesthetic theme.
 * Uses the /ccl lexer keywords + parser purely for presentation — execution
 * only ever flows through the GameEngine facade (RUN_SCRIPT).
 */

import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { linter, type Diagnostic } from '@codemirror/lint';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

import { KEYWORDS } from '../ccl/lexer.ts';
import { parse } from '../ccl/parser.ts';
import type { CclApiCommandView, CclApiStatView } from '../core/types.ts';

// ---------------------------------------------------------------------------
// Syntax highlighting (line-based stream tokenizer; mirrors /ccl/lexer.ts rules)

const cclStream = StreamLanguage.define({
  token(stream) {
    if (stream.match(/^#.*/)) return 'comment';
    if (stream.eatSpace()) return null;
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return 'string';
    if (stream.match(/^\d+(?:\.\d+)?/)) return 'number';
    if (stream.match(/^[A-Za-z_]\w*/)) {
      const word = stream.current();
      if ((KEYWORDS as readonly string[]).includes(word)) return 'keyword';
      if (stream.peek() === '.') return 'namespace';
      return 'variableName';
    }
    if (stream.match(/^\.[A-Za-z_]\w*/)) return 'propertyName';
    stream.next();
    return 'operator';
  },
});

const cclHighlight = HighlightStyle.define([
  { tag: tags.comment, color: 'var(--term-dim)', fontStyle: 'italic' },
  { tag: tags.keyword, color: 'var(--term-bright)' },
  { tag: tags.string, color: 'var(--term-fg)' },
  { tag: tags.number, color: 'var(--term-bright)' },
  { tag: tags.namespace, color: 'var(--term-bright)' },
  { tag: tags.propertyName, color: 'var(--term-fg)' },
  { tag: tags.variableName, color: 'var(--term-fg)' },
  { tag: tags.operator, color: 'var(--term-dim)' },
]);

const cclTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'var(--term-panel)',
      color: 'var(--term-fg)',
      fontSize: '13px',
    },
    '.cm-content': {
      fontFamily: 'var(--term-font)',
      caretColor: 'var(--term-fg)',
      padding: '0.5rem 0',
    },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--term-fg)' },
    '&.cm-focused': { outline: 'none' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, ::selection': {
      backgroundColor: 'var(--term-border)',
    },
    '.cm-gutters': {
      backgroundColor: 'var(--term-panel)',
      color: 'var(--term-dim)',
      border: 'none',
      borderRight: '1px solid var(--term-border)',
    },
    '.cm-activeLine': { backgroundColor: 'rgba(200, 250, 204, 0.04)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--term-fg)' },
    '.cm-lintRange-error': {
      backgroundImage: 'none',
      textDecoration: 'underline wavy var(--term-error) 1px',
    },
    '.cm-tooltip': {
      backgroundColor: 'var(--term-panel)',
      color: 'var(--term-fg)',
      border: '1px solid var(--term-border)',
      fontFamily: 'var(--term-font)',
      fontSize: '12px',
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: 'var(--term-border)',
      color: 'var(--term-bright)',
    },
    '.cm-completionDetail': { color: 'var(--term-dim)', fontStyle: 'normal' },
  },
  { dark: true },
);

// ---------------------------------------------------------------------------
// Live diagnostics: re-parse the buffer with the real CCL parser (no execution).

function cclLinter(constructs: () => CclConstructs) {
  return linter((view) => {
    const source = view.state.doc.toString();
    const { conditions, scheduling } = constructs();
    const { diagnostics } = parse(source, { conditions, scheduling });
    const max = source.length;
    return diagnostics.map((d): Diagnostic => ({
      from: Math.min(d.from, max),
      to: Math.max(Math.min(d.to, max), Math.min(d.from, max)),
      severity: 'error',
      message: d.message,
    }));
  });
}

// ---------------------------------------------------------------------------
// Autocomplete fed by the unlock-gated API registry (via snapshot).

export interface CclApiSource {
  stats: readonly CclApiStatView[];
  commands: readonly CclApiCommandView[];
}

/** Language tiers the player has unlocked (snapshot `ccl.constructs`). */
export interface CclConstructs {
  conditions: boolean;
  scheduling: boolean;
}

/** Keyword completions per tier, so the list never offers a locked construct. */
const TIER_KEYWORDS: Readonly<Record<keyof CclConstructs, readonly string[]>> = {
  conditions: ['if', 'else', 'and', 'or', 'not'],
  scheduling: ['every', 'when', 'seconds', 'ticks'],
};

function cclCompletion(api: () => CclApiSource, constructs: () => CclConstructs) {
  return autocompletion({
    override: [
      (context: CompletionContext): CompletionResult | null => {
        const word = context.matchBefore(/[\w.]+/);
        if (word === null && !context.explicit) return null;
        const { stats, commands } = api();
        const tiers = constructs();
        const keywords = (Object.keys(TIER_KEYWORDS) as (keyof CclConstructs)[])
          .filter((tier) => tiers[tier])
          .flatMap((tier) => TIER_KEYWORDS[tier]);
        return {
          from: word?.from ?? context.pos,
          options: [
            ...stats.map((s) => ({ label: s.name, type: 'property', info: s.desc })),
            ...commands.map((c) => ({
              label: c.name,
              type: 'function',
              detail: c.signature,
              info:
                c.computeCost > 0 ? `${c.desc} Costs ${c.computeCost} compute per call.` : c.desc,
            })),
            ...keywords.map((label) => ({ label, type: 'keyword' })),
          ],
          validFor: /^[\w.]*$/,
        };
      },
    ],
  });
}

/**
 * Full extension set for the CCL editor. `api` and `constructs` are read lazily
 * so newly unlocked tiers apply to highlighting, linting and completion at once.
 */
export function cclExtensions(api: () => CclApiSource, constructs: () => CclConstructs) {
  return [
    cclStream,
    syntaxHighlighting(cclHighlight),
    cclTheme,
    cclLinter(constructs),
    cclCompletion(api, constructs),
  ];
}
