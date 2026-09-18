const { SourceError, resolveEvidenceGroups, normalText, assertLanguage, validateReport } = require('./sourceIntegrity');

// New extraction contract: the model selects segment IDs, never writes quotes.
// Legacy quote validation remains strict and separate; no invalid quote is
// silently replaced. This verifies provenance, not semantic entailment of claims.
function validateSelectedReport(data, source) {
  if (!data || !Array.isArray(data.companies) || !data.companies.length || data.companies.length > 100) {
    throw new SourceError('NO_SUPPORTED_IDEAS', 'Keine belegten Investment-Ideen gefunden.');
  }
  assertLanguage(JSON.stringify(data), source.language);
  const companies = data.companies.map((company, companyIndex) => {
    if (!Array.isArray(company?.evidence) || !company.evidence.length || company.evidence.length > 5) {
      throw new SourceError('EVIDENCE_MISSING', 'Investment-Aussage ohne gültige Belegauswahl.');
    }
    const evidence = company.evidence.flatMap((selection, evidenceIndex) => {
      try {
        if (!selection || typeof selection !== 'object' || Array.isArray(selection) ||
          Object.keys(selection).some(key => key !== 'segment_ids')) {
          throw new SourceError('EVIDENCE_SELECTION_INVALID', 'Die Belegauswahl darf nur Quellsegment-IDs enthalten, keinen generierten Zitattext.');
        }
        return resolveEvidenceGroups(selection.segment_ids, source).map(segments => {
          const original_text = normalText(segments.map(segment => segment.text).join(' '));
          if (original_text.length < 3 || original_text.length > 1800) {
            throw new SourceError('EVIDENCE_UNSUPPORTED', 'Die gewählte Originalstelle ist zu kurz oder zu lang.');
          }
          return { segment_ids: segments.map(segment => segment.id), original_text };
        });
      } catch (error) {
        if (!(error instanceof SourceError)) throw error;
        error.companyIndex = companyIndex;
        error.evidenceIndex = evidenceIndex;
        error.message += ` (Firma ${companyIndex + 1}, Beleg ${evidenceIndex + 1})`;
        throw error;
      }
    });
    return { ...company, evidence };
  });
  const verified = validateReport({ ...data, companies }, source);
  return { ...verified, evidence_extraction_version: 3, companies: verified.companies.map(company => ({
    ...company, evidence: company.evidence.map(item => ({ ...item, quote_origin: 'source_segments' }))
  })) };
}

module.exports = { validateSelectedReport };
