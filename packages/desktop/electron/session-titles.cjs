const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const readline = require('node:readline');
const {createReadStream} = require('node:fs');
const security = require('./security.cjs');

async function readCodexTitles(home, env, database) {
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

const CLAUDE_LIMITS = {projects: 2000, files: 5000, bytes: 256 * 1024 * 1024, line: 64 * 1024, title: 4096, parallel: 8};
const TITLE_MARKER = /"custom-title"|"ai-title"|"summary"/;
// Saved title metadata only. Precedence: explicit custom title, generated AI title, summary.
const TITLE_FIELDS = {'custom-title': ['customTitle', 0], 'ai-title': ['aiTitle', 1], summary: ['summary', 2]};

function cleanTitle(value) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, CLAUDE_LIMITS.title).trim();
}

async function readClaudeFileTitle(file) {
  const best = [null, null, null];
  let sessionId = '';
  const stream = createReadStream(file, {encoding: 'utf8'});
  const lines = readline.createInterface({input: stream, crlfDelay: Infinity});
  try {
    for await (const line of lines) {
      if (line.length > CLAUDE_LIMITS.line || !TITLE_MARKER.test(line)) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      const spec = entry && typeof entry === 'object' ? TITLE_FIELDS[entry.type] : null;
      if (!spec) continue;
      const title = cleanTitle(entry[spec[0]]);
      if (!title) continue;
      best[spec[1]] = title; // later saved titles replace earlier ones
      if (typeof entry.sessionId === 'string' && entry.sessionId.length <= 256) sessionId = entry.sessionId;
    }
  } finally { lines.close(); stream.destroy(); }
  return {title: best.find(Boolean) || '', sessionId};
}

async function readClaudeTitles(home, env) {
  const configDir = home ? path.join(home, '.claude') : env.CLAUDE_CONFIG_DIR || path.join(env.USERPROFILE || os.homedir(), '.claude');
  const root = path.join(configDir, 'projects');
  let projects;
  try { projects = await fs.readdir(root, {withFileTypes: true}); }
  catch (error) { return {titles: {}, source: null, ...(error.code === 'ENOENT' || error.code === 'ENOTDIR' ? {} : {warning: 'Saved Claude titles could not be read.'})}; }
  const candidates = [];
  let failed = false;
  for (const project of projects.filter(entry => entry.isDirectory()).slice(0, CLAUDE_LIMITS.projects)) {
    if (candidates.length >= CLAUDE_LIMITS.files) break;
    try {
      for (const entry of await fs.readdir(path.join(root, project.name), {withFileTypes: true})) {
        if (entry.isFile() && /\.jsonl$/i.test(entry.name) && candidates.length < CLAUDE_LIMITS.files) candidates.push(path.join(root, project.name, entry.name));
      }
    } catch { failed = true; }
  }
  const titles = Object.create(null);
  let next = 0;
  async function worker() {
    while (next < candidates.length) {
      const file = candidates[next++];
      try {
        if ((await fs.stat(file)).size > CLAUDE_LIMITS.bytes) continue;
        const {title, sessionId} = await readClaudeFileTitle(file);
        if (!title) continue;
        const stem = path.basename(file).replace(/\.jsonl$/i, '');
        // The engine keys Claude rows by transcript filename stem.
        if (stem && stem.length <= 1024) titles[stem] = title;
        if (sessionId && !(sessionId in titles)) titles[sessionId] = title;
      } catch { failed = true; }
    }
  }
  await Promise.all(Array.from({length: Math.min(CLAUDE_LIMITS.parallel, candidates.length)}, worker));
  return {titles, source: Object.keys(titles).length ? 'claude-transcripts' : null, ...(failed ? {warning: 'Some saved Claude titles could not be read.'} : {})};
}

async function getSessionTitles(home = '', { env = process.env, database } = {}) {
  security.settings({home});
  const [codex, claude] = await Promise.all([
    readCodexTitles(home, env, database).catch(() => ({titles: {}, source: null, warning: 'Saved Codex titles could not be read.'})),
    readClaudeTitles(home, env).catch(() => ({titles: {}, source: null, warning: 'Saved Claude titles could not be read.'})),
  ]);
  // Codex entries win on the (unlikely) collision of identifiers.
  const titles = Object.assign(Object.create(null), claude.titles, codex.titles);
  const sources = [codex.source, claude.source].filter(Boolean);
  const warnings = [codex.warning, claude.warning].filter(Boolean);
  return {
    titles: Object.assign({}, titles),
    source: sources.length > 1 ? sources.join('+') : sources[0] || null,
    ...(warnings.length ? {warning: warnings.join(' ')} : {}),
  };
}
module.exports = {getSessionTitles};