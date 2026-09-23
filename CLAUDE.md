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
- `npx wrangler deploy` — the only supported deploy command (Workers with Static Assets). Never `wrangler pages deploy` or any other `wrangler pages *` command: they ignore `wrangler.jsonc`, so the deploy silently loses `nodejs_compat` and any cron triggers.
- There is no separate `wrangler dev` step. With `@astrojs/cloudflare` v14, `npm run dev` already runs workerd inside Vite; tutorials recommending `wrangler pages dev ./dist` are obsolete for these pins.
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

## 10xDevs AI Toolkit — Moduł 1, Lekcja 5

Wybierz platformę wdrożeniową i wdroż na produkcję za pomocą **łańcucha infra**:

```
(/10x-init  →  /10x-shape  →  /10x-prd  →  /10x-tech-stack-selector  →  /10x-bootstrapper  →  /10x-agents-md  →  /10x-rule-review  →  /10x-lesson)  →  /10x-infra-research  →  Plan Mode deploy
```

Pełny łańcuch Modułu 1 obejmuje rezultaty z Lekcji 1–4 (uwzględnione ponownie, aby można było poprawić dowolny wcześniejszy kontrakt w trakcie pracy). `/10x-infra-research` jest głównym tematem lekcji; sam krok wdrożenia używa wbudowanego **Plan Mode** hosta, a nie dedykowanej umiejętności — to artefakt (`context/deployment/deploy-plan.md`) jest przekazywany dalej.

### Router zadań — od czego zacząć

| Umiejętność | Użyj jej, gdy |
| --- | --- |
| **Infrastruktura (temat lekcji)** | |
| `/10x-infra-research [path-to-tech-stack-or-prd]` | Masz `context/foundation/tech-stack.md` (a najlepiej także `prd.md`) i musisz wybrać platformę wdrożeniową dla MVP. Umiejętność ładuje stack jako twarde ograniczenie, przeprowadza 5-pytaniowy wywiad z deweloperem (trwałe połączenia, wrażliwość na koszty, istniejąca znajomość, zasięg globalny, preferencja współlokalizacji), uruchamia równoległe badania subagentów dla sześciu kandydujących platform, ocenia je jako Pass/Partial/Fail według pięciu kryteriów przyjaznych agentom z `references/agent-friendly-criteria.md`, wybiera trzy najlepsze i przeprowadza kontrolę antybiasową lidera z trzech perspektyw (adwokat diabła, pre-mortem, niewiadome niewiadome), zanim zapisze `context/foundation/infrastructure.md`. Użyj PO `/10x-tech-stack-selector`, PRZED `/10x-implement`. |
| **Wdrożenie (wbudowane w hosta, nie jest umiejętnością)** | |
| Plan Mode deploy | Masz `infrastructure.md` + `tech-stack.md` i chcesz, aby plan tylko do odczytu został sprawdzony, zanim jakakolwiek zmiana trafi na platformę. Aktywuj tryb planowania hosta (Claude Code: `Shift+Tab` przełącza default → auto-accept → plan; IDE: dedykowany przycisk) za pomocą promptu „Wykonajmy pierwsze wdrożenie w oparciu o `@infrastructure.md`, zgodnie ze stackiem z `@tech-stack.md`”. Przeczytaj plan, zażądaj poprawek, zatwierdź go, a następnie pozwól agentowi wykonać działania. Zatwierdzony plan jest zachowywany w `context/deployment/deploy-plan.md`, aby planowanie kamieni milowych w kolejnej lekcji mogło odwołać się do tego, co zostało już wdrożone i które sekrety są już podłączone. |
| **W razie potrzeby uruchom ponownie poprzedni etap** | |
| `/10x-init` / `/10x-shape` / `/10x-prd` / `/10x-tech-stack-selector` / `/10x-bootstrapper` / `/10x-agents-md` / `/10x-rule-review` / `/10x-lesson` / `/10x-stack-assess` / `/10x-health-check` | Zebrane razem, aby można było poprawić dowolny wcześniejszy kontrakt w trakcie pracy. Jeśli kontrola antybiasowa wymusi zmianę platformy, która wpływa na decyzję ukształtowaną przez stack (np. „ta DB nie pasuje do żadnej platformy, którą zaakceptowalibyśmy”), uruchom ponownie `/10x-tech-stack-selector`, aby zachować zgodność `tech-stack.md` i `infrastructure.md`. |

