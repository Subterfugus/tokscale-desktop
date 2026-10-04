const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {getSessionTitles}=require('./session-titles.cjs');
async function scratch(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tokscale-titles-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
const lines=rows=>rows.map(row=>typeof row==='string'?row:JSON.stringify(row)).join('\n')+'\n';
async function transcript(home,name,rows,project='C--Demo-Cedar'){
  const dir=path.join(home,'.claude','projects',project);await fs.mkdir(dir,{recursive:true});
  await fs.writeFile(path.join(dir,`${name}.jsonl`),lines(rows));
}
const user=text=>({type:'user',sessionId:'x',message:{role:'user',content:text}});

test('reads a saved Claude custom title keyed by the engine session id (file stem)',async t=>{
  const home=await scratch(t);
  await transcript(home,'synthetic-claude-1',[user('hello'),{type:'custom-title',customTitle:'Cedar review · 2026-10-03',sessionId:'synthetic-claude-1'}]);
  const result=await getSessionTitles(home);
  assert.equal(result.titles['synthetic-claude-1'],'Cedar review · 2026-10-03');
  assert.equal(result.source,'claude-transcripts');assert.equal(result.warning,undefined);
});
test('also keys by the in-file session id when it differs from the file stem',async t=>{
  const home=await scratch(t);
  await transcript(home,'file-stem',[{type:'custom-title',customTitle:'Cedar one',sessionId:'inner-id'}]);
  const {titles}=await getSessionTitles(home);
  assert.equal(titles['file-stem'],'Cedar one');assert.equal(titles['inner-id'],'Cedar one');
});
test('precedence is custom title, then generated title, then summary, regardless of line order',async t=>{
  const home=await scratch(t);
  await transcript(home,'all',[{type:'custom-title',customTitle:'Custom'},{type:'ai-title',aiTitle:'Generated'},{type:'summary',summary:'Summary'}]);
  await transcript(home,'ai-over-summary',[{type:'ai-title',aiTitle:'Generated'},{type:'summary',summary:'Summary'}]);
  await transcript(home,'summary-only',[{type:'summary',summary:'Summary',leafUuid:'u'}]);
  await transcript(home,'latest-wins',[{type:'custom-title',customTitle:'Old'},{type:'custom-title',customTitle:'New'}]);
  await transcript(home,'blank-custom',[{type:'custom-title',customTitle:'   '},{type:'ai-title',aiTitle:'Generated'}]);
  const {titles}=await getSessionTitles(home);
  assert.deepEqual(titles,{all:'Custom','ai-over-summary':'Generated','summary-only':'Summary','latest-wins':'New','blank-custom':'Generated'});
});
test('never derives a title from message text and omits untitled sessions',async t=>{
  const home=await scratch(t);
  await transcript(home,'untitled',[user('"custom-title" "summary" please name this'),{type:'assistant',message:{role:'assistant',content:[{type:'text',text:'{"type":"summary","summary":"nope"}'}]}},{type:'last-prompt',lastPrompt:'a prompt',sessionId:'untitled'},{type:'agent-name',agentName:'Not a title'}]);
  assert.deepEqual(await getSessionTitles(home),{titles:{},source:null});
});
test('a missing .claude folder is not an error',async t=>{
  const home=await scratch(t);
  assert.deepEqual(await getSessionTitles(home),{titles:{},source:null});
  await fs.mkdir(path.join(home,'.claude'));
  assert.deepEqual(await getSessionTitles(home),{titles:{},source:null});
});
test('malformed lines are skipped without losing other titles',async t=>{
  const home=await scratch(t);
  await transcript(home,'messy',['{"type":"custom-title","customTitle":"Broken','not json at all "ai-title"',JSON.stringify({type:'custom-title',customTitle:7}),JSON.stringify({type:'ai-title',aiTitle:'Still found'})]);
  assert.equal((await getSessionTitles(home)).titles.messy,'Still found');
});
test('titles are capped at 4096 characters and oversize lines are ignored',async t=>{
  const home=await scratch(t);
  await transcript(home,'long',[{type:'custom-title',customTitle:'x'.repeat(10000)}]);
  await transcript(home,'huge-line',[{type:'custom-title',customTitle:'y'.repeat(200000)},{type:'summary',summary:'Kept'}]);
  const {titles}=await getSessionTitles(home);
  assert.equal(titles.long.length,4096);assert.equal(titles['huge-line'],'Kept');
});
test('only top-level project transcripts are scanned and non-jsonl files are ignored',async t=>{
  const home=await scratch(t);
  await transcript(home,'good',[{type:'summary',summary:'Good'}]);
  const dir=path.join(home,'.claude','projects','C--Demo-Cedar');
  await fs.writeFile(path.join(dir,'notes.txt'),lines([{type:'summary',summary:'Wrong'}]));
  await fs.mkdir(path.join(dir,'good','subagents'),{recursive:true});
  await fs.writeFile(path.join(dir,'good','subagents','agent-1.jsonl'),lines([{type:'summary',summary:'Wrong'}]));
  await fs.writeFile(path.join(home,'.claude','projects','stray.jsonl'),lines([{type:'summary',summary:'Wrong'}]));
  assert.deepEqual((await getSessionTitles(home)).titles,{good:'Good'});
});
test('merges Codex index titles with Claude titles and survives a broken Codex index',async t=>{
  const home=await scratch(t);
  await transcript(home,'claude-1',[{type:'custom-title',customTitle:'Cedar review'}]);
  await fs.mkdir(path.join(home,'.codex'),{recursive:true});
  const db=new DatabaseSync(path.join(home,'.codex','state_5.sqlite'));
  db.exec('CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT, name TEXT, rollout_path TEXT)');
  db.prepare('INSERT INTO threads VALUES (?,?,?,?)').run('codex-1','Initial','Atlas planning',path.join(home,'.codex','sessions','rollout-codex-1.jsonl'));
  db.close();
  const merged=await getSessionTitles(home);
  assert.equal(merged.titles['codex-1'],'Atlas planning');assert.equal(merged.titles['rollout-codex-1'],'Atlas planning');
  assert.equal(merged.titles['claude-1'],'Cedar review');
  assert.equal(merged.source,'codex-index+claude-transcripts');assert.equal(merged.warning,undefined);
  const broken=await getSessionTitles(home,{database:function(){throw new Error('boom');}});
  assert.equal(broken.titles['claude-1'],'Cedar review');assert.equal(broken.source,'claude-transcripts');assert.match(broken.warning,/Codex/);
});
test('without a home argument the Claude config directory comes from the environment',async t=>{
  const dir=await scratch(t);
  await fs.mkdir(path.join(dir,'projects','p'),{recursive:true});
  await fs.writeFile(path.join(dir,'projects','p','env-1.jsonl'),lines([{type:'custom-title',customTitle:'From env'}]));
  const empty=await scratch(t);
  const result=await getSessionTitles('',{env:{CLAUDE_CONFIG_DIR:dir,CODEX_HOME:path.join(empty,'none')}});
  assert.equal(result.titles['env-1'],'From env');
});
test('scanning is read-only',async t=>{
  const home=await scratch(t);
  await transcript(home,'ro',[{type:'custom-title',customTitle:'Keep'}]);
  const file=path.join(home,'.claude','projects','C--Demo-Cedar','ro.jsonl');
  const before=await fs.readFile(file);const {mtimeMs}=await fs.stat(file);
  await getSessionTitles(home);
  assert.deepEqual(await fs.readFile(file),before);assert.equal((await fs.stat(file)).mtimeMs,mtimeMs);
});
