const { YoutubeTranscript, YoutubeTranscriptNotAvailableLanguageError } = require('youtube-transcript');
const { SourceError, makeSource, languageCode } = require('./sourceIntegrity');

class SourceService {
  constructor({ fetchImpl = fetch, transcript = YoutubeTranscript, audioFallback = null, maxDurationSeconds = 3600 } = {}) {
    Object.assign(this, { fetchImpl, transcript, audioFallback, maxDurationSeconds });
  }
  async get(videoId, metadata, { signal } = {}) {
    const durationSeconds = metadata.durationSeconds;
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > this.maxDurationSeconds) {
      throw new SourceError('VIDEO_DURATION_UNSUPPORTED', 'Die Beta unterstützt verfügbare Videos bis 60 Minuten mit verifizierter Laufzeit.');
    }
    let unit = null;
    // v1.3.1 returns ms for srv3 and seconds for classic XML. Inspect the actual
    // response format instead of guessing a unit from the magnitude of a timestamp.
    const boundedFetch = async (url, options = {}) => {
      const target = new URL(url);
      if (target.protocol !== 'https:' || !(target.hostname === 'youtube.com' || target.hostname.endsWith('.youtube.com')) || target.searchParams.has('tlang')) {
        throw new SourceError('SOURCE_URL_REJECTED', 'Nur originale öffentliche YouTube-Quellen werden gelesen.');
      }
      const response = await this.fetchImpl(target, { ...options, redirect: 'error',
        signal: AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]) });
      if (target.pathname.includes('timedtext') && response.ok) {
        const xml = await response.clone().text();
        if (xml.length > 2000000) throw new SourceError('SOURCE_TOO_LARGE', 'Transkript zu groß.');
        unit = /<p\s+t="\d+"\s+d="\d+"/u.test(xml) ? 'milliseconds' : /<text\s/u.test(xml) ? 'seconds' : null;
      }
      return response;
    };
    try {
      const originalLanguage = languageCode(metadata.language);
      const config = { fetch: boundedFetch, ...(['de', 'en'].includes(originalLanguage) ? { lang: originalLanguage } : {}) };
      let items;
      try { items = await this.transcript.fetchTranscript(videoId, config); }
      catch (error) {
        // Some original tracks use en-US/de-DE instead of en/de. Retry only that
        // metadata-verified language, never an arbitrary or translated track.
        if (!(error instanceof YoutubeTranscriptNotAvailableLanguageError) || !config.lang || metadata.language === config.lang) throw error;
        items = await this.transcript.fetchTranscript(videoId, { ...config, lang: metadata.language });
      }
      const lang = languageCode(items[0]?.lang);
      if (metadata.language && ['de', 'en'].includes(languageCode(metadata.language)) && languageCode(metadata.language) !== lang) {
        throw new SourceError('SOURCE_LANGUAGE_MISMATCH', 'Die Untertitel entsprechen nicht der Originalsprache.');
      }
      return makeSource({ videoId, items, unit, language: lang, durationSeconds });
    } catch (error) {
      if (signal?.aborted) throw error;
      if (this.audioFallback && durationSeconds <= 900) return this.audioFallback.transcribe(videoId, metadata, { signal });
      if (error instanceof SourceError) throw error;
      const failure = new SourceError('TRANSCRIPT_UNAVAILABLE', 'Originaltranskript nicht verfügbar. Audio-Fallback ist nicht eingerichtet oder das Video überschreitet 15 Minuten. Keine Analyse verbraucht.');
      failure.cause = error;
      throw failure;
    }
  }
}

// A bounded, explicitly configured speech gateway must obtain authorized source
// audio and return original-language ASR segments (seconds), never translated text.
class AudioFallback {
  constructor({ url, apiKey, fetchImpl = fetch }) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Audio gateway requires HTTPS.');
    Object.assign(this, { url: parsed.href, apiKey, fetchImpl });
  }
  async transcribe(videoId, metadata, { signal } = {}) {
    if (metadata.durationSeconds > 900) throw new SourceError('AUDIO_LIMIT', 'Audio-Fallback: maximal 15 Minuten.');
    const response = await this.fetchImpl(this.url, { method: 'POST', redirect: 'error', headers: {
      'content-type': 'application/json', authorization: `Bearer ${this.apiKey}`
    }, body: JSON.stringify({ video_id: videoId, language: metadata.language || null, translate: false,
      max_duration_seconds: 900, max_bytes: 30000000, word_timestamps: true }),
    signal: AbortSignal.any([AbortSignal.timeout(90000), ...(signal ? [signal] : [])]) });
    if (!response.ok) throw new SourceError('AUDIO_UNAVAILABLE', 'Audioquelle konnte nicht verarbeitet werden.', 503);
    const raw = await response.text();
    if (raw.length > 240000) throw new SourceError('SOURCE_TOO_LARGE', 'Audioantwort zu groß.');
    const data = JSON.parse(raw);
    if (data.translated !== false || data.source_video_id !== videoId || data.timing_origin !== 'speech_alignment') {
      throw new SourceError('AUDIO_SOURCE_UNVERIFIED', 'Audioquelle oder Zeitzuordnung nicht nachgewiesen.');
    }
    if (metadata.language && languageCode(data.language) !== languageCode(metadata.language)) throw new SourceError('SOURCE_LANGUAGE_MISMATCH', 'Audiosprache weicht ab.');
    return makeSource({ videoId, items: data.segments, unit: 'seconds', language: data.language,
      durationSeconds: metadata.durationSeconds, kind: 'audio_transcription' });
  }
}
module.exports = { SourceService, AudioFallback };
