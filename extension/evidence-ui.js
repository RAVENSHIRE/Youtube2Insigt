(function(root) {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  function clock(seconds) {
    const whole = Math.floor(seconds);
    return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
  }
  function render(items = []) {
    if (!items.length) return '<p class="report-missing">Keine Belege verfügbar.</p>';
    return items.map(item => {
      if (typeof item === 'string') return `<li class="evidence-legacy">${escape(item)}<small>Altbericht · Originalsegment und Zeitmarke noch nicht geprüft</small></li>`;
      if (!item?.original_text) return '';
      const timed = item.validation === 'source_match' && Number.isFinite(item.start_seconds) && Number.isFinite(item.end_seconds);
      return `<li class="evidence-item" ${timed ? `data-evidence-start="${item.start_seconds}" data-evidence-end="${item.end_seconds}"` : ''}>
        ${timed ? `<button type="button" class="evidence-marker" data-seek-evidence="${item.start_seconds}" aria-label="Zur Belegstelle ${clock(item.start_seconds)}">${clock(item.start_seconds)}</button>` : '<small>Zeitmarke ungeprüft</small>'}
        <blockquote>${escape(item.original_text)}</blockquote><small>Original · ${escape(item.source_language)} · ${timed ? 'mit Quellsegment abgeglichen' : 'nicht verifiziert'}</small>
        ${item.translation?.text ? `<p class="evidence-translation">KI-Übersetzung (${escape(item.translation.language)}): ${escape(item.translation.text)}</p>` : ''}</li>`;
    }).join('');
  }
  const api = { render, clock };
  if (typeof module === 'object') module.exports = api;
  else root.EvidenceUI = api;
})(globalThis);
