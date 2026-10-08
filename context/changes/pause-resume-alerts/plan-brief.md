# Wstrzymanie i wznowienie alertów (S-05) — Plan Brief

> Full plan: `context/changes/pause-resume-alerts/plan.md`

## What & Why

FR-006: użytkownik może wstrzymać alerty (urlop, noc) i je wznowić, nie tracąc ustawień. Bez tego jedynym sposobem
na ciszę jest wyczyszczenie ustawień albo zablokowanie bota.

## Starting Point

Kolumna `alert_settings.paused` istnieje, poller pomija wstrzymanych, a cron biegnie dalej. Brakuje tylko UI:
nikt nie zapisuje `paused` i nigdzie nie widać, że alerty są wstrzymane.

## Desired End State

Na dashboardzie karta „Alerts: active” / „Alerts paused” z jednym przyciskiem Pause/Resume. Pauza trwa do ręcznego
wznowienia i przeżywa zapis ustawień; w tym czasie nie przychodzą powiadomienia.

## Key Decisions Made

| Decision           | Choice                                   | Why (1 sentence)                                                         |
| ------------------ | ---------------------------------------- | ------------------------------------------------------------------------ |
| Model pauzy        | Do ręcznego wznowienia, bez daty         | Dokładnie FR-006, bez migracji i zmian w pollerze.                       |
| Miejsce            | Dashboard                                | Pierwsza strona po zalogowaniu — stanu pauzy nie da się przeoczyć.       |
| Telegram           | Bez wiadomości przy pauzie/wznowieniu    | Brak zależności od tokena bota i obsługi błędów wysyłki.                 |
| Kontrakt endpointu | Jawny stan docelowy `paused=true\|false` | Podwójne kliknięcie lub ponowne wysłanie nie odwraca stanu.              |
| Produkcja          | Bez deployu w tej zmianie                | Poller nie działa na produkcji, więc pauza nie ma tam czego wstrzymywać. |

## Scope

**In scope:**

- `parsePauseForm` w `src/lib/alert-settings.ts` z testem Vitest
- `POST /api/settings/pause` (RLS, redirect z `?alerts=` / `?alerts_error=`)
- Karta stanu alertów z przyciskiem na `/dashboard`
- Kroki smoke (round-trip, pauza przeżywa zapis ustawień), dwie asercje pgTAP, zdanie w README

**Out of scope:**

- Pauza do daty, okresy, ciche godziny
- Przełącznik na `/settings`, wiadomości na Telegram
- Migracje, zmiany w pollerze, deploy

## Architecture / Approach

Endpoint wzorem `telegram-test.ts`: sprawdza sesję, parsuje formularz czystą funkcją, robi `update` pod RLS na
własnym wierszu i wraca na dashboard z parametrem wyniku. Dashboard czyta `paused` tym samym klientem co kartę crona
i renderuje formularz z ukrytym stanem docelowym. Poller bez zmian.

## Phases at a Glance

| Phase                                 | What it delivers                                  | Key risk                                                     |
| ------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------ |
| 1. Pauza i wznowienie na dashboardzie | Przełącznik, endpoint, smoke, pgTAP, test parsera | Zapis ustawień nie może zdejmować pauzy — pilnuje tego smoke |

**Prerequisites:** lokalna Supabase i `.dev.vars` (są).
**Estimated effort:** jedna krótka sesja.

## Open Risks & Assumptions

- Po wznowieniu przyjdzie alert o samolocie, który jest w oknie 2–15 min, nawet jeśli był widoczny w czasie pauzy —
  w pauzie nic nie trafia do dziennika deduplikacji. To zgodne z PRD.
- Pauza bez daty wymaga pamiętania o wznowieniu; karta na dashboardzie ma to ograniczyć.

## Success Criteria (Summary)

- Jedno kliknięcie na dashboardzie wstrzymuje alerty, drugie je wznawia.
- W czasie pauzy nie przychodzą powiadomienia, a cron i ustawienia działają bez zmian.
