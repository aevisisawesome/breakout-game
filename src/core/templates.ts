/**
 * Template rendering (TDD §5.5). Templates live in /content as CCL text with
 * `{{param}}` placeholders; this is the only logic involved — substitution and
 * clamping of the player's chosen values. All modes produce CCL text, which is
 * the contract that keeps block mode addable later.
 *
 * A parameter's ceiling may be a fixed number or a live derived stat (OP-4), so
 * every entry point takes the current limits. The functions stay pure: the
 * limits are passed in, never read from a snapshot here.
 */

import type { TemplateDef, TemplateParam } from '../content/templates.ts';

/**
 * Live ceilings a template parameter may be bound to. One field per
 * `TemplateLimitKey`; the caller reads them from the snapshot.
 */
export interface TemplateLimits {
  /** Largest `range(n)` the parser currently accepts — `CclView.iterationLimit`. */
  readonly iterationLimit: number;
}

/** The ceiling in force for a parameter right now: derived if it names one, declared otherwise. */
export function paramMax(param: TemplateParam, limits: TemplateLimits): number {
  return param.maxFrom === undefined ? param.max : limits[param.maxFrom];
}

/** Clamp to the range in force and snap to the declared step. */
export function clampParam(param: TemplateParam, value: number, limits: TemplateLimits): number {
  if (!Number.isFinite(value)) return param.default;
  const steps = Math.round((value - param.min) / param.step);
  const snapped = param.min + steps * param.step;
  const bounded = Math.min(paramMax(param, limits), Math.max(param.min, snapped));
  // Snapping can leave binary-float dust (0.5 steps); round to the step's precision.
  const decimals = (String(param.step).split('.')[1] ?? '').length;
  return Number(bounded.toFixed(decimals));
}

/** Default values for a template's form, keyed by param id. */
export function templateDefaults(def: TemplateDef): Record<string, number> {
  const values: Record<string, number> = {};
  for (const param of def.params) values[param.id] = param.default;
  return values;
}

/**
 * Render a template to CCL source. Missing or out-of-range values fall back to
 * the declared default/bounds, so a malformed form can never emit broken code.
 */
export function renderTemplate(
  def: TemplateDef,
  values: Record<string, number>,
  limits: TemplateLimits,
): string {
  let source = def.source;
  for (const param of def.params) {
    const value = clampParam(param, values[param.id] ?? param.default, limits);
    source = source.split(`{{${param.id}}}`).join(String(value));
  }
  return source;
}
