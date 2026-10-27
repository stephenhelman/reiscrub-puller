// Built-in list presets. Bundled with the extension; there is no remote config, user-created
// presets, import/export or storage of presets. The filter objects are DealMachine's own,
// captured from real search requests, and are stored VERBATIM: the server consumes them as-is.
// Only filters / filterGroups / policyFilters live here; location and everything else always
// comes from the user's own captured search. Rules are enforced in presets.test.ts.

export type PresetFilter = Record<string, unknown> & { filterId: number; label: string };

export interface Preset {
  id: string;
  name: string;
  description: string;
  filters: PresetFilter[];
  filterGroups: unknown[];
  /** Must be empty: the user's captured policyFilters are always used. */
  policyFilters: never[];
}

// SLOT: "motivated-sellers" (name "Motivated Sellers"), description:
//   "Off-market single family, individually owned, under $300k value, 30%+ equity, last sold
//    before 2021. Built for markets where most SFR is under $300k."
// Add its captured filters here and append it to PRESETS below.

const CASH_BUYERS: Preset = {
  id: 'cash-buyers',
  name: 'Cash Buyers',
  description: 'Active investors: individual or corporate owners of 3+ properties who bought single family in the last 2 years.',
  filters: [
    {
      filterId: 431,
      slug: 'ownership_entity_type',
      defaultColumnAlias: 'ownership_entity_type',
      label: 'Ownership Entity Type',
      description:
        'Categorical type of the owning entity from county ownership records: individual, corporate, trust, bank, or government. Use this when the user names a specific entity kind or wants to include/exclude several at once. For simple boolean requests prefer the dedicated flags: is_corporate_owned for companies, is_owned_by_trust for trusts, is_bank_owned for lender-held REO.',
      useCaseDescriptions:
        'Use it when a user distinguishes among entity kinds: "government owned parcels", "individually owned only, no companies or trusts", "banks and corporations". Multi-select, so it handles exclusion lists cleanly (for example, everything except government and bank owned). Disambiguation: "LLC owned" or "company owned" alone maps to is_corporate_owned; "trust owned" maps to is_owned_by_trust; "REO" or "bank owned" as a distress concept maps to is_bank_owned rather than the bank option here. Reach for this field when the request needs the full category breakdown rather than one yes/no flag.',
      type: 'MULTI_SELECT',
      subtype: null,
      source_type: 'properties',
      options: [
        { id: 4, label: 'Bank' },
        { id: 2, label: 'Corporation' },
        { id: 5, label: 'Government' },
        { id: 1, label: 'Individual' },
        { id: 3, label: 'Trust' },
      ],
      data: {
        selectedItems: [
          { id: 2, label: 'Corporation' },
          { id: 1, label: 'Individual' },
        ],
      },
      fieldGroup: { id: 8, title: 'Ownership', slug: 'owner_type', pinned: true, featured: false },
      displayOrder: null,
      defaultOperation: null,
      isPremiumFilter: false,
      aliases: ['entity type', 'owner type', 'ownership type', 'owner category'],
      searchTerms: ['entity', 'individual', 'government owned', 'ownership structure'],
      optionSearchMetadata: null,
      searchMetadata: {
        aliases: ['entity type', 'owner type', 'ownership type', 'owner category'],
        searchTerms: ['entity', 'individual', 'government owned', 'ownership structure'],
        options: null,
      },
      bigQueryDestinationTable: 'dm_analytics.property_wide_facts',
      bigQueryDestinationTableColumn: 'property_ownership_entity_type_id',
      bigQueryReferenceDisplayColumn: 'property_ownership_entity_type_name',
      operation: 'contains_any',
    },
    {
      filterId: 795,
      slug: 'ppm_num_properties_owned_by_owner',
      defaultColumnAlias: 'ppm_num_properties_owned_by_owner',
      label: 'Number of Properties Owned',
      description:
        "Count of properties linked to the same owner in DealMachine's ownership graph, shown on the matched owner of the property. Measures portfolio size across the data set, not just holdings in the searched area. Use it to filter properties by how many the owner holds; for entity ownership use is_corporate_owned.",
      useCaseDescriptions:
        'Use it when portfolio size matters: "owners with 5+ properties" finds professional landlords and portfolio sellers, "owners with exactly 1 property" isolates single-property owners such as accidental landlords or homeowners. Wholesalers use high counts to source multi-property packages; property managers prospect mid-size portfolios. Combine with has_absentee_owners or has_tired_landlords for motivated-landlord lists. The count comes from DealMachine\'s ownership linking, so entities holding each property in a separate LLC may show smaller counts than the true portfolio.',
      type: 'NUMBER',
      subtype: null,
      source_type: 'PPM',
      options: null,
      data: { value: 3 },
      fieldGroup: { id: 64, title: 'Owner Demographics', slug: 'owner_demographics', pinned: true, featured: false },
      displayOrder: null,
      defaultOperation: null,
      isPremiumFilter: false,
      aliases: ['properties owned', 'portfolio size', 'number of properties', 'multi property owner'],
      searchTerms: ['portfolio', 'landlord', 'holdings', 'investor'],
      optionSearchMetadata: null,
      searchMetadata: {
        aliases: ['properties owned', 'portfolio size', 'number of properties', 'multi property owner'],
        searchTerms: ['portfolio', 'landlord', 'holdings', 'investor'],
        options: null,
      },
      bigQueryDestinationTable: 'dm_analytics.property_people_matches',
      bigQueryDestinationTableColumn: 'ppm_num_properties_owned_by_owner',
      operation: 'greater_than_or_equal',
    },
    {
      filterId: 29,
      slug: 'property_type_id',
      defaultColumnAlias: 'property_type',
      label: 'Property Type',
      description:
        "DealMachine's normalized property type, mapped from county assessor use codes. Options include Single Family, Townhouse, Condominium, Mobile Home, Multi Family, Vacant Land, Co-Op, Apartment, Office, Retail, Industrial, Hospitality, Healthcare, Mixed Use, Special Purpose, Government / Institutional, Agriculture, Development Site, and Other. The main type filter for property searches.",
      useCaseDescriptions:
        'Use it for any property-category request: \'single family homes\' (Single Family), \'vacant land\' or \'lots\' (Vacant Land), \'mobile homes\' (Mobile Home), \'commercial\' (Office, Retail, Industrial, and related types). For \'duplex\', \'triplex\', or any unit-count request, use num_units instead of or alongside Multi Family, since the type alone does not separate a duplex from a large apartment building. For assessor tax categories like Exempt use property_class.',
      type: 'MULTI_SELECT',
      subtype: null,
      source_type: 'properties',
      options: [
        { id: 19, label: 'Agriculture' },
        { id: 9, label: 'Apartment' },
        { id: 8, label: 'Co-Op' },
        { id: 3, label: 'Condominium' },
        { id: 20, label: 'Development Site' },
        { id: 18, label: 'Government / Institutional' },
        { id: 15, label: 'Healthcare' },
        { id: 14, label: 'Hospitality' },
        { id: 13, label: 'Industrial' },
        { id: 16, label: 'Mixed Use' },
        { id: 4, label: 'Mobile Home' },
        { id: 5, label: 'Multi Family' },
        { id: 11, label: 'Office' },
        { id: 10, label: 'Other' },
        { id: 12, label: 'Retail' },
        { id: 1, label: 'Single Family' },
        { id: 17, label: 'Special Purpose' },
        { id: 2, label: 'Townhouse' },
        { id: 6, label: 'Vacant Land' },
      ],
      data: { selectedItems: [{ id: 1, label: 'Single Family' }] },
      fieldGroup: { id: 29, title: 'Property Type', slug: 'property_type', pinned: true, featured: false },
      displayOrder: null,
      defaultOperation: null,
      isPremiumFilter: false,
      aliases: ['property type', 'single family', 'vacant land', 'mobile home', 'commercial', 'condo'],
      searchTerms: ['type', 'category', 'residential', 'land'],
      optionSearchMetadata: null,
      searchMetadata: {
        aliases: ['property type', 'single family', 'vacant land', 'mobile home', 'commercial', 'condo'],
        searchTerms: ['type', 'category', 'residential', 'land'],
        options: null,
      },
      bigQueryDestinationTable: 'dm_analytics.property_wide_facts',
      bigQueryDestinationTableColumn: 'property_type_id',
      bigQueryReferenceDisplayColumn: 'property_type_name',
      operation: 'contains_any',
    },
    {
      filterId: 123,
      slug: 'last_sale_date',
      defaultColumnAlias: 'last_sale_date',
      label: 'Last sale date',
      description:
        "Date of the property's most recent recorded sale, from county deed records and MLS sale data combined. Marks the start of the current owner's tenure.",
      useCaseDescriptions:
        "Ownership-length screens are bread and butter: 'owned more than 10 years' finds equity-rich, long-tenure sellers; 'sold in the last 6 months' finds new owners and disqualifies them from motivated-seller outreach. Also anchors comp recency when pulling comparable sales. Users say 'last sold', 'purchase date', 'owned since'. The boolean shortcut for the past year is is_recently_sold; the price paid is last_sale_price.",
      type: 'DATE',
      subtype: null,
      source_type: 'properties',
      options: null,
      data: { relativeTime: { comparison: 'less_than', value: 2, unit: 'years', direction: 'ago' } },
      fieldGroup: { id: 12, title: 'Sale History', slug: 'sale_history', pinned: true, featured: false },
      displayOrder: null,
      defaultOperation: null,
      isPremiumFilter: false,
      aliases: ['sale date', 'last sold', 'purchase date', 'date sold'],
      searchTerms: ['sold', 'sale', 'ownership length', 'tenure'],
      optionSearchMetadata: null,
      searchMetadata: {
        aliases: ['sale date', 'last sold', 'purchase date', 'date sold'],
        searchTerms: ['sold', 'sale', 'ownership length', 'tenure'],
        options: null,
      },
      bigQueryDestinationTable: 'dm_analytics.property_wide_facts',
      bigQueryDestinationTableColumn: 'last_sale_date',
      operation: 'relative_time',
    },
    {
      filterId: 775,
      label: 'Likely Owner',
      type: 'BOOLEAN',
      operation: 'is_boolean',
      data: { value: 'yes' },
      source_type: 'PPM',
      fieldGroup: { id: -1, title: 'Owner Demographics', slug: 'owner_demographics', featured: false, pinned: false },
    },
  ],
  filterGroups: [],
  policyFilters: [],
};

export const PRESETS: readonly Preset[] = [CASH_BUYERS];

export function getPreset(id: string | null): Preset | null {
  return id === null ? null : (PRESETS.find((p) => p.id === id) ?? null);
}
