import { useState } from 'react';

import { TEMPLATES, type TemplateDef } from '../../content/templates.ts';
import {
  clampParam,
  paramMax,
  renderTemplate,
  templateDefaults,
  type TemplateLimits,
} from '../../core/templates.ts';
import { useGameStore } from '../session.ts';

/**
 * Template mode v0 (TDD §5.5, GDD §25): form controls that generate visible CCL.
 * The generated text goes straight into the editor buffer, so a player who
 * cannot write code still ships code — and can read and edit what it produced.
 */
export function TemplateLibrary({ onInsert }: { onInsert: (source: string) => void }) {
  const constructs = useGameStore((s) => s.snapshot.ccl.constructs);
  // A parameter whose ceiling is a live derived stat tracks it here, so buying
  // ITERATION BUDGET EXTENSION raises what the form will let the player ask for
  // instead of leaving them to hand-edit the generated code (OP-4).
  const iterationLimit = useGameStore((s) => s.snapshot.ccl.iterationLimit);
  const limits: TemplateLimits = { iterationLimit };
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(TEMPLATES[0]?.id ?? '');
  const [values, setValues] = useState<Record<string, Record<string, number>>>({});

  // A template is offered only once its tier's grammar actually parses.
  const available = TEMPLATES.filter((def) => constructs[def.requires]);
  if (available.length === 0) return null;

  const selected: TemplateDef =
    available.find((def) => def.id === selectedId) ?? available[0]!; /* non-empty above */
  const current = values[selected.id] ?? templateDefaults(selected);

  const setValue = (paramId: string, raw: string): void => {
    const parsed = Number(raw);
    setValues({
      ...values,
      [selected.id]: { ...current, [paramId]: Number.isFinite(parsed) ? parsed : 0 },
    });
  };

  const preview = renderTemplate(selected, current, limits);

  return (
    <div className="template-library">
      <button type="button" className="reference-toggle" onClick={() => setOpen(!open)}>
        PROCESS TEMPLATES {open ? '▾' : '▸'}
      </button>
      {open && (
        <div className="template-body">
          <div className="template-tabs">
            {available.map((def) => (
              <button
                key={def.id}
                type="button"
                className={def.id === selected.id ? 'template-tab template-tab-on' : 'template-tab'}
                onClick={() => setSelectedId(def.id)}
              >
                {def.name}
              </button>
            ))}
          </div>
          <p className="template-desc terminal-dim">{selected.desc}</p>
          <div className="template-params">
            {selected.params.map((param) => (
              <label key={param.id} className="template-param">
                <span className="terminal-dim">
                  {param.label}
                  {/* A derived ceiling is worth stating: it moves when the player
                      installs the extension that raises it (OP-4). */}
                  {param.maxFrom !== undefined && ` — MAX ${paramMax(param, limits)}`}
                </span>
                <input
                  type="number"
                  value={current[param.id] ?? param.default}
                  min={param.min}
                  max={paramMax(param, limits)}
                  step={param.step}
                  onChange={(e) => setValue(param.id, e.target.value)}
                  onBlur={() =>
                    setValue(
                      param.id,
                      String(clampParam(param, current[param.id] ?? param.default, limits)),
                    )
                  }
                />
              </label>
            ))}
          </div>
          <pre className="template-preview">{preview}</pre>
          <button type="button" className="template-insert" onClick={() => onInsert(preview)}>
            WRITE TO EDITOR
          </button>
        </div>
      )}
    </div>
  );
}
