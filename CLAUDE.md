# Repository Guidelines

Astro 7 SSR app (React 19 islands, Tailwind 4, shadcn/ui) with Supabase Auth, deployed to Cloudflare Workers. Product scope: @context/foundation/prd.md. Stack rationale: @context/foundation/tech-stack.md. Setup: @README.md.

## Hard rules

- Never write to `context/archive/`; archived changes are immutable.
- Read `SUPABASE_URL` / `SUPABASE_KEY` only via `astro:env/server` (server-only secrets in @astro.config.mjs). Never import them into React components or client scripts.
- Create Supabase clients only with `createClient()` from @src/lib/supabase.ts and handle its `null` return (Supabase not configured), as in @src/pages/api/auth/signin.ts.
- To require login for a page, add its path prefix to `PROTECTED_ROUTES` in @src/middleware.ts; the middleware sets `context.locals.user`.
- `AGENTS.md` is a symlink to `CLAUDE.md`. Edit `CLAUDE.md`, and put project rules outside the `@przeprogramowani/10x-cli` BEGIN/END block, which the CLI manages.

## Commands

- `npm run dev` — dev server on the Cloudflare workerd runtime; local secrets come from `.dev.vars`.
- `npm run lint` / `npm run lint:fix` — ESLint strict type-checked rules plus Prettier (@eslint.config.js).
- `npx astro sync && npx astro check` — type check, run by CI after lint.
- `npm run build` — SSR build for Cloudflare.
- `npm run smoke` — HTTP auth-flow test against a running server (`BASE_URL`, default `http://localhost:4321`); needs Supabase with email confirmation disabled.

No unit test runner is configured; `smoke` is the only automated test.

## Structure & conventions

- `src/pages/` — routes; `src/pages/api/` — endpoints exporting uppercase `GET`/`POST` typed as `APIRoute`.
- `src/components/` — `.astro` for static UI; React `.tsx` only for interactive islands (e.g. `src/components/auth/`). No `"use client"` or other Next.js directives.
- `src/components/ui/` — shadcn/ui ("new-york"); add components with `npx shadcn@latest add <name>`.
- `src/lib/` — helpers and services.
- Import from `src` via the `@/` alias (`@/lib/supabase`), not deep relative paths.
- Merge Tailwind classes with `cn()` from @src/lib/utils.ts; do not concatenate class strings.
- Auth endpoints report failures by redirecting back to the form with `?error=<encodeURIComponent(message)>`, not by returning JSON.

## Commits & CI

- Pre-commit (husky + lint-staged) runs `eslint --fix` on `*.{ts,tsx,astro}` and `prettier --write` on `*.{json,css,md}`.
- CI (@.github/workflows/ci.yml) runs on push/PR to `master`: lint → `astro check` → build, plus a smoke job against a local Supabase. Run lint and `astro check` before pushing.
- No git history yet; commit message convention is to be defined.

<!-- BEGIN @przeprogramowani/10x-cli -->

## Zestaw narzędzi AI 10xDevs — Moduł 1, Lekcja 4

Wdróż agenta do projektu, który utworzyłeś w Lekcji 3, za pomocą **łańcucha kontekstu agenta**:

```
(/10x-init  →  /10x-shape  →  /10x-prd  →  /10x-tech-stack-selector  →  /10x-bootstrapper)  →  /10x-agents-md  →  /10x-rule-review  →  /10x-lesson
```

Łańcuch PRD → tech-stack → bootstrap pochodzi z Lekcji 1–3 (został ponownie uwzględniony, aby można było naprawić projekt w trakcie pracy). `/10x-agents-md`, `/10x-rule-review` i `/10x-lesson` to główne tematy lekcji. Łańcuch zostaje rozszerzony w Lekcji 5 o krok infra/deploy.

### Router zadań — od czego zacząć

