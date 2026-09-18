// Optional local test metadata. Normal accounts need no schema migration.
// Hidden membership stays in `library`: reports, ownership, sequence and billing
// history remain intact. Reading a known saved report still costs no credit.
function hasVisibilityTable(db) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='local_hidden_library'").get());
}
function hiddenCount(db, userId) {
  return hasVisibilityTable(db) ? db.prepare('SELECT count(*) AS n FROM local_hidden_library WHERE user_id=?').get(userId).n : 0;
}
function hideExisting(db, userId, now) {
  db.exec(`CREATE TABLE IF NOT EXISTS local_hidden_library (
    user_id TEXT NOT NULL, video_id TEXT NOT NULL, hidden_at INTEGER NOT NULL,
    PRIMARY KEY(user_id,video_id),
    FOREIGN KEY(user_id,video_id) REFERENCES library(user_id,video_id));`);
  return db.prepare(`INSERT OR IGNORE INTO local_hidden_library
    SELECT user_id,video_id,? FROM library WHERE user_id=?`).run(now,userId).changes;
}
module.exports = { hasVisibilityTable, hiddenCount, hideExisting };
