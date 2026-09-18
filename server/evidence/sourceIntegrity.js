const { createHash } = require('node:crypto');

const EVIDENCE_VERSION = 1;
class SourceError extends Error {
  constructor(code, message, status = 422) { super(message); this.code = code; this.status = status; }
}
const normalText = value => String(value ?? '').normalize('NFC').replace(/\s+/gu, ' ').trim();
const languageCode = value => String(value || '').toLowerCase().split('-')[0];
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function assertLanguage(text, language) {
  if (!['de', 'en'].includes(languageCode(language))) {
    throw new SourceError('SOURCE_LANGUAGE_UNSUPPORTED', 'Die Beta unterstützt Originalquellen auf Deutsch und Englisch.');
  }
  // Do not silently accept a translated caption track or generated Arabic prose.
  if (/\p{Script=Arabic}/u.test(text)) {
    throw new SourceError('SOURCE_LANGUAGE_MISMATCH', 'Die Sprache stimmt nicht mit der deutschen oder englischen Quelle überein. Keine Analyse verbraucht.');
  }
}

function makeSource({ videoId, items, unit, language, durationSeconds, kind = 'youtube_captions', languageSelection = null }) {
  if (!['seconds', 'milliseconds'].includes(unit)) throw new SourceError('TIMING_UNIT_UNKNOWN', 'Zeitformat der Quelle ist nicht verifiziert.');
  if (!Array.isArray(items) || !items.length || items.length > 15000) throw new SourceError('TRANSCRIPT_UNAVAILABLE', 'Kein nutzbares Transkript.');
  const factor = unit === 'milliseconds' ? 1000 : 1;
  const lang = languageCode(language || items[0]?.lang);
  let previous = -1;
  const segments = items.map((item, index) => {
    const start = Number(item.offset) / factor;
    const end = start + Number(item.duration) / factor;
    const text = String(item.text ?? '').trim();
    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start ||
      start < previous || end > durationSeconds + 2 || text.length > 12000) {
      throw new SourceError('SOURCE_TIMING_INVALID', 'Die Zeitmarken der Quelle konnten nicht verifiziert werden.');
    }
    if (item.lang && languageCode(item.lang) !== lang) throw new SourceError('SOURCE_LANGUAGE_MISMATCH', 'Gemischte Transkriptsprachen.');
    assertLanguage(text, lang);
    previous = start;
    return { id: `s${index + 1}`, text, language: lang, start_seconds: start, end_seconds: end };
  });
  const content = { version: EVIDENCE_VERSION, video_id: videoId, kind, language: lang,
    timing_origin: kind === 'youtube_captions' ? 'caption_track' : 'speech_provider',
    duration_seconds: durationSeconds, segments, ...(languageSelection ? { language_selection: languageSelection } : {}) };
  if (JSON.stringify(content).length > 240000) throw new SourceError('SOURCE_TOO_LARGE', 'Dieses Video überschreitet die Beta-Analysegrenze.');
  return { ...content, sha256: digest(content), retrieved_at: new Date().toISOString() };
}

function selectionError(reason, ids, source) {
  const error = new SourceError('EVIDENCE_UNSUPPORTED', `Ungültige Belegauswahl: ${reason}.`);
  // Diagnostics contain IDs/counts only, never transcript or generated prose.
  error.selectionReason = reason;
  error.selectedSegmentIds = Array.isArray(ids) ? ids.slice(0, 6).map(id =>
    typeof id === 'string' && /^s\d{1,6}$/u.test(id) ? id : '[invalid]') : [];
  error.sourceSegmentCount = source.segments.length;
  return error;
}

function resolveEvidenceGroups(ids, source) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 6) throw selectionError('INVALID_COUNT', ids, source);
  if (ids.some(id => typeof id !== 'string')) throw selectionError('INVALID_ID_TYPE', ids, source);
  if (new Set(ids).size !== ids.length) throw selectionError('DUPLICATE_ID', ids, source);
  const positions = ids.map(id => source.segments.findIndex(segment => segment.id === id));
  if (positions.some(position => position < 0)) throw selectionError('UNKNOWN_ID', ids, source);
  if (positions.some((position, index) => index > 0 && position <= positions[index - 1])) {
    throw selectionError('REVERSED_ORDER', ids, source);
  }
  const groups = [];
  positions.forEach((position, index) => {
    if (!index || position !== positions[index - 1] + 1) groups.push([]);
    groups.at(-1).push(source.segments[position]);
  });
  return groups;
}

function resolveEvidenceSegments(ids, source) {
  const groups = resolveEvidenceGroups(ids, source);
  // Legacy quotations may never bridge omitted speech. Only the ID-selection
  // contract can split separate source passages into separately timed quotes.
  if (groups.length !== 1) throw selectionError('NON_CONTIGUOUS', ids, source);
  return groups[0];
}

function validateEvidence(item, source, reportLanguage = source.language) {
  const ids = item?.segment_ids;
  const segments = resolveEvidenceSegments(ids, source);
  const quotation = normalText(item.original_text);
  const context = normalText(segments.map(segment => segment.text).join(' '));
  if (quotation.length < 3 || quotation.length > 1800 || !context.includes(quotation)) {
    throw new SourceError('QUOTE_SOURCE_MISMATCH', 'Ein Zitat stimmt nicht mit dem Originaltranskript überein.');
  }
  // Times are derived exclusively from the source, never from the extraction model.
  const translation = item.translation?.text ? {
    text: normalText(item.translation.text), language: reportLanguage, label: 'AI translation'
  } : null;
  if (translation) assertLanguage(translation.text, reportLanguage);
  return { id: `ev_${digest({ ids, quotation }).slice(0, 16)}`, kind: 'transcript',
    segment_ids: ids, original_text: quotation, source_language: source.language,
    start_seconds: segments[0].start_seconds, end_seconds: segments.at(-1).end_seconds,
    timing_precision: 'segment', validation: 'source_match', source_sha256: source.sha256, translation };
}

function validateReport(data, source, reportLanguage = source.language) {
  if (!data || !Array.isArray(data.companies) || !data.companies.length || data.companies.length > 100) {
    throw new SourceError('NO_SUPPORTED_IDEAS', 'Keine belegten Investment-Ideen gefunden.');
  }
  assertLanguage(JSON.stringify(data), reportLanguage);
  const companies = data.companies.map((company, companyIndex) => {
    if (!Array.isArray(company.evidence) || !company.evidence.length) throw new SourceError('EVIDENCE_MISSING', 'Investment-Aussage ohne Beleg.');
    return { ...company, evidence: company.evidence.map((item, evidenceIndex) => {
      try { return validateEvidence(item, source, reportLanguage); }
      catch (error) {
        if (!(error instanceof SourceError)) throw error;
        error.companyIndex = companyIndex;
        error.evidenceIndex = evidenceIndex;
        error.message += ` (Firma ${companyIndex + 1}, Beleg ${evidenceIndex + 1})`;
        throw error;
      }
    }),
      risks: Array.isArray(company.risks) ? company.risks.filter(x => typeof x === 'string').slice(0, 8) : [] };
  });
  return { ...data, companies, source, evidence_version: EVIDENCE_VERSION, report_language: reportLanguage };
}

module.exports = { SourceError, makeSource, validateEvidence, validateReport, resolveEvidenceSegments, resolveEvidenceGroups, normalText, languageCode, assertLanguage, digest };