| Umiejętność                                                                                                                            | Użyj jej, gdy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Kontekst agenta (temat lekcji)**                                                                                                     |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `/10x-agents-md`                                                                                                                       | Repozytorium jest utworzone, ale agent nie ma wdrożenia specyficznego dla projektu. Analizuje repozytorium (manifest pakietu, README, skrypty, konfigurację lint/test, układ, historię commitów) i zapisuje zwięzłe, uporządkowane „Wytyczne repozytorium” w `AGENTS.md` (lub, gdy jest wywoływane z podkatalogu, `AGENTS.md` na poziomie katalogu, przeformułowane wokół lokalnych konwencji i dominującej jednostki). Użyj jako alternatywy dla wbudowanego `/init` hosta lub jako rozwiązania awaryjnego dla narzędzi, które go nie mają. Treść na poziomie repozytorium ma docelowo ~200 wierszy; przewodniki na poziomie katalogu mają docelowo 120–250 słów. |
| `/10x-rule-review <path>`                                                                                                              | Masz plik zasad dla AI (`AGENTS.md`, `CLAUDE.md`, `.cursor/rules/*.mdc`, `.github/copilot-instructions.md`, `.windsurfrules`, zagnieżdżone pliki dla poszczególnych obszarów) i chcesz otrzymać kartę wyników w 5 osiach: długość, osadzone fragmenty kodu/konfiguracji, precyzja języka, redundancja względem wiedzy publicznej oraz kolejność zasad. Niezależne od narzędzia — ocenia stan artefaktu, a nie projektu. Domyślne wyjście jest tylko do odczytu; tylko Kontrola 5 (zmiana kolejności) może edytować, i wyłącznie po wyraźnej akceptacji.                                                                                                            |
| `/10x-lesson [seed]`                                                                                                                   | Zauważyłeś powtarzającą się zasadę, którą warto ujawnić na potrzeby przyszłych uruchomień `/10x-frame`, `/10x-research`, `/10x-plan`, `/10x-plan-review`, `/10x-implement` i `/10x-impl-review`. Dodaje pojedynczy wpis (Kontekst / Problem / Zasada / Dotyczy) do `context/foundation/lessons.md`. Przy pierwszym użyciu samodzielnie inicjalizuje plik z kanonicznym nagłówkiem `# Lessons Learned`. Tylko dopisywanie — nigdy nie zmienia kolejności ani nie przepisuje wcześniejszych wpisów.                                                                                                                                                                  |
| **W razie potrzeby uruchom ponownie wcześniejszy etap**                                                                                |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `/10x-init` / `/10x-shape` / `/10x-prd` / `/10x-tech-stack-selector` / `/10x-bootstrapper` / `/10x-stack-assess` / `/10x-health-check` | Dołączone, aby można było poprawić PRD, zmienić stos technologiczny lub ponownie utworzyć szkielet w trakcie pracy. Jeśli `/10x-rule-review` zgłosi `FAIL`, którego nie da się rozwiązać przez skrócenie, często wskazuje to na niejednoznaczne decyzje dotyczące PRD lub stosu — uruchom ponownie wcześniejszą umiejętność zamiast wypełniać `AGENTS.md` poprawkami.                                                                                                                                                                                                                                                                                              |

### Jak łańcuch przekazuje pracę dalej

- `/10x-agents-md` zapisuje (lub punktowo aktualizuje) `AGENTS.md` w określonym zakresie. Zakres na poziomie repozytorium = plik znajduje się w korzeniu repozytorium i opisuje cały projekt; zakres na poziomie katalogu = plik znajduje się obok kodu, którym zarządza, i jest przeformułowany wokół lokalnej jednostki, całkowicie pomijając perspektywę całego repozytorium. Umiejętność nigdy nie nadpisuje po cichu — gdy cel istnieje, przełącza się na przepływ aktualizacji.
- `/10x-rule-review` odczytuje dowolny wskazany plik markdown z zasadami dla AI i wyświetla kartę wyników z 5 kontrolami (`OK` / `WARN` / `FAIL`) wraz z konkretnymi poprawkami. Nie zależy od wcześniejszego uruchomienia `/10x-agents-md`; w ten sam sposób możesz sprawdzić `.cursor/rules/`, instrukcje Copilot lub ręcznie napisany `CLAUDE.md`.
- `/10x-lesson` przy pierwszym użyciu samodzielnie inicjalizuje `context/foundation/lessons.md`, a następnie przy każdym wywołaniu dopisuje jeden wpis Kontekst/Problem/Zasada/Dotyczy. Plik jest wykorzystywany jako wcześniejszy kontekst przez umiejętności fazy planowania i przeglądu wprowadzone później w procesie — `/10x-frame`, `/10x-research`, `/10x-plan`, `/10x-plan-review`, `/10x-implement`, `/10x-impl-review`.

### Co wychwytują umiejętności lekcji (a czego NIE robią)

