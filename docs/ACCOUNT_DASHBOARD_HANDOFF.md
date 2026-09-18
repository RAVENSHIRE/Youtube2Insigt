# Account Research Dashboard — 17. September 2026

Branch `feature/account-research-dashboard`, Basis `ae48469` (Phase 1). Kein Merge nach main und kein Deployment. Keine Änderungen an .env, Datenbank, Authentifizierung, Resend, Analysemodell oder Chrome-Extension-Dateien.

## Umgesetzt

`/account/` zeigt nach Login die Research-Oberfläche in derselben Reihenfolge wie die Sidebar:

1. Kompakte aufklappbare Konto- und Analysesteuerung.
2. Creator Universe / Creator Overview mit Avatar und analysiert/gesamt.
3. Ausgewählter Kanal mit Abonnenten, Gesamtvideos und dynamischem Analysefortschritt.
4. Report-Mix als klickbarer SVG-Donut und Legende: Sektor → Sub-Sektor → Unternehmen. Unternehmen filtern die zugehörigen Videoreports; „Alle Kanalvideos“ setzt zurück.
5. Research Library mit Suche und neuester/ältester Analyse. Dieselbe reine Such-/Sortierdatei wie in der Extension wird eingebunden, nicht kopiert. Persistierte Nummern bleiben bei Sortierung stabil. Die Performance-Option ist bewusst inaktiv, solange die Account-API keine freigegebenen Performancewerte liefert.
6. Titel oder Mini-Kreisdiagramm öffnen den vollständigen gespeicherten Report ohne neue Analyse und ohne automatisch ein YouTube-Video zu öffnen.
7. Ticker sind direkt auf den Videokarten anklickbar. Bestätigte Links führen zur vorhandenen TradingView-Instrumentseite. Für syntaktisch gültige, ungeklärte Symbole gibt es einen Chart-Link mit dem Ticker als Suchvorgabe und einem Hinweis auf die fehlende Börsenbestätigung. Das bestätigt keine Instrumentidentität, erfindet keine Börse und ändert keine gespeicherte Zuordnung. Identitätskonflikte bleiben ohne Link.
8. „CSV-Report“ direkt auf der Videokarte und im geöffneten Report. Export enthält Veröffentlichungszeit, Titel, Creator, Zusammenfassung, Unternehmen, Ticker, Call, Sentiment, Aktionen, Sektor, These, Risiken, Ziele, Levels und Originalbelege einschließlich vorhandener Zeitmarken. Komplexe Felder als JSON-Zellinhalt, UTF-8 mit BOM, korrektes Quoting und Schutz gegen Tabellenformeln. Dies ist ein Research-Export, kein Yahoo-Importformat. Die alten Symbol-CSV-Endpunkte bleiben für die funktionierende Extension erhalten.
9. Den gewünschten Werbeblock „Vom Video zur Watchlist“ inklusive Yahoo-Anleitung und zugehöriger Hinweise aus `/account/` entfernt. Die entsprechende Watchlist-Werbekarte auf der Landingpage ebenfalls entfernt.

## Prüfung

209 automatisierte Tests bestanden. Enthalten: Registrierung/Anmeldung, Credit-Success/-Failure, gespeicherte Reports, bestehende IPO/RKLB/ASTS-Links, Creatorwechsel mit verspäteter Antwort, Kanalfilter/Donutgruppen, stabile Nummern, CSV-Inhalte und Formelschutz, 401 ohne Sitzung / 404 bei fremdem Report, öffentliche Beispiel-CSV ohne persönliche Daten. Syntaxprüfung und `git diff --check` bestanden.

Kein neuer Live-Gemini-Aufruf, keine erneute echte Resend-Zustellung und kein visueller Browser-Pass behauptet. Die Cloud-Browserprüfung lokaler Seiten war mit `ERR_BLOCKED_BY_CLIENT` blockiert; die visuelle Abnahme erfolgt lokal. Kontodaten hier nur Testfixtures. Es wurden keine Nutzer-Credits verbraucht.

## Übernehmen

Server stoppen. Den Patch `account-research-dashboard.patch` in Downloads speichern. Er setzt den bereits angewendeten Phase-1-Patch voraus. Bestehende Änderungen behalten, kein Reset/Stash-Pop nötig. Vor dem Anwenden betroffene Dateien sichern. Im Projektroot:

```powershell
Set-Location 'C:\Users\j.krayenbuehl\Desktop\dev\Youtube2Insigt'
$Patch = Join-Path $env:USERPROFILE 'Downloads\account-research-dashboard.patch'
git apply --check $Patch
if ($LASTEXITCODE -ne 0) { throw 'Patch passt nicht zum aktuellen Stand. Nichts anwenden.' }
```

Bei erfolgreichem Check einen eigenen Feature-Branch verwenden, anschließend:

```powershell
git apply $Patch
if ($LASTEXITCODE -ne 0) { throw 'Patch fehlgeschlagen.' }
npm test --prefix server
if ($LASTEXITCODE -ne 0) { throw 'Tests fehlgeschlagen.' }
```

```powershell
node .\server\server.js
```

## Lokale Abnahme

- `/account/` mit Strg+F5 aktualisieren und mit vorhandenem Konto anmelden.
- Bei einem Creator wird dessen Dashboard automatisch geöffnet. Kanalzahlen müssen den gespeicherten Sidebar-Werten entsprechen. Bei mehreren Creators wechseln: keine Reports des vorigen Kanals sichtbar.
- Technology im Report-Mix anklicken → Sub-Sektor → Unternehmen. Nur passende Videoreports erscheinen; Zurücknavigation testen.
- Nach einem Ticker suchen; neueste/älteste Analyse wechseln. Reportnummern dürfen sich nicht ändern.
- Titel oder Mini-Kreis anklicken: vollständiger Report. Wieder schließen/öffnen: kein Creditverbrauch.
- RKLB/ASTS oder einen anderen bestätigten Ticker anklicken: bestehende TradingView-Seite. Bei unbestätigten Symbolen die Instrumentauswahl bei TradingView prüfen; keine automatische Gleichsetzung unterschiedlicher Firmen.
- CSV-Report direkt herunterladen. Datei muss These und Belege enthalten, nicht nur Symbole. Creditstand unverändert. Breite 390 px und Desktop auf horizontales Überlaufen prüfen.
- Der entfernte Watchlist-Werbeblock darf nicht mehr erscheinen. Konto & Pro und Video analysieren sind aufklappbar. Authentifizierung und Analyseablauf unverändert.
