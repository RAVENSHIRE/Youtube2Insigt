# SignalTube — Phase 1 Handoff

Stand: 16. September 2026. Branch `feature/phase-1-product-polish`, aufbauend auf `a52d151` (`fix/saved-report-access`). Lokaler Feature-Stand; kein Merge nach `main`, kein Deployment. Der Patch basiert auf dem zuletzt funktionierenden Stand einschließlich gespeicherter Reports und Extension-Origin-Hilfe, nicht auf dem älteren Remote-Commit `49491f7` allein.

## Ergebnis

- Landingpage unter `/`: SignalTube, YouTube → Investment Research, Analyseablauf, klare CTA zu `/account/`, ehrliche Beta-/Beispielhinweise. Keine erfundenen Testimonials, Preise oder Store-Verfügbarkeit.
- Kontoseite und vollständiger Webbericht nutzen den dunklen Hintergrund, roten Akzent, Kontrast und Rundungen der bestehenden Extension. Vierfeldregistrierung, Zweifeldlogin, Resend und Quotenlogik bleiben unverändert.
- Pro ist eine deaktivierte Coming-soon-Vorschau. Keine Checkout-/Portal-Anfragen mehr aus der Kontoseite. Bestehende Backend-Billingmodule wurden nicht erweitert oder entfernt; Stripe darf für diese Phase nicht aktiviert werden.
- Veröffentlichungsdatum in persönlicher Webbibliothek und vollständigen Reports hervorgehoben; unbekannte Veröffentlichung wird nicht durch Analysezeit ersetzt. Webdatum in Europe/Zurich. Der gespeicherte Originalzeitstempel bleibt unverändert.
- Watchlist-CSV aus Web- und Extension-Report, einschließlich Beispielen. GET `/videos/:videoId/watchlist.csv` ist authentifiziert und kontogebunden; `/examples/videos/:videoId/watchlist.csv` liefert nur öffentliche Beispielassets.
- CSV mit `Symbol` und leeren Yahoo-Positionsspalten: keine Kaufpreise, Mengen, Datumskäufe oder Renditen erfunden. Bekannte US-Listings werden über die bestehende Instrumentzuordnung aufgelöst, Symbole dedupliziert. RKLB/ASTS funktionieren; RZLB wird über die bestehende Identität als RZLV exportiert. INDO/INOD-Konflikte, ungeklärte Lifecycle-Übergänge und nicht zugeordnete/ausländische Listings werden ausgelassen. Keine automatische Yahoo-Verknüpfung.
- Export ergänzt keine Analyse und verändert keine gespeicherten Reports. Kein zusätzliches Extension-Recht, keine neue Abhängigkeit, keine Datenbankmigration.
- [Kostenmodell](docs/PHASE_1_COST_MODEL.md) mit geprüfter Preistabelle, Code-Audit, gemessenen Beispielgrößen und klar markierten Annahmen.

## Geänderte Bereiche

`server/web/`: Branding, CSS, Landingpage, Pro-Vorschau, Publikationsdatum, Exportlink. `server/exports/watchlistCsv.js`: Symbolauflösung und CSV. `server/accounts/routes.js` / `server/onboarding/routes.js`: Landing-/Export-Routen. `extension/watchlist-download.js`: authentifizierter Download, Scopewechsel-Schutz und Fehlermeldung. `extension/sidepanel.*`: Script-Einbindung, Datum und Export-Schaltfläche. Tests und Roadmap ergänzt.

Nicht geändert: Analyseprompt, Modell, Quellsegment-/Zitatvalidierung, Authentifizierungsimplementierung, Resend, Credit-Reservierung, bestehende TradingView-Auflösung und Tabnavigation. Recovery-Bundle vor Beginn erstellt; unversionierte frühere Patches wurden erhalten. Nutzer-.env, SQLite-Daten und Runtime-Dateien wurden nicht verändert.

## Nachweise

| Prüfung | Ergebnis und Aussagegrenze |
|---|---|
| Vollständige Node-Testsuite | 205 Tests bestanden, 0 fehlgeschlagen, 0 übersprungen |
| Syntax und `git diff --check` | Bestanden |
| MV3-Entwicklungsbuild | Erfolgreich, 13 Dateien; enthält Export-Script, keine Server-/Umgebungsdateien |
| Registrieren, Verifizieren, Login, Analyse | Bestehende automatisierte HTTP-/Provider-Fixture-Tests grün; kein neuer Live-Provider-Aufruf in dieser Phase |
| CSV-Nutzertrennung | Eigener Report 200, fremdes Konto 404, ohne Sitzung 401, kein zusätzlicher Job/Creditverbrauch |
| Beispielbibliothek / IPO / RKLB / ASTS | Bestehende HTTP-/Render-Tests grün, CSV enthält RKLB/ASTS; TradingView-Links unverändert |
| Download-Oberfläche | Ereignis-/DOM-Fixture prüft Download und echten Fehlerstatus; kein Chrome-Download-Live-Nachweis |
| Browser | Lokale Landingpage im Cloud-Browser durch `net::ERR_BLOCKED_BY_CLIENT` blockiert. Keine Screenshots oder Desktop-/Mobil-Abnahme behauptet |
| Früherer echter Nutzer-Test | Erfolgreiche Analyse RN_C7a66OSA, Auftrag fe9ef3c8-2c53-45c5-97c6-dd91c171cdce; Nutzer bestätigte anschließend Extension-Zugriff. Das ist ein vorheriger Nutzer-Nachweis, kein neuer Test dieser Phase |
| Yahoo Finance Import | CSV-Struktur getestet, tatsächlicher Import in Yahoo NICHT verifiziert. Kontoverfügbarkeit/Importformat extern noch bestätigen |

