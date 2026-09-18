// Explicit SDK retry policy: without retryOptions this installed SDK makes one
// request. Keep retries inside the existing job/deadline and credit reservation.
const RETRY_POLICY = Object.freeze({ attempts: 3, initialDelay: 2, expBase: 2,
  maxDelay: 10, jitter: 1, httpStatusCodes: [429, 500, 502, 503, 504] });

async function requestAnalysisModel(ai, request, retryPolicy = RETRY_POLICY) {
  try {
    return await ai.models.generateContent({ ...request, config: { ...request.config,
      httpOptions: { timeout: 45000, retryOptions: retryPolicy } } });
  } catch (cause) {
    if (request.config?.abortSignal?.aborted) throw cause;
    if (![429, 500, 502, 503, 504].includes(Number(cause.status))) throw cause;
    const error = new Error('Gemini ist nach mehreren Versuchen vorübergehend nicht verfügbar. Bitte später erneut versuchen.', { cause });
    error.code = Number(cause.status) === 429 ? 'MODEL_RATE_LIMIT' : 'MODEL_UNAVAILABLE';
    error.status = Number(cause.status); error.retryable = true;
    throw error;
  }
}
module.exports = { requestAnalysisModel, RETRY_POLICY };
