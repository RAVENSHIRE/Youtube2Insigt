// Separate from video navigation: export never opens a YouTube or TradingView tab.
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-export-watchlist]');
  if (!button || button.disabled) return;
  event.preventDefault();
  const videoId = button.dataset.exportWatchlist;
  if (!/^[A-Za-z0-9_-]{11}$/u.test(videoId || '')) return;
  button.disabled = true;
  const label = button.textContent;
  const scope = AppApi.scope;
  try {
    const response = await AppApi.fetch(`${AppApi.base}/videos/${videoId}/watchlist.csv`);
    if (!response.ok) throw Error((await response.json()).error || 'Export nicht verfügbar.');
    const contents = await response.blob();
    if (!button.isConnected || scope !== AppApi.scope) return;
    const url = URL.createObjectURL(contents);
    const link = document.createElement('a');
    link.href = url; link.download = `signaltube-${videoId}-watchlist.csv`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    button.textContent = 'CSV heruntergeladen ✓';
  } catch (error) {
    if (error.name !== 'AbortError') {
      button.textContent = 'Export nicht verfügbar';
      const notice = button.parentElement.querySelector('[data-export-notice]');
      if (notice) notice.textContent = error.message;
    }
  } finally { button.disabled = false; button.title = label; }
});
