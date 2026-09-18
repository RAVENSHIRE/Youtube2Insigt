# Pro-Testcheckout — 18. September 2026

Branch: `feature/pro-checkout-access`. Basis: Free-Abnahme aus PR #10 (`48b0997`).
Keine Freigabe für echte Zahlungen, Deployment oder Merge dieses Features.

## Verhalten

- Free bleibt eine persönliche Analyse pro verifiziertem Konto. Vorhandene Reports bleiben lesbar.
- Pro ergänzt standardmäßig 20 Analysen je **bezahltem** Abrechnungsmonat (`PRO_MONTHLY_ANALYSES`). Eine ungenutzte Gratisanalyse bleibt zusätzlich erhalten. Monatscredits werden nicht übertragen.
- Preis und Währung stammen aus dem konfigurierten Stripe-Preis: aktiver monatlicher Festpreis, Menge 1, CHF/EUR/USD/GBP. Kein Jahresabo, Mengenmodell, Trial oder Live-Modus in diesem Feature.
- Der Nutzer sieht Betrag, Kontingent und Testmodus und bestätigt ausdrücklich vor dem Checkout. Stripe kann im Checkout zusätzlich konfigurierte Steuern anzeigen; der Endbetrag dort ist maßgeblich.
- Der Erfolgslink ist nur ein Statusabruf. Erst ein signierter Webhook mit aktueller Stripe-Subscription und passender bezahlter Rechnung aktiviert Pro. Doppelte Events erzeugen keine weiteren Credits; verspätete Events werden gegen den aktuellen Stripe-Zustand geprüft.
- Offene Checkouts werden wiederverwendet. Bei einem bereits abgeschlossenen, noch nicht bestätigten Checkout erscheint ein Wartehinweis. Bestehende Abos werden im Customer Portal verwaltet.
- `past_due`, `unpaid`, `incomplete`, `trialing`, `canceled` und abgelaufene Zeiträume schalten keine neuen Pro-Analysen frei. Eine vorgemerkte Kündigung erhält Zugang bis zum bezahlten Periodenende. Gespeicherte Reports bleiben erhalten.
- Analysefehler geben die Reservierung weiterhin frei. Gespeicherte Reports erneut öffnen verbraucht nichts. Stripe-Latenz blockiert das Laden der Research Library nicht.
- Das große „Konto & Pro“ wurde durch ein Profilmenü ersetzt. Nach bestätigtem Checkout erscheint wieder Creator Overview mit der persönlichen Research Library. Die Extension aktualisiert den Kontostand beim erneuten Fokus.
- Marktdatenrechte werden durch Pro **nicht** freigeschaltet. Es gibt keinen HTTP-Dummy-Schalter für kostenloses Pro.

## Verifikation hier

- Vollständige Suite: **245 bestanden, 0 fehlgeschlagen, 0 übersprungen** (Node 24.19).
- Neue Tests: Stripe-HTTP-Vertragsfixtures, authentifizierte Express-Routen, echte SQLite-Transaktionen und DOM-Ereignisprüfungen. Stripe-Antworten sind dabei simuliert.
- Enthalten: doppelte Checkouts, Eigentümerprüfung, bestätigter Monatsbetrag, Modussperre, ungültiger Preis/Redirect, abgelaufene Session, erneutes Abo nach Kündigung, Rückkehr ohne Freischaltung, bezahlte/unbezahlte Perioden, Wiederholung/verzögerte Webhooks, Verlängerung, fehlgeschlagene Zahlung, Kündigung, Quoten und Credit-Recovery.
- Bestehende Regressionen: Auth/Bestätigung, Free-Analyse, Kontentrennung, Reports/CSV, Beispiele, IPO Market Watch sowie RKLB/ASTS/Gold-TradingView bestehen.
- **Keine echte Stripe-Zahlung hier ausgeführt:** Testschlüssel, Testpreis und Webhook-Secret fehlen in dieser Arbeitsumgebung.
- **Keine neue visuelle Chrome-Abnahme:** Der Browser meldete beim Zugriff auf die isolierte lokale Testseite `net::ERR_BLOCKED_BY_CLIENT`. DOM-Tests sind kein Browser-End-to-End-Nachweis.

## Einrichtung auf deinem bestehenden Rechner

