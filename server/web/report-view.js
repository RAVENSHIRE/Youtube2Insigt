(function (root) {
  const escape = value => String(value ?? '').replace(/[&<>"']/gu, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  const clock = seconds => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
  const array = value => Array.isArray(value) ? value : [];
  const section = (title, contents) => `<section><h4>${title}</h4>${contents}</section>`;
  const missing = text => `<p class="fine">${text}</p>`;
  const labels = {buy:'Kaufen',add:'Aufstocken',hold:'Halten',reduce:'Reduzieren',sell:'Verkaufen',watch:'Beobachten',none:'Keine explizite Aktion',
    entry:'Einstieg',support:'Unterstützung',resistance:'Widerstand',breakout:'Ausbruch',stop_loss:'Stop-Loss',reference:'Referenz'};
  function price(item) {
    return item?.value !== null && item?.value !== undefined && Number.isFinite(Number(item.value))
      ? `${escape(item.value)}${item.currency ? ` ${escape(item.currency)}` : ''}` : 'Keine Preisangabe';
  }
  function tradingView(url) {
    return typeof url === 'string' && /^https:\/\/www\.tradingview\.com\/symbols\/[A-Z0-9.-]+-[A-Z0-9.%_-]+\/$/u.test(url) ? url : null;
  }
  function tickerLink(company) {
    const label = company.ticker || company.company || 'Asset';
    const sentiment = ['bull','bear','neutral'].includes(company.sentiment) ? company.sentiment : 'neutral';
    const resolved = tradingView(company.tradingview_url);
    const commodity = String(company.asset_type || '').trim().toLowerCase() === 'commodity';
    const symbol = !commodity && /^[A-Z0-9][A-Z0-9.:-]{0,24}$/u.test(company.ticker || '') ? company.ticker : null;
    const href = company.identity_conflict ? null : resolved || (symbol ? `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}` : null);
    const title = resolved ? company.tradingview_label || `${company.company || label} auf TradingView` : 'Symbol bei TradingView öffnen; Börsenplatz nicht bestätigt. Bitte Zuordnung prüfen.';
    return href ? `<a class="ticker-chip sentiment-${sentiment}" href="${escape(href)}" target="_blank" rel="noopener noreferrer" title="${escape(title)}">${escape(label)} ↗</a>` : `<span class="ticker-chip sentiment-${sentiment}" title="Instrument-Zuordnung offen">${escape(label)}</span>`;
  }
  function evidenceMarkup(evidence, videoId) {
    if (!evidence.length) return missing('Keine prüfbaren Belege gespeichert.');
    return evidence.map(item => {
      const text = typeof item === 'string' ? item : item?.original_text || '';
      const verified = item?.validation === 'source_match' && typeof item.start_seconds === 'number' &&
        Number.isFinite(item.start_seconds) && item.start_seconds >= 0 && /^[\w-]{11}$/u.test(videoId);
      const marker = verified ? `<a href="https://www.youtube.com/watch?v=${videoId}&amp;t=${Math.floor(item.start_seconds)}s" target="_blank" rel="noopener noreferrer">${clock(item.start_seconds)} ↗</a>` : '<span class="fine">Zeitmarke nicht verifiziert</span>';
      const translation = item?.translation?.text ? `<p class="fine">KI-Übersetzung (${escape(item.translation.language)}): ${escape(item.translation.text)}</p>` : '';
      return `<blockquote>${marker}<p>${escape(text)}</p>${translation}</blockquote>`;
    }).join('');
  }
  function companyMarkup(company, videoId, index) {
    const tv = tradingView(company.tradingview_url);
    const ticker = tickerLink(company);
    const sentiment = {bull:'Bullish',neutral:'Neutral',bear:'Bearish'}[company.sentiment];
    const facts = [ ['Call-Typ',company.call_type], ['Aktion', labels[company.action] || company.action],
      ['Asset',company.asset_type], ['Sektor',company.sector], ['Sub-Sektor',company.sub_sector], ['Zeithorizont',company.time_horizon],
      ['Genannte Bewegung',company.mentioned_move_pct == null ? null : `${company.mentioned_move_pct} %`] ]
      .filter(([,value])=>value != null && value !== '')
      .map(([label,value])=>`<div><dt>${label}</dt><dd>${escape(value)}</dd></div>`).join('');
    const targets = array(company.price_targets).map(item=>`<li>${price(item)}${item.context ? ` — ${escape(item.context)}` : ''}${item.source ? ` (${escape(item.source)})` : ''}</li>`).join('');
    const levels = array(company.levels).map(item=>`<li>${escape(labels[item.type] || item.type || 'Level')}: ${price(item)}${item.context ? ` — ${escape(item.context)}` : ''}</li>`).join('');
    const risks = array(company.risks).map(risk=>`<li>${escape(risk)}</li>`).join('');
    return `<details class="saved-company" ${index === 0 ? 'open' : ''}><summary>${escape(company.company || 'Unternehmen')}${company.ticker ? ` · ${escape(company.ticker)}` : ''}</summary>
      <div class="saved-company-body"><div class="actions">${ticker}${sentiment ? `<span class="sentiment sentiment-${company.sentiment}">${sentiment}</span>` : ''}${tv ? `<a href="${escape(tv)}" target="_blank" rel="noopener noreferrer">TradingView ↗</a>` : ''}</div>
      ${company.identity_conflict ? missing('Unternehmensname und Symbol widersprechen sich; keine verlässliche Instrument-Zuordnung.') : ''}
      <dl class="report-facts">${facts}</dl>
      ${section('Investment-These', company.thesis ? `<p>${escape(company.thesis)}</p>` : missing('Keine These gespeichert.'))}
      ${section('Kursziele', targets ? `<ul>${targets}</ul>` : missing('Keine ausdrücklichen Kursziele gespeichert.'))}
      ${section('Marken &amp; Levels', levels ? `<ul>${levels}</ul>` : missing('Keine Levels gespeichert.'))}
      ${section('Risiken', risks ? `<ul>${risks}</ul>` : missing('Keine Risiken aus den Belegen extrahiert. Das bedeutet nicht, dass keine Risiken bestehen.'))}
      ${section('Belege aus dem Video', evidenceMarkup(array(company.evidence), videoId))}</div></details>`;
  }
  function publicationDate(value) {
    if (!value || !Number.isFinite(Date.parse(value))) return 'nicht bekannt';
    return new Intl.DateTimeFormat('de-CH', {year:'numeric',month:'long',day:'numeric',timeZone:'Europe/Zurich'}).format(new Date(value));
  }
  function render(report) {
    const id = report?.video?.id;
    if (!/^[A-Za-z0-9_-]{11}$/u.test(id || '')) throw Error('Ungültige Report-Identität.');
    const companies = array(report.companies);
    const metadata = [report.video.creator, report.video.published_at ? `Veröffentlicht: ${report.video.published_at}` : '', report.report_language ? `Quellsprache: ${report.report_language}` : ''].filter(Boolean).map(escape).join(' · ');
    return `<h3>Vollständiger Analysebericht</h3><p class="publication">Veröffentlicht: ${escape(publicationDate(report.video.published_at))}</p><p class="fine">${metadata}</p><a class="button secondary" href="${report.example ? '/examples' : ''}/videos/${id}/report.csv" download>CSV-Report herunterladen ↓</a>` +
      (companies.length ? companies.map((company,index)=>companyMarkup(company,id,index)).join('') : missing('Keine Unternehmen im gespeicherten Bericht.'));
  }
  const view = {render, publicationDate, tickerLink};
  if (typeof module === 'object' && module.exports) module.exports = view;
  else root.SavedReportView = view;
})(globalThis);
