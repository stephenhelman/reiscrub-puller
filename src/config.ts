export interface PacingConfig {
  /** Jittered delay between pages when the budget is healthy. */
  minDelayMs: number;
  maxDelayMs: number;
  /** Exponential backoff: base * 2^n, capped, with +/- jitterRatio. */
  backoffBaseMs: number;
  backoffCapMs: number;
  jitterRatio: number;
  /** Throttle when userTokensRemaining <= this. */
  lowUserTokens: number;
  /** Throttle when organizationRemainingThisMinute <= this. */
  lowOrgRemaining: number;
  /** Retries on HTTP 429 / 5xx / network error before the run stops. */
  maxRetries: number;
}

export interface AppConfig {
  /** Matched against the request URL to find the search call. */
  endpointPattern: RegExp;
  /** Requests to this host suffix + path prefix refresh the replay auth headers. */
  apiHostSuffix: string;
  apiPathPrefix: string;
  /** Body keys that define which properties a search matches (used to guard Resume). */
  searchIdentityKeys: string[];
  /** Used only when neither the response nor the request reveals a page size. */
  defaultPageSize: number;
  pacing: PacingConfig;
  /** First line of the clipboard payload. */
  payloadHeader: string;
  limits: {
    maxLineLength: number;
    maxRecordsPerMessage: number;
  };
}

export const DEFAULT_CONFIG: AppConfig = {
  endpointPattern: /\/api\/search\/map-properties(?:[?#]|$)/,
  apiHostSuffix: 'dealmachine.com',
  apiPathPrefix: '/api/',
  searchIdentityKeys: ['filters', 'filterGroups', 'policyFilters', 'locations', 'includeLists', 'excludeLists'],
  defaultPageSize: 25,
  pacing: {
    minDelayMs: 1200,
    maxDelayMs: 2500,
    backoffBaseMs: 3000,
    backoffCapMs: 60_000,
    jitterRatio: 0.25,
    lowUserTokens: 1,
    lowOrgRemaining: 2,
    maxRetries: 3,
  },
  payloadHeader: 'REISCRUB:v1:dealmachine',
  limits: {
    maxLineLength: 500,
    maxRecordsPerMessage: 1000,
  },
};

// REMOTE CONFIG HOOK (not implemented in phase 1).
// Later: fetch a signed/validated (Zod) partial config from a REIscrub URL and
// merge it over DEFAULT_CONFIG. Until then this always returns the bundled defaults.
export function getConfig(): AppConfig {
  return DEFAULT_CONFIG;
}

export const CONFIG = getConfig();
