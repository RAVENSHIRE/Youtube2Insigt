# Belegauswahl und lokaler Test-Reset — 18.09.2026

Branch: `fix/evidence-groups-local-reset`. Patch-Basis: `52e004c` (Free-Retest-Helfer und aktuelles Account-Dashboard). Keine Änderung an main, Auth, Resend, TradingView, Beispielbibliothek oder Pro/Checkout.

## Fehler und Lösung

Job `f9158308-0ee7-4364-811d-03d34162c3c8`, Video `h2vHUSvcTIA`, scheiterte nach zwei Modellantworten in `evidence_validation`, Firma 3/Beleg 1. Die bisherige Meldung umfasst sowohl unbekannte IDs als auch gültige, aber getrennte Stellen. Die konkrete Auswahl fehlt im Log: Kein Nachweis, welche Variante bei diesem Lauf vorlag.

- `resolveEvidenceGroups` prüft Auswahlgröße (1–6), Typ, Duplikate, bekannte IDs und Originalreihenfolge. Gültige getrennte Stellen werden in zusammenhängende Gruppen geteilt.
- `validateSelectedReport` erstellt pro Gruppe ein separates Originalzitat und eigene Quellzeitmarken. Ausgelassene Segmente werden weder ergänzt noch zu einer scheinbar durchgehenden Aussage zusammengeschnitten. Maximal 5 Auswahlen × 6 getrennte Stellen = 30 Belege je Firma. Kein stilles Abschneiden.
- Legacy-Zitatprüfung bleibt streng. Unbekannte, vertauschte, doppelte oder gemischte Auswahlen scheitern weiterhin; höchstens eine erneute Extraktion. Reparaturanweisung enthält den präziseren Fehlergrund.
- Neue Reports tragen `evidence_extraction_version: 3`. Originalquelle, alte Reports, Evidence-Version 1 und Analysis-Version 8 bleiben unverändert. Kein automatisches Neuschreiben vorhandener Reports.
- Fehlerlogs nennen `error.selection.reason`, `ids` und `sourceSegmentCount`. Keine Originaltexte oder Zugangsdaten in diesen Feldern. IDs werden auf erwartetes Format und Anzahl begrenzt.
- Quellenübereinstimmung bestätigt die Herkunft eines Zitats, nicht automatisch die sachliche Richtigkeit jeder daraus abgeleiteten These.

## Reset-Verhalten

`prepare-free-retest.js --hide-existing` legt vor Änderungen einen verifizierten SQLite-Backup an und blendet bestehende Reports über eine optionale lokale Sichtbarkeitstabelle aus. Die Dashboard-/Creator-Statistik und Research-Abfragen sehen nur sichtbare Reports. Manuell vorgemerkte Creator und Beispiele bleiben bestehen.

Originalberichte, Library-Mitgliedschaften, Eigentümer, Nummerierung, Jobs und ursprüngliche Credit-Verbräuche bleiben erhalten. Ein bekannter alter Report bleibt direkt kostenlos lesbar; ein neuer Analyseversuch derselben Video-ID ist weiterhin ein kostenloser Cache-Treffer. Deshalb ein anderes Video verwenden.

Bereits ein Credit verfügbar: kein neuer Credit. Ein echter Fehler gibt den reservierten Credit frei. Neuer Erfolg: genau ein Credit verbraucht und genau ein neuer sichtbarer Report. Die neue Nummer wird nicht auf 01 zurückgesetzt. Wiederherstellen blendet die alten Nummern unverändert wieder ein.

Der Helfer ist ausschließlich lokal aufrufbar, kein HTTP-Endpunkt. Produktions-/öffentliche Umgebungen werden abgelehnt. Ohne `--apply` keine Änderungen. Bei laufenden Jobs ist Vorbereitung gesperrt. Vor einer eventuellen Übernahme der lokalen Datenbank in Produktion die Sichtbarkeit wiederherstellen; dies ist keine Datenmigration für den Produktivbetrieb.

## Patch anwenden

