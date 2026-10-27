// Builds the request body a preset run sends. A preset MERGES with the user's captured
// search: it is the starting point, and the user's on-screen filters override or add to it.
import type { Preset } from './presets';

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const idOf = (f: Obj): number | null => (typeof f.filterId === 'number' ? f.filterId : null);

/** Preset filters minus the unchecked ones; then the user's filters replace by filterId or append. */
export function mergeFilters(preset: Preset, excluded: readonly number[], userFilters: unknown): Obj[] {
  const skip = new Set(excluded);
  const out: Obj[] = [];
  const at = new Map<number, number>();
  const put = (f: Obj) => {
    const id = idOf(f);
    const i = id === null ? undefined : at.get(id);
    if (i !== undefined) {
      out[i] = f;
      return;
    }
    if (id !== null) at.set(id, out.length);
    out.push(f);
  };
  for (const f of preset.filters) if (!skip.has(f.filterId)) put(f);
  if (Array.isArray(userFilters)) for (const f of userFilters) if (isObj(f)) put(f);
  return out;
}

/**
 * filters: merged (above). filterGroups: preset's then the user's. policyFilters: the user's
 * (presets have none). Every other key, including the location, comes from the user's search.
 */
export function effectiveBody(base: Obj, preset: Preset, excluded: readonly number[]): Obj {
  const userGroups = Array.isArray(base.filterGroups) ? base.filterGroups : [];
  return {
    ...base,
    filters: mergeFilters(preset, excluded, base.filters),
    filterGroups: [...preset.filterGroups, ...userGroups],
  };
}