Bestehende `.env`, Datenbank, Resend-, YouTube-, Gemini- und Extension-Origin-Werte beibehalten. Keine Secrets in Chat, Git oder Screenshots posten.

1. Stripe-Testumgebung/Sandbox auswählen. Ein Produkt „Pro“ mit einem aktiven **monatlichen, festen** Preis in CHF, EUR, USD oder GBP erstellen. Preis selbst festlegen. `price_...` und `sk_test_...` müssen derselben Testumgebung angehören.
2. Customer Portal in dieser Testumgebung aktivieren; Zahlungsmittelverwaltung und Kündigung zum Periodenende erlauben. Planwechsel/Mengenänderung deaktivieren, da nur ein Pro-Preis unterstützt wird.
3. Stripe CLI installieren und dort anmelden. In einem eigenen PowerShell-Fenster ausführen und geöffnet lassen:

```powershell
stripe login
stripe listen --events checkout.session.completed,invoice.paid,invoice.payment_failed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted --forward-to localhost:3000/billing/webhook
```

4. `.env` im Projektroot um folgende Werte ergänzen bzw. vorhandene Zeilen bearbeiten. Platzhalter durch echte **Testwerte** ersetzen, nicht doppelt anlegen. Das `whsec_...` muss vom laufenden CLI-Listener stammen, nicht von einem anderen Dashboard-Webhook:

```dotenv
BILLING_MODE=test
STRIPE_SECRET_KEY=sk_test_DEIN_TESTSCHLUESSEL
STRIPE_PRO_PRICE_ID=price_DEIN_MONATLICHER_TESTPREIS
STRIPE_WEBHOOK_SECRET=whsec_DEIN_CLI_LISTENER_SECRET
PRO_MONTHLY_ANALYSES=20
PUBLIC_BASE_URL=http://localhost:3000
COMMERCIAL_MARKET_DATA_APPROVED=false
```

5. Server stoppen und aus dem Projektroot die Tests und den Server starten. Jeden Codeblock vollständig kopieren, ohne `PS ...>` oder `>>`:

```powershell
Set-Location 'C:\Users\j.krayenbuehl\Desktop\dev\Youtube2Insigt'
npm test --prefix server
if ($LASTEXITCODE -ne 0) { throw 'Tests fehlgeschlagen. Server nicht starten.' }
node .\server\server.js
```

6. Zweites Fenster für eine Prüfung ohne Secrets:

```powershell
$Config = Invoke-RestMethod 'http://localhost:3000/config'
$Config | Select-Object billingAvailable, billingMode, proMonthlyAnalyses, marketDataAvailable | Format-List
Start-Process 'http://localhost:3000/account/'
```

Erwartet: `billingAvailable=True`, `billingMode=test`, `proMonthlyAnalyses=20`, `marketDataAvailable=False`. Dies beweist Konfiguration, noch keinen erfolgreichen Checkout; Preisprüfung erfolgt im Profilmenü. `release:check` prüft zusätzlich spätere HTTPS-Produktionsvoraussetzungen und darf lokal deshalb „blocked“ melden.

## Abnahmetest mit realem Stripe-Testmodus

