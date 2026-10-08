import React, { useEffect, useId, useRef, useState } from "react";
import { Check, Plus, Search, X } from "lucide-react";
import { normalizeTypeQuery, type AircraftType } from "@/lib/aircraft-types";
import { ICAO_TYPE_PATTERN, MAX_AIRCRAFT_TYPES } from "@/lib/alert-settings";
import { cn } from "@/lib/utils";

interface Props {
  selected: string[];
  onChange: (codes: string[]) => void;
  featuredTypes: AircraftType[];
  typeNames: Record<string, string>;
  featuredUnavailable?: boolean;
}

type SearchStatus = "idle" | "searching" | "done" | "error";

interface SearchAnswer {
  query: string;
  status: "done" | "error";
  types: AircraftType[];
}

const SEARCH_DELAY_MS = 250;

const hintClass = "text-xs text-blue-100/50";
const optionClass =
  "flex w-full min-w-0 items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-left text-sm transition-colors hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white/10";

function isAircraftTypeList(value: unknown): value is AircraftType[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as Record<string, unknown>).code === "string" &&
        typeof (item as Record<string, unknown>).name === "string",
    )
  );
}

// The endpoint answers { types } on success; a redirect (expired session), an HTTP error or another shape is an error.
async function searchAircraftTypes(query: string, signal: AbortSignal): Promise<AircraftType[]> {
  const response = await fetch(`/api/aircraft-types?q=${encodeURIComponent(query)}`, {
    redirect: "manual",
    headers: { Accept: "application/json" },
    signal,
  });
  if (response.type === "opaqueredirect" || response.redirected || !response.ok) {
    throw new Error(`Search failed with status ${String(response.status)}`);
  }
  const body: unknown = await response.json();
  const types = typeof body === "object" && body !== null ? (body as Record<string, unknown>).types : undefined;
  if (!isAircraftTypeList(types)) {
    throw new Error("Unexpected search response");
  }
  return types;
}

