# Panel-Ticker — 18.09.2026

Branch `fix/panel-tradingview-tickers`, Patch-Basis `3c4918b`.

Der Nutzer hat den neuen vollständigen Free-Report, `analysis_completed` und Credit-Verbrauch auf 0 bestätigt. Dieser Nachweis stammt vom Nutzerrechner. Die noch gemeldete Abweichung betrifft ausschließlich TradingView im Panel.

## Ursache und Änderung

Die Research-Library-Ticker waren Buttons mit `data-company-key` und öffneten den internen Unternehmensbericht. Die Web-Kontoseite verwendete bereits TradingView-Anker. Zusätzlich bot das Panel ohne verifizierte `tradingview_url` nur einen Text-Badge, während die Kontoseite eine ausdrücklich unbestätigte Symbolabfrage anbietet.

`extension/sidepanel.js`: `panelTradingViewTarget` und `renderPanelTicker` wenden dieselbe Ziel- und Konfliktprüfung wie die Kontoseite an. Verifizierte URLs werden bevorzugt. Sichere Symbole ohne bestätigten Börsenplatz verlinken die TradingView-Symbolabfrage mit einem Zuordnungshinweis. Bei `identity_conflict` entsteht kein Link. Ticker in Videokarten, vollständigen Reports und Unternehmenshistorie nutzen diese Darstellung.

`handleVideoReportSelection` lässt normale TradingView-Linknavigation zu, ohne den Report oder YouTube zusätzlich zu öffnen. Titel und Mini-Kreisdiagramm behalten die bisherige Funktion. Report-Mix-Auswahl bleibt erhalten. `extension/sidepanel.css` erhält nur die Textdekoration für die neuen Link-Chips.

Backend, gespeicherte Berichte, Konto-Webseite, Auth, Resend, Creditlogik und Pro sind unverändert.

## Prüfung

224 Tests bestanden, 0 Fehler, 0 übersprungen. Neue Tests führen die tatsächlichen Panel-Render-/Klickfunktionen mit isolierten UI-Abhängigkeiten aus:

- RKLB/ASTS-Ziele und Symbol-Fallback stimmen mit der Kontoseite überein.
- Unsichere URLs/Markup und Identitätskonflikte erzeugen keine falschen Links.
- Videokarten behalten Nummerierung und Report-Titel-/Diagramm-Navigation.
- Ticker-Klick greift nicht in normale Linknavigation ein und öffnet keinen zusätzlichen YouTube-Tab.
- Vollständiger Report behält Inhalt/Belege und dieselbe Linkpolitik.

Vollständige Suite einschließlich Auth, Beispiele, Analyse, Credits und CSV grün; `node --check extension/sidepanel.js` und `git diff --check` erfolgreich. Kein neuer echter Chrome-Browsertest hier. Keine Pro-Implementierung und kein main-Merge.

## Lokal übernehmen

`panel-tradingview-tickers.patch` in Downloads speichern, im bestehenden Projektroot ausführen:

```powershell
& {
    $Patch = Join-Path $env:USERPROFILE 'Downloads\panel-tradingview-tickers.patch'
    if (-not (Test-Path $Patch)) { throw 'Patch zuerst herunterladen.' }
    git apply --check $Patch
    if ($LASTEXITCODE -ne 0) { throw 'Patch passt nicht. Nichts anwenden.' }
    git apply $Patch
    if ($LASTEXITCODE -ne 0) { throw 'Anwenden fehlgeschlagen.' }
    npm test --prefix server
    if ($LASTEXITCODE -ne 0) { throw 'Tests fehlgeschlagen.' }
}
```

In `chrome://extensions` die bestehende Erweiterung neu laden. Panel schließen und wieder öffnen; keine neue Analyse und keinen Credit-Reset starten.

1. Research Library: RKLB und ASTS anklicken → korrektes NASDAQ-Symbol bei TradingView. Persönliche Ticker ebenfalls prüfen; unbestätigter Börsenplatz wird im Link-Hinweis benannt.
2. Vollständigen Bericht öffnen und dort Ticker anklicken → gleiches Ziel.
3. Titel/Mini-Kreisdiagramm → weiterhin der Report und vorhandenes YouTube-Tab; Report-Mix unverändert.
4. Kontoseite, Beispiele und CSV bleiben wie zuvor.

Danach getestete Änderungen konsolidieren/mergen; Pro-Integration in separatem Feature-Branch.
