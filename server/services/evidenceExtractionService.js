const { atStage } = require('../accounts/analysisDiagnostics');
const { validateReport } = require('../evidence/sourceIntegrity');
const { validateSelectedReport } = require('../evidence/segmentSelection');

const REPAIRABLE = new Set(['QUOTE_SOURCE_MISMATCH', 'EVIDENCE_UNSUPPORTED', 'EVIDENCE_SELECTION_INVALID']);

// One bounded re-extraction, under the existing job reservation and deadline.
// Neither attempt may bypass validation or replace invented prose with a quote.
async function extractVerifiedReport({ generate, prompt, source, signal, onStage, evidenceMode = 'quotes' }) {
  if (!['quotes', 'segments'].includes(evidenceMode)) throw new Error('Unknown evidence extraction mode');
  const validate = evidenceMode === 'segments' ? validateSelectedReport : validateReport;
  signal?.throwIfAborted();
  const data = await atStage('model_response', () => generate(prompt, { signal }), onStage);
  try {
    return await atStage('evidence_validation', () => validate(data, source), onStage);
  } catch (error) {
    if (!REPAIRABLE.has(error.code)) throw error;
    signal?.throwIfAborted();
    const position = Number.isInteger(error.companyIndex) && Number.isInteger(error.evidenceIndex)
      ? ` Firma ${error.companyIndex + 1}, Beleg ${error.evidenceIndex + 1} der vorherigen Antwort.` : '';
    const reason = /^[A-Z_]{3,40}$/u.test(error.selectionReason || '') ? ` Auswahlfehler: ${error.selectionReason}.` : '';
    const guidance = evidenceMode === 'segments' ? `
evidence darf nur segment_ids enthalten. Schreibe KEIN original_text, keine Uebersetzung und keine Zeitmarken.
Waehle nur vorhandene, aufeinanderfolgende IDs in Originalreihenfolge (eine bis sechs pro Beleg).
Kopiere IDs exakt aus der Quelle. Kein Raten, keine Zeitangaben als IDs. Getrennte Stellen sind getrennte Belege.
Waehle kurze Originalstellen, die die jeweilige Aussage wirklich stuetzen. Der Server uebernimmt deren Text unveraendert.
` : `
Kopiere original_text exakt aus den Segmenttexten: keine Rechtschreibkorrektur, keine neue Zeichensetzung,
keine Umformulierung, keine Auslassung mit "...", keine Umwandlung von Zahlwoertern oder Waehrungen.
Bevorzuge ein einzelnes Segment pro Beleg. Bei einem Zitat ueber Segmentgrenzen nenne ALLE betroffenen
aufeinanderfolgenden segment_ids in Reihenfolge (hoechstens sechs); verbinde ihren Text nur mit Leerzeichen.`;
    const repairPrompt = `${prompt}\n\nQUELLENPRUEFUNG: ${error.code}.${position}${reason}
Die vorherige Antwort wurde verworfen. Extrahiere den Bericht erneut aus den oben stehenden Originalsegmenten.
${guidance}
Fuehre nur Aussagen auf, die diese Originalsegmente tatsaechlich stuetzen. Erfinde keine Ersatzbelege.
Antworte mit dem vollstaendigen Bericht im unveraenderten JSON-Schema und der Originalsprache.`;
    const repaired = await atStage('evidence_repair', () => generate(repairPrompt, { signal }), onStage);
    signal?.throwIfAborted();
    return atStage('evidence_validation', () => validate(repaired, source), onStage);
  }
}

module.exports = { extractVerifiedReport };
