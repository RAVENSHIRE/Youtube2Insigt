# Free-Abnahme mit einem anderen Video

Stand 18.09.2026. Aktueller Fix-Branch `fix/evidence-groups-local-reset`, Basis `52e004c`.

Der echte Lauf `h2vHUSvcTIA` scheiterte an `EVIDENCE_UNSUPPORTED`. Die alte Meldung unterscheidet unbekannte IDs nicht von nicht zusammenhängenden Stellen. Ohne die ausgewählten IDs lässt sich dieser Einzelfall nicht enger bestimmen. Der Fix verarbeitet gültige getrennte Originalstellen als separate Belege. Unbekannte IDs bleiben ein Fehler; neue Diagnosefelder zeigen Grund, maximal sechs IDs und Quellsegmentanzahl, ohne Quelltext/Schlüssel zu protokollieren. Details und aktueller Patch: [Beleg-/Reset-Fix](EVIDENCE_GROUPS_RESET.md).

## Reihenfolge / Freigabe

Die neue Kontoseite ist vom Nutzer lokal bestätigt. Vor dem Merge nach main fehlt noch ein echter neuer Videoanalyse-Lauf mit zurückgesetztem lokalem Test-Credit. Automatisierte Tests sind kein Ersatz dafür. Erst nach diesem Nachweis: aktuellen Windows-Arbeitsstand/Branch mit GitHub abgleichen, Codeänderungen inklusive angewendeter Patches sichern, Feature-PR prüfen und nach main mergen. Kein Reset, kein Löschen alter Daten, keine Übernahme von .env oder SQLite-Dateien nach GitHub.

Danach separat `feature/pro-checkout-access`: Entwicklungs-Checkout (Stripe-Testmodus mit verifiziertem Webhook statt vorgetäuschter Live-Zahlung), serverseitige Pro-Freischaltung und Kontingent. Nach Checkout direkt Creator Universe → Kanal → Report-Mix → Research Library. „Konto & Pro“ nicht mehr als großer Reiter in der Research-Ansicht; Anmeldung/Abmeldung und spätere Kontoverwaltung über ein kompaktes Profilmenü erreichbar halten. Diese Pro-Arbeit wurde noch nicht begonnen.

## Was der Testhelfer tut

`server/scripts/prepare-free-retest.js` ist ein lokales Wartungswerkzeug, kein HTTP-Endpunkt. Nur mit `--local-development`, niemals bei NODE_ENV=production oder einer öffentlichen PUBLIC_BASE_URL. Es verwendet die bestehende ACCOUNT_DB_PATH aus der Projekt-.env oder die normale lokale SQLite-Datei.

- Bestehendes verifiziertes Free-Konto und ein noch nicht gespeichertes Video erforderlich.
- Ohne `--apply` nur Prüfung, keine Änderung.
- Mit `--hide-existing` werden bestehende Reports aus der persönlichen Übersicht ausgeblendet. Originalberichte, Eigentümerschaft, Nummern und Jobverlauf bleiben gespeichert. Keine zusätzliche Gutschrift, wenn bereits ein Credit verfügbar ist.
- `--restore-library --apply --local-development` blendet sie nach einem Backup wieder ein, ohne Credits zu ändern. Kein Löschen oder Überschreiben von Reports. Die optionale lokale Sichtbarkeitstabelle ändert nicht das Konten-Schema. Vor Übernahme einer lokalen Datenbank in eine andere Umgebung die ausgeblendeten Einträge wiederherstellen.
- Ein ausgeblendeter Report bleibt über seine bekannte Video-ID kostenlos lesbar. Manuell vorgemerkte Creator und die separate Beispielbibliothek bleiben unverändert.
- Vor einer Gutschrift oder Sichtbarkeitsänderung wird ein neuer SQLite-Backup-Snapshot mit Integritätsprüfung unter dem Datenbankordner `/recovery/` angelegt. Kein zweiter Projektordner.
- Genau ein zusätzlicher, als `dev-retest:<user>:<video>` nachvollziehbarer Free-Test-Credit, 24 Stunden gültig. Der ursprüngliche verbrauchte Gratis-Credit, Reports und Jobs bleiben unverändert.
- Bereits ein Credit verfügbar: keine weitere Gutschrift. Gleichzeitige Aufrufe können das Konto nicht über einen verfügbaren Credit auffüllen.
- Laufende/reservierte Jobs blockieren die Vorbereitung; erst Abschluss/Fehler bzw. Wiederanlauf abwarten.
- Der Credit wird nicht an ein bestimmtes Video gebunden. Deshalb für die Abnahme genau die neue URL verwenden, die bei der Vorbereitung angegeben wurde.
- Anbieter-/Quellenfehler geben den reservierten Test-Credit weiterhin frei. Erfolgreiche Analyse verbraucht ihn. Das erneute Lesen kostet nichts.
- Kein Passwort, API-Key oder Session-Token wird ausgegeben. Es werden keine Konto- oder Modellparameter geändert.