1. Mit dem bestehenden verifizierten Free-Konto anmelden. Alten Report, CSV und direkte TradingView-Links öffnen. Verbrauch bleibt unverändert.
2. Profil oben rechts öffnen. Monatsbetrag, Währung und 20 Analysen prüfen. Ohne Zustimmung bleibt Checkout gesperrt.
3. Zuerst Checkout abbrechen: weiterhin Free, keine neuen Credits.
4. Erneut öffnen; nur **Stripe-Testkarte** `4242 4242 4242 4242`, zukünftiges Ablaufdatum und beliebige dreistellige CVC verwenden. Keine echten Kartendaten. Nach Abschluss zurück zur Kontoseite.
5. CLI muss relevante Events mit HTTP 200 zeigen. Danach zeigt das Profil Pro und 20 Analysen (21, falls die Gratisanalyse ungenutzt ist). Creator Overview und bestehende Reports bleiben erhalten. Falls der Webhook verspätet ist: „Status erneut prüfen“, nicht erneut bezahlen.
6. Neues Video analysieren: vollständiger Report, `analysis_completed`, Kontingent genau minus 1. Report wieder öffnen: kein zusätzlicher Verbrauch. Bei einem echten Providerfehler wird die Reservierung freigegeben.
7. Extension unter `chrome://extensions` neu laden; dort mit demselben Konto anmelden. Nach Rückkehr ins Panel muss Pro und derselbe Creditstand erscheinen. IPO Market Watch, RKLB/ASTS und Gold-Links sowie CSV nochmals prüfen.
8. In einem zweiten getrennten Konto bleiben Free und die eigene Bibliothek unverändert. Eine fremde `session_id` darf keine Freischaltung und keine fremden Kontodaten liefern.
9. Im Test-Portal Kündigung vormerken: Pro bis Periodenende. Sofortige Kündigung im Test-Dashboard: Free, alte Reports lesbar. Nicht mehrere echte Abos erstellen.
10. Einen weiteren Erstcheckout mit `4000 0000 0000 9995` ablehnen lassen: keine bezahlte Freischaltung. Für eine fehlgeschlagene **Verlängerung** Stripe-Test-Clocks und die dort dokumentierten Zahlungsmethoden nutzen; ein beliebiger `stripe trigger invoice.paid` gehört nicht automatisch zu diesem App-Konto.
11. Monatsverlängerung per Test Clock oder separat kontrollierter Stripe-Simulation: einmaliges neues Monatskontingent, kein Übertrag. Duplikate/alte Events nochmals zustellen: keine Doppelgutschrift und keine Rückstufung gegen den aktuellen Stripe-Zustand. Zukünftige Test-Clock-Perioden werden nicht vor ihrem Beginn nach Server-Uhr nutzbar; keine Systemuhr des laufenden Produkts dafür verstellen. Der automatisierte Verlängerungstest verwendet eine explizite Test-Uhr. Test Clocks benötigen eine dazugehörige Stripe-Testkundschaft; der normale App-Checkout legt keine Clock an. Diesen erweiterten Nachweis getrennt vom Erstcheckout dokumentieren.

Abnahmeprotokoll ohne Secrets: Commit, Datum, Ereignis-ID, HTTP-Status, Plan/Credits vorher und nachher, Analyse-Auftrags-ID und Ergebnis. Keine Checkout-URLs, Tokens, Schlüssel oder personenbezogenen Zahlungsdaten in öffentliche Logs schreiben.

## Recovery und Grenzen

Keine neue Schema-Migration, keine automatische Umwandlung bestehender Reports. Für den lokalen Test weiterhin genau ein Node-Prozess auf der vorhandenen SQLite-Datenbank. Mehrere Serverinstanzen brauchen vor produktiver Skalierung verteilte Checkout-Sperren.

Vor dem Einspielen Codezustand und Datenbank sichern. Bestehender Helfer: `node server/scripts/backup-accounts.js --source ABSOLUTER_DB_PFAD --output NEUER_BACKUP_PFAD`. Die Datei darf nicht bereits existieren. `.env` bei Änderungen separat geschützt sichern. Keine Stashes löschen.

Rollback: Server stoppen, neuen Feature-Patch mit `git apply -R --check` prüfen und nur bei erfolgreicher Prüfung rückwärts anwenden; alternativ zur vorher gesicherten Codeversion zurückkehren. `BILLING_MODE=disabled` schließt neue Checkouts. Bereits in SQLite gespeicherte bezahlte Test-Zeiträume werden dadurch nicht gelöscht. Test-Abos vorher in Stripe kündigen und Kündigungs-Webhooks verarbeiten lassen; die bestehenden Berichte/Datenbank nicht zurücksetzen.

Vor einem öffentlichen Kaufangebot bleiben echte Stripe-Test-Abnahme, Preis-/Steuer-/Portal-Konfiguration, HTTPS-Deployment, dauerhafte Datenbank samt Recovery und Betreiber-/Datenschutz-/Vertragsangaben offen. **Live-Schlüssel allein aktivieren in diesem Branch keine echten Zahlungen.** Dafür folgt nach dieser Abnahme eine separate Freigabe und Implementierung. Marktdaten bleiben bis zur vertraglichen Rechtefreigabe außen vor.

Quellen: [Stripe-Webhooks und lokaler Listener](https://docs.stripe.com/webhooks), [Testkarten](https://docs.stripe.com/testing), [Test Clocks](https://docs.stripe.com/billing/testing/test-clocks).
