---
name: 10x-ui
description: >
  Audit and improve ONE view that already renders, as a normal 10x change with a
  design-system contract — audit into 3–5 charges (missing tokens, missing shared
  component, accidental architecture), fix the contract before the pixels, cover a
  7-state matrix, gate with a screenshot, and leave a rule so the next agent keeps
  using the tokens and components. The UI entry to /10x-research → /10x-plan →
  /10x-implement, sharing the same change folder and Progress. Use when the user wants
  a theme, a restyle, "make it prettier", shadcn/Tailwind work, design tokens, dark
  mode, a visible-focus pass, or cleanup of UI an agent built feature by feature. Not a
  generator for a view that does not exist yet, not a component catalog, not a
  Playwright course.
argument-hint: "<change-id> | <route or view file>"
---
# 10x-ui — kontrakt systemu projektowego dla jednej zmiany wizualnej

UI to zwykła zmiana 10x. Nie otwieraj czatu vibes w wątku CRUD i nie zaczynaj
od promptu, który mówi tylko „make it nicer”.

**Ta umiejętność iteruje na UI, które już istnieje.** Zakłada widok, który możesz otworzyć i
zrobić mu zrzut ekranu: markup się renderuje, dane przepływają, ekran wykonuje swoje zadanie i po prostu nie jest
wystarczająco dobry. Stworzenie tego pierwszego widoku jest zwykłą pracą nad funkcją w ramach Core Skills Chain; ta
umiejętność przejmuje pracę w momencie, gdy jest on na ekranie.

Nie zastępuje łańcucha. Otwiera zmianę, przekazuje brief audytowy przez
`/10x-research`, kształtuje plan, który zapisuje `/10x-plan`, i dodaje kontrole UI do każdej
fazy `/10x-implement`. Te umiejętności zachowują własne kontrakty — to samo `plan.md`, to samo
`## Progress`, ten sam rytuał commitów.

Cel: `$ARGUMENTS`

Jeśli istnieje `context/foundation/lessons.md`, przeczytaj go raz, aby poznać powracające błędy UI w tym repozytorium.

## Kiedy to uruchomić — i na którym widoku

- **Kiedy:** po wyrenderowaniu pierwszego pionowego wycinka z prawdziwymi danymi — główny przepływ działa
  od początku do końca i wygląda, jakby był budowany funkcja po funkcji. Wcześniej nie ma czego
  audytować; dużo później każdy nowy widok kopiuje dryf. Najlepszy moment to przed drugim
  lub trzecim widokiem, aby dziedziczyły kontrakt zamiast literałów.
- **Który widok:** ten, na który użytkownicy trafiają najczęściej w głównym przepływie (lista/dashboard po zalogowaniu,
  a nie strona ustawień). Landing page liczy się tylko wtedy, gdy już istnieje i jest
  zmianą, na której Ci zależy — dostaje własną zmianę, a nie dołącza przy okazji.
- **Nie teraz:** widok, który jeszcze nie istnieje (zbuduj go przez zwykły łańcuch, a potem wróć),
  rebranding całego MVP, równoległe agenty lub `/goal` dla przepustowości (późniejsza lekcja), plik
  narzędzia projektowego jako jedyne źródło prawdy (ta umiejętność działa na uruchomionej aplikacji).

## Przy wywołaniu

1. **Ustal cel.**
   - Istnieje `context/changes/<arg>/` → ta zmiana; przeczytaj `change.md` oraz ewentualne `research.md`
     i `plan.md`, a następnie wznów od pierwszego kroku routera, który nie został jeszcze wykonany.
   - Trasa lub plik widoku → widok do audytu. Zaproponuj change-id i skopiuj
     `/10x-new <change-id>` do schowka; w `change.md` nazwij **jeden** widok oraz źródło tokenów
     (lub motyw), względem których pracuje ta zmiana.
   - Brak argumentu → zapytaj, który widok, korzystając z powyższych wskazówek, i zatrzymaj się do czasu odpowiedzi.
   - Odrzuć ścieżki `context/archive/`: „Ta zmiana jest zarchiwizowana. Zamiast tego otwórz nową zmianę przez
     `/10x-new`.”
