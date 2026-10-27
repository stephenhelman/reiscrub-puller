// Validation rules for built-in presets. Used by presets.test.ts so a bad preset fails the
// test run; not part of the runtime bundle.
import { z } from 'zod';

export const PresetFilterSchema = z.looseObject({
  filterId: z.number().int(),
  // Shown in the panel as the checkbox label.
  label: z.string().min(1).max(200),
  operation: z.string(),
  data: z.record(z.string(), z.unknown()),
  // Premium filters are rejected; a missing flag is allowed.
  isPremiumFilter: z.literal(false).optional(),
});

// Strict: locations, includeLists, excludeLists, fields, resultSessionId, startRow/endRow and
// anything else not listed are rejected.
export const PresetSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
    description: z.string().min(1),
    filters: z.array(PresetFilterSchema).min(1),
    filterGroups: z.array(z.unknown()),
    // The user's captured policyFilters are always used, so presets must have none.
    policyFilters: z.array(z.unknown()).max(0),
  })
  .superRefine((p, ctx) => {
    const seen = new Set<number>();
    for (const f of p.filters) {
      if (seen.has(f.filterId)) ctx.addIssue({ code: 'custom', message: `duplicate filterId ${f.filterId}` });
      seen.add(f.filterId);
    }
  });

export const PresetListSchema = z.array(PresetSchema).superRefine((list, ctx) => {
  const ids = new Set<string>();
  for (const p of list) {
    if (ids.has(p.id)) ctx.addIssue({ code: 'custom', message: `duplicate preset id ${p.id}` });
    ids.add(p.id);
  }
});
