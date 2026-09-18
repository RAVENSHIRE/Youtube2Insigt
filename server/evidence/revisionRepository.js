const fs = require('node:fs/promises');
const path = require('node:path');
const { digest } = require('./sourceIntegrity');

class RevisionRepository {
  constructor(root) {
    if (!path.isAbsolute(root) || root === path.parse(root).root) throw new Error('An explicit revision storage directory is required.');
    this.root = root;
  }
  async write(report, { parent = null, reason = 'evidence-repair-v1' } = {}) {
    if (!/^[\w-]{11}$/u.test(report?.video?.id || '')) throw new Error('Invalid video ID.');
    const content = { revision_schema: 1, parent_sha256: parent ? digest(parent) : null, reason, report };
    const sha256 = digest(content);
    const id = `rev_${sha256}`;
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    // The original is saved first and never overwritten. No active pointer changes here.
    if (parent) await this.write(parent, { reason: 'original-recovery-copy' });
    const file = path.join(this.root, `${id}.json`);
    try { await fs.writeFile(file, JSON.stringify({ ...content, sha256 }, null, 2), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; await this.read(id); }
    return { id, sha256, original_preserved: true, activated: false };
  }
  async read(id) {
    if (!/^rev_[a-f0-9]{64}$/u.test(id)) throw new Error('Invalid revision ID.');
    const { sha256, ...content } = JSON.parse(await fs.readFile(path.join(this.root, `${id}.json`), 'utf8'));
    if (digest(content) !== sha256 || id !== `rev_${sha256}`) throw new Error('Revision integrity mismatch.');
    return { ...content, sha256 };
  }
}
module.exports = { RevisionRepository };
