## Aktuell: Pro-Testcheckout — 18. September 2026

Maßgeblich ist [Pro-Einrichtung und Abnahme](docs/PRO_CHECKOUT_ACCESS.md). Dieser Abschnitt ersetzt den früheren Coming-soon-Status; historische Phasen unten bleiben dokumentiert.

- [x] Free-Stand einschließlich Panel-/Gold-TradingView vom Nutzer abgenommen und über PR #10 auf `main` (`48b0997`) gesichert.
- [x] Separater Branch `feature/pro-checkout-access`: expliziter Stripe-Testcheckout, geprüftes monatliches Preisangebot und Customer Portal.
- [x] Pro nur aus signierter, bezahlter Periode; monatliches Kontingent, doppelte/verzögerte Events, fehlgeschlagene Zahlung und Kündigung abgesichert.
- [x] Kompaktes Profilmenü, Rückkehr zum Creator Overview, bestehende Bibliotheken/CSV/TradingView erhalten.
- [x] 245 automatisierte Tests bestanden; Stripe-Vertragsprüfungen sind simuliert.
- [ ] Echten Stripe-Testcheckout plus Webhook, Portal, Verlängerung und fehlgeschlagene Zahlung lokal abnehmen.
- [ ] Browser-/Extension-Abnahme der neuen Oberfläche; Cloud-Browserzugriff auf localhost hier blockiert.
- [ ] Nach expliziter Freigabe dieses Feature nach `main` mergen.
- [ ] Danach getrennt Produktionskonfiguration, HTTPS-Deployment und Live-Zahlungsfreigabe. Kommerzielle Marktdaten weiterhin gesperrt.

## Nächste Abnahme: zweites Video im Free-Testkonto

- [x] Lokaler Test-Credit-Helfer mit verifiziertem SQLite-Backup und Produktionssperre.
- [x] Testprüfer kontrolliert frisches Video, Erhalt alter Reports, einmaligen Verbrauch und kostenlosen Wiederaufruf.
- [x] Getrennte Originalsegmente als separate Belege (Extraction v3); sichere Diagnose unbekannter IDs.
- [x] Optionaler lokaler Reset blendet alte Reports reversibel aus; Originale/Nummerierung bleiben erhalten.
- [x] Neuer Video-Lauf vom Nutzer bestätigt: vollständiger Report, `analysis_completed`, Credit 0 (18.09.2026).
- [x] Panel-Ticker auf direkte TradingView-Links umgestellt; 224 automatisierte Tests grün.
- [x] Gold als COMMODITY erhält beim Lesen einen gekennzeichneten Gold/USD-Referenzchart, auch ohne Ticker; 229 Tests grün.
- [x] Gold-Link lokal vom Nutzer bestätigt; Free-Stand auf main über PR #10 gesichert.
- [x] Pro-Testcheckout separat implementiert; echte Stripe-Abnahme siehe aktueller Abschnitt oben.

Anleitung: [Free-Abnahme](docs/FREE_SECOND_VIDEO_ACCEPTANCE.md). Der Live-Erfolg ist Voraussetzung für den Merge. Kein Deployment und kein Live-Payment behauptet.

## Account-Dashboard — 17. September 2026

- [x] `/account/` mit Creator Overview, Kanalkennzahlen, Fortschritt, interaktivem Sektor → Sub-Sektor → Unternehmen Report-Mix.
- [x] Research Library mit gemeinsamer Such-/Sortierlogik der Extension und stabiler Reportnummer.
- [x] Titel/Mini-Chart öffnen Report; Ticker und vollständiger CSV-Report direkt auf der Videokarte.
- [x] Watchlist-Werbeabschnitt aus Konto-/Landingseite entfernt. Pro bleibt Coming soon.
- [ ] Visuelle lokale Chrome-Abnahme; Performance-Sortierung bleibt mangels freigegebener Marktdaten deaktiviert.

Details: [Account-Dashboard-Handoff](docs/ACCOUNT_DASHBOARD_HANDOFF.md). Dieser Abschnitt ersetzt abweichende UI-Beschreibungen aus dem Phase-1-Handoff; Analyse, Login und Credits bleiben unverändert.

# SignalTube — aktive Phase 1, 16. September 2026

Maßgeblich: [PHASE_1_HANDOFF.md](PHASE_1_HANDOFF.md) und [Kostenmodell](docs/PHASE_1_COST_MODEL.md).