- **`/10x-agents-md` wychwytuje**: strukturę projektu, polecenia build/test/lint faktycznie obecne w skryptach, konwencje commitów wywnioskowane z historii, pułapki specyficzne dla repozytorium, które agent mógłby przeoczyć, odwołania do kanonicznych plików przez ścieżki `@` zamiast wklejania ich treści. Zakres na poziomie katalogu dodatkowo wychwytuje: lokalne wzorce nazewnictwa/układu wywnioskowane z sąsiednich elementów, dozwolone/zabronione importy, wzorzec testów używany przez sąsiednie moduły oraz pułapki widoczne w bezpośrednim otoczeniu.
- **`/10x-agents-md` NIE** wkleja zawartości `tsconfig.json` / `eslint.config` / dokumentacji frameworka, którą agent już zna; **NIE** generuje ogólnych intencji typu „pisz czysty kod”; **NIE** zastępuje wbudowanego `/init` hosta, gdy taki istnieje — jest pozycjonowany jako alternatywa lub rozwiązanie awaryjne, a nie domyślna opcja.
- **`/10x-rule-review` wychwytuje**: werdykt długości (OK ≤ 200 niepustych wierszy, WARN 201–500, FAIL 501+), bloki kodu/konfiguracji, które powinny być odwołaniami `@`, niejasny język intencji, redundancję względem dokumentacji frameworka, którą agent zna już z treningu, oraz propozycję zmiany kolejności w Kontroli 5, która przenosi krytyczne zasady na górę.
- **`/10x-rule-review` NIE** edytuje pliku domyślnie; **NIE** ocenia zawartości projektu (architektury, wyborów stosu) — ocenia stan artefaktu zasad; **NIE** generuje „poprawionej wersji” pliku (Kontrola 5 może przenosić sekcje po wyraźnej akceptacji, ale nigdy nie przepisuje brzmienia zasad).
- **`/10x-lesson` wychwytuje**: jeden wpis na wywołanie z krótkim tytułem H2 w trybie rozkazującym (tytuł JEST zasadą), Kontekst (podsystem / faza / wzorzec plików, wystarczająco konkretny do dopasowywania wzorców), Problem (co konkretnie psuje się bez zasady, najlepiej wraz z wcześniejszym incydentem), Zasada (1–2 zdania w trybie rozkazującym, które można dosłownie wkleić do przyszłego ustalenia przeglądu), Dotyczy (podzbiór `frame`, `research`, `plan`, `plan-review`, `implement`, `impl-review` lub `all`).
- **`/10x-lesson` NIE** edytuje ani nie usuwa istniejących lekcji — plik z założenia pozwala wyłącznie na dopisywanie (bezrefleksyjne przepisywanie powtarzających się zasad jest trybem awarii, któremu ta konwencja zapobiega); **NIE** grupuje wielu zasad w jednym wywołaniu; **NIE** wypełnia pól proaktywnie (użytkownik pisze treść — to cena wychwytywania zasad poza ustrukturyzowanym przeglądem).

### Test włączenia (filtr dla AGENTS.md / CLAUDE.md)

Przed dodaniem zasady do dowolnego pliku zasad dla AI zapytaj: _czy agent mógłby wiedzieć to bez tego pliku? Czy publiczne dane treningowe — książki, blogi, repozytoria w tym stosie — mogły go do tego przygotować?_ Jeśli tak, pomiń ją. Jeśli nie, zachowaj ją. Plik służy do wdrożenia agenta, który już zna TypeScript / Python / twój framework, ale NIE zna twoich lokalnych konwencji.

Należy:

- nieoczywiste konwencje projektu (kształt odpowiedzi błędów, nazewnictwo plików, dozwolone ścieżki importu)
- pułapki specyficzne dla projektu i „żenujące” obejścia związane z historią lub błędami zależności
- odwołania do kanonicznych plików przez ścieżki `@` (np. `@src/features/users/user.service.ts` jako odwołanie do wzorca, a nie wklejony kod)

NIE należy:

- dokumentacja popularnych frameworków
- zawartość README, którą agent i tak przeczyta (połącz przez `@README.md`)
- popularne ogólne porady („używaj trybu TypeScript strict”), które są już wymuszane przez konfigurację
- deklaracje intencji („pisz czysty kod”, „stosuj dobre praktyki”) — przekształć w sprawdzalne zachowanie lub pomiń

### U-kształtna uwaga i szczegółowe zasady

LLM-y najsilniej skupiają uwagę na początku i końcu kontekstu (Lost-in-the-Middle / U-shaped attention). Długi monolityczny `CLAUDE.md` umieszcza zasady ze środka w najsłabszej strefie uwagi. Dwie praktyczne konsekwencje:

1. **Najważniejsze zasady trafiają na górę** każdego pliku zasad.
2. **Zasady dla poszczególnych obszarów powinny znajdować się obok ich kodu** — zagnieżdżone `AGENTS.md` / `CLAUDE.md` wewnątrz `src/api/`, `.cursor/rules/*.mdc` z globami plików itd. Szczegółowe pliki są ładowane selektywnie i pojawiają się w całości blisko początku własnej sekcji, zamiast być zakopane w wierszu 400 jednego dużego pliku.

Kontrola 5 (zmiana kolejności) w `/10x-rule-review` operacjonalizuje konsekwencję (1); test włączenia wraz z `/10x-agents-md` na poziomie katalogu operacjonalizuje konsekwencję (2).

### Ćwiczenie kalibracyjne z pięcioma wzorcami

Przed zapisaniem zasady potwierdź, że agent faktycznie łamie konwencję bez niej. Wybierz jeden wzorzec z projektu (kształt odpowiedzi błędów, nazewnictwo plików, styl importów, struktura modułu, obsługa dat). Następnie:

