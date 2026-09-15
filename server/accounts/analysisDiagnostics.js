// Only analysis errors pass through this logger. Never pass requests, accounts,
// SDK response objects, headers, source text or credentials to it.
function redact(value, env = process.env) {
  let text = String(value ?? '');
  const secrets = Object.entries(env).filter(([key, secret]) =>
    /KEY|SECRET|TOKEN|PASSWORD|COOKIE|CREDENTIAL/iu.test(key) && typeof secret === 'string' && secret.length >= 4);
  for (const [, secret] of secrets.sort((a, b) => b[1].length - a[1].length)) {
    for (const form of new Set([secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)])) text = text.split(form).join('[REDACTED]');
  }
  return text
    .replace(/((?:set-)?cookie["']?\s*:\s*)[^\r\n]+/giu, '$1[REDACTED]')
    .replace(/https?:\/\/[^\s<>"']+/giu, value => {
      try { const url = new URL(value); return `${url.origin}${url.pathname}${url.search ? '?[REDACTED]' : ''}${url.hash ? '#[REDACTED]' : ''}`; }
      catch { return '[REDACTED URL]'; }
    })
    .replace(/\bBearer\s+[^\s,"'}]+/giu, 'Bearer [REDACTED]')
    .replace(/((?:[\w-]*(?:api[-_]?key|secret|token|password|authorization|cookie)[\w-]*)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\r\n,;}]+)/giu, '$1[REDACTED]')
    .replace(/\bAIza[\w-]{20,}\b/gu, '[REDACTED]')
    .slice(0, 8000);
}
function errorDetails(error, env, seen = new Set()) {
  if (!error || seen.has(error) || seen.size >= 3) return null;
  seen.add(error);
  return { name: redact(error.name || 'Error', env), message: redact(error.message || String(error), env),
    stack: redact(error.stack || '', env), ...(error.cause ? { cause: errorDetails(error.cause, env, seen) } : {}) };
}
function logAnalysis(logger, { jobId, videoId, stage, error, state }, env = process.env) {
  const entry = { event: error ? 'analysis_failed' : 'analysis_completed', jobId, videoId,
    stage: /^[a-z_]{1,40}$/u.test(stage || '') ? stage : 'analysis', state,
    ...(error ? { code: /^[A-Z_]{3,80}$/u.test(error.code || '') ? error.code : 'ANALYSIS_FAILED', error: errorDetails(error, env) } : {}) };
  try { (error ? logger.error : logger.info).call(logger, '[analysis]', JSON.stringify(entry)); }
  catch { /* A logging transport must never prevent credit release or job completion. */ }
}
async function atStage(stage, operation, onStage = () => {}) {
  onStage(stage);
  try { return await operation(); }
  catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    if (!error.analysisStage) error.analysisStage = stage;
    throw error;
  }
}
module.exports = { redact, logAnalysis, atStage };