- [x] Funktionierenden Stand nach Quellen-, Modell- und Extension-Origin-Fixes erhalten.
- [x] Konto und Webbericht in der dunklen SignalTube-Gestaltung der Extension.
- [x] Öffentliche Landingpage mit ehrlichem Beta-Umfang und funktionierenden Konto-Links.
- [x] Pro als inaktive Coming-soon-Vorschau; kein neuer Zahlungsablauf.
- [x] Veröffentlichungsdatum hervorheben, nicht durch Analysezeit ersetzen.
- [x] Symbol-CSV pro persönlichem/Beispielreport; US-Zuordnung, Nutzertrennung, keine erfundenen Positionen.
- [x] Kostenmodell mit geprüften Providerpreisen und getrennt gekennzeichneten Annahmen.
- [ ] Visuelle lokale Chrome-Abnahme dieser Änderungen und echter Yahoo-Import.
- [ ] Echte p50/p95-Analyse- und Speicherkosten erfassen.
- [ ] Beispielbelege/Verbreitungsrechte und Betreiber-/Datenschutzangaben final prüfen.

**Kein Stripe, Deployment oder neues Feature in dieser Phase.** Bestehende Stripe-Module bleiben unverändert und sind keine Freigabe für Zahlungen. Historische Release-Checklisten unten sind nachrangig gegenüber diesem Phase-1-Umfang. Nächste Phase erst nach Abnahme.

---

# MVP release roadmap — 7 September 2026

Target: retail investors who consume finance videos, not a large trading terminal.
The extension stays compact. Working Creator Overview, channel counters, sector
Report Mix, instrument resolution and simple Research Library remain the base.

## Implementation completed; acceptance is a separate gate

- [x] Recover and push the simplified Research Library without merging `main`.
- [x] Version-8 original transcript segments, explicit timing units, DE/EN language
  guard, original quotations separate from translations, source-quote matching.
- [x] Evidence `mm:ss` buttons, existing-tab seeking, playback highlight logic;
  versioned inactive repair revisions preserve the original report.
- [x] Bounded authorized-audio gateway adapter and 30-second visual-observation API.
  Neither has a genuine live-provider proof; the audio gateway itself is external.
- [x] Persistent SQLite accounts, verified email, hashed sessions, isolated empty
  personal libraries, one free analysis and transactional quota reservation/release.
- [x] Monthly Pro Checkout, signed Stripe webhooks and Portal; duplicate,
  out-of-order, renewal, failed-payment and cancellation contract tests.
- [x] Explicit analysis action in the panel; no automatic credit consumption.
- [x] Separate three-creator legacy example library with honest source-review labels.
- [x] Compact extractive “Ask your research library”, accessible citations and coverage.
- [x] Optional consent-based readonly YouTube sync; manual creator fallback.
- [x] Commercial market-data gate, INDO/INOD conflict guard, resolved TradingView
  links where listing identity is known, quote time distinct from retrieval time.
- [x] Deployment configuration, extension builder, readiness report and verified
  SQLite backup utility. Templates are not a deployed HTTPS service.

## P0 before charging beta users

- [ ] Deploy one Node 24 instance with HTTPS, persistent storage and tested restore.
- [ ] Configure and verify email delivery, Gemini and YouTube Data API v3.
- [ ] Perform real DE/EN analysis and local Chrome timestamp/highlight acceptance.
- [ ] Configure Stripe test mode and prove actual Checkout → webhook → quota →
  renewal → failed payment → Portal cancellation. Then separately approve live mode.
- [ ] Review example originals and distribution rights; replace unverified legacy
  examples before marketing them as verified research. No invented premium corpus.
- [ ] Supply/verify the audio gateway if promising transcript-free analysis;
  otherwise explicitly restrict the beta to supported transcripts.
- [ ] Verify the targeted visual path with real source video before enabling it.
- [ ] Finalize operator identity, privacy/terms, retention/deletion process, support,
  product name and Chrome Web Store disclosures. Obtain store approval separately.

Google OAuth review may be deferred: ship manual creator selection and label sync
unavailable until approved. Commercial market-data licensing may be deferred:
keep the gate closed and do not include price/outcome features in the paid promise.

## After MVP acceptance — not in this release

Portfolio ledger/watchlists, personal PnL, public creator rankings, Stock Universe,
cross-creator consensus, deeper attribution, creator track record, community,
mobile app, full researcher terminal, strategy backtesting/Jesse and automatic
chart reconstruction. The longer-term Grand Picture is not the current backlog.