### Jak łańcuch przekazuje pracę dalej

- `/10x-infra-research` odczytuje `context/foundation/tech-stack.md` (język, framework, runtime, baza danych) jako **twarde ograniczenia** — platformy, które nie obsługują stacka, są odrzucane przed oceną. Odczytuje także `context/foundation/prd.md` (skala, opóźnienia, oczekiwania dotyczące dostępności) jako **miękkie wagi** podczas oceniania. Oba wejścia są opcjonalne, ale zdecydowanie zalecane; bez nich umiejętność działa dalej, lecz wyświetla ostrzeżenie.
- Umiejętność zapisuje `context/foundation/infrastructure.md` jako trzeci kontrakt fundamentowy: frontmatter (`project`, `researched_at`, `recommended_platform`, `runner_up`, `context_type`, `tech_stack`) oraz treść obejmującą rekomendację, pełne porównanie platform z macierzą ocen, ustalenia antybiasowe, model operacyjny (preview / secrets / rollback / approval / logs) i rejestr ryzyk wiążący każdy wpis z perspektywą, która go ujawniła. W przypadku kolizji umiejętność pyta: nadpisać, zapisać jako `infrastructure-v2.md` czy przerwać.
- Plan Mode odczytuje razem `infrastructure.md` i `tech-stack.md`. Agent generuje plan krok po kroku obejmujący zautomatyzowane kroki, za które odpowiada, ręczne bramki konfiguracji (utworzenie konta, konfiguracja sekretów), dokładne komendy wdrożeniowe (komendy Pages i Workers NIE są wymienne w Cloudflare — plan musi to określać) oraz kroki weryfikacji. Plan jest odrzucany/edytowany, dopóki nie będzie poprawny; dopiero wtedy Plan Mode kończy działanie i rozpoczyna się wykonanie. Zatwierdzony plan trafia do `context/deployment/deploy-plan.md` i jest wykorzystywany dalej przez umiejętności planowania kamieni milowych jako źródło prawdy dla „tego, co jest już wdrożone”.

### Co przechwytują umiejętności tej lekcji (a czego NIE)

- **`/10x-infra-research` przechwytuje**: shortlistę platform ocenionych według pięciu kryteriów przyjaznych agentom (jakość CLI, stopień zarządzania/serverless, dokumentacja czytelna dla agenta, stabilne/skryptowalne API wdrożeniowe, MCP lub integracja agentowa pierwszej klasy), trzy wyniki kontroli antybiasowej lidera (ponumerowane słabości, 150–200-słowowa narracja porażki, 3–5 niewiadomych niewiadomych), model operacyjny z jedną konkretną odpowiedzią dla każdej osi (nie kategoriami) oraz rejestr ryzyk, w którym każdy wiersz wskazuje źródłową perspektywę (`Devil's advocate` / `Pre-mortem` / `Unknown unknowns` / `Research finding`). Status każdej funkcji niebędącej GA jest przechwytywany inline (`beta` / `preview` / `region-limited` / `deprecated`) wraz z datą sprawdzenia statusu.
- **`/10x-infra-research` NIE** buduje obrazów Docker ani nie pisze Dockerfile'ów, nie konfiguruje potoków CI/CD ani nie planuje poza zakresem MVP (multi-region HA jest wyraźnie poza zakresem). NIE podejmuje decyzji za Ciebie — użytkownik akceptuje, zamienia na runner-up albo przerywa po kontroli, a decyzja ta jest zapisywana w wyniku.
- **Plan Mode** przechwytuje: wyraźną bramkę człowieka między „agent ma plan” a „agent modyfikuje produkcję”. Artefakt (`deploy-plan.md`) jest ścieżką audytową dla „tego, co miało się wydarzyć”, gdy rzeczywiste wykonanie pójdzie źle. Plan Mode NIE zastępuje `/10x-infra-research` (decyzja o platformie musi być już podjęta — Plan Mode planuje wdrożenie, nie wybiera miejsca wdrożenia).

### Pięć kryteriów przyjaznych agentom (i dlaczego są nośne)

Kryteria tworzące macierz ocen `/10x-infra-research` nie są ogólnymi osiami „dobrej platformy” — są to konkretne cechy określające, czy agent może obsługiwać tę platformę z sesji bez prowadzenia go za rękę:

