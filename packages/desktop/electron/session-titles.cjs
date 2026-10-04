const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const security = require('./security.cjs');

async function getSessionTitles(home = '', { env = process.env, database } = {}) {
  security.settings({home});
  const root = home ? path.join(home, '.codex') : env.CODEX_HOME || path.join(env.USERPROFILE || os.homedir(), '.codex');
  let files;
  try {
    files = (await fs.readdir(root)).filter(name => /^state_\d+\.sqlite$/.test(name))
      .sort((a,b) => Number(b.match(/\d+/)[0]) - Number(a.match(/\d+/)[0]));
  } catch (error) {
    return {titles:{},source:null,...(error.code === 'ENOENT' ? {} : {warning:'Saved Codex titles could not be read.'})};
  }
  if (!files.length) return {titles:{},source:null};
  let DatabaseSync;
  try { DatabaseSync = database || require('node:sqlite').DatabaseSync; }
  catch { return {titles:{},source:null,warning:'Saved Codex titles are unavailable in this runtime.'}; }
  for (const name of files) {
    let db;
    try {
      const file = path.join(root,name);
      if ((await fs.stat(file)).size > 512 * 1024 * 1024) continue;
      db = new DatabaseSync(file,{readOnly:true,timeout:250});
      const columns = new Set(db.prepare('PRAGMA table_info(threads)').all().map(row=>row.name));
      if (!columns.has('id') || !columns.has('title')) continue;
      const title = columns.has('name') ? "COALESCE(NULLIF(TRIM(name), ''), NULLIF(TRIM(title), ''))" : "NULLIF(TRIM(title), '')";
      const rollout = columns.has('rollout_path') ? 'rollout_path' : 'NULL AS rollout_path';
      const rows = db.prepare(`SELECT id, ${title} AS saved_title, ${rollout} FROM threads LIMIT 50000`).all();
      const titles = Object.create(null);
      for (const row of rows) {
        if (typeof row.id === 'string' && row.id.length <= 256 && typeof row.saved_title === 'string') {
          const savedTitle=row.saved_title.slice(0,4096);
          titles[row.id] = savedTitle;
          // Public Tokscale model reports key Codex sessions by transcript
          // filename stem, while Codex's index keys them by payload UUID.
          // Map both identities using saved metadata, never transcript text.
          if (typeof row.rollout_path === 'string') {
            const filename=path.win32.basename(row.rollout_path);
            const stem=filename.replace(/\.jsonl$/i,'');
            if (stem && stem.length<=1024 && filename!==stem) titles[stem]=savedTitle;
          }
        }
      }
      return {titles,source:'codex-index'};
    } catch { /* Try an older index when a migration is incomplete. */ }
    finally { try { db?.close(); } catch {} }
  }
  return {titles:{},source:null,warning:'Saved Codex titles could not be read. Session identifiers are still available.'};
}
module.exports = {getSessionTitles};