Server mit Ctrl+C stoppen. `evidence-groups-reset.patch` herunterladen; vollständigen folgenden Block im bestehenden Projekt ausführen. Bei einem Prüffehler stoppen, keinen Reset/Force-Apply ausführen.

```powershell
& {
    Set-Location 'C:\Users\j.krayenbuehl\Desktop\dev\Youtube2Insigt'
    $Patch = Join-Path $env:USERPROFILE 'Downloads\evidence-groups-reset.patch'
    if (-not (Test-Path -LiteralPath $Patch)) { throw 'Patch zuerst herunterladen.' }
    git apply --check $Patch
    if ($LASTEXITCODE -ne 0) { throw 'Patch passt nicht zum aktuellen Stand. Nichts anwenden.' }
    git apply $Patch
    if ($LASTEXITCODE -ne 0) { throw 'Patch konnte nicht angewendet werden.' }
    npm test --prefix server
    if ($LASTEXITCODE -ne 0) { throw 'Tests fehlgeschlagen. Server noch nicht starten.' }
}
```

Danach Vorbereitung (E-Mail und URL interaktiv; keine Passwörter nötig):

```powershell
node .\server\scripts\prepare-free-retest.js --local-development --apply --hide-existing
```

Als URL `https://www.youtube.com/watch?v=h2vHUSvcTIA` verwenden. Erwartet: `status: ready` oder `already_ready`, `credits_after: 1`, `hidden_reports` entsprechend dem alten Bestand. Bei Änderungen steht der verifizierte Backup-Pfad im Ergebnis. Bei Abbruch nicht blind weitergehen.

```powershell
node .\server\server.js
```

Konto-Seite und Sidepanel neu laden. Persönliche Übersicht vor dem neuen Lauf leer; 1 Credit verfügbar. Video einmal bewusst starten. Erwartet: vollständiger Report mit klickbaren getrennten Belegen, `analysis_completed`, Credit 0. Report in Konto und Extension, TradingView/CSV und kostenloses Wiederöffnen prüfen. Bei Fehler neue `[analysis]`-Zeile sichern; Credit muss wieder 1 sein. Kein weiterer Reset nötig, solange 1 Credit verfügbar ist.

Alternativ vor einem manuellen Analyseversuch im zweiten Terminal `& .\server\scripts\Test-FreeAnalysis.ps1` ausführen; gleiche URL wählen. Der Prüfer verbraucht den Credit bewusst und prüft eine neue sichtbare Bibliothekszeile. Sein `previous_reports_preserved` betrifft die vorher sichtbaren Einträge; die unveränderten ausgeblendeten Reports sind separat automatisiert getestet.

Alte Übersicht nach dem Test wiederherstellen (Server vorher stoppen):

```powershell
node .\server\scripts\prepare-free-retest.js --local-development --restore-library --apply
```

Danach Server starten und Konto/Sidepanel neu laden. Kein weiterer Analyse-Credit wird dabei vergeben.

## Verifikation

- Vollständige Suite: 220 Tests bestanden, 0 fehlgeschlagen, 0 übersprungen.
- DE/EN: getrennte Originalbelege, genaue Segmentzeitmarken, kein Auffüllen von Lücken, kein Umschreiben gespeicherter Quellen.
- Unbekannte IDs: bounded repair, präzise sichere Diagnose, fehlgeschlagener Job ohne Report und mit Creditfreigabe.
- Erfolgsweg: geteilte Auswahl gespeichert, einmaliger Verbrauch; bestehende API-/Account-Tests grün.
- Reset: Backup-Integrität, Wiederholbarkeit, vorhandener Credit, Account-Isolation, verborgene/alte/neue Reports, stabile Sequenzen, Fehlerfreigabe, Wiederherstellung ohne Gutschrift und Produktionssperre.
- Regressionen für Anmeldung, Beispiele, TradingView, Dashboard/CSV und Analyseablauf sind Teil der gesamten automatisierten Suite.
- Kein neuer echter YouTube-/Gemini-Lauf hier: Windows-Konto, lokale Datenbank und Schlüssel stehen nicht zur Verfügung. Keine neue visuelle Chrome-/PowerShell-Verifikation. Deshalb noch kein Merge-Nachweis.