1. **CLI-first** — każda rutynowa operacja ma udokumentowaną komendę; agent nie musi klikać w panelu.
2. **Managed / serverless** — mniej ruchomych elementów oznacza mniej sposobów, w jakie agent (lub Ty) może zepsuć coś, czym platforma miała się zajmować.
3. **Agent-readable docs** — dokumentacja markdown / `llms.txt` / hostowana na GitHubie, którą agent może pobrać i sparsować, a nie strony marketingowe renderowane przez JS.
4. **Stable, scriptable deploy API** — przewidywalne kody wyjścia, ustrukturyzowany output, brak interaktywnych promptów w trakcie wdrożenia.
5. **MCP server or first-class agent integration** — bonus, nie wymóg. Samo CLI wystarcza dla MVP; MCP zyskuje na znaczeniu, gdy agent wykonuje dziesiątki ustrukturyzowanych zapytań względem stanu produkcyjnego.

Twarde filtry są stosowane przed ocenianiem (wymóg trwałego połączenia odrzuca Netlify/Vercel obsługujące wyłącznie serverless; niezgodność runtime stacka całkowicie odrzuca platformę). Odpowiedzi z wywiadu później zmieniają wagi kryteriów — wrażliwość na koszty karze drogie poziomy bazowe, znajomość rozstrzyga remisy, preferencja zasięgu globalnego faworyzuje platformy edge-native, a preferencja współlokalizacji faworyzuje zintegrowane bazy danych.

### Antybias jako dyscyplina decyzyjna (nie teatr)

Każda rozmowa badawcza z LLM ma wbudowane przechylenie w stronę tego, co użytkownik już zasygnalizował. `/10x-infra-research` uruchamia trzy ustrukturyzowane perspektywy wobec lidera PRZED zapisaniem pliku, a nie po:

- **Devil's advocate** — *znajdź słabości, ukryte koszty i tryby awarii specyficzne dla wdrażania `<this stack>` na `<this platform>`*. Wynikiem jest ponumerowana lista 3–5 konkretów, a nie kategorii.
- **Pre-mortem** — *sześć miesięcy później ta decyzja okazała się kompletną katastrofą; przeanalizuj założenia i niedoszacowane ryzyka, które do tego doprowadziły*. Wynikiem jest narracja o długości 150–200 słów; narracje ujawniają konkretne kształty porażki, które ukrywają abstrakcyjne listy ryzyk.
- **Unknown unknowns** — *co jest prawdą o tej kombinacji, czego strona marketingowa i dokumentacja nie czynią oczywistym?* Wynikiem jest 3–5 nieoczywistych ryzyk.

Po kontroli użytkownik ma trzy rzeczywiste opcje: **kontynuować z liderem i włączyć ryzyka do rejestru**, **zamienić na runner-up** (i ponownie przeprowadzić kontrolę dla nowego lidera) albo **zamienić na trzecie miejsce**. Trzecia opcja zdarza się rzadko; jeśli nigdy nie występuje w wielu uruchomieniach, kontrola zdegradowała się do rytuału i należy ją przepisać.

Dwie dodatkowe techniki (nie wymagają umiejętności, surowe prompty) należą do tego samego zestawu narzędzi: zmuszenie modelu do porównania trzech alternatyw w tabeli markdown (struktura jest lepsza niż „ta sama odpowiedź innymi słowami”) oraz rotacja ról (ta sama decyzja oczami frontend developera, osoby od bezpieczeństwa i właściciela kosztów — ujawnij koszt, który ponosi każda rola, i zaproponuj alternatywy, jeśli któraś z nich się waha).

### CLI kontra MCP dla operacyjności live-infra

Po wdrożeniu agent potrzebuje sposobu komunikacji z działającą platformą. Dwie ścieżki, uzupełniające się, a nie konkurujące:

- **CLI** (`wrangler`, `flyctl`, `vercel`, `gh`) — jawne i audytowalne, output pozostaje w terminalu, bezpieczniejsze ustawienia domyślne dla nieodwracalnych działań (np. `netlify deploy` domyślnie tworzy draft; należy przekazać `--prod`). Najlepsze dla MVP: minimalna konfiguracja, niski koszt kontekstu (brak wstępnie załadowanych schematów narzędzi), a agent musi znać komendę (w czym pomaga umiejętność per narzędzie).
- **MCP** — dedykowany serwer udostępniający ustrukturyzowane narzędzia ze schematami (`pages_deployments_list` itp.). Każdy podłączony serwer MCP dodaje definicje narzędzi do okna kontekstowego, więc koszt kumuluje się między serwerami. Zyskuje na znaczeniu, gdy agent wykonuje wiele zapytań typu discovery względem stanu produkcyjnego (logi, różnice wdrożeń), a ustrukturyzowany JSON jest lepszy niż parsowanie outputu CLI.

