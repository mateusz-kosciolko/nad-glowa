# Pomiar źródeł ADS-B (F-01, faza 1)

- **Uruchomienie:** 2026-09-28, 11:13–11:40 UTC, `npm run adsb:measure` (`scripts/adsb-measure.mjs`), z sieci lokalnej (nie z IP Cloudflare)
- **Parametry:** domyślny punkt 52.23, 21.01 (centrum Warszawy), promień 100 km = 54 nm, 6 próbek co 300 s, do 10 zapytań o trasę na próbkę
- **Kod wyjścia:** 0

## Tabela zbiorcza

Odsetki są liczone dla samolotów w powietrzu (z pozycją i bez `alt_baro === "ground"`). „t zgodne z wzorcem” jest liczone tylko wśród niepustych `t`, wzorzec to `^[A-Z0-9]{2,4}$` po `trim` i `toUpperCase`.

| Źródło         | Próbki OK | Czas śr. [ms] | ac śr. | W powietrzu śr. | t niepuste | t zgodne z wzorcem | hex    | r     | flight | track | gs    | Wojskowe (dbFlags&1) | hex ~ | seen_pos med / max [s] | Trafienia tras |
| -------------- | --------- | ------------- | ------ | --------------- | ---------- | ------------------ | ------ | ----- | ------ | ----- | ----- | -------------------- | ----- | ---------------------- | -------------- |
| adsb.fi        | 6/6       | 99            | 31.8   | 22.7            | 94.9%      | 100.0%             | 100.0% | 94.9% | 99.3%  | 97.8% | 97.8% | 0                    | 0     | 0.299 / 50.563         | —              |
| adsb.lol       | 6/6       | 161           | 31.7   | 21.7            | 80.0%      | 100.0%             | 100.0% | 80.0% | 100.0% | 94.6% | 94.6% | 0                    | 0     | 0.28 / 43.955          | —              |
| adsbdb (trasy) | 60/60     | 42            | —      | —               | —          | —                  | —      | —     | —      | —     | —     | —                    | —     | —                      | 37/60 (61.7%)  |

## Kody typów spoza wzorca

- adsb.fi: brak
- adsb.lol: brak

Mapowanie kodów typów między źródłem a ustawieniami z S-02 nie jest potrzebne.

## adsb.lol `routeset`

`POST /api/0/routeset` z 10 samolotami (`{callsign, lat, lng}`) zwrócił **HTTP 201 z pustym ciałem**, tak samo jak w szybkim przebiegu i w researchu. W tej postaci endpoint nie dostarcza tras. Źródłem tras dla S-07 jest adsbdb: 61.7% trafień na 60 znakach wywoławczych, średnio 42 ms, bez odmów.

## Obserwacje

- W żadnej próbce nie było samolotów wojskowych (`dbFlags & 1`) ani adresów spoza ICAO (`~`). Brak samolotów wojskowych wokół Warszawy w ciągu 30 minut nie mówi nic o zasięgu flagi. Flagę potwierdza jedynie research na `/v2/mil`.
- Mediana `seen_pos` jest poniżej 0,3 s. Pojedyncze wpisy mają pozycję sprzed około 50 s, więc S-03 powinien uwzględniać wiek pozycji przy predykcji.
- adsb.lol ma typ i rejestrację rzadziej niż adsb.fi (80.0% wobec 94.9%). To liczba samolotów bez wpisu w bazie maszyn, nie błąd formatu.

## Werdykt względem progu

Próg: `t` u ≥ 90% samolotów w powietrzu i ≥ 95% obecnych `t` zgodnych ze wzorcem, łącznie ze wszystkich próbek, osobno dla każdego źródła.

- **adsb.fi (podstawowe): spełnia** (94.9% i 100%). Zmiana idzie dalej.
- **adsb.lol (zapasowe): nie spełnia** progu pokrycia typu (80.0% < 90%), a zgodność wynosi 100%. Zgodnie z planem zmiana idzie dalej, a ten fakt trafi do „Otwartych ryzyk” w `adsb-source.md`. Po przełączeniu na zapas około 1 na 5 samolotów zostałby pominięty przez regułę typów.