2. **Przed-audyt (minuty, nie research):** zlokalizuj źródło wartości, katalog współdzielonych komponentów,
   plik(i) reguł agenta (`CLAUDE.md`, `AGENTS.md`, `.cursor/rules/*`,
   `.windsurfrules`, `copilot-instructions.md`) i uruchom poniższe skanowanie zakodowanych na stałe wartości
   na plikach widoku. Zgłoś liczniki — mówią Ci, który wariant kontraktu ma zastosowanie.
3. **Przekaż do `/10x-research`** brief audytowy z sekcji *Audyt* poniżej; skopiuj
   polecenie do schowka. Zarzuty trafiają do `research.md` pod `## Charges`.

> **Schowek.** Przekaż dokładne polecenie do `pbcopy` / `clip.exe` / `xclip -selection
> clipboard` / `Set-Clipboard`, po cichu użyj fallbacku, jeśli żadne nie istnieje, a następnie wypisz je w osobnej
> linii z sufiksem `(✓ copied)`.

## Router

1. `/10x-new <change-id>` — jeden widok, jedno źródło tokenów lub motyw.
2. `/10x-research <change-id>` — poniższy dwukierunkowy audyt. Wynik: `## Charges` w `research.md`.
3. `/10x-plan <change-id>` — fazy w tej kolejności: **środowisko/biblioteka → wartości tokenów →
   jeden widok → stany**. Każdy zarzut przypisuje się do fazy lub wymienia jako odroczony. Faza stanów
   zawiera macierz 7 stanów jako kryteria sukcesu.
4. `/10x-implement <change-id>` faza po fazie. Po każdej fazie wizualnej: zrzut ekranu na desktopie
   i przy jednej szerokości mobilnej oraz ponowne uruchomienie skanowania zakodowanych na stałe wartości na widoku.
5. **Bramka wizualna** — kitchen sink lub `toHaveScreenshot` dla tego jednego widoku.
6. **Zostaw zabezpieczenie** — regułę (oraz, jeśli repozytorium ma linter, kontrolę), która utrzyma następnego
   agenta przy kontrakcie. Zobacz *Utrwal to*.
7. `/10x-impl-review` — ustalenia UI domyślnie nie są „cosmetic skip”. Następnie pętla przeglądu.

## Audyt: trzy kategorie zarzutów

Przed jakimkolwiek CSS przejdź przez widok i zapisz **3–5 zarzutów**. Każdy zarzut otrzymuje **plik i
linię** oraz **jedno zdanie o wpływie na użytkownika**. Lista zarzutów jest wejściem do
planu; „make it nicer” nim nie jest.

Audyt przebiega w **dwóch kierunkach**:

- **Źródło → widoki.** Gdzie żyją wartości, gdzie żyją współdzielone komponenty i które
  widoki rzeczywiście je odczytują? Policz użycia klas/zmiennych tokenów oraz importy z
  katalogu komponentów na widok. Plik tokenów, którego nic nie odczytuje, to ustalenie, nie punkt odniesienia.
- **Widok → źródło.** Dla każdego literału w widoku: który token lub komponent powinien był
  go pokryć? To jest dowód zarzutu.

Przeczytaj także plik(i) reguł agenta pod kątem instrukcji UI. Reguła, która nakazuje agentowi używanie
jednorazowych wartości (np. „use arbitrary values like `w-[123px]` for precise designs”), jest zarzutem
dotyczącym przypadkowej architektury: to dlatego widoki się rozjechały i to cofnie naprawę.