Rozsądne ustawienie domyślne: zacznij od CLI, dodaj MCP, gdy zauważysz powtarzalny wzorzec przechodzenia przez `--help`, który agent musi wykonywać, aby odpowiedzieć na określoną klasę pytań. Ujęcie Anthropic w [building-agents-that-reach-production](https://claude.com/blog/building-agents-that-reach-production-systems-with-mcp) brzmi: „API, CLI i MCP to trzy uzupełniające się ścieżki” — wybieraj według zadania, nie według hype'u.

### Granica dostępu do produkcji (minimalne uprawnienia, człowiek przy nieodwracalnych działaniach)

Zarówno CLI, jak i MCP mogą dać agentowi bezpośredni dostęp do produkcji. Lekcja ustawia domyślną postawę:

- **Tokeny są ograniczone zakresem, nie są kluczami głównymi.** W Cloudflare: token API ograniczony do Pages lub Workers dla jednego projektu, bez DNS, bez Workers Secrets dla niepowiązanych projektów, bez rozliczeń. Odpowiednik AWS / GCP: ograniczona rola IAM z `console-only-user` lub dostępem tylko do odczytu na produkcji, pełnym dostępem na stagingu.
- **Tokeny znajdują się w zmiennych env, a nie w `.mcp.json` commitowanym do repo.** Agent pobiera je przez serwer MCP lub wykrywanie env przez CLI, a nie przez plaintext w rozmowie.
- **Destrukcyjne działania wykonuje wyłącznie człowiek.** Usunięcie bazy danych, rotacja głównego sekretu, skasowanie projektu — są to operacje wykonywane ręcznie w panelu, nawet jeśli agent je sugeruje. Ręczne kliknięcie kosztuje 30 sekund; sprzątanie po automatycznym błędzie kosztuje godziny.

To jest postawa dla MVP. W miarę dojrzewania projektu naturalna ewolucja wygląda tak: staging otrzymuje pełny dostęp agenta, a produkcja staje się tylko do odczytu — co omawiają późniejsze moduły.

### Ścieżki fundamentowe używane przez tę lekcję

- `context/foundation/tech-stack.md` — wejście (przekazanie z Lekcji 2, twarde ograniczenia)
- `context/foundation/prd.md` — wejście (przekazanie z Lekcji 1, miękkie wagi)
- `context/foundation/infrastructure.md` — wyjście (trzeci kontrakt fundamentowy)
- `context/deployment/deploy-plan.md` — wyjście Plan Mode deploy (ścieżka audytowa „tego, co miało się wydarzyć”)
- `context/foundation/lessons.md` — powtarzające się zasady i pułapki (użyj `/10x-lesson` z Lekcji 4, jeśli podczas badań lub wdrożenia zauważysz klasę błędu agenta)
- `docs/reference/contract-surfaces.md` — rejestr nazw nośnych

### Uniwersalny język

Dostarczona umiejętność nie zawiera odniesień do 10xDevs / cohort / certification. Lista kandydatów na platformy (Cloudflare, Vercel, Netlify, Fly.io, Railway, Render) jest punktem wyjścia dla badań, a nie zbiorem rekomendacji — nośny jest potok scoring + interview + cross-check, a platformę nieobecną na domyślnej liście można dodać przez rozszerzenie kroku badawczego. Pięć kryteriów przyjaznych agentom to rzeczywisty rdzeń artefaktu; `/10x-infra-research` ponownie odczytuje je z `references/agent-friendly-criteria.md`, aby ewoluowały wraz z platformami.

Umiejętności nie mogą zapisywać do `context/archive/`. Zarchiwizowane zmiany są niezmienne; jeśli rozwiązana ścieżka docelowa zaczyna się od `context/archive/`, przerwij z komunikatem: „This change is archived. Open a new change with `/10x-new` instead.”

<!-- END @przeprogramowani/10x-cli -->
