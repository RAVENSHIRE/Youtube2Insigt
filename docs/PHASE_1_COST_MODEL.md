# SignalTube — Kostenmodell der bestehenden Pipeline

Stand: 16. September 2026. Keine Änderung am Modell oder Analyseablauf.

## Was tatsächlich geprüft wurde

- Accounts-Modus: YouTube-Video-Metadaten → Kanal-Metadaten (Fehler toleriert) → Originaltranskript → strukturierte Gemini-Extraktion → Segmentvalidierung → SQLite-Report.
- `server/server.js`: `buildAnalysisPrompt` umfasst 3.860 Quelltextzeichen einschließlich Interpolationen, nicht den fertigen Modellinput. Hinzu kommen JSON-Segmente, Titel, Creator und das Antwortschema.
- `generateStructured`: maximal 24.000 Ausgabetokens. `evidenceExtractionService`: eine Extraktion, bei bestimmten Validierungsfehlern genau eine erneute Extraktion. Keine Endlosschleife.
- `analysisModelService`: bis zu drei SDK-Versuche je Extraktion bei temporären Providerfehlern. Rechnerisch bis zu sechs HTTP-Versuche, zusätzlich durch den gemeinsamen Job-Timeout von 180 Sekunden begrenzt. Nicht jeder fehlgeschlagene Versuch ist zwingend kostenpflichtig.
- Speicherung enthält Report UND Quellsegmente; Lesen eines eigenen gespeicherten Reports und CSV-Export starten keine Gemini-Anfrage und verbrauchen keinen Analyse-Credit.
- Öffnen der Beispielbibliothek startet keine Gemini-Analyse. Creator-Metadaten können YouTube-Abfragen auslösen (zehn Minuten Cache je Serverprozess).
- Die drei ausgelieferten Beispielauszüge messen serialisiert 1.738, 1.535 und 1.547 Bytes (insgesamt 4.820 Bytes). Sie haben keine Originalsegmente und sind daher KEIN Größenmaß für neue vollständige Analysen.
- Tokenverbrauch, Thinking-Tokens, tatsächliche Retryquote und Providerrechnung der erfolgreichen Nutzeranalyse liegen hier nicht vor. Kein gemessener Stückpreis behauptet.

## Preisbasis und Formel

Gemini 3.5 Flash, Standard Paid Tier: USD 1,50 pro Million Eingabetokens und USD 9,00 pro Million Ausgabetokens einschließlich Thinking, geprüft am 16.09.2026 in der [offiziellen Gemini-Preisliste](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.5-flash). Preise vor dem Launch erneut kontrollieren; Free-Tier-Verfügbarkeit ist keine belastbare kommerzielle Kalkulationsgrundlage.

`Kosten = Summe aller abgerechneten Versuche [(Inputtokens × 1,50 + Outputtokens einschließlich Thinking × 9,00) / 1.000.000]`

Nicht mit der Länge des ausgegebenen JSON gleichsetzen. Rückgabe eines App-Credits erstattet keine bereits angefallenen Providerkosten. Eine neue Analyse eines anderen Kontos kann erneut Kosten verursachen; keine globale kostenlose Wiederverwendung kalkulieren.

## Planungsbeispiel — ausdrücklich Annahmen

12.000 Eingabe- und 4.000 gesamte Ausgabetokens pro Extraktion: USD 0,054. Bei angenommener zehnprozentiger Rate einer zweiten vollständig berechneten Extraktion: USD 0,0594 pro Video. Ohne Audio, Bilder, Marktpreise, Steuern oder sonstige APIs.

| Erfolgreiche Videos | Geschätzte Gemini-Kosten | Bei zwei Extraktionen für jedes Video |
|---:|---:|---:|
| 1 | $0,0594 | $0,108 |
| 100 | $5,94 | $10,80 |
| 1.000 | $59,40 | $108,00 |
| 10.000 | $594,00 | $1.080,00 |

Das ist keine Prognose: längere Transkripte, Thinking, erneute Nutzerstarts und Fehlschläge verändern die Kosten. Ein Stressbeispiel mit 50.000 Input- und 24.000 Outputtokens kostet $0,291 pro berechnetem Versuch. Sechs so berechnete Versuche wären $1,746. Das ist KEIN technischer Kostenhöchstwert, da 50.000 Inputtokens hier nur eine Annahme sind.

## Speicher und weitere Kosten

Planungsannahme 100 KB pro vollständigem Report einschließlich Transkript: 100 Videos ≈ 10 MB, 1.000 ≈ 100 MB, 10.000 ≈ 1 GB Rohdaten. SQLite-Indizes, WAL, Logs, Revisionen und Backups kommen hinzu. Vor Kapazitätsentscheidungen echte Reports und Backupgrößen messen; die kleinen Demoauszüge dürfen dafür nicht hochgerechnet werden.

Hosting, persistentes Volume, Backups, E-Mail-Versand und Support sind zusätzlich einzukalkulieren; hier ist kein konkreter Tarif gebucht oder verifiziert. YouTube hat Quoten. Audio-/Visual-Fallback und Research-Fragen haben eigene variable Kosten und sind in der Tabelle nicht enthalten. Twelve Data/Massive werden nicht in ein kommerzielles Angebot eingerechnet; die Marktdatensperre bleibt bestehen. Pro-Preis, Marge und Kontingent werden erst nach Messung festgelegt.

## Vor einem bezahlten Angebot messen

Mindestens zehn echte DE/EN-Videos unterschiedlicher Länge: Inputtokens, gesamte Output-/Thinking-Tokens, Versuche, Dauer, Erfolgsstatus und gespeicherte Bytes erfassen und gegen Providerrechnung abgleichen. Keine Transkriptinhalte oder Schlüssel in Kostenlogs speichern. Erst danach p50/p95-Kosten und einen Fehlerpuffer für Gratisanalysen und Pro bestimmen. Diese Instrumentierung ist eine spätere, getrennte Änderung; die funktionierende Analyse wurde in Phase 1 nicht umgebaut.