| Kategoria | Jak wygląda | Dowody do zapisania | Typowa naprawa |
| --- | --- | --- | --- |
| **Brakujące tokeny** | literalne kolory w widoku — hex/rgb/oklch, a w Tailwind **klasy palety** (`bg-blue-900`, `text-purple-200`, `from-indigo-900`) i wartości arbitralne (`p-[13px]`); trzy odcienie tego samego „primary”; odstępy wymyślane w każdym pliku | plik:linia literału oraz token, który powinien go pokryć | przenieś wartość do źródła tokenów tego repozytorium i odwołuj się do niej przez rolę (`bg-primary`, `text-muted-foreground` w wariancie Tailwind) |
| **Brakujący współdzielony komponent** | drugi `Button` zbudowany z `div`+klas, karta kopiująca kartę DS, skopiowane pole formularza | plik:linia duplikatu oraz komponent, który zasłania (lub ten do dodania) | zaimportuj prawdziwy komponent albo dodaj go ścieżką właściwą dla stacka (np. `npx shadcn add <name>`) |
| **Przypadkowa architektura** | ekran odzwierciedla kolejność dodawania funkcji: nieuwierzytelniona trasa zwracająca surowy JSON, modal będący stroną, zakładka „settings” zawierająca cztery niepowiązane rzeczy, reguła agenta zachęcająca do jednorazowych stylów | ścieżka trasy/komponentu/reguły oraz to, co widzi użytkownik, gdy trafia tam tą drogą | napraw punkt wejścia (guard, redirect, layout) lub regułę, nie kolor |

Trzecia kategoria jest najtrudniejsza do dostrzeżenia na zrzucie ekranu i najłatwiejsza do pominięcia. Zapytaj
wprost: *co się dzieje, jeśli ktoś trafia na ten widok wylogowany, bez danych albo bezpośrednio
z linku?*

Zarzuty, których plan nie uwzględnia, pozostają w `## Charges` oznaczone jako **deferred** z powodem —
nie są usuwane.

### Skanowanie zakodowanych na stałe wartości

Lista kandydatów, nie werdykt — każde trafienie to możliwy zarzut o brakujący token. Uruchom je na
plikach widoku (nigdy na samym źródle tokenów), w przed-audycie i po każdej fazie wizualnej:

```bash
grep -nE '#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(|-\[[0-9.]+(px|rem)\]|\b(bg|text|border|ring|outline|from|via|to|fill|stroke|shadow|divide)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)\b' <view files>
```

Stacki inne niż Tailwind: zachowaj część dotyczącą funkcji kolorów, usuń część dotyczącą klas palety i dodaj
własną formę literału danego stacka (hex wewnątrz styled-component, kolor we właściwości `sx`).
Liczba powinna spadać faza po fazie; liczba rosnąca oznacza regresję.

## Kontrakt systemu projektowego

Kontrakt ma dwie połowy i żadna nie nazywa narzędzia:

1. **Semantyczne tokeny** — jedno źródło wartości, z nazwami opisującymi **rolę** (`primary`,
   `surface`, `muted`, `destructive`), nigdy kolor (`purple-600`).
2. **Komponenty możliwe do zaimportowania, które żyją w repozytorium** — czytelne dla agenta, nie jako czarno-skrzynkowa
   zależność, którą może tylko zgadywać.

Bez obu agent odtwarza prymitywy na każdym widoku. Z obiema ma miejsce, do którego może zajrzeć.

| Stack | Gdzie żyją wartości | Gdzie żyją komponenty |
| --- | --- | --- |
| **Tailwind v4 + shadcn/ui** (wariant kursu) | `:root` / `.dark` w CSS, publikowane przez `@theme` / `@theme inline` | kopiowane do repozytorium, zwykle `src/components/ui` |
| **CSS Modules / zwykłe zmienne CSS** | plik zmiennych (`:root`, często `theme.css` / `variables.css`) | katalog współdzielonych komponentów, importowany ścieżką |
| **CSS-in-JS z motywem** (styled-components, vanilla-extract, Panda) | obiekt motywu lub plik tokenów `.css.ts` | stylowane prymitywy eksportowane z jednego modułu |
| **Biblioteka komponentów z motywem** (MUI, Chakra, Mantine) | obiekt motywu/config biblioteki, rozszerzony w Twoim kodzie | komponenty biblioteki, lokalnie opakowane tam, gdzie je dostosowujesz |

