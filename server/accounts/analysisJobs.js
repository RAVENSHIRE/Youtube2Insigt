const { AppError } = require('./store');

class AnalysisJobs {
  constructor({ store, analyze, version = 8, concurrency = 2 }) {
    Object.assign(this, { store, analyze, version, concurrency });
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
      this.run(next).finally(() => { this.running--; this.drain(); });
    }
  }
  async run({ userId, input, job }) {
    try {
      if (job.expires_at <= this.store.now()) throw new AppError('ANALYSIS_INTERRUPTED', 'Wartezeit überschritten.');
      let work = this.inflight.get(input.videoId);
      if (!work) {
        work = Promise.resolve().then(() => this.store.cachedReport(input.videoId, this.version) ||
          this.analyze(input, { signal: AbortSignal.timeout(180000) }));
        this.inflight.set(input.videoId, work);
        work.finally(() => { if (this.inflight.get(input.videoId) === work) this.inflight.delete(input.videoId); }).catch(() => {});
      }
      const report = await work;
      this.store.complete(userId, job.id, report);
    } catch (error) {
      this.store.fail(userId, job.id, /^[A-Z_]{3,80}$/u.test(error.code || '') ? error.code : 'ANALYSIS_FAILED');
    }
  }
  stop() {
    this.stopping = true;
    for (const task of this.queue.splice(0)) this.store.fail(task.userId, task.job.id, 'ANALYSIS_INTERRUPTED');
  }
}
module.exports = { AnalysisJobs };
