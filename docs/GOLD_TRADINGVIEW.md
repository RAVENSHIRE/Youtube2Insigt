# Gold-Rohstoff: TradingView — 18.09.2026

Branch `fix/gold-commodity-tradingview`, Patch-Basis `b279620`.

## Ursache und Umfang

Die bisherige Backend-Zuordnung erzeugte TradingView-Links aus Aktienbörsen. Gold als `commodity` blieb ohne bestätigten Link; ohne Ticker unterdrückte das Panel zudem den Badge im vollständigen Bericht. Eine freie Symbolsuche nach GOLD ist für diesen Rohstoff mehrdeutig.

`commodityTradingView` ergänzt für explizit als Rohstoff klassifiziertes Gold einen beschrifteten Gold/USD-Referenzchart von OANDA. Unterstützt Gold ohne Ticker sowie GOLD, XAU, XAUUSD und XAU/USD, bei passendem Namen. Explizite andere Währung, widersprüchlicher Name, Aktie, ETF oder Future werden nicht in diesen Referenzchart umgedeutet. Andere nicht bestätigte Rohstoffe erhalten keinen automatischen Aktien-Suchlink.

Das ist ausschließlich Link-Navigation, keine Aussage über identische Ausführungs-/Snapshotkurse. Marktpreise, Provider-Symbole, ursprüngliche Ticker, Zitate, Credits und gespeicherte Reports werden nicht geändert. Links/Labels entstehen beim Lesen; keine Neuanalyse oder Migration nötig.

Panel, Unternehmenshistorie und Account-Seite verwenden die vom Backend bereitgestellte URL. Gold ohne Ticker wird über den Asset-Namen verlinkt. RKLB/ASTS und bisherige Aktienlinks bleiben erhalten.

Primärquelle am 18.09.2026 geöffnet: [TradingView Gold Spot / U.S. Dollar](https://www.tradingview.com/symbols/OANDA-XAUUSD/). Navigation wurde mit Web-Abruf geprüft, kein interaktiver Chrome-Test des Nutzer-Panels.

## Prüfung

229 automatisierte Tests bestanden; 0 Fehler, 0 übersprungen. Neue Prüfungen: Gold ohne Ticker, Groß-/Kleinschreibung der Asset-Klasse, Alias-Zuordnung, Abgrenzung zu Goldminen/ETF/Futures/EUR, keine Mutation gespeicherter Reports, Link im Panel-Videobericht und in der Library, keine mehrdeutige Commodity-Symbolsuche. Vollständige bestehende Suite inklusive Auth, Analyse, TradingView und CSV grün.

## Lokal testen

1. Server mit Ctrl+C stoppen. `gold-tradingview.patch` nach Downloads speichern.
2. Im bestehenden Projekt: `git apply --check` vor `git apply`; bei Fehler nichts erzwingen. Danach `npm test --prefix server`.
3. Server neu starten: `node .\server\server.js` aus dem Projektroot.
4. Erweiterung in `chrome://extensions` neu laden; Panel schließen/öffnen. Konto-Seite neu laden, damit Backend-Projektion erneut abgerufen wird.
5. Bestehenden Gold-Report öffnen: Name/Badge in Research Library und vollständigem Report öffnen Gold/USD. Referenzchart-Hinweis steht im Link-Tooltip. RKLB/ASTS gegenprüfen.

Keine neue Analyse, kein Credit-Reset. Kein main-Merge und keine Pro-Änderung in diesem Patch.