Szczegół Tailwind: `:root` / `.dark` przechowują **wartości**, `@theme inline` **publikuje** je jako
`--color-*`, i dopiero wtedy istnieje `bg-primary`. Surowe kolory wpisane bezpośrednio do
`@theme inline` to klasyczna awaria dark mode — wartości `.dark` są tam, ale przełącznik
nic nie robi. Inne stacki mają własną wersję tego podziału; znajdź ją przed edycją.

Wybierz wariant pasujący do repozytorium i zapisz go w `change.md`:

- **Istniejący system projektowy** — przeczytaj jego źródło wartości, współdzielone komponenty i notatki projektowe,
  zanim cokolwiek zaproponujesz. Rozszerz go; nie rozwidlaj drugiej palety ani nie uruchamiaj drugiego
  `shadcn init`. Istniejący, gorszy system jest lepszy niż lepszy, który przynosisz.
- **Świeży starter z martwym plikiem tokenów** — najczęstszy przypadek greenfield: starter
  dostarcza tokeny i jeden lub dwa komponenty, a ekrany używają klas literałowych. Faza 1 nie polega na
  wyborze motywu; polega na tym, by istniejący widok odczytywał tokeny, które już tam są. Dopiero wtedy
  warto wybierać nowe wartości.
- **Brak systemu projektowego** — wprowadzenie kontraktu **jest** zmianą. Zaproponuj go z trzema
  warunkami zapisanymi w `change.md`: (1) oznaczony jako dodający zależność — decyzję podejmuje uczestnik;
  (2) ograniczony do bloku tokenów plus 2–3 komponentów używanych przez ten widok, nie całej biblioteki;
  (3) przegrywa z czymkolwiek, co repozytorium już ma.
- **Nazwany motyw lub preset** — odwzoruj jego wartości na istniejące nazwy zmiennych; zachowaj małą liczbę
  (primary, surface, border, muted, destructive oraz radius i skalę odstępów).

Niezależnie od źródła wartości, **złóż je w repozytorium**: surowe wartości w pliku w folderze
zmiany oraz linia nazywająca ich źródło obok edytowanego bloku.
Wartości, które żyją tylko w oknie czatu, to wartości, które następna sesja wymyśli ponownie.

Dodawanie komponentu: użyj ścieżki właściwej dla stacka — `npx shadcn add <name>` (lub shadcn MCP,
jeśli jest już skonfigurowany) w wariancie kursu. Nie wymagaj `mcp init`, aby zakończyć zmianę.

## Definicja ukończenia: macierz 7 stanów

Faza stanów jest ukończona, gdy każda komórka jest **pokazana** (w kitchen sink) lub oznaczona
**N/A z powodem** — nie wtedy, gdy szczęśliwa ścieżka wygląda dobrze.

| Stan | Co sprawdzić |
| --- | --- |
| default | zbudowany wyłącznie z tokenów i komponentów repozytorium |
| hover | widoczna zmiana, sterowana tokenami |
| focus-visible | fokus klawiatury widoczny na każdej kontrolce; własny token (`--ring` w shadcn), nie domyślny przeglądarki |
| disabled | wygląda i zachowuje się jak wyłączony, nadal czytelny |
| error | komunikat obok pola/akcji, token `destructive`, nie sam kolor |
| empty | brak danych: rzeczywisty stan pusty, nie pusta ramka ani surowy JSON |
| loading | skeleton lub spinner; brak skoku layoutu po nadejściu danych |

`disabled`, `error` i `focus-visible` rozjeżdżają się jako pierwsze, ponieważ nic na szczęśliwej ścieżce
ich nie ćwiczy. Przesunięcie akcentu nie przesuwa tokenu fokusu — sprawdź go osobno.

