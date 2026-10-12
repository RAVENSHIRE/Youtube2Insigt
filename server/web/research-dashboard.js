(function (root) {
  const esc = value => String(value ?? '').replace(/[&<>"']/gu, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const colors = ['#ff5a47','#f5bf56','#4bd29b','#76adff','#bc94ef','#eb91ba','#86cec5'];
  const number = value => value != null && value !== '' && Number.isFinite(Number(value)) ? Number(value).toLocaleString('de-CH') : '—';
  function avatar(creator) {
    const initials = String(creator.name || '?').split(/\s+/u).slice(0,2).map(s=>s[0]).join('');
    let url;
    try { const parsed = new URL(creator.avatarUrl); if (parsed.protocol === 'https:' && ['yt3.ggpht.com','yt3.googleusercontent.com'].includes(parsed.hostname)) url = parsed.href; } catch {}
    return `<span class="creator-avatar"><span>${esc(initials)}</span>${url ? `<img src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}</span>`;
  }
  function creators(items, selected) {
    return items.length ? items.map(c=>`<button type="button" class="creator-tile" data-creator="${esc(c.creatorId)}" aria-pressed="${c.creatorId === selected}">${avatar(c)}<span><strong>${esc(c.name)}</strong><small>${number(c.analyzedVideos)}/${number(c.totalVideos)} analysiert</small></span></button>`).join('') : '<p>Noch keine Creator. Analysiere dein erstes Video, um deine Bibliothek aufzubauen.</p>';
  }
  function channel(creator, videos) {
    if (!creator) return '';
    let href = null;
    try { const url = new URL(creator.url); if (url.protocol === 'https:' && ['youtube.com','www.youtube.com'].includes(url.hostname)) href = url.href; } catch {}
    const name = href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(creator.name)}</a>` : esc(creator.name);
    const total = Number(creator.totalVideos), valid = creator.totalVideos != null && total > 0;
    return `<div class="channel-heading">${avatar(creator)}<div><p class="eyebrow">YOUTUBE CHANNEL</p><h2>${name}</h2></div></div><div class="channel-stats"><div><strong>${number(creator.subscriberCount)}</strong><small>Abonnenten</small></div><div><strong>${number(creator.totalVideos)}</strong><small>Gesamte Anzahl Videos</small></div><div><strong>${videos.length}/${number(creator.totalVideos)}</strong><small>Analysierte Videos</small>${valid ? `<progress max="${total}" value="${Math.min(total,videos.length)}" aria-label="Analysierte Videos"></progress>` : ''}</div></div>`;
  }
  function groups(videos, path = []) {
    const grouped = new Map();
    for (const video of videos) for (const company of video.companies || []) {
      const sector = company.sector || 'Other', sub = company.sub_sector || 'Unclassified';
      if ((path[0] && path[0] !== sector) || (path[1] && path[1] !== sub)) continue;
      const label = path.length === 0 ? sector : path.length === 1 ? sub : (company.company || company.ticker || 'Unbekannt');
      // Keep same-name instruments separate; never combine distinct tickers implicitly.
      const key = path.length < 2 ? label : JSON.stringify([company.company,company.ticker]);
      if (!grouped.has(key)) grouped.set(key,{key,label,count:0,videoIds:new Set(),company});
      const group = grouped.get(key);
      if (!group.videoIds.has(video.id)) { group.count++; group.videoIds.add(video.id); }
      // Sector/sub-sector totals count every mentioned entity in each video.
      else if (path.length < 2) group.count++;
    }
    return [...grouped.values()].sort((a,b)=>b.count-a.count || a.label.localeCompare(b.label));
  }
  function donut(items, interactive = false) {
    const total = items.reduce((sum,item)=>sum+item.count,0); let offset=0;
    const arcs = items.map((item,index)=>{
      const length = total ? item.count/total*100 : 0;
      const circle = `<circle cx="60" cy="60" r="46" pathLength="100" fill="none" stroke="${colors[index%colors.length]}" stroke-width="12" stroke-dasharray="${length} ${100-length}" stroke-dashoffset="${-offset}" transform="rotate(-90 60 60)"/>`;
      offset+=length;
      return interactive ? `<a href="#reportMix" data-mix-index="${index}" aria-label="${esc(item.label)}: ${item.count} Vorstellungen">${circle}</a>` : circle;
    }).join('');
    return `<svg viewBox="0 0 120 120" class="research-donut" ${interactive ? 'role="group" aria-label="Report-Mix"' : 'aria-hidden="true"'}><circle cx="60" cy="60" r="46" fill="none" stroke="#29303b" stroke-width="12"/>${arcs}<text x="60" y="59" text-anchor="middle" fill="#f5f1e8" font-size="22" font-weight="700">${total}</text><text x="60" y="76" text-anchor="middle" fill="#b3bac6" font-size="9">${interactive?'Vorstellungen':'Assets'}</text></svg>`;
  }
  function mix(videos,path) {
    const items=groups(videos,path),total=items.reduce((n,item)=>n+item.count,0);
    return `<div class="mix-nav"><button type="button" data-mix-back="0">Sektoren</button>${path.map((label,i)=>`<span>›</span><button type="button" data-mix-back="${i+1}">${esc(label)}</button>`).join('')}<small>Klicken zum Aufklappen</small></div><div class="mix-layout">${donut(items,true)}<div class="mix-legend">${items.map((item,i)=>`<button type="button" data-mix-index="${i}"><svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="5" fill="${colors[i%colors.length]}"/></svg><span>${esc(item.label)}</span><strong>${item.count}× · ${Math.round(item.count/total*100)}%</strong></button>`).join('') || '<p>Keine Vorstellungen vorhanden.</p>'}</div></div>`;
  }
  function videos(items, view) {
    return items.length ? items.map(video=>{
      const companies=video.companies || [], id=esc(video.id), sequence=Number(video.analysisSequence);
      return `<article class="library-entry"><div class="video-top"><div><p class="video-meta">Report ${Number.isInteger(sequence)&&sequence>0?String(sequence).padStart(2,'0'):'—'} <span>·</span> ${esc(view.publicationDate(video.publishedAt))}</p><h3><button type="button" class="video-title-button" data-report-video="${id}" aria-expanded="false">${esc(video.title || 'Unbenanntes Video')}</button></h3></div><button type="button" class="video-chart-button" data-report-video="${id}" aria-expanded="false" aria-label="Vollständigen Report öffnen: ${esc(video.title)}">${donut(companies.map(c=>({count:1})))}</button></div><p>${esc(video.summary)}</p><div class="ticker-row">${companies.map(c=>view.tickerLink(c)).join('')}</div><div class="actions"><button type="button" data-report-video="${id}" aria-expanded="false" data-report-label="true">Vollständigen Report öffnen</button><a class="button secondary" href="/videos/${id}/report.csv" download>CSV-Report ↓</a><a target="_blank" rel="noopener noreferrer" href="https://www.youtube.com/watch?v=${id}">YouTube ↗</a></div><div class="saved-report" hidden></div></article>`;
    }).join('') : '<p>Keine passenden Reports.</p>';
  }
  const api={creators,channel,groups,mix,videos};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.ResearchDashboard=api;
})(globalThis);
