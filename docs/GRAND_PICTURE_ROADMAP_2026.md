# SignalTube Grand Picture

## Produktvision, Roadmap und Kommerzialisierung bis Dezember 2026

**Status:** Produkt- und Ausführungsplan, aktualisiert am 1. September 2026<br>
**Zieltermin:** 31. Dezember 2026<br>
**Referenzvideo:** [Business with Brian – 141 Videos, 21 Channels, 5 Companies](https://www.youtube.com/watch?v=4u8dR2Dxcdc)

## Aktueller Umsetzungsstand

**Verifizierter Teststand:** `feature/live-market-snapshot-proof`<br>
**Backend:** Analysis Version 6, Creator Storage v2, Market Snapshot Schema v1<br>
**Testabdeckung:** 37 automatisierte Tests plus lokaler Chrome-Sidepanel-Test<br>
**Aktueller Datensatz:** 3 Creator und 10 analysierte Videos im isolierten Creator-Staging

| Bereich | Status | Ergebnis / nächster Nachweis |
|---|---|---|
| Repository Recovery | Abgeschlossen | einzelnes Repo, PR #6 auf `main`, Analyse-Version 5 konsolidiert |
| Creator Storage & Routing | Verifiziert | Daten pro Creator isoliert; Creator-Wechsel und Erkennung des aktuellen Tabs funktionieren |
| Channel Overview | Verifiziert | Abonnenten, gesamte Videozahl und dynamischer Analysefortschritt |
| Research Library | Verifiziert | vollständige Reports, klickbare Videos und Wiederverwendung bereits geöffneter YouTube-Tabs |
| Report Mix v2 | Verifiziert | `Sector → Sub-Sector → Company`, Erwähnungen, Erstvorstellung und vollständiger Drill-down |
| Report-UX | Verifiziert | kontrastreiche Bullish-/Neutral-/Bearish-Badges sowie vollständige Thesen, Ziele, Levels und Belege |
| Market Snapshot Foundation | Implementiert | unveränderliches Schema, Repository, YouTube-Zeitstempel-Service, Marktdaten-Provider und API-Endpunkte |
| Market Snapshot Live-Nachweis | Verifiziert | NVDA-Live-Snapshot mit YouTube-Zeitstempel und Twelve Data erfasst; HTTP-201-Write, idempotenter HTTP-200-Replay und identischer Read-back bestätigt |
| Call Classification | Offen – P0 | Mention, View, Actionable Call und Targeted Call trennen |
| Outcome Engine | Offen – P0 | Return, Peak Return, Drawdown und Benchmark Alpha berechnen |
| Creator Track Record | Blockiert durch Outcomes | erst nach genügend fälligen, klassifizierten Calls bewerten |

Der aktuelle Panel-Stand bleibt die stabile Produktbasis. Neue P0-Arbeit wird in
separaten Feature-Branches entwickelt und erst nach lokalem Test übernommen.

## 1. Die Gelegenheit

Brian beschreibt ein Research-Problem, das SignalTube automatisieren kann:

- 141 Aktienvideos aus 21 Kanälen mussten innerhalb von elf Tagen manuell durchsucht werden.
- Die relevanten Stellen wurden gesucht, übersprungen und anschließend in einer Tabelle zusammengeführt.
- Nur wenige Creator nannten gleichzeitig Richtung, Position, konkretes Kursziel, Zeithorizont und eine Bedingung, die ihre These widerlegt.
- Mehrere scheinbar unterschiedliche Unternehmen bildeten in Wahrheit denselben konzentrierten AI-/Chip-/Cloud-Trade.
- Die wertvollste zusätzliche Ebene war nicht noch eine Meinung, sondern eine vorab definierte Entry-/Exit-Ladder relativ zum Fair Value.

SignalTube soll aus verstreuten Videos ein überprüfbares, zeitgestempeltes Entscheidungssystem machen.

> **North Star:** Von „jemand hat in einem Video etwas über eine Aktie gesagt“ zu „hier ist die belegte Aussage, der Zeitpunkt, die historische Trefferquote, die Portfolioüberschneidung und die vorab definierte Handlungsregel“.

SignalTube ist ein Research- und Dokumentationsprodukt, keine Anlageberatung.

## 2. Das Grand Picture

Das fertige Produkt besteht aus acht verbundenen Ebenen:

1. **Capture Layer** – Videos, Transkripte, Bildschirm-/Chart-Szenen und Metadaten erfassen.
2. **Evidence Layer** – jede Behauptung mit Timestamp, Zitatkontext und sichtbarem Chart verknüpfen.
3. **Phenomenal Report** – These, Ziel, Risiko, Zeithorizont, Catalyst, Invalidation und Disclosure strukturiert darstellen.
4. **Report Mix** – Unternehmen, Creator, Sentiment, Zeit und Themenexposure aggregieren.
5. **Watchlist & Ladder** – objektive Preisbänder und Thesis-Trigger überwachen.
6. **Outcome Engine** – Calls mit damaligem Preis, aktuellem Ergebnis, Drawdown und Benchmark verknüpfen.
7. **Creator Universe** – Creator transparent, fair und backtestbar vergleichen.
8. **Commercial Layer** – Website, Creator-Dashboard, Embeds, Exporte, API und White-Label-Produkte verkaufen.

Der langfristige Burggraben ist nicht nur die AI-Extraktion, sondern der
historische Datensatz: *Wer sagte wann, mit welcher These und bei welchem Preis
was über welches Unternehmen – und was geschah danach?* Jeder unveränderliche
Call erweitert diesen Datenbestand und macht Report Mix, Konsens, Belief Changes,
Outcomes und Creator Track Records wertvoller.

## 3. Zielgruppen und Nutzenversprechen

### Creator

- Spart Recherche- und Schnittzeit.
- Verwandelt alte Videos in eine durchsuchbare Research-Bibliothek.
- Liefert automatisch Quellen, Timestamps, Follow-ups und Track-Record-Karten.
- Stärkt Glaubwürdigkeit durch nachvollziehbare Calls statt rückblickende Auswahl einzelner Gewinner.
- Erzeugt wiederverwendbare Website-, Newsletter- und Social-Media-Inhalte.

### Zuschauer und Investoren

- Findet sofort die relevante Stelle im Video.
- Erkennt Konsens, Widerspruch und fehlende Begründungen.
- Sieht, wann ein Unternehmen erstmals vorgestellt wurde und wie oft es danach vorkam.
- Erkennt, ob fünf Watchlist-Namen wirtschaftlich nur ein konzentrierter Trade sind.
- Kann Preisziele und Regeln beobachten, ohne jedes Video erneut anzusehen.

### Netzwerke, Research-Teams und Datenpartner

- Erhalten normalisierte Creator-Research-Daten statt unstrukturierter Videos.
- Können Themen-, Creator- und Asset-Trends über Zeit auswerten.
- Können geprüfte Widgets, Rankings und Datenfeeds lizenzieren.

## 4. Kernprodukt

### 4.1 Phenomenal Report v2

Jeder Unternehmensreport enthält:

| Feld | Bedeutung |
|---|---|
| Unternehmen / Ticker | normalisierte Identität des Assets |
| Richtung | bullish, neutral oder bearish |
| Handlung | kaufen, aufstocken, halten, reduzieren, verkaufen, beobachten |
| These | warum der Creator diese Position vertritt |
| Fair Value | explizit genannt oder klar als nicht vorhanden markiert |
| Kursziel(e) | Wert, Währung, Quelle und Zeithorizont |
| Entry-/Exit-Level | Preis, Typ und Begründung |
| Catalyst | Ereignis, das die These beschleunigen kann |
| Invalidation | überprüfbare Bedingung, die die These widerlegt |
| Risiken | fundamentale, technische und Konzentrationsrisiken |
| Disclosure | besitzt der Creator die Position oder nicht |
| Evidence | Transcript-Ausschnitt plus Timestamp |
| Visual Evidence | Chart-/Tabelle-/Filing-Szene plus Timestamp |
| Confidence | Modellkonfidenz getrennt von Creator-Überzeugung |
| Version | ursprünglicher Call, Update, Korrektur oder geschlossener Call |

#### Report-UX

Der Report öffnet sich neben dem Video und besteht aus:

1. **Executive Summary** – Aussage in höchstens fünf Zeilen.
2. **Decision Card** – Richtung, Ziel, Zeithorizont, Invalidation und Disclosure.
3. **Evidence Timeline** – anklickbare Timestamps für Aussagen und Charts.
4. **Ladder** – Preis relativ zu Fair Value und den definierten Bändern.
5. **Creator Context** – frühere Calls zu diesem Unternehmen.
6. **Report Mix** – Konsens, Gegenmeinungen und Themenkonzentration.
7. **Outcome** – nach Fälligkeit automatisch berechnetes Ergebnis.

### 4.2 Automatische Timestamps und Chart-Erkennung

#### Pipeline

1. Transcript-Segmente mit Start-/Endzeit speichern.
2. Videos über Scene Changes in visuelle Abschnitte zerlegen.
3. Relevante Frames in niedriger Frequenz samplen; bei Slides/Charts dichter samplen.
4. OCR für Ticker, Preise, Prozentwerte, Achsen und Datumsangaben ausführen.
5. Transcript-Claims mit sichtbaren Zahlen und Tickersymbolen abgleichen.
6. Pro Evidence-Element einen Timestamp-Link erzeugen: `youtube.com/watch?v=...&t=<seconds>s`.
7. Niedrige Konfidenz zur manuellen Prüfung markieren.

#### Qualitätsziele

- mindestens 90 % der Report-Claims besitzen einen anklickbaren Timestamp;
- relevante Aussage innerhalb von ±5 Sekunden treffen;
- Chart-/Slide-Erkennung mit mindestens 85 % Precision im Golden Set;
- Zahlen niemals allein aus OCR übernehmen, wenn Transcript oder Kontext widersprechen;
- sichtbare und gesprochene Quelle getrennt kennzeichnen.

### 4.3 Report Mix

Der Report Mix wird kanalbezogen und global verfügbar:

- Häufigkeit pro Unternehmen in eindeutigen analysierten Videos;
- erste und letzte Vorstellung;
- Sentiment-Verlauf und Zielrevisionen;
- Creator-Konsens und Gegenmeinungen;
- Sektor-, Faktor- und Themenexposure;
- Cluster wie AI, Chips, Cloud oder Driverless;
- Warnung, wenn mehrere Namen wirtschaftlich derselbe Trade sind;
- Drill-down vom Diagramm bis zum Video, Timestamp und vollständigen Report.

Der zentrale Wert ist nicht die Zahl der Erwähnungen, sondern die nachvollziehbare Entwicklung eines Calls über Zeit.

### 4.4 Market Snapshot, Call Classification und Outcome

Der Report Mix beantwortet heute: **„Welche Unternehmen behandelt dieser
Creator?“** Die nächste Produktstufe beantwortet: **„Was geschah nach einem
wirklich handelbaren Call?“**

#### Call-Klassifizierung

| Call-Typ | Bedeutung | Performance-Tracking |
|---|---|---|
| Mention | Unternehmen wird nur erwähnt | nein |
| View | Bullish-, Neutral- oder Bearish-Ansicht ohne Handlung | nein |
| Actionable Call | explizites Buy, Add, Hold, Reduce oder Sell | ja |
| Targeted Call | Handlung plus Kursziel und Zeithorizont | ja, inklusive Zielstatus |

Eine Erwähnung darf niemals rückwirkend wie eine Kaufempfehlung bewertet werden.
Im UI wird deshalb immer Call-Typ, Stichprobe und Datenqualität gezeigt.

#### Unveränderlicher Market Snapshot

Jeder geeignete Call referenziert den exakten YouTube-Veröffentlichungszeitpunkt
und die erste verlässlich handelbare Marktperiode danach:

```text
MarketSnapshot
  snapshot_id
  ticker / asset_id
  published_at
  market_timestamp
  price_at_video
  currency
  exchange
  source
  selection_policy
  integrity_hash
```

Der ursprüngliche Snapshot wird nie aktualisiert. Aktuelle Kurse und daraus
berechnete Resultate gehören in versionierte Outcome-Datensätze.

#### Outcome Engine

Die erste Version berechnet für Actionable und Targeted Calls:

- aktuelle hypothetische Rendite seit Call;
- Peak Return und Zeitpunkt des Hochs;
- Maximum Drawdown seit Call;
- Benchmark Return und Alpha in Prozentpunkten;
- Kurszielstatus und Zeit bis zur Zielerreichung;
- standardisierte Fenster von 30, 90, 180 und 365 Tagen.

Die Darstellung lautet bewusst **„Hypothetical performance since call“** und
nicht „Gewinn“, solange Gebühren, FX, Dividenden, Slippage und individuelle
Ausführung nicht vollständig modelliert sind.

#### Report-Mix-Integration

Jede geeignete Company Card erhält anschließend:

```text
NVDA  |  Actionable Call
$142.30 → $181.70  |  +27.7 %
First call: 4 Mar 2026  |  Alpha: +16.0 pp
```

Der Klick öffnet später `Price vs. Creator Calls`: Kursverlauf, ursprünglicher
Call, Updates, Ziele, Invalidation und Outcomes auf einer gemeinsamen Timeline.

### 4.5 Watchlist Layer

Jeder Nutzer oder Creator kann Unternehmen aus Reports auf eine Watchlist übernehmen.

Eine Watchlist-Zeile enthält:

- aktuellen Preis;
- Fair Value und Quelle;
- aktive Ladder-Stufe;
- nächstes Entry-/Exit-Level;
- Abstand in Prozent;
- Invalidation-Trigger;
- nächstes relevantes Datum oder Catalyst;
- letzter Creator-Call und letzte Report-Änderung;
- Themen-/Portfolioüberschneidung.

#### Alerts

- Preis betritt oder verlässt ein Ladder-Band;
- Kursziel wird erreicht;
- Invalidation-Level wird gebrochen;
- Creator ändert Rating, Ziel oder Disclosure;
- neue Gegenmeinung erscheint;
- Watchlist überschreitet ein Konzentrationslimit.

### 4.6 LADDER

Brian verwendet eine wertbasierte Entry-Ladder: Je tiefer der Preis relativ zum Fair Value fällt, desto anders wird die Positionsgröße; der billigste Bereich ist kein automatischer Kauf, sondern kann bedeuten, dass das Unternehmen fundamental gebrochen ist. Die genauen Bandnamen und Schwellen aus Brians Darstellung müssen vor einer kommerziellen Nachbildung mit ihm validiert werden.

SignalTube modelliert deshalb keine starre Kaufempfehlung, sondern konfigurierbare Bänder:

| Band | Bedeutung | Beispielaktion |
|---|---|---|
| Above Fair Value | Preis über dem akzeptierten Wertbereich | warten / nicht neu kaufen |
| Starter | erste vertretbare Sicherheitsmarge | Teilposition, z. B. 50 % der normalen Größe |
| Buy | attraktiver Preis bei intakter These | normale Positionsgröße |
| Deep Value | große Sicherheitsmarge, erhöhte Prüfung | nur mit bestätigten Fundamentals |
| Exit / Broken | Preis signalisiert möglicherweise gebrochene These | nicht automatisch kaufen; Invalidation prüfen |

Jede Stufe braucht:

- absoluten Preis und Abstand zum Fair Value;
- Berechnungsmethode und Datum;
- fundamentalen oder technischen Trigger;
- empfohlene Maximalgröße als Dokumentationsfeld, nicht als individuelle Beratung;
- Invalidation und Ablaufdatum;
- Versionshistorie, damit nachträgliches Verschieben sichtbar bleibt.

## 5. Creator Universe

### 5.1 Grundprinzip

Das Creator Universe ist keine Popularitätsrangliste. Es misst, wie klar, überprüfbar und später zutreffend veröffentlichte Research-Calls waren.

Die öffentliche Darstellung startet erst nach einer privaten Beta und transparenter Methodik. Creator erhalten ein Einspruchs- und Korrekturverfahren. Unklare oder zu kleine Stichproben erhalten **Unrated** statt eines schlechten Tiers.

### 5.2 Tier-System

| Tier | Interpretation |
|---|---|
| S | außergewöhnlich belastbarer, transparenter Track Record |
| A | stark und über mehrere Marktphasen konsistent |
| B | solide, mit klaren Stärken und sichtbaren Schwächen |
| C | gemischte Ergebnisse oder unvollständige Calls |
| D | schwache Kalibrierung bzw. geringe Nachvollziehbarkeit |
| E | wiederholt unklare, nicht prüfbare oder stark verfehlte Calls |
| Unrated | noch nicht genügend fällige Calls oder Datenqualität |

### 5.3 Scorecard (100 Punkte)

| Komponente | Gewicht |
|---|---:|
| Kursziel-Kalibrierung und Zielerreichung | 20 |
| Rendite relativ zu Benchmark und Richtung | 15 |
| Risiko-adjustiertes Ergebnis / Drawdown | 10 |
| Genauigkeit des genannten Zeithorizonts | 10 |
| Qualität von These und Invalidation | 15 |
| Evidence- und Timestamp-Nachvollziehbarkeit | 10 |
| Transparenz zu Position und Interessenkonflikt | 5 |
| Konsistenz statt selektiver Gewinner | 10 |
| Korrekturen und saubere Versionshistorie | 5 |

**Bonuspunkte werden nicht frei addiert.** Präzise und erfüllte Kursziele verbessern die Kursziel-Komponente; sonst könnte ein Score über 100 entstehen oder leicht manipulierbar werden.

### 5.4 Backtest-Regeln

- Call-Zeitpunkt ist der ursprüngliche Video-Zeitpunkt, nicht das Analysedatum.
- Preis wird mit der ersten handelbaren Periode nach Veröffentlichung verknüpft.
- Ergebnisse getrennt für 30, 90, 180 und 365 Tage ausweisen.
- Expliziten Zeithorizont bevorzugen; andernfalls Call als „ohne Horizont“ markieren.
- Benchmark nach Asset und Region wählen.
- Dividenden, Splits und Währungsänderungen berücksichtigen.
- Bullish, bearish und neutral getrennt bewerten.
- Geänderte Calls versionieren; niemals den ursprünglichen Call überschreiben.
- Gelöschte oder private Videos nicht stillschweigend aus der Historie entfernen.
- Mindeststichprobe: 20 fällige Calls und mindestens 90 Tage Historie für ein vorläufiges Tier.
- Konfidenzintervall, Stichprobengröße und Marktregime neben jedem Score anzeigen.
- Keine Bewertung, wenn Aussage, Ziel oder Zeitpunkt nicht zuverlässig extrahiert werden konnte.

### 5.5 Einfacher Excel-/CSV-Export

Die erste verkaufbare Version braucht keinen komplexen Terminal-Export. Eine verständliche Tabelle genügt:

| Creator | Tier | Score | Fällige Calls | Trefferquote | Zielgenauigkeit | Benchmark Alpha | Max Drawdown | Transparenz | Stand |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|

Zusätzliche Tabellenblätter:

- `Calls` – unveränderte Original-Calls;
- `Outcomes` – Preise und Auswertungsfenster;
- `Targets` – Kursziel-Erfüllung;
- `Companies` – Report Mix je Creator;
- `Methodology` – Version und Berechnungsregeln.

## 6. Datenmodell

| Entität | Schlüsselattribute |
|---|---|
| Creator | Kanal-ID, Name, URL, Disclosure-Profil |
| Video | Video-ID, Creator-ID, Veröffentlichungszeit, Analyseversion |
| Evidence | Start-/Endsekunde, Transcript, Frame, OCR, Konfidenz |
| Company | normalisierte ID, Ticker, Asset-Typ, Sektor, Sub-Sektor, Themencluster |
| Report | Video-ID, Company-ID, These, Sentiment, Handlung, Horizont, Evidence |
| Call | Call-Typ, Originalzeitpunkt, Report-ID, Status, Klassifizierungsgrund |
| Target | Wert, Währung, Quelle, Fälligkeit, Status |
| Ladder | Fair Value, Methode, Version, Banddefinitionen |
| Call Version | ursprünglicher Call, Änderung, Korrektur, Schließung |
| Market Snapshot | exakter Zeitpunkt, Preis, Währung, Börse, Quelle, Auswahlregel, Integrität |
| Outcome | Bewertungszeitpunkt, Fenster, Current/Peak Return, Alpha, Drawdown, Zielstatus |
| Creator Score | Methoden-Version, Stichprobe, Komponenten, Tier |
| Watchlist Item | Nutzer, Company, Trigger, aktive Stufe, Alerts |

## 7. Website

### Öffentliche Seiten

1. **Home** – „Every claim. Every timestamp. Every outcome.“
2. **Explore** – Unternehmen, Creator und Themen durchsuchen.
3. **Company Grand Picture** – Report Mix, Creator-Historie, Ladder und Evidence.
4. **Creator Profile** – Track Record, Methodik, Calls und Korrekturen.
5. **Methodology** – vollständig transparente Scoring- und Backtest-Regeln.
6. **For Creators** – Zeitersparnis, White-Label-Reports und Media-Kit.
7. **Pricing** – Self-Serve, Creator Pro und Netzwerk-/API-Angebot.

### Private App

- Watchlist;
- Alerts;
- persönlicher Grand Picture Feed;
- Creator-Vergleich;
- Exporte;
- Report-Review und Korrekturen;
- Creator-Analytics.

## 8. Geschäftsmodell

Preise sind Testhypothesen, keine endgültige Festlegung.

| Angebot | Zielgruppe | Hypothese |
|---|---|---:|
| Viewer Pro | aktive Zuschauer / Anleger | 19–39 EUR pro Monat |
| Creator Starter | einzelne Kanäle | 99–199 EUR pro Monat |
| Creator Pro | wachsende Research-Kanäle | 399–799 EUR pro Monat |
| Network / White Label | Mediennetzwerke | ab 1.500 EUR pro Monat |
| Data / API | Research- und Datenpartner | nutzungs- oder lizenzbasiert |

Creator Pro sollte enthalten:

- automatische Reports und Timestamps;
- Website-Embed;
- Watchlist-/Ladder-Widget;
- Track-Record-Karte;
- CSV-/Excel-Export;
- priorisierte Korrektur- und Review-Warteschlange;
- monatliches „What changed?“ Paket für Folgecontent.

## 9. Go-to-Market

### Positionierung

Nicht mit „Wir ranken dich“ verkaufen. Der erste Nutzen für Creator lautet:

> „Wir verwandeln jedes deiner Videos automatisch in einen belegten Research-Report, eine aktualisierte Watchlist und wiederverwendbare Inhalte – inklusive Timestamps und Track Record.“

Das Ranking folgt erst, wenn Vertrauen, Datenqualität und Methodik bewiesen sind.

### Design-Partner-Strategie

1. Brians Video als personalisierten Proof of Value verarbeiten.
2. Seine fünf Unternehmen, 16 Positionen und Creator-Gegenmeinungen als klickbares Grand Picture nachbauen.
3. Seine Ladder nur mit Erlaubnis und validierten Banddefinitionen integrieren.
4. Einen privaten Link mit Zeitersparnis, Fehlerliste und Verbesserungsvorschlägen senden.
5. Nicht sofort verkaufen; zuerst 30 Minuten Product Feedback und Erlaubnis für ein Case Study anfragen.
6. Dasselbe Vorgehen bei vier weiteren mittelgroßen, research-orientierten Kanälen wiederholen.

### Content Engine

- wöchentlicher „Creator Consensus vs. Reality“-Report;
- „One Trade Wearing Five Names“-Konzentrationskarte;
- automatisch erzeugte Follow-up-Karten zu erreichten/verfehlten Zielen;
- Creator-Embeds als Distribution Loop;
- öffentliche Methodik und Changelog als Vertrauensanker;
- Newsletter mit neuen Calls, Änderungen und fälligen Outcomes.

### Sales Funnel

1. personalisierter kostenloser Beispielreport;
2. Creator Review und Datenkorrektur;
3. 30-Tage-Pilot mit eigenem Dashboard;
4. bezahltes Creator-Pro-Abo;
5. White-Label, Netzwerk oder API-Upsell.

## 10. Roadmap September–Dezember 2026

### P0 – Investment Outcome Engine (sofort)

| Reihenfolge | Arbeitspaket | Status am 1. September 2026 |
|---:|---|---|
| 1 | Market Snapshot Foundation | abgeschlossen; Live-Provider-Lauf, unveränderlicher Write, Replay und Read-back am 2. September 2026 verifiziert |
| 2 | Call Classification | nächster Feature-Branch |
| 3 | Outcome Engine | offen; baut auf 1 und 2 auf |
| 4 | Report-Mix Performance Cards | offen; erster sichtbarer Outcome-Nutzen |
| 5 | Best/Worst Calls und Call Timeline | offen |
| 6 | Creator Track Record | offen; benötigt ausreichende fällige Stichprobe |
| 7 | Evidence-Timestamps und Visual Evidence | offen |
| 8 | Watchlist, LADDER und TradingView | offen |

Performance wird nur für `actionable` und `targeted` Calls berechnet. Mention
und View bleiben sichtbar, werden aber nicht als hypothetischer Trade gewertet.
Market Snapshots bleiben unveränderlich; zeitabhängige Outcomes werden separat
und mit Bewertungszeitpunkt, Methodenversion und Datenquelle gespeichert.

### September – belastbare Grundlage

- [x] Repository konsolidieren und Recovery-Stand über PR #6 sichern.
- [x] Creator Storage v2, Creator Overview und aktiven YouTube-Tab integrieren.
- [x] Channel Overview mit Gesamtvideos und dynamischem Analysefortschritt umsetzen.
- [x] Report Mix als `Sector → Sub-Sector → Company` mit vollständigem Drill-down umsetzen.
- [x] Research Library, Smart Tabs, Kontrast und Sentiment-Badges verifizieren.
- [x] unveränderliches Market-Snapshot-Schema, Repository und Provider-Services implementieren.
- [x] realen NVDA-Snapshot erfassen und Idempotenz mit identischer Snapshot-ID bestätigen.
- [ ] Report-Schema v7 mit `call_type`, Catalyst, Invalidation, Disclosure und Evidence definieren.
- [ ] Call Classification für Mention, View, Actionable und Targeted implementieren.
- [ ] Outcome Engine für Current Return, Peak Return, Drawdown und Benchmark Alpha implementieren.
- [ ] Report-Mix-Performance-Card „Since Call“ integrieren.
- [ ] Veröffentlichungszeit und Transcript-Timestamps verlustfrei gemeinsam speichern.
- [ ] Golden Set mit 200 manuell gelabelten Unternehmens-Calls aufbauen.
- [ ] Report-Evaluationen statt blindem Fine-Tuning einführen.
- [ ] Brians Video vollständig als Referenzdatensatz modellieren.
- [ ] Landingpage-Wireframe und Creator-Pitch erstellen.
- [ ] rechtliche Prüfung: Disclaimer, Ranking, Copyright, Datenschutz und Plattformbedingungen.

**Exit-Kriterium September:** Ein Actionable Call besitzt einen exakten,
unveränderlichen Einstiegssnapshot und ein reproduzierbares Outcome; Report Mix
zeigt die hypothetische Performance, ohne Mentions als Calls umzudeuten.

### Oktober – Track Record, Evidence und LADDER MVP

- [ ] beste und schlechteste Calls für 30/90/180/365 Tage anzeigen.
- [ ] Call Timeline mit Original, Update, Ziel, Invalidation und Outcome bauen.
- [ ] privaten Creator Track Record mit Stichprobe und Datenkonfidenz berechnen.
- [ ] Transcript-Timestamps als vertikalen Evidence-Slice integrieren.
- [ ] Chart-/Slide-Erkennung und OCR-Prototyp integrieren.
- [ ] Watchlist mit Preis, Ziel, Invalidation und Alerts bauen.
- [ ] konfigurierbare Ladder-Bänder mit Versionshistorie umsetzen.
- [ ] globalen Report Mix und Creator-Konsens ergänzen.
- [ ] Cluster-/Konzentrationswarnung entwickeln.
- [ ] fünf Creator als private Design Partner gewinnen.
- [ ] mindestens 300 Videos verarbeiten und QA-Stichprobe durchführen.

**Exit-Kriterium Oktober:** Nutzer sieht belegte Call-Historie, Outcome und Risiko
auf einer Timeline und springt direkt zur relevanten Video-Sekunde.

### November – Creator Universe und Beta

- [ ] Backtest-Worker und Corporate-Action-/FX-Normalisierung produktionsreif machen.
- [ ] Scorecard v1 mit Methodology-Version implementieren.
- [ ] Unrated-/Minimum-Sample-Regeln und Konfidenzintervalle anzeigen.
- [ ] Creator-Korrektur- und Einspruchsprozess bauen.
- [ ] CSV-/Excel-Export veröffentlichen.
- [ ] Website mit Company- und Creator-Seiten als private Beta starten.
- [ ] TradingView-Prototyp für technische Evidence testen.
- [ ] drei Preisvarianten mit Design Partnern testen.

**Exit-Kriterium November:** Mindestens zwei Creator akzeptieren die Darstellung ihrer Calls und Methodik; Outcomes sind reproduzierbar.

### Dezember – Verkauf und Launch

- [ ] Creator Pro abrechenbar machen.
- [ ] fünf belastbare Case Studies oder Testimonials sichern.
- [ ] mindestens drei zahlende Creator gewinnen.
- [ ] 1.000 analysierte Videos oder einen klaren Qualitätsgrenzwert erreichen.
- [ ] öffentliche Methodik, Changelog und Korrekturpolicy veröffentlichen.
- [ ] Content- und Outreach-System dokumentieren.
- [ ] 2027-Skalierungsbudget anhand echter Kosten und Conversion planen.

**Exit-Kriterium Dezember:** Wiederholbarer Lead → Pilot → Paid-Prozess sowie mindestens ein Produkt, für das Creator tatsächlich bezahlen.

## 11. Fine-Tuning-Strategie

Fine-Tuning ist nicht der erste Schritt. Zuerst braucht SignalTube ein sauberes Golden Set und automatisierte Evaluationsmetriken.

### Reihenfolge

1. Schema und Taxonomie stabilisieren.
2. 200–500 Calls manuell labeln.
3. Prompt-/Modell-Baseline messen.
4. häufigste Fehler nach Feld klassifizieren.
5. nur bei wiederkehrenden, mit Prompting nicht lösbaren Fehlern fine-tunen.
6. neues Modell gegen unverändertes Holdout Set testen.
7. Modell- und Prompt-Version in jedem Report speichern.

### Metriken

- Company-/Ticker Precision und Recall;
- Zielwert- und Währungsextraktion;
- Richtung und Handlung;
- Zeithorizont;
- Disclosure;
- Invalidation;
- Timestamp Alignment;
- Halluzinationsrate;
- Anteil der Reports, die ohne manuelle Korrektur veröffentlichbar sind.

## 12. Skalierungsstrategie

### Technisch

- asynchrone Ingestion Queue;
- idempotente Video-Verarbeitung;
- kostengünstiges Erstmodell plus selektives Premium-Modell;
- Frame-Sampling statt Vollvideoanalyse;
- Cache für Transkripte, Frames und Marktpreise;
- versionierte Datenpipelines;
- automatische Qualitäts-Gates vor Veröffentlichung;
- Human Review nur für niedrige Konfidenz oder zahlende Creator.

### Operativ

- zuerst fünf hochwertige Creator statt tausend unkontrollierte Kanäle;
- gemeinsame Taxonomie und Korrekturpolicy;
- QA anhand fester Stichproben;
- Creator-Onboarding als wiederholbares Playbook;
- Support- und Einspruchs-SLA definieren;
- Unit Economics pro analysierter Videostunde messen.

### North-Star- und Guardrail-Metriken

| Typ | Metrik |
|---|---|
| North Star | monatlich genutzte Evidence-verknüpfte Reports |
| Aktivierung | erster geöffneter Timestamp oder Watchlist-Add |
| Creator Value | gesparte Review-/Research-Zeit pro Video |
| Revenue | zahlende Creator, MRR und Pilot→Paid-Conversion |
| Qualität | publishable without edit, Timestamp Precision, Halluzinationsrate |
| Vertrauen | Korrekturquote, Einsprüche, Methodology Views |
| Kosten | Analyse-Kosten pro Videostunde und pro veröffentlichtem Report |

## 13. Risiken und Schutzmaßnahmen

| Risiko | Schutzmaßnahme |
|---|---|
| Finanzberatung / Haftung | klare Research-Positionierung, keine personalisierte Empfehlung, juristische Prüfung |
| Rufschädigung durch Rankings | transparente Methodik, Mindeststichprobe, Einspruch, Unrated, Konfidenzintervalle |
| Backtest-Leakage | unveränderliche Call-Zeitpunkte, versionierte Outcomes, keine rückwirkende Überschreibung |
| Halluzinierte Preise oder Ziele | Evidence-Pflicht, Confidence Gate, manuelle Prüfung bei Konflikten |
| Copyright / Plattformregeln | kurze Evidence-Auszüge, Links zum Original, keine unnötige Videorepublikation |
| Creator-Ablehnung | zuerst privates Creator-Tool und Zeitersparnis verkaufen, Ranking später |
| Daten-/API-Kosten | Sampling, Cache, Modell-Routing und Kostenlimits |
| Ranking-Gaming | vollständige Call-Historie, Mindeststichprobe, Korrektur- und Löschprotokoll |
| Scheingenauigkeit | Rohdaten, Stichprobe, Benchmark und Unsicherheit immer sichtbar machen |

## 14. Exit-Strategie

Die Exit-Strategie ist Optionalität, kein kurzfristiges Verkaufsversprechen.

### Pfad A – profitables Vertical SaaS

- Creator-Abos und Netzwerkverträge finanzieren organisches Wachstum.
- Fokus auf hohe Marge, geringe Churn-Rate und proprietäre Outcome-Daten.
- Gründer kann Cashflow-Unternehmen halten oder später verkaufen.

### Pfad B – Daten- und API-Lizenzierung

- normalisierte Video-Research- und Track-Record-Daten werden zum Kernasset.
- mögliche Partner: Research-Plattformen, Broker, Watchlist-Tools, Mediennetzwerke und Creator-Analytics-Anbieter.
- Werttreiber sind Datenhistorie, Entity Resolution, Evidence-Verknüpfung und Backtest-Methodik.

### Pfad C – strategische Übernahme

Attraktiv wird SignalTube, wenn es mindestens drei Assets besitzt:

1. einzigartige, rechtssicher nutzbare Creator-Research-Historie;
2. nachweisbar hohe Extraktions- und Timestamp-Qualität;
3. wiederkehrenden Umsatz oder starke Distribution über Creator.

Vorbereitung:

- IP- und Datenrechte dokumentieren;
- saubere Cap Table und Verträge;
- Methoden-, Modell- und Datensatzversionen archivieren;
- Kundenkonzentration begrenzen;
- monatliche KPI- und Unit-Economics-Historie führen;
- Abhängigkeit von einzelnen Modellen und Plattformen reduzieren.

## 15. Die nächsten 30 Tage

1. verifizierten Stand `feature/panel-unified-v1` sichern, PR prüfen und einen Release-Kandidaten markieren.
2. ~~einen realen Market Snapshot erfassen und den identischen Request idempotent validieren.~~ Abgeschlossen am 2. September 2026.
3. `feature/call-classification` mit Mention/View/Actionable/Targeted und Migrationstest bauen.
4. `feature/outcome-engine` für Current Return, Peak Return, Max Drawdown und Benchmark Alpha bauen.
5. „Since Call“ als erste Performance Card in den bestehenden Report-Mix-Drill-down integrieren.
6. Brians Video als Golden-Set-Fall inklusive Call-Typen, Ziele und Horizonte annotieren.
7. Report-Schema v7 mit Catalyst, Invalidation, Disclosure und Evidence spezifizieren.
8. automatische Transcript-Timestamps als nächsten vertikalen Evidence-Slice umsetzen.
9. Grand-Picture-Demo und 90-Sekunden-Creator-Pitch für Brian und vier Design Partner erstellen.
10. Kosten, Datenqualität und Zeitersparnis pro Video messen; nur anhand dieser Ergebnisse skalieren.

## 16. Offene Entscheidungen

- Welche exakten Namen und Formeln verwendet Brian für seine Ladder-Bänder?
- Soll das Creator Universe anfangs privat, opt-in oder vollständig öffentlich sein?
- Ist der erste Käufer der Creator, der Zuschauer oder ein Netzwerk?
- Welche Marktdatenquelle deckt Preise, Splits, Dividenden und Benchmarks rechtssicher ab?
- Welche Börsen-/Symbolauflösung verhindert falsche Zuordnungen bei identischen Tickern?
- Welche Benchmark gilt pro Asset, Region und Währung?
- Wie werden Pre-/After-Market-Calls sowie Wochenenden konsistent bewertet?
- Wie viele manuell geprüfte Calls sind nötig, bevor ein Report veröffentlicht werden darf?
- Welche Verben und Evidenzschwellen machen eine Aussage wirklich `actionable`?
- Welche Evidence darf angezeigt, gespeichert und exportiert werden?
- Werden Ladder-Level vom Creator übernommen, vom System berechnet oder klar getrennt nebeneinander gezeigt?
- Welche Outcome-Metrik korreliert am stärksten mit Zahlungsbereitschaft?

## 17. Produktprinzipien

1. **Evidence before opinion.** Keine Aussage ohne belegbare Quelle.
2. **Original call stays immutable.** Änderungen erzeugen neue Versionen.
3. **Uncertainty is a feature.** Unklarheit wird gezeigt, nicht versteckt.
4. **Rules before emotion.** Ladder und Invalidation werden vor dem Ereignis dokumentiert.
5. **Context beats count.** Fünf Unternehmen können derselbe Trade sein.
6. **Creator first, ranking second.** Erst Nutzen und Vertrauen, dann Vergleich.
7. **Quality before scale.** Fünf verlässliche Kanäle sind wertvoller als tausend unkontrollierte.
