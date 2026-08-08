import { useState } from 'react';

import { TEMPLATES, type TemplateDef } from '../../content/templates.ts';
import { clampParam, renderTemplate, templateDefaults } from '../../core/templates.ts';
import { useGameStore } from '../session.ts';

/**
 * Template mode v0 (TDD §5.5, GDD §25): form controls that generate visible CCL.
 * The generated text goes straight into the editor buffer, so a player who
 * cannot write code still ships code — and can read and edit what it produced.
 */
export function TemplateLibrary({ onInsert }: { onInsert: (source: string) => void }) {
  const constructs = useGameStore((s) => s.snapshot.ccl.constructs);
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

  const preview = renderTemplate(selected, current);

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
                <span className="terminal-dim">{param.label}</span>
                <input
                  type="number"
                  value={current[param.id] ?? param.default}
                  min={param.min}
                  max={param.max}
                  step={param.step}
                  onChange={(e) => setValue(param.id, e.target.value)}
                  onBlur={() =>
                    setValue(
                      param.id,
                      String(clampParam(param, current[param.id] ?? param.default)),
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