## Übernehmen und live testen

Server mit Ctrl+C stoppen. `free-second-video-test.patch` aus dem Chat nach Downloads speichern. Im vorhandenen Projektroot:

```powershell
$Patch = Join-Path $env:USERPROFILE 'Downloads\free-second-video-test.patch'
git apply --check $Patch
if ($LASTEXITCODE -ne 0) { throw 'Patch fehlt oder passt nicht. Nichts anwenden.' }
git apply $Patch
if ($LASTEXITCODE -ne 0) { throw 'Anwenden fehlgeschlagen.' }
npm test --prefix server
if ($LASTEXITCODE -ne 0) { throw 'Tests fehlgeschlagen.' }
```

Lokalen Test-Credit vorbereiten (E-Mail und andere YouTube-URL werden interaktiv abgefragt):

```powershell
node .\server\scripts\prepare-free-retest.js --local-development --apply --hide-existing
```

Nur bei `status: ready` oder `already_ready` mit einem Credit weiter:

```powershell
node .\server\server.js
```

**Entweder manuell:** Konto neu laden → verfügbar 1 → das NEUE Video bewusst starten → Report vollständig öffnen → verfügbar 0. Nach dem Ausblenden ist die persönliche Übersicht leer; der neue Report erscheint dort allein. Alte Reports bleiben gespeichert und können mit `--restore-library` wieder eingeblendet werden. Stabile Nummerierung wird nicht zurückgesetzt: der neue Report kann Report 02 heißen. Serverlog muss `analysis_completed` für die neue Video-ID enthalten. CSV/TradingView und dieselben Reports in der Extension prüfen. Bei Fehler: `analysis_failed`, keine neue Bibliothekszeile, Credit weiterhin 1.

**Oder automatisierter Live-Nachweis** in einem zweiten PowerShell-Fenster im Projektroot:

```powershell
& .\server\scripts\Test-FreeAnalysis.ps1
```

Das Skript fragt URL und vorhandene Kontozugangsdaten ab, übergibt sie nur per stdin an den lokalen Prüfer und verbraucht den einen Credit bewusst. Keine Zugangsdaten in den Chat kopieren. Wenn PowerShell die Datei wegen lokaler Ausführungsrichtlinien blockiert, den manuellen Browser-Test verwenden; die Sicherheitsrichtlinie wird nicht automatisch verändert.

Der Prüfer kontrolliert zusätzlich: frische Originalquelle, gespeicherter Report, genau ein verbrauchter Credit, alle vor dem Lauf sichtbaren Videos weiterhin sichtbar, genau eine neue sichtbare Bibliothekszeile, kostenloser Wiederaufruf. Bereits gespeicherte Videos zählen nicht als frischer Test. `status: success`, `credit_consumed_once: true`, `previous_reports_preserved: true`, `new_video_in_library: true` und `reread_free: true` sind der erwartete Nachweis. Bei echter Störung ist `analysis_failed` mit `credit_released: true` korrekt, aber kein Merge-Nachweis für den Erfolgsfall.

Nur EINE der beiden Methoden für das neue Video ausführen. Ein manueller Erfolg vor dem Prüfer wird dort korrekt als gespeicherter statt frischer Report erkannt. Danach in Konto und Extension visuell kontrollieren, keine zweite Analyse starten.

## Prüfung hier

220 automatisierte Tests bestanden; Provider-Antworten sind Testdaten, kein neuer Live-Gemini-Nachweis. Darunter getrennte DE/EN-Belege mit unveränderten Zeitmarken, ungültige IDs mit Creditfreigabe sowie Ausblenden/Wiederherstellen alter Reports ohne Änderungen an Inhalten oder Credits. Neue Tests: verifizierter SQLite-Backup vor Gutschrift, Idempotenz, parallele Vorbereitung, Produktionssperre, unverifizierte Konten, Erhalt des alten Reports/Jobverlaufs, Erfolgsverbrauch und Creditfreigabe beim zweiten Video. Live-Prüfer erkennt verlorene alte Bibliothekseinträge als fehlgeschlagene Abnahme.

Kein echter Account-Reset oder neuer Gemini-Lauf hier: Windows-Datenbank und lokale Zugänge sind nicht verfügbar. PowerShell-Wrapper als Datei geliefert, hier kein Windows-/PowerShell-Ausführungsnachweis. Main unverändert; Pro/Checkout unverändert.
