// Isolated content-script context; no remote code or page-script injection.
(() => {
  const videoId = () => new URL(location.href).searchParams.get('v');
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.action !== 'seekEvidence') return false;
    const player = document.querySelector('video');
    const seconds = message.seconds;
    const ok = message.videoId === videoId() && player && Number.isFinite(seconds) && seconds >= 0 &&
      Number.isFinite(player.duration) && seconds <= player.duration;
    if (ok) { player.currentTime = seconds; player.focus({ preventScroll: true }); }
    respond({ ok: Boolean(ok) });
    return false;
  });
  let lastSent = 0;
  document.addEventListener('timeupdate', event => {
    if (event.target.tagName !== 'VIDEO' || Date.now() - lastSent < 350) return;
    lastSent = Date.now();
    chrome.runtime.sendMessage({ action: 'evidencePlayback', videoId: videoId(),
      seconds: event.target.currentTime }).catch(() => {});
  }, true);
})();
