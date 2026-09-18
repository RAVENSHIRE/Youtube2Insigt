#!/usr/bin/env node
// Explicit local operator tool. Does not mutate legacy records or active pointers.
const fs = require('node:fs/promises');
const path = require('node:path');
const { RevisionRepository } = require('../evidence/revisionRepository');
const { digest } = require('../evidence/sourceIntegrity');

async function main(args = process.argv.slice(2)) {
  const value = flag => args[args.indexOf(flag) + 1];
  const apply = args.includes('--apply');
  if (!args.includes('--source') || !args.includes('--video-id') || !args.includes('--output')) {
    throw Error('Usage: node server/scripts/repair-evidence.js --source <videos.json> --video-id <id> --output <revision-directory> [--apply]');
  }
  const sourcePath = path.resolve(value('--source'));
  const output = path.resolve(value('--output'));
  if (output === path.dirname(sourcePath) || output === path.parse(output).root) throw Error('Use a separate revision directory, not the source directory.');
  const raw = await fs.readFile(sourcePath, 'utf8');
  const records = JSON.parse(raw);
  const id = value('--video-id');
  const original = records[id] || records.videos?.[id];
  if (!original?.video || original.video.id !== id) throw Error('Video not found in source.');
  if (!apply) return { mode: 'dry-run', video_id: id, source_sha256: digest(records),
    original_preserved: true, writes: false, provider_requests: 0, next: 'Review source and use --apply to create a non-active revision.' };
  const repository = new RevisionRepository(output);
  await repository.write(original, { reason: 'original-recovery-copy' });
  const { createVerifiedReport } = require('../server');
  const revised = await createVerifiedReport({ videoId: id }, { signal: AbortSignal.timeout(180000) });
  const result = await repository.write(revised, { parent: original });
  if (await fs.readFile(sourcePath, 'utf8') !== raw) throw Error('Source changed during repair; inspect concurrent writer. No source files were changed by this script.');
  return { ...result, video_id: id, mode: 'revision-created', writes: true };
}
if (require.main === module) main().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
