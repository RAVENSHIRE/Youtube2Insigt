# SignalTube Grand Picture

## Produktvision, Roadmap und Kommerzialisierung bis Dezember 2026

- **Status:** Aktualisierte Arbeitsgrundlage (Stand: 1. September 2026)
- **Zieltermin:** 31. Dezember 2026
- **Referenzvideo:** [Business with Brian – 141 Videos, 21 Channels, 5 Companies](https://www.youtube.com/watch?v=4u8dR2Dxcdc)

### Aktueller Repository-Stand

**Gesicherte Basis vor diesem Roadmap-Update:** `main` auf `e7179d0` (Extension v0.5.1, Analyseversion 5).

Bereits abgeschlossen und auf `main` enthalten:

- [x] Repository konsolidiert und aktive Extension-/Server-Basis auf Analyseversion 5 angehoben.
- [x] Interaktive Reports und Report Mix in die aktive Basis übernommen.
- [x] Research Library und Kanalansicht in der aktuellen UI verfügbar.
- [x] YouTube-Kanalprofilbild wiederhergestellt.
- [x] Grand-Picture-Roadmap als gemeinsame Produkt- und Architekturgrundlage angelegt.

Noch offen und jetzt am höchsten priorisiert:

- [ ] Erwähnung, Sichtweise und echten Investment-Call zuverlässig unterscheiden.
- [ ] Historischen Marktpreis am exakten Veröffentlichungszeitpunkt erfassen.
- [ ] Unveränderliche Market Snapshots und versionierte Call-Daten speichern.
- [ ] Outcome Engine für Rendite, Benchmark-Alpha, Peak und Drawdown bauen.
- [ ] Outcome-Kontext in Report Mix und Company Cards sichtbar machen.
- [ ] Erst danach belastbare Creator-Track-Records und Rankings veröffentlichen.

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
5. **Market & Outcome Layer** – den Markt zum Call-Zeitpunkt einfrieren und spätere Ergebnisse reproduzierbar berechnen.
6. **Watchlist & Ladder** – objektive Preisbänder und Thesis-Trigger überwachen.
7. **Creator Universe** – Creator transparent, fair und backtestbar vergleichen.
8. **Commercial Layer** – Website, Creator-Dashboard, Embeds, Exporte, API und White-Label-Produkte verkaufen.

Der entscheidende Produktsprung lautet:

> Report Mix beantwortet heute: „Über welche Unternehmen spricht dieser Creator?“ Die nächste Version beantwortet: „Was geschah, nachdem er einen überprüfbaren Call veröffentlicht hatte?“

Der langfristige Moat ist damit nicht nur die AI-Extraktion, sondern der wachsende historische Datensatz aus **Creator × Unternehmen × These × Evidence × Preis × Outcome**.

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
- historischer Preis beim ersten qualifizierten Call und aktueller Preis;
- hypothetische Performance seit Call sowie Performance für 30, 90, 180 und 365 Tage;
- beste und schwächste Calls je Creator und Zeitraum;
- Drill-down vom Diagramm bis zum Video, Timestamp und vollständigen Report.

Jede Company Card erhält als unmittelbaren nächsten Schritt **„Since Creator Mention“**:

- Preis beim ersten qualifizierten Call → aktueller Preis;
- prozentuale Performance und Benchmark-Alpha;
- Datum und Timestamp des ersten Calls;
- Klick auf „Price vs. Creator Calls“ mit allen Calls auf der Kurskurve.

Der zentrale Wert ist nicht die Zahl der Erwähnungen, sondern die nachvollziehbare Entwicklung eines Calls über Zeit. Performance darf nur für qualifizierte Calls berechnet werden, nie automatisch für jede bloße Nennung.

### 4.4 Call-Taxonomie, Market Snapshot und Outcome Engine

#### Erwähnung ist nicht gleich Investment-Call

| Klasse | Definition | Performance-Tracking |
|---|---|---|
| Mention | Unternehmen wird lediglich besprochen | nein |
| View | bullish, neutral oder bearish ohne klare Handlung | nur Kontext, kein Track Record |
| Actionable Call | Buy, Add, Hold, Reduce oder Sell mit nachvollziehbarer Richtung | ja, mit Confidence Gate |
| Targeted Call | Actionable Call plus Ziel und Zeithorizont | ja, inklusive Zielerreichung |

Diese Trennung verhindert, dass aus „NVIDIA ist interessant“ rückwirkend eine Kaufempfehlung konstruiert wird. Jede Klassifikation speichert Modellkonfidenz, Evidence und gegebenenfalls einen manuellen Review-Status.

#### Unveränderlicher Market Snapshot

Für jeden qualifizierten Call wird die Welt zum Veröffentlichungszeitpunkt reproduzierbar eingefroren:

```text
MarketSnapshot
  asset_id
  video_published_at
  market_timestamp
  price
  currency
  exchange
  source
  price_policy_version
```

Regeln:

- vollständigen Video-Veröffentlichungszeitpunkt inklusive Zeitzone verwenden, nicht nur das Datum;
- bei geöffnetem Markt den nächstliegenden belastbaren Preis nach definierter Policy wählen;
- außerhalb der Handelszeit die erste handelbare Periode nach Veröffentlichung verwenden;
- Quelle, Börse, Währung, Corporate Actions und Policy-Version speichern;
- Snapshots niemals mit einem aktuellen Preis überschreiben; neue Beobachtungen erzeugen neue Datensätze;
- Splits, Dividenden, Delistings und FX-Effekte in der Auswertung explizit behandeln.

#### Outcome Engine

Die erste Version berechnet für 30, 90, 180 und 365 Tage sowie „aktuell“:

- absolute und prozentuale Rendite ab Entry Snapshot;
- Benchmark-Rendite und Alpha in Prozentpunkten;
- Peak Return und Maximum Drawdown;
- Zielerreichung und Zeit bis zum Ziel;
- Stichprobe, Datenkonfidenz und Methoden-Version.

Die UI formuliert Ergebnisse als **„Hypothetical performance since call“**. Gebühren, Slippage, Steuern, FX, Dividenden und tatsächliche Ausführbarkeit müssen transparent ausgewiesen werden; ein optionales „10.000 EUR“-Szenario ist eine Simulation, kein Renditeversprechen.

Erst wenn genügend fällige Outcomes existieren, werden daraus beste/schwächste Calls, Creator-Aggregate und später ein Creator Score. Ein Creator mit drei glücklichen Calls darf nicht über jemanden mit 100 belastbaren Calls gerankt werden.

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
| Company | normalisierte ID, Ticker, Asset-Typ, Themencluster |
| Report | Video-ID, Company-ID, These, Sentiment, Handlung, Horizont |
| Target | Wert, Währung, Quelle, Fälligkeit, Status |
| Ladder | Fair Value, Methode, Version, Banddefinitionen |
| Call Version | Klasse (Mention/View/Actionable/Targeted), ursprünglicher Call, Änderung, Korrektur, Schließung, Confidence |
| Market Snapshot | Asset, Veröffentlichungszeit, Marktzeit, Preis, Währung, Börse, Quelle, Corporate Actions, Policy-Version |
| Outcome | Auswertungsfenster, Rendite, Benchmark, Alpha, Peak, Drawdown, Zielstatus, Methoden-Version |
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

### Priorisierungslogik: NOW → NEXT → THEN → LATER

| Horizont | Fokus | Ergebnis |
|---|---|---|
| NOW | Call-Klassifikation, Market Snapshot, Outcome Engine, Report-Mix-Performance | „Was geschah nach diesem qualifizierten Call?“ |
| NEXT | Best/Worst Calls, Call Timeline, Creator Track Record | nachvollziehbare Historie je Creator |
| THEN | Evidence-Ausbau, TradingView-/Chart-Kontext, Creator Score | belastbare Bewertung mit Belegen |
| LATER | X/Newsletter-Ingestion, Creator Universe, Knowledge Graph | plattformübergreifende Research-Datenbank |

### September – Outcome-Grundlage

- [x] Interaktive Dashboard-/Report-Mix-Version in `main` übernehmen und lokal validieren.
- [x] Extension v0.5.1 und Analyseversion 5 als konsolidierte Basis sichern.
- [ ] Call-Taxonomie für Mention, View, Actionable Call und Targeted Call definieren.
- [ ] Market-Snapshot-Schema und Preis-Auswahl-Policy implementieren.
- [ ] historischen Preis am exakten Video-Veröffentlichungszeitpunkt erfassen.
- [ ] Outcome Engine für Rendite, Benchmark-Alpha, Peak und Drawdown umsetzen.
- [ ] „Since Creator Mention“ in Company Cards und Report Mix integrieren.
- [ ] Report-Schema v5 mit Evidence, Disclosure, Catalyst und Invalidation definieren.
- [ ] Veröffentlichungszeit und Transcript-Timestamps verlustfrei speichern.
- [ ] Golden Set mit 200 manuell gelabelten Unternehmens-Calls aufbauen.
- [ ] Report-Evaluationen statt blindem Fine-Tuning einführen.
- [ ] Brians Video vollständig als Referenzdatensatz modellieren.
- [ ] Landingpage-Wireframe und Creator-Pitch erstellen.
- [ ] rechtliche Prüfung: Disclaimer, Ranking, Copyright, Datenschutz und Plattformbedingungen.

**Exit-Kriterium September:** Ein qualifizierter Call besitzt reproduzierbar Classification, Evidence, Entry Snapshot und berechnetes Outcome; eine bloße Mention erzeugt keinen künstlichen Track Record.

### Oktober – Track Record, Watchlist und LADDER MVP

- [ ] Best/Worst Calls für 30, 90, 180 und 365 Tage anzeigen.
- [ ] Call Timeline für Buy → Target → Update → Outcome umsetzen.
- [ ] privaten Creator Track Record mit Sample Size und Data Confidence bauen.
- [ ] Chart-/Slide-Erkennung und OCR-Prototyp integrieren.
- [ ] Watchlist mit Preis, Ziel, Invalidation und Alerts bauen.
- [ ] konfigurierbare Ladder-Bänder mit Versionshistorie umsetzen.
- [ ] kanalbezogenen und globalen Report Mix um Outcome-Kontext ergänzen.
- [ ] Cluster-/Konzentrationswarnung entwickeln.
- [ ] fünf Creator als private Design Partner gewinnen.
- [ ] mindestens 300 Videos verarbeiten und QA-Stichprobe durchführen.

**Exit-Kriterium Oktober:** Nutzer springt aus Report und Watchlist direkt zur belegenden Video-Sekunde; Ladder-Änderungen sind auditierbar.

### November – belastbare Creator-Beta

- [ ] Snapshot-/Outcome-Worker härten und Corporate Actions vollständig testen.
- [ ] Scorecard v1 mit Methodology-Version implementieren.
- [ ] Unrated-/Minimum-Sample-Regeln und Konfidenzintervalle anzeigen.
- [ ] Creator-Korrektur- und Einspruchsprozess bauen.
- [ ] CSV-/Excel-Export veröffentlichen.
- [ ] Website mit Company- und Creator-Seiten als private Beta starten.
- [ ] drei Preisvarianten mit Design Partnern testen.

**Exit-Kriterium November:** Mindestens zwei Creator akzeptieren die Darstellung ihrer Calls und Methodik; Outcomes sind reproduzierbar und Rankings bleiben bei zu kleiner Stichprobe „Unrated“.

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

1. Call-Taxonomie und Confidence Gates als Schema und Tests festschreiben.
2. vollständigen Veröffentlichungszeitpunkt inklusive Zeitzone verlustfrei speichern.
3. MarketSnapshot mit Price Policy, Quelle und unveränderlicher Historie implementieren.
4. Outcome Engine zunächst für Current Return und 30/90/180/365 Tage bauen.
5. Benchmark-Alpha, Peak Return und Maximum Drawdown ergänzen.
6. „Since Creator Mention“ als vertikalen Slice in einer Company Card ausliefern.
7. Brians Video als Golden-Set-Fall vollständig annotieren und gegen die Pipeline testen.
8. Report-Schema v5 und Evidence-Objekt parallel vervollständigen.
9. Ergebnisse mit Sample Size, Data Confidence und Methodology-Version anzeigen.
10. erst danach Best/Worst Calls und einen privaten Creator Track Record aggregieren.

## 16. Offene Entscheidungen

- Welche exakten Namen und Formeln verwendet Brian für seine Ladder-Bänder?
- Soll das Creator Universe anfangs privat, opt-in oder vollständig öffentlich sein?
- Ist der erste Käufer der Creator, der Zuschauer oder ein Netzwerk?
- Welche Marktdatenquelle deckt Preise, Splits, Dividenden und Benchmarks rechtssicher ab?
- Wie viele manuell geprüfte Calls sind nötig, bevor ein Report veröffentlicht werden darf?
- Welche Evidence darf angezeigt, gespeichert und exportiert werden?
- Werden Ladder-Level vom Creator übernommen, vom System berechnet oder klar getrennt nebeneinander gezeigt?
- Welche Outcome-Metrik korreliert am stärksten mit Zahlungsbereitschaft?
- Welche Price Policy gilt bei Premarket, After-Hours, Wochenenden und illiquiden Assets?
- Welche Benchmark wird je Asset, Region und Währung verwendet?
- Zählt ein `Hold` ohne bekannte Vorposition als Actionable Call oder nur als View?
- Ab welcher Klassifikationskonfidenz darf ein Call automatisch in den Track Record eingehen?
- Werden hypothetische Renditen als Total Return oder Price Return ausgewiesen, und wie wird FX behandelt?

## 17. Produktprinzipien

1. **Evidence before opinion.** Keine Aussage ohne belegbare Quelle.
2. **Original call stays immutable.** Änderungen erzeugen neue Versionen.
3. **Uncertainty is a feature.** Unklarheit wird gezeigt, nicht versteckt.
4. **Rules before emotion.** Ladder und Invalidation werden vor dem Ereignis dokumentiert.
5. **Context beats count.** Fünf Unternehmen können derselbe Trade sein.
6. **Creator first, ranking second.** Erst Nutzen und Vertrauen, dann Vergleich.
7. **Quality before scale.** Fünf verlässliche Kanäle sind wertvoller als tausend unkontrollierte.
8. **A mention is not a call.** Nur qualifizierte Handlungen erzeugen Performance-Tracking.
9. **Snapshots are immutable.** Historische Marktstände werden ergänzt, niemals durch aktuelle Werte überschrieben.
10. **Methodology before ranking.** Creator Scores folgen erst nach reproduzierbaren Outcomes und ausreichender Stichprobe.
