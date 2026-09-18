const { atStage } = require('../accounts/analysisDiagnostics');

function createReportAnalyzer({ youtubeMetadataService, sourceService, analyzeTranscript, analysisVersion, model }) {
  return async function createVerifiedReport(input, { signal, onStage = () => {} } = {}) {
    const authoritative = await atStage('video_metadata', () => youtubeMetadataService.getVideo(input.videoId), onStage);
    const channel = await youtubeMetadataService.getChannel(authoritative.channelId).catch(() => null);
    const source = await atStage('transcript', () => sourceService.get(input.videoId, authoritative, { signal }), onStage);
    const analysis = await atStage('analysis', () => analyzeTranscript({ source, title: authoritative.title,
      creator: authoritative.channelTitle, signal, onStage }), onStage);
    return {
      analysis_version: analysisVersion, evidence_version: 1, report_language: source.language,
      ...(analysis.evidence_extraction_version ? { evidence_extraction_version: analysis.evidence_extraction_version } : {}),
      analysis_models: [model], source, summary: analysis.summary, companies: analysis.companies,
      video: { id: input.videoId, title: authoritative.title, creator: authoritative.channelTitle,
        url: `https://www.youtube.com/watch?v=${input.videoId}`, published_at: authoritative.publishedAt,
        analyzed_at: new Date().toISOString(), channel: { ...(channel || {}), name: authoritative.channelTitle,
          youtube_channel_id: authoritative.channelId, url: `https://www.youtube.com/channel/${authoritative.channelId}` } }
    };
  };
}
module.exports = { createReportAnalyzer };