Minimum, nie kurs WCAG: każda kontrolka ma dostępną nazwę, a kontrast przy zmianach tokenów
pozostaje poprawny w obu motywach, jeśli aplikacja ma dark mode. Dark mode zmienia się na warstwie tokenów; przebieg
dark mode, który edytuje klasy komponentów, to zamaskowany zarzut o brakujące tokeny.
Desktop plus **jedna** szerokość mobilna — nie macierz responsywności.

## Bramka wizualna

Jeden widok, każdy stan widoczny naraz. Najtańsza forma nie potrzebuje runnera testów:
strona **kitchen-sink** renderująca widok we wszystkich siedmiu stanach obok siebie, ze zrzutami ekranu
na desktopie i przy jednej szerokości mobilnej. Pełni też rolę dowodu do przeglądu i działa w każdym stacku.

Jeśli repozytorium ma już narzędzie do testowania zrzutów ekranu, podłącz do niego bramkę — np.
`await expect(page).toHaveScreenshot({ maxDiffPixels: 100 })` z Playwright, maskując
zmienne regiony (daty, avatary, liczniki). Nie instaluj go, aby spełnić tę umiejętność.
Nigdy nie aktualizuj baseline tylko po to, by CI było zielone, bez uprzedniego wyjaśnienia różnicy wizualnej.

## Utrwal to

Naprawa trwa jedną sesję, chyba że następnemu agentowi powiesz, gdzie ma szukać. Przed przeglądem:

1. **Reguła.** Dodaj krótki blok UI do pliku reguł agenta w repozytorium (tego, który znalazł przed-audyt;
   rozszerz go, nie twórz drugiego; zapisz go **poza** blokiem
   `<!-- BEGIN @przeprogramowani/10x-cli -->` … `<!-- END … -->`, który CLI przepisuje
   przy każdym `get`): gdzie żyją tokeny, gdzie żyją komponenty,
   „check `<components dir>` before creating a component; add missing ones via
   `<stack's path>`”, „no literal colours or arbitrary values in views — use tokens” oraz
   gdzie znajduje się kitchen sink. Usuń lub przepisz każdą regułę zachęcającą do jednorazowych wartości.
2. **Kontrola.** Jeśli repozytorium ma już linter lub hook pre-commit, dodaj skanowanie zakodowanych na stałe wartości
   (lub własną regułę lintera dla tego) ograniczone do widoków, które ta zmiana oczyściła —
   nieudana kontrola jest lepsza niż reguła, o której agent zapomniał. Nowa zależność lint podlega tym samym trzem
   warunkom co nowy system projektowy: zaproponowana, ograniczona zakresem, a decyzję podejmuje uczestnik.
3. **Dokumentacja jako kontekst.** Jeśli repozytorium ma Storybook lub dokumentację komponentów, wskaż je w regule
   zamiast je powtarzać.

## Pętla przeglądu: od zarzutu do PR

Widok może być technicznie poprawny, a nadal nieczytelny — nagłówek konkurujący z głównym
przyciskiem, każda informacja o tej samej wadze, każda drobna rzecz w osobnej karcie.
Oceniaj layout **po** zbudowaniu widoku z tokenów i komponentów repozytorium; na ekranie posklejanym
z jednorazowych klas krytyka layoutu sprowadza się do kosmetycznych poprawek.

1. Uzyskaj krytykę: `/10x-impl-review`, plus opcjonalny przebieg layoutu (Impeccable,
   `frontend-design`), jeśli uczestnik ma je zainstalowane. Nie dodawaj tych narzędzi do repozytorium.
2. Posortuj każde ustalenie według **wpływu na użytkownika**: brakujący pierścień fokusu lub martwa zakładka
   zasługują na równie konkretną decyzję jak błąd logiki.
