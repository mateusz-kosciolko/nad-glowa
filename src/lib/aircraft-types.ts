// Shared by the aircraft types search endpoint and the type picker island: no server-only imports here.

export interface AircraftType {
  code: string;
  name: string;
}

export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LENGTH = 40;
export const SEARCH_LIMIT = 20;

// The normalized query goes straight into PostgREST `ilike` filters, where `%`, `_` or `*` would act as wildcards
// (and `,`, `(`, `)`, `.` would break a filter string). Only this whitelist may ever reach a filter.
const QUERY_PATTERN = /^[A-Za-z0-9 \-/]+$/;

export function normalizeTypeQuery(raw: string): string | null {
  const query = raw.trim().replace(/\s+/g, " ");
  if (query.length < SEARCH_MIN_LENGTH || query.length > SEARCH_MAX_LENGTH) {
    return null;
  }
  return QUERY_PATTERN.test(query) ? query : null;
}

// Exact code first, then code prefix, then name match; within a group by code ascending. Types matching none of
// these are dropped.
export function rankAircraftTypes(query: string, types: AircraftType[]): AircraftType[] {
  const needle = query.toUpperCase();
  const rank = ({ code, name }: AircraftType): number => {
    const upperCode = code.toUpperCase();
    if (upperCode === needle) return 0;
    if (upperCode.startsWith(needle)) return 1;
    if (name.toUpperCase().includes(needle)) return 2;
    return -1;
  };

  return types
    .map((type) => ({ type, rank: rank(type) }))
    .filter(({ rank: value }) => value >= 0)
    .sort((a, b) => a.rank - b.rank || (a.type.code < b.type.code ? -1 : a.type.code > b.type.code ? 1 : 0))
    .slice(0, SEARCH_LIMIT)
    .map(({ type }) => type);
}