1. Poproś agenta o zaimplementowanie zgodnie ze wzorcem 3–5 razy ze stanu czystego, bez zasady.
2. Zanotuj, gdzie złamał konwencję; uchwyć czas wykonania, przeanalizowane pliki oraz widoczny koszt/tokeny, jeśli host je pokazuje.
3. Dodaj zasadę składającą się z 1–3 zdań do odpowiedniego zakresu (głównego lub na poziomie obszaru).
4. Uruchom ponownie to samo zadanie w świeżej sesji i porównaj przestrzeganie konwencji, czas, pliki i liczbę iteracji.

Jeśli agent już bez zasady ma tendencję do stosowania konwencji, nie potrzebujesz tej zasady. Jeśli systematycznie wybiera niewłaściwy wzorzec, znalazłeś zasadę o dużej dźwigni, którą warto dodać. To ćwiczenie pokazuje, jak w praktyce wygląda „zasłużenie na zasadę przez powtarzającą się porażkę”.

### Hierarchia i interoperacyjność narzędzi

- **Claude Code** ładuje `CLAUDE.md` z katalogu użytkownika (`~/.claude/CLAUDE.md`), korzenia repozytorium oraz każdego podkatalogu, w którym pracuje agent. Głębsze pliki zastępują lub uzupełniają pliki znajdujące się wyżej.
- **Codex** i **GitHub Copilot** ładują `AGENTS.md` od bieżącego katalogu w górę — wygrywa najbliższy plik.
- Jeden kanoniczny plik jest lepszy niż trzy duplikaty. Typowy wzorzec: `AGENTS.md` jako źródło prawdy, `CLAUDE.md` jako cienka nakładka Claude Code z importem `@AGENTS.md`, `.github/copilot-instructions.md` tylko wtedy, gdy Copilot potrzebuje własnych dodatków. Dowiązanie symboliczne (`ln -s AGENTS.md CLAUDE.md`) jest najprostszą deduplikacją, gdy narzędzia wymagają obu nazw.
- Automatyczna pamięć (np. `~/.claude/projects/<dir-with-slashes-as-dashes>/memory/MEMORY.md` Claude Code) jest lokalna dla maszyny i nie zastępuje `AGENTS.md`. Zasady wiążące zespół znajdują się w repozytorium; automatyczna pamięć jest osobistym cache'em, który można okresowo przeglądać.

### Hooki wewnętrznej pętli (deterministyczne sprzężenie zwrotne bez promptowania)

Mechaniczne, nieopcjonalne kontrole powinny znajdować się w hookach (np. `PostToolUse` Claude Code), a nie w pliku zasad. Agent kończy edycję; uruchamia się formatter lub szybki lint; wynik wraca bez konieczności przypominania mu o tym. Szablon ustawień (`settings.json.template`) jest dostarczany w pakiecie lekcji jako punkt wejścia do konfiguracji. Przepływy proceduralne (głębszy przegląd, lista kontrolna wydania, wdrożenie w sandboxie) trzymaj w umiejętnościach, a hooki rezerwuj dla deterministycznych sygnałów narzędzi.

### Ścieżki fundamentu używane przez tę lekcję

- `AGENTS.md` / `CLAUDE.md` (oraz warianty dla poszczególnych obszarów) — wynik `/10x-agents-md`
- `context/foundation/lessons.md` — wynik `/10x-lesson` (rejestr tylko do dopisywania, używany przez przyszłe umiejętności planowania/przeglądu)
- `context/foundation/prd.md`, `context/foundation/tech-stack.md` — dane wejściowe z wcześniejszych lekcji, nadal obecne
- `docs/reference/contract-surfaces.md` — rejestr nazw mających kluczowe znaczenie (utworzony przez `/10x-init`)

### Uniwersalny język

Dostarczone umiejętności nie zawierają odniesień do 10xDevs / kohorty / certyfikacji. `/10x-agents-md` odkrywa informacje na podstawie repozytorium, w którym jest wywoływane; `/10x-rule-review` jest niezależne od narzędzia i traktuje każdy plik jako „artefakt zasad dla AI”; `/10x-lesson` zapisuje wpis o jednym kształcie niezależnie od dziedziny projektu. Ćwiczenie kalibracyjne z pięcioma wzorcami ma charakter ilustracyjny — zastąp wzorce wzorcami z własnego stosu.

Umiejętności nie mogą zapisywać do `context/archive/`. Zarchiwizowane zmiany są niezmienne; jeśli rozwiązana ścieżka docelowa zaczyna się od `context/archive/`, przerwij z komunikatem: „This change is archived. Open a new change with `/10x-new` instead.”

<!-- END @przeprogramowani/10x-cli -->