export function AircraftTypePicker({
  selected,
  onChange,
  featuredTypes,
  typeNames,
  featuredUnavailable = false,
}: Props) {
  const searchId = useId();
  const legendId = useId();
  const [query, setQuery] = useState("");
  // The last answered search; the status shown is derived from it, so a newer query reads as "searching" until its
  // own answer arrives.
  const [answer, setAnswer] = useState<SearchAnswer | null>(null);
  // Names learned from search results, so a chip shows its name without asking the endpoint again.
  const [learnedNames, setLearnedNames] = useState<Record<string, string>>({});
  const latestRequest = useRef(0);
  // The query of `answer`, readable in the effect without making it a dependency.
  const answeredQuery = useRef<string | null>(null);

  const normalized = normalizeTypeQuery(query);

  useEffect(() => {
    const requestId = ++latestRequest.current;
    // Going back to the query already answered (c17 → c1 → c17) reuses that answer instead of fetching it again.
    if (normalized === null || normalized === answeredQuery.current) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchAircraftTypes(normalized, controller.signal).then(
        (types) => {
          // A response to an older query is ignored.
          if (requestId !== latestRequest.current) return;
          answeredQuery.current = normalized;
          setAnswer({ query: normalized, status: "done", types });
        },
        () => {
          if (requestId !== latestRequest.current) return;
          answeredQuery.current = null;
          setAnswer({ query: normalized, status: "error", types: [] });
        },
      );
    }, SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [normalized]);

  let status: SearchStatus = "idle";
  let results: AircraftType[] = [];
  if (normalized !== null) {
    if (answer?.query === normalized) {
      status = answer.status;
      results = answer.types;
    } else {
      status = "searching";
    }
  }

  const names: Record<string, string> = { ...typeNames, ...learnedNames };
  for (const { code, name } of featuredTypes) {
    names[code] ??= name;
  }

  const selectedSet = new Set(selected);
  const atLimit = selected.length >= MAX_AIRCRAFT_TYPES;

  function add(code: string, name?: string) {
    if (selectedSet.has(code) || atLimit) return;
    if (name !== undefined) {
      setLearnedNames((current) => ({ ...current, [code]: name }));
    }
    onChange([...selected, code]);
  }

  function remove(code: string) {
    onChange(selected.filter((item) => item !== code));
  }

  function toggle(type: AircraftType) {
    if (selectedSet.has(type.code)) {
      remove(type.code);
    } else {
      add(type.code, type.name);
    }
  }

  function addFromSearch(code: string, name?: string) {
    add(code, name);
    setQuery("");
  }

  // "Add code XXXX" for a valid ICAO code the dictionary did not return (only once the search has answered).
  const typedCode = query.trim().toUpperCase();
  const showAddCode =
    (status === "done" || status === "error") &&
    ICAO_TYPE_PATTERN.test(typedCode) &&
    !results.some(({ code }) => code === typedCode);

  const actionable: { code: string; name?: string }[] = [
    ...results.filter(({ code }) => !selectedSet.has(code)),
    ...(showAddCode && !selectedSet.has(typedCode) ? [{ code: typedCode }] : []),
  ];

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    // Enter in the search field never submits the settings form.
    e.preventDefault();
    if (!atLimit && actionable.length === 1) {
      const [only] = actionable;
      addFromSearch(only.code, only.name);
    }
  }

  let statusMessage = "";
  if (status === "searching") {
    statusMessage = "Searching…";
  } else if (status === "error") {
    statusMessage = "Search is unavailable right now";
  } else if (status === "done" && results.length === 0) {
    statusMessage = "No matching types";
  }

  return (
    <fieldset className="m-0 min-w-0 border-0 p-0" aria-labelledby={legendId}>
      <input type="hidden" name="aircraft_types" value={selected.join(",")} />
      <span id={legendId} className="mb-1 block text-sm text-blue-100/80">
        Aircraft types
      </span>

      <div className="space-y-3">
        <div>
          <p className={cn(hintClass, "mb-1")}>Highlighted</p>
          {featuredUnavailable ? (
            <p className={hintClass}>
              Type names and highlighted types are unavailable right now. You can still search below.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {featuredTypes.map((type) => {
                const pressed = selectedSet.has(type.code);
                return (
                  <button
                    key={type.code}
                    type="button"
                    aria-pressed={pressed}
                    disabled={!pressed && atLimit}
                    onClick={() => {
                      toggle(type);
                    }}
                    className={cn(
                      "inline-flex max-w-full min-w-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 disabled:cursor-not-allowed disabled:opacity-50",
                      pressed
                        ? "border-purple-300/60 bg-purple-500/30 text-white hover:bg-purple-500/40"
                        : "border-white/20 bg-white/10 text-blue-100/80 hover:bg-white/20",
                    )}
                  >
                    {pressed && <Check className="size-3 shrink-0" aria-hidden="true" />}
                    <span className="min-w-0 truncate">
                      {type.name} · {type.code}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <label htmlFor={searchId} className={cn(hintClass, "mb-1 block")}>
            Search by code or name
          </label>
          <div className="relative">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-white/40" aria-hidden="true" />
            {/* No `name`: the hidden field above is the only carrier of the selected types. */}
            <input
              id={searchId}
              type="text"
              autoComplete="off"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
              }}
              onKeyDown={handleSearchKeyDown}
              placeholder="e.g. C17 or Globemaster"
              className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 pl-10 text-white placeholder-white/40 transition-colors focus:ring-2 focus:ring-purple-400 focus:outline-none"
            />
          </div>
          <p className={cn(hintClass, "mt-1 min-h-4")} aria-live="polite">
            {statusMessage}
          </p>
          {(results.length > 0 || showAddCode) && (
            <ul className="mt-1 max-h-60 space-y-1 overflow-y-auto">
              {results.map((type) => {
                const isSelected = selectedSet.has(type.code);
                return (
                  <li key={type.code}>
                    <button
                      type="button"
                      disabled={isSelected || atLimit}
                      onClick={() => {
                        addFromSearch(type.code, type.name);
                      }}
                      className={optionClass}
                    >
                      {isSelected ? (
                        <Check className="size-4 shrink-0" aria-hidden="true" />
                      ) : (
                        <Plus className="size-4 shrink-0" aria-hidden="true" />
                      )}
                      <span className="min-w-0 flex-1 truncate">
                        {type.name} · {type.code}
                      </span>
                      {isSelected && <span className="shrink-0 text-xs text-blue-100/50">selected</span>}
                    </button>
                  </li>
                );
              })}
              {showAddCode && (
                <li>
                  <button
                    type="button"
                    disabled={selectedSet.has(typedCode) || atLimit}
                    onClick={() => {
                      addFromSearch(typedCode);
                    }}
                    className={optionClass}
                  >
                    <Plus className="size-4 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">Add code {typedCode}</span>
                    {selectedSet.has(typedCode) && <span className="shrink-0 text-xs text-blue-100/50">selected</span>}
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>

        <div>
          <p className={cn(hintClass, "mb-1")}>
            Selected ({selected.length}/{MAX_AIRCRAFT_TYPES})
          </p>
          {selected.length === 0 ? (
            <p className={hintClass}>No types selected. Pick a highlighted type or search above.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {selected.map((code) => {
                const name = names[code] as string | undefined;
                return (
                  <li
                    key={code}
                    className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-full border border-white/20 bg-white/10 py-0.5 pr-0.5 pl-2.5 text-xs"
                  >
                    <span className="min-w-0 truncate">
                      {name === undefined ? (
                        <>
                          {code} · <span className="text-blue-100/50">unknown name</span>
                        </>
                      ) : (
                        `${name} · ${code}`
                      )}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${code}`}
                      onClick={() => {
                        remove(code);
                      }}
                      className="shrink-0 rounded-full p-1 text-white/60 transition-colors hover:bg-white/20 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
                    >
                      <X className="size-3" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {atLimit && (
            <p className={cn(hintClass, "mt-1")}>
              You can select up to {MAX_AIRCRAFT_TYPES} types. Remove one to add another.
            </p>
          )}
        </div>
      </div>
    </fieldset>
  );
}
