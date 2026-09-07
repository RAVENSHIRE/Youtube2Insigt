const { SourceError } = require('./sourceIntegrity');

class VisualService {
  constructor({ ai, model }) { Object.assign(this, { ai, model }); }
  async extract({ videoId, startSeconds, endSeconds, durationSeconds, language = 'de', signal }) {
    if (!/^[\w-]{11}$/u.test(videoId) || !Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) ||
      startSeconds < 0 || endSeconds <= startSeconds || endSeconds - startSeconds > 30 || endSeconds > durationSeconds) {
      throw new SourceError('VISUAL_WINDOW_INVALID', 'Wähle einen Ausschnitt von höchstens 30 Sekunden innerhalb des Videos.');
    }
    const response = await this.ai.models.generateContent({ model: this.model,
      contents: [{ role: 'user', parts: [
        { fileData: { fileUri: `https://www.youtube.com/watch?v=${videoId}`, mimeType: 'video/mp4' },
          videoMetadata: { startOffset: `${startSeconds}s`, endOffset: `${endSeconds}s`, fps: 1 } },
        { text: `Read only visible chart/table labels in this clip. Output language ${language}. Do not reconstruct a chart, infer hidden values or quote speech. If unclear, return observations: []. Each observation is {description, visible_text, uncertainty}. Never treat a chart as a trading instruction. JSON only: {observations: [...]}.` }
      ] }], config: { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 1800, abortSignal: signal } });
    const data = JSON.parse(response.text);
    return { kind: 'visual', video_id: videoId, start_seconds: startSeconds, end_seconds: endSeconds,
      timing_precision: 'requested_window', sampling_fps: 1, verification: 'machine_observation_unverified',
      observations: (Array.isArray(data.observations) ? data.observations : []).slice(0, 8).map(item => ({
        description: String(item.description || '').slice(0, 1500), visible_text: String(item.visible_text || '').slice(0, 1500),
        uncertainty: String(item.uncertainty || 'Nicht manuell geprüft; Details können beim Sampling fehlen.').slice(0, 500)
      })), model: this.model, captured_at: new Date().toISOString() };
  }
}
module.exports = { VisualService };
