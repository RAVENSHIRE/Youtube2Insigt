const { AppError } = require('./store');
const { logAnalysis } = require('./analysisDiagnostics');

class AnalysisJobs {
  constructor({ store, analyze, version = 8, concurrency = 2, timeoutMs = 180000, logger = console }) {
    Object.assign(this, { store, analyze, version, concurrency, timeoutMs, logger });
    this.queue = []; this.running = 0; this.inflight = new Map(); this.stopping = false;
  }
  start(userId, input) {
    if (this.stopping) throw new AppError('SERVER_STOPPING', 'Server wird aktualisiert. Bitte erneut versuchen.', 503);
    const job = this.store.reserve(userId, input.videoId, this.version);
    if (job.state === 'complete' || job.reused) return job;
    this.queue.push({ userId, input, job }); this.drain();
    return job;
  }
  drain() {
    while (!this.stopping && this.running < this.concurrency && this.queue.length) {
      const next = this.queue.shift(); this.running++;
      this.run(next).finally(() => { this.running--; this.drain(); }).catch(error => {
        logAnalysis(this.logger, { jobId: next.job.id, videoId: next.input.videoId, stage: 'worker', state: 'unknown', error });
      });
    }
  }
  async run({ userId, input, job }) {
    let work, stage = 'reservation';
    try {
      if (job.expires_at <= this.store.now()) throw new AppError('ANALYSIS_INTERRUPTED', 'Wartezeit überschritten.');
      work = this.inflight.get(input.videoId);
      if (!work) {
        work = { stage: 'cache' };
        const controller = new AbortController();
        let timer;
        const deadline = new Promise((resolve, reject) => {
          timer = setTimeout(() => {
            const error = new AppError('ANALYSIS_TIMEOUT', 'Analysezeit überschritten.');
            controller.abort(error); reject(error);
          }, this.timeoutMs);
        });
        const shared = work;
        const operation = Promise.resolve().then(() => {
          const cached = this.store.cachedReport(input.videoId, this.version);
          if (cached) return cached;
          shared.stage = 'analysis';
          return this.analyze(input, { signal: controller.signal, onStage: value => { shared.stage = value; } });
        });
        work.promise = Promise.race([operation, deadline]).finally(() => clearTimeout(timer));
        this.inflight.set(input.videoId, work);
        work.promise.finally(() => { if (this.inflight.get(input.videoId) === work) this.inflight.delete(input.videoId); }).catch(() => {});
      }
      const report = await work.promise;
      stage = 'persistence';
      this.store.complete(userId, job.id, report);
      logAnalysis(this.logger, { jobId: job.id, videoId: input.videoId, stage: 'complete', state: 'complete' });
    } catch (error) {
      try {
        this.store.fail(userId, job.id, /^[A-Z_]{3,80}$/u.test(error?.code || '') ? error.code : 'ANALYSIS_FAILED');
      } catch (releaseError) {
        logAnalysis(this.logger, { jobId: job.id, videoId: input.videoId, stage: 'credit_release', error: releaseError, state: 'release_failed' });
      }
      logAnalysis(this.logger, { jobId: job.id, videoId: input.videoId,
        stage: error?.analysisStage || (stage === 'persistence' ? stage : work?.stage || stage), error: error || new Error('Unknown analysis failure'), state: this.store.job(userId, job.id)?.state || 'unknown' });
    }
  }
  stop() {
    this.stopping = true;
    for (const task of this.queue.splice(0)) this.store.fail(task.userId, task.job.id, 'ANALYSIS_INTERRUPTED');
  }
}
module.exports = { AnalysisJobs };
