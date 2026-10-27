import { describe, expect, it } from 'vitest';
import { effectiveBody, mergeFilters } from './effective-body';
import { PRESETS, type Preset } from './presets';
import { PresetListSchema, PresetSchema } from './presets.schema';

const base = (over: Record<string, unknown> = {}) => ({
  id: 'x',
  name: 'X',
  description: 'd',
  filters: [{ filterId: 1, label: 'One', operation: 'contains_any', data: {} }],
  filterGroups: [],
  policyFilters: [],
  ...over,
});

describe('built-in presets', () => {
  it('all pass validation', () => {
    expect(PresetListSchema.safeParse(PRESETS).success).toBe(true);
  });

  it('cash-buyers is present with its description and 5 filters', () => {
    const p = PRESETS.find((x) => x.id === 'cash-buyers');
    expect(p?.name).toBe('Cash Buyers');
    expect(p?.description).toBe(
      'Active investors: individual or corporate owners of 3+ properties who bought single family in the last 2 years.',
    );
    expect(p?.filters.map((f) => f.filterId)).toEqual([431, 795, 29, 123, 775]);
  });
});

describe('preset validation', () => {
  it('accepts a minimal preset, with the premium flag missing or false', () => {
    expect(PresetSchema.safeParse(base()).success).toBe(true);
    const f = { filterId: 1, label: 'One', operation: 'o', data: {}, isPremiumFilter: false };
    expect(PresetSchema.safeParse(base({ filters: [f] })).success).toBe(true);
  });

  it('rejects premium filters', () => {
    const f = { filterId: 1, label: 'One', operation: 'o', data: {}, isPremiumFilter: true };
    expect(PresetSchema.safeParse(base({ filters: [f] })).success).toBe(false);
  });

  it.each([
    ['non-numeric filterId', { filterId: '1', label: 'L', operation: 'o', data: {} }],
    ['missing operation', { filterId: 1, label: 'L', data: {} }],
    ['non-object data', { filterId: 1, label: 'L', operation: 'o', data: 'x' }],
    ['array data', { filterId: 1, label: 'L', operation: 'o', data: [] }],
    ['missing label', { filterId: 1, operation: 'o', data: {} }],
  ])('rejects a filter with %s', (_n, f) => {
    expect(PresetSchema.safeParse(base({ filters: [f] })).success).toBe(false);
  });

  it.each(['locations', 'includeLists', 'excludeLists', 'fields', 'resultSessionId', 'startRow', 'endRow'])(
    'rejects a preset containing %s',
    (key) => {
      expect(PresetSchema.safeParse(base({ [key]: [] })).success).toBe(false);
    },
  );

  it('rejects policyFilters, duplicate filterIds and duplicate preset ids', () => {
    expect(PresetSchema.safeParse(base({ policyFilters: [{ filterId: 9 }] })).success).toBe(false);
    const f = { filterId: 1, label: 'One', operation: 'o', data: {} };
    expect(PresetSchema.safeParse(base({ filters: [f, f] })).success).toBe(false);
    expect(PresetListSchema.safeParse([base(), base()]).success).toBe(false);
  });
});

describe('merging with the user\'s filters', () => {
  const f = (id: number, v: unknown): Preset['filters'][number] => ({ filterId: id, label: `F${id}`, operation: 'o', data: { v } });
  const preset: Preset = {
    id: 'p',
    name: 'P',
    description: 'd',
    filters: [f(1, 'preset'), f(2, 'preset'), f(3, 'preset')],
    filterGroups: ['pg'],
    policyFilters: [],
  };

  it('keeps preset filters, user filters replace by filterId and new ones append', () => {
    const user = [f(2, 'user'), f(9, 'user')];
    const out = mergeFilters(preset, [], user);
    expect(out.map((x) => [x.filterId, (x.data as { v: string }).v])).toEqual([
      [1, 'preset'],
      [2, 'user'],
      [3, 'preset'],
      [9, 'user'],
    ]);
  });

  it('drops unchecked preset filters (a user filter with that id is then simply added)', () => {
    const out = mergeFilters(preset, [1, 2], [f(2, 'user')]);
    expect(out.map((x) => x.filterId)).toEqual([3, 2]);
  });

  it('tolerates a missing or odd user filter list', () => {
    expect(mergeFilters(preset, [], undefined)).toHaveLength(3);
    expect(mergeFilters(preset, [], [null, 5, 'x'])).toHaveLength(3);
  });

  it('concatenates filterGroups, keeps the user\'s policyFilters and everything else', () => {
    const body = effectiveBody(
      { filters: [f(9, 'u')], filterGroups: ['ug'], policyFilters: ['pol'], locations: ['loc'], fields: ['a'], startRow: 0 },
      preset,
      [],
    );
    expect(body.filterGroups).toEqual(['pg', 'ug']);
    expect(body.policyFilters).toEqual(['pol']);
    expect(body.locations).toEqual(['loc']);
    expect(body.fields).toEqual(['a']);
    expect((body.filters as unknown[]).length).toBe(4);
  });
});