## Lokal übernehmen und testen

1. Node-Server mit Ctrl+C stoppen. Bestehende Projektdateien sichern; insbesondere uncommittete Änderungen behalten. Keinen neuen Projektordner anlegen, keinen Reset und keinen automatischen Stash-Pop ausführen.
2. Den gelieferten `phase-1-product-polish.patch` in Downloads speichern. Im bestehenden Projektroot zuerst `git apply --check` ausführen. Bei Fehler nichts anwenden: Die Basis weicht dann vom erwarteten zuletzt getesteten Stand ab.
3. Nach erfolgreichem Check Patch anwenden. Auf einem eigenen Feature-Branch bleiben; nicht nach `main` mergen. `.env` bleibt unverändert.
4. `npm test --prefix server`, danach `node .\server\server.js` im Projektroot.
5. `http://localhost:3000/` öffnen: SignalTube-Landingpage, CTA führt zu `/account/`. Mobilbreite und Desktop testen; Fokus mit Tab sichtbar, keine abgeschnittenen Buttons.
6. Mit vorhandenem bestätigtem Konto anmelden. Credit-Stand notieren. Gespeicherten vollständigen Report öffnen: Veröffentlichungsdatum, Originalbelege und TradingView prüfen. CSV herunterladen; danach unveränderter Credit-Stand. Pro darf keinen Zahlungsdialog öffnen.
7. In `chrome://extensions` die bestehende Erweiterung neu laden (keine Neuinstallation, gleiche ID). YouTube-Tab aktualisieren. Persönlichen Report öffnen; CSV laden. Beispielbibliothek → IPO Market Watch → RKLB/ASTS prüfen: richtige TradingView-Seiten und CSV-Symbole. CSV-Export darf kein neues Video öffnen.
8. CSV zunächst in einer leeren Test-Watchlist bei Yahoo Finance importieren, falls das Konto Import anbietet. Symbole/Listingnamen überprüfen; es dürfen keine Käufe oder Positionen entstehen. Importergebnis dokumentieren. Nicht als bereits bewiesene Kompatibilität vermarkten.
9. Neue Analyse nur bewusst mit verfügbarem Credit starten; vollständigen Report und Creditverbrauch prüfen. Ein erzwungener Providerausfall sollte Credit freigeben (automatisiert bereits abgedeckt). Kein weiterer Gratis-Credit wurde für die UI-Prüfung vergeben.

PowerShell-Befehle einzeln kopieren, ohne `PS C:\…>` oder `>>`:

```powershell
Set-Location 'C:\Users\j.krayenbuehl\Desktop\dev\Youtube2Insigt'
```

```powershell
$Patch = Join-Path $env:USERPROFILE 'Downloads\phase-1-product-polish.patch'
git apply --check $Patch
if ($LASTEXITCODE -ne 0) { throw 'Patch passt nicht. Nichts wurde angewendet.' }
```

Erst bei erfolgreichem Check:

```powershell
git apply $Patch
if ($LASTEXITCODE -ne 0) { throw 'Patch fehlgeschlagen. Nicht fortfahren.' }
npm test --prefix server
if ($LASTEXITCODE -ne 0) { throw 'Tests fehlgeschlagen. Server noch nicht starten.' }
```

```powershell
node .\server\server.js
```

## Offene Release-Anforderungen

Lokale visuelle Chrome-Abnahme; tatsächlicher Yahoo-Import; Stichprobe echter DE/EN-Reports und Zeitmarken; Betreiber-/Datenschutzangaben; Prüfung der Beispielquellen/Verbreitungsrechte; gemessene Stückkosten und Lastverhalten. Die derzeitigen Datenschutzseiten sind Entwürfe und ein öffentlicher Launch ist damit nicht freigegeben. Resend/Gemini/YouTube-Schlüssel bleiben nur serverseitig. Kommerzielle Marktdaten und nicht geprüfte Audio-/Visual-Pfade nicht versprechen.

## Nächste Phase — noch nicht gestartet

Nach Abnahme: Beta-Onboarding und Vertriebsumfang verbindlich festlegen, echte Kosten messen, rechtliche/operative Launch-Voraussetzungen abschließen. Erst mit eigener Freigabe Hosting und Pro-Abrechnung. Keine Portfolio-App, MCP-/Chat-Oberfläche, Stock-/Creator-Rankings oder weitere Analyseagenten in diese Phase aufnehmen.
