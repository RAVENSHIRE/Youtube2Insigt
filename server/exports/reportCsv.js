const HEADERS = ['Video ID','Published at','Title','Creator','Summary','Company','Ticker','TradingView','Call type','Sentiment','Action','Sector','Sub-sector','Thesis','Risks','Price targets','Levels','Evidence'];
function cell(value) {
  let text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  // CSV quoting does not prevent spreadsheet formula execution.
  if (/^[\s\u0000-\u001f]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text)) text = "'" + text;
  return `"${text.replaceAll('"','""')}"`;
}
function reportCsv(report) {
  const video = report.video || {};
  const companies = report.companies?.length ? report.companies : [{}];
  return '\ufeff' + [HEADERS, ...companies.map(c=>[
    video.id,video.published_at,video.title,video.creator,report.summary,c.company,c.ticker,c.tradingview_url,
    c.call_type,c.sentiment,c.action,c.sector,c.sub_sector,c.thesis,c.risks,c.price_targets,c.levels,c.evidence
  ])].map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}
function sendReportCsv(res, report) {
  const id = /^[\w-]{11}$/u.test(report.video?.id || '') ? report.video.id : 'report';
  res.set('Cache-Control','private, no-store');
  res.set('Content-Disposition',`attachment; filename="signaltube-${id}-report.csv"`);
  res.type('text/csv').send(reportCsv(report));
}
module.exports={reportCsv,sendReportCsv,cell,HEADERS};
