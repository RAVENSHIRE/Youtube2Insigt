(() => {
  const element = id => document.getElementById(id);
  const status = (message, error = false) => document.dispatchEvent(new CustomEvent('accountStatus', { detail: { message, error } }));
  const run = action => async event => { event?.preventDefault(); try { await action(); } catch (error) { status(error.message, true); } };
  async function refreshAccount() {
    const account = await AppApi.currentAccount();
    element('accountLabel').textContent = AppApi.config.legacy ? 'Lokale Entwicklung' : account ? `${account.plan === 'pro' ? 'Pro' : 'Free'} · ${account.analyses_available} Analysen` : 'Anmelden · 1 Analyse kostenlos';
    element('panelLogin').hidden = Boolean(account) || AppApi.config.legacy;
    element('panelLogout').hidden = !account;
    element('syncYoutube').disabled = !account || !AppApi.config.youtubeSyncAvailable;
    element('syncYoutube').title = AppApi.config.youtubeSyncAvailable ? 'Liest Abos nach ausdrücklicher Zustimmung. Keine automatischen Analysen.' : 'Google-OAuth nicht eingerichtet. Creator können manuell hinzugefügt werden.';
    return account;
  }
  document.addEventListener('DOMContentLoaded', () => {
    AppApi.ready.then(refreshAccount).catch(error => status(error.message, true));
    element('panelLogin').addEventListener('submit', run(async () => {
      await AppApi.login(element('panelEmail').value, element('panelPassword').value);
      element('panelPassword').value = ''; element('accountTools').open = false;
      await refreshAccount(); document.dispatchEvent(new Event('accountChanged'));
    }));
    element('panelLogout').addEventListener('click', run(async () => {
      await AppApi.logout(); await refreshAccount(); document.dispatchEvent(new Event('accountChanged'));
    }));
    element('openAccount').addEventListener('click', run(() => chrome.tabs.create({ url: `${AppApi.base}/account/` })));
    element('libraryScope').addEventListener('change', () => {
      AppApi.scope = element('libraryScope').value;
      element('exampleNotice').classList.toggle('hidden', AppApi.scope !== 'examples');
      document.dispatchEvent(new Event('accountChanged'));
    });
    element('manualCreator').addEventListener('submit', run(async () => {
      await AppApi.json('/onboarding/creators', { channel: element('creatorInput').value });
      element('creatorInput').value = ''; status('Creator gespeichert. Es wurden keine Videos analysiert.');
      document.dispatchEvent(new Event('accountChanged'));
    }));
    element('syncYoutube').addEventListener('click', run(async () => {
      const result = await AppApi.json('/youtube/connect', { consent: true });
      const url = new URL(result.url);
      if (url.origin !== 'https://accounts.google.com') throw Error('Unerwartete OAuth-Adresse.');
      await chrome.tabs.create({ url: url.href });
      status('Nach der Zustimmung hier Konto erneut öffnen und Kanäle auswählen.');
    }));
    element('disconnectYoutube').addEventListener('click', run(async () => {
      const result = await AppApi.json('/youtube/disconnect', {}); element('subscriptionChoices').replaceChildren(); status(result.action_required || 'YouTube-Verbindung getrennt. Gespeicherte Reports bleiben erhalten.');
    }));
    element('accountTools').addEventListener('toggle', run(async () => {
      if (!element('accountTools').open || !AppApi.account || !AppApi.config.youtubeSyncAvailable) return;
      const state = await AppApi.json('/youtube/status');
      if (!state.connected) return;
      const result = await AppApi.json('/youtube/subscriptions');
      const container = element('subscriptionChoices'); container.replaceChildren();
      const description = document.createElement('p'); description.textContent = `${result.channels.length} Abos geladen${result.truncated ? ' (weitere im Konto verfügbar; Beta-Limit erreicht)' : ''}. Wähle Creator; keine automatische Analyse.`; container.append(description);
      for (const channel of result.channels) {
        const label = document.createElement('label'), checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = channel.id;
        label.append(checkbox, document.createTextNode(channel.name)); container.append(label);
      }
      const save = document.createElement('button'); save.type = 'button'; save.textContent = 'Ausgewählte Creator übernehmen';
      save.addEventListener('click', run(async () => {
        const ids = [...container.querySelectorAll('input:checked')].map(input => input.value);
        await AppApi.json('/youtube/select', { channelIds: ids }); status('Creator übernommen. Keine Analysen gestartet.');
        document.dispatchEvent(new Event('accountChanged'));
      })); container.append(save);
    }));
    element('askResearch').addEventListener('submit', run(async () => {
      const answer = element('researchAnswer'), citations = element('researchCitations');
      answer.textContent = 'Gespeicherte Quellen werden geprüft …'; citations.replaceChildren();
      try {
        const result = await AppApi.json('/research/ask', { question: element('researchQuestion').value, scope: AppApi.scope });
        answer.textContent = `${result.answer}\nAbdeckung: ${result.coverage.used_videos} von ${result.coverage.accessible_videos} zugänglichen Videos.`;
        for (const citation of result.citations) {
          const button = document.createElement('button'); button.type = 'button';
          button.textContent = `${citation.title} · ${citation.start_seconds === null ? 'Zeitmarke ungeprüft' : EvidenceUI.clock(citation.start_seconds)}`;
          button.addEventListener('click', run(async () => {
            const response = await chrome.runtime.sendMessage({ action: 'openOrFocusVideo', videoUrl: citation.url,
              ...(citation.start_seconds === null ? {} : { startSeconds: citation.start_seconds }) });
            if (!response?.ok) throw Error(response?.error || 'Quelle konnte nicht geöffnet werden.');
          })); citations.append(button);
        }
      } catch (error) { answer.textContent = error.message; }
    }));
  });
  document.addEventListener('accountRefresh', () => refreshAccount().catch(error => status(error.message, true)));
})();
