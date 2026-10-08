import React, { useState } from "react";
import { CircleCheck, LocateFixed, MapPin, Radar, Save, Send } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";
import { AircraftTypePicker } from "@/components/settings/AircraftTypePicker";
import type { AircraftType } from "@/lib/aircraft-types";
import { RADIUS_MAX, RADIUS_MIN, parseAlertSettingsForm, type AlertSettingsInput } from "@/lib/alert-settings";

interface Props {
  initial: AlertSettingsInput;
  serverError?: string | null;
  saved?: boolean;
  featuredTypes: AircraftType[];
  typeNames: Record<string, string>;
  featuredUnavailable?: boolean;
}

function coordinateToText(value: number | null) {
  return value === null ? "" : String(value);
}

// Matches the numeric(5,2) precision the database stores (~1 km).
function roundCoordinate(value: number) {
  return (Math.round(value * 100) / 100).toFixed(2);
}

export default function AlertSettingsForm({
  initial,
  serverError,
  saved = false,
  featuredTypes,
  typeNames,
  featuredUnavailable = false,
}: Props) {
  const [lat, setLat] = useState(coordinateToText(initial.home_lat));
  const [lon, setLon] = useState(coordinateToText(initial.home_lon));
  const [radius, setRadius] = useState(String(initial.radius_km));
  const [types, setTypes] = useState<string[]>(initial.aircraft_types);
  const [chatId, setChatId] = useState(initial.telegram_chat_id === null ? "" : String(initial.telegram_chat_id));
  const [clientError, setClientError] = useState<string | null>(null);
  const [geoMessage, setGeoMessage] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  function handleLocate() {
    setGeoMessage(null);
    if (!("geolocation" in navigator)) {
      setGeoMessage("Your browser does not support location access. Enter the coordinates manually.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLat(roundCoordinate(position.coords.latitude));
        setLon(roundCoordinate(position.coords.longitude));
        setLocating(false);
      },
      (error) => {
        setGeoMessage(
          error.code === error.PERMISSION_DENIED
            ? "Location access was denied. Enter the coordinates manually."
            : "Could not determine your location. Enter the coordinates manually.",
        );
        setLocating(false);
      },
    );
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    const result = parseAlertSettingsForm(new FormData(e.currentTarget));
    if (!result.ok) {
      e.preventDefault();
      setClientError(result.error);
      return;
    }
    setClientError(null);
  }

  const hintClass = "mt-1 text-xs text-blue-100/50";

  return (
    <form method="POST" action="/api/settings" className="space-y-4" onSubmit={handleSubmit} noValidate>
      <div>
        <div className="grid grid-cols-2 gap-3">
          <FormField
            id="home_lat"
            label="Latitude"
            inputMode="decimal"
            value={lat}
            onChange={setLat}
            placeholder="52.23"
            icon={<MapPin className="size-4" />}
          />
          <FormField
            id="home_lon"
            label="Longitude"
            inputMode="decimal"
            value={lon}
            onChange={setLon}
            placeholder="21.01"
            icon={<MapPin className="size-4" />}
          />
        </div>
        <p className={hintClass}>Your location is stored approximately (~1 km, 2 decimal places).</p>
        <button
          type="button"
          onClick={handleLocate}
          disabled={locating}
          className="mt-2 flex items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-sm transition-colors hover:bg-white/20 disabled:opacity-60"
        >
          <LocateFixed className="size-4" />
          {locating ? "Locating..." : "Use my location"}
        </button>
        {geoMessage && <p className="mt-1 text-xs text-red-300">{geoMessage}</p>}
      </div>

      <FormField
        id="radius_km"
        label="Alert radius (km)"
        type="number"
        inputMode="numeric"
        min={RADIUS_MIN}
        max={RADIUS_MAX}
        step={1}
        value={radius}
        onChange={setRadius}
        icon={<Radar className="size-4" />}
        hint={
          <p className={hintClass}>
            Whole number between {RADIUS_MIN} and {RADIUS_MAX}.
          </p>
        }
      />

      <AircraftTypePicker
        selected={types}
        onChange={setTypes}
        featuredTypes={featuredTypes}
        typeNames={typeNames}
        featuredUnavailable={featuredUnavailable}
      />

      <FormField
        id="telegram_chat_id"
        label="Telegram chat ID"
        inputMode="numeric"
        value={chatId}
        onChange={setChatId}
        placeholder="Your numeric chat ID"
        icon={<Send className="size-4" />}
        hint={
          <p className={hintClass}>
            Open your bot in Telegram and press Start, then get your chat ID from @userinfobot.
          </p>
        }
      />

      <ServerError message={clientError ?? serverError} />

      {saved && !clientError && !serverError && (
        <p className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-900/30 px-3 py-2 text-sm text-green-300">
          <CircleCheck className="size-4 shrink-0" />
          Settings saved.
        </p>
      )}

      <SubmitButton pendingText="Saving..." icon={<Save className="size-4" />}>
        Save settings
      </SubmitButton>
    </form>
  );
}
