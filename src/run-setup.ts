// Turns the user's captured search plus the panel's list-type selection into the Template a
// run replays. Kept apart from the MAIN-world entrypoint so it can be tested.
import type { Template } from './collector';
import { effectiveBody } from './effective-body';
import { getPreset } from './presets';
import { searchKeyOf } from './searchkey';

export type CapturedTemplate = Omit<Template, 'searchKey' | 'presetId' | 'managedSession'>;

/**
 * No preset: the captured body is replayed unchanged. With a preset: the merged body, and the
 * search key is computed from it, so it covers the location, the user's filters and which
 * preset filters were unchecked. Null when the preset id is unknown.
 */
export function buildTemplate(c: CapturedTemplate, presetId: string | null, excluded: readonly number[]): Template | null {
  const preset = getPreset(presetId);
  if (presetId !== null && !preset) return null;
  const body = preset ? effectiveBody(c.body, preset, excluded) : c.body;
  return { ...c, body, searchKey: searchKeyOf(body), presetId, managedSession: preset !== null };
}
