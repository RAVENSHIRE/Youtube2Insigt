const { YoutubeTranscript, YoutubeTranscriptNotAvailableLanguageError } = require('youtube-transcript');
const { SourceError, makeSource, languageCode } = require('./sourceIntegrity');
const { setTimeout: wait } = require('node:timers/promises');

function transcriptTimeout(cause) {
  const failure = new SourceError('TRANSCRIPT_TIMEOUT', 'YouTube hat das Originaltranskript nicht rechtzeitig geliefert. Bitte erneut versuchen. Keine Analyse verbraucht.', 504);
  failure.cause = cause;
  return failure;
}

class SourceService {
  constructor({ fetchImpl = fetch, transcript = YoutubeTranscript, audioFallback = null, maxDurationSeconds = 3600,
    requestTimeoutMs = 20000, transcriptTimeoutMs = 60000, retryDelayMs = 500 } = {}) {
    Object.assign(this, { fetchImpl, transcript, audioFallback, maxDurationSeconds, requestTimeoutMs, transcriptTimeoutMs, retryDelayMs });
  }
  async get(videoId, metadata, { signal } = {}) {
    const durationSeconds = metadata.durationSeconds;
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > this.maxDurationSeconds) {
      throw new SourceError('VIDEO_DURATION_UNSUPPORTED', 'Die Beta unterstützt verfügbare Videos bis 60 Minuten mit verifizierter Laufzeit.');
    }
    let unit = null;
    const deadline = AbortSignal.timeout(this.transcriptTimeoutMs);
    const sourceSignal = AbortSignal.any([deadline, ...(signal ? [signal] : [])]);
    // v1.3.1 returns ms for srv3 and seconds for classic XML. Inspect the actual
    // response format instead of guessing a unit from the magnitude of a timestamp.
    const boundedFetch = async (url, options = {}) => {
      sourceSignal.throwIfAborted();
      const target = new URL(url);
      if (target.protocol !== 'https:' || !(target.hostname === 'youtube.com' || target.hostname.endsWith('.youtube.com')) || target.searchParams.has('tlang')) {
        throw new SourceError('SOURCE_URL_REJECTED', 'Nur originale öffentliche YouTube-Quellen werden gelesen.');
      }
      const response = await this.fetchImpl(target, { ...options, redirect: 'error',
        signal: AbortSignal.any([AbortSignal.timeout(this.requestTimeoutMs), sourceSignal, ...(options.signal ? [options.signal] : [])]) });
      if (target.pathname.includes('timedtext') && response.ok) {
        const xml = await response.clone().text();
        if (xml.length > 2000000) throw new SourceError('SOURCE_TOO_LARGE', 'Transkript zu groß.');
        unit = /<p\s+t="\d+"\s+d="\d+"/u.test(xml) ? 'milliseconds' : /<text\s/u.test(xml) ? 'seconds' : null;
      }
      return response;
    };
    const readOriginal = async () => {
      sourceSignal.throwIfAborted();
      unit = null;
      const originalLanguage = languageCode(metadata.language);
      const config = { fetch: boundedFetch, ...(['de', 'en'].includes(originalLanguage) ? { lang: originalLanguage } : {}) };
      let items;
      try { items = await this.transcript.fetchTranscript(videoId, config); }
      catch (error) {
        if (!(error instanceof YoutubeTranscriptNotAvailableLanguageError) || !config.lang) throw error;
        if (metadata.language !== config.lang) {
          try { items = await this.transcript.fetchTranscript(videoId, { ...config, lang: metadata.language }); }
          catch (regionalError) { if (!(regionalError instanceof YoutubeTranscriptNotAvailableLanguageError)) throw regionalError; }
        }
        // Video language metadata can describe a dub or be inaccurate. If the
        // requested language is absent, read the available native caption track.
        // boundedFetch rejects translation URLs; makeSource still rejects any
        // language other than DE/EN and validates every segment's actual language.
        if (!items) items = await this.transcript.fetchTranscript(videoId, { fetch: boundedFetch });
      }
      const lang = languageCode(items[0]?.lang);
      sourceSignal.throwIfAborted();
      return makeSource({ videoId, items, unit, language: lang, durationSeconds,
        languageSelection: { metadata_language: metadata.language || null, caption_language: lang,
          metadata_mismatch: Boolean(originalLanguage && originalLanguage !== lang), basis: 'native_caption_track' } });
    };
    try {
      try { return await readOriginal(); }
      catch (error) {
        if (signal?.aborted) throw signal.reason;
        if (deadline.aborted) throw transcriptTimeout(error);
        if (error?.name !== 'TimeoutError') throw error;
        // Retry one complete caption acquisition, including response-body reads.
        // All language fallbacks and both attempts share one 60-second budget.
        await wait(this.retryDelayMs, undefined, { signal: sourceSignal });
        return await readOriginal();
      }
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (error?.code === 'TRANSCRIPT_TIMEOUT') throw error;
      if (deadline.aborted || error?.name === 'TimeoutError') throw transcriptTimeout(error);
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