3. Napraw albo zapisz ustalenie jako odroczone z powodem. Cisza nie jest triage.
4. Uruchom ponownie bramkę wizualną. Ustalenie, które zmieniło widok bez zmiany baseline, jest
   sygnałem ostrzegawczym.

Lista kontrolna merge: [`ui-quality-checklist`](references/ui-quality-checklist.md). Zielone CI samo w sobie
nie jest bramką — test zrzutu ekranu przejdzie bez problemu dla widoku, którego stan `disabled` nigdy nie został
wyrenderowany.

## Routing modeli (najpierw faza, potem dostępność)

Żaden konkretny model nie jest wymagany; praca potrzebuje **wizji** (odczytania zrzutu ekranu) i **użycia narzędzi**.
Kieruj według fazy: najsilniejszy model, jaki masz, do audytu, planu i przeglądu (błędna decyzja tam
kosztuje tuzin edycji w złym kierunku; do przeglądu najlepiej nie ten, który napisał
kod); tańsza warstwa robocza do wdrażania zarzutów w pętli render → porównanie → naprawa.
Eskaluj tylko wtedy, gdy **ten sam zarzut przetrwa dwie rundy**. Jeden model do wszystkiego jest w porządku —
podział zmienia rachunek, nie metodę. W ogóle brak wizji? Wyrenderuj kitchen sink,
opisz stany tekstowo, zachowaj bramkę zrzutów ekranu w CI.

## Twarde reguły

- Żadnego promptu, który jest tylko „make it nicer / prettier”.
- Każdy zarzut zawiera plik, linię i wpływ na użytkownika, zanim trafi do planu.
- Kolory, typografia, radius, odstępy: token z systemu **tego repozytorium**, nie literał w widoku.
- Użyj ponownie istniejącego komponentu lub dodaj go ścieżką właściwą dla stacka; nigdy drugi `Button`.
- Jeden widok plus globalne tokeny na zmianę. Nie rebranding całego MVP.
- Zmiana kończy się regułą w pliku reguł agenta, nie tylko ładniejszym zrzutem ekranu.

## Błędy, których należy odmawiać

| Zapach | Zrób to zamiast tego |
| --- | --- |
| Domyślny fioletowo-niebieski gradient „AI landing” | Najpierw zmień `--primary` / tokeny motywu |
| Nowy prymityw `div`+CSS kopiujący komponent DS | Zaimportuj prawdziwy komponent |
| Zakładka „Selected”, która jest tylko CSS i nie można jej kliknąć | Podłącz stan |
| Nieuwierzytelnione wejście lub wejście stanu pustego, które wyrzuca surowy JSON / pustą ramkę | Napraw punkt wejścia; to zarzut architektoniczny |
| `shadcn init` (lub odpowiednik) w repozytorium, które już dostarcza tokeny i komponenty | Rozszerz pierwszy system |
| Aktualizowanie baseline zrzutu ekranu, aby CI było zielone | Wyjaśnij różnicę wizualną; aktualizuj tylko, jeśli jest zamierzona |
| „Fix the design” jako jedno zadanie agenta w wątku CRUD | Nowy folder zmiany, audyt, plan, bramka |

## Playbooki

Wszystkie zachowują listę zarzutów.

- **Motyw lub zmiana stylu jednego widoku** — domyślna ścieżka, zacznij od tokenów.
- **Odziedziczony bałagan po agencie** — spodziewaj się wszystkich trzech kategorii; napraw tokeny i współdzielony komponent
  przed dotknięciem layoutu i sprawdź plik reguł agenta pod kątem instrukcji, która go spowodowała.
- **Pojedynczy komponent** — pomiń fazę tokenów tylko wtedy, gdy jego wartości już pochodzą z tokenów.
- **Dark mode** — warstwa tokenów, oba motywy w kitchen sink, kontrola kontrastu w bramce.
- **Przebieg focus/keyboard** — faza stanów go obejmuje: focus-visible, nazwy kontrolek, kolejność tabulatora.