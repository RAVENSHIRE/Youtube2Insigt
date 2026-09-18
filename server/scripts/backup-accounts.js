const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync, backup } = require('node:sqlite');

async function backupAccounts(source, destination) {
  if (!path.isAbsolute(source) || !path.isAbsolute(destination) || !fs.statSync(source).isFile() ||
      source === destination || fs.existsSync(destination)) throw Error('Use an existing absolute database path and a NEW absolute backup filename.');
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(source, { readOnly: true });
  try { await backup(db, destination); } finally { db.close(); }
  fs.chmodSync(destination, 0o600);
  const copy = new DatabaseSync(destination, { readOnly: true });
  try {
    const result = copy.prepare('PRAGMA integrity_check').get().integrity_check;
    if (result !== 'ok') throw Error('Backup integrity verification failed; original unchanged.');
  } finally { copy.close(); }
  return { status: 'verified_backup', destination, original_unchanged: true };
}
if (require.main === module) {
  const args = process.argv.slice(2), value = flag => args[args.indexOf(flag) + 1];
  if (!args.includes('--source') || !args.includes('--output')) { console.error('Required: --source ABSOLUTE_DB --output NEW_ABSOLUTE_BACKUP'); process.exitCode = 1; }
  else backupAccounts(value('--source'), value('--output')).then(result => console.log(JSON.stringify(result, null, 2))).catch(() => {
    console.error('Backup failed. Check paths, permissions and disk space. Original database was not overwritten.'); process.exitCode = 1;
  });
}
module.exports = { backupAccounts };
