const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createProviderCache}=require('./provider-cache.cjs');
const {createPreferences}=require('./preferences.cjs');
const security=require('./security.cjs');
const {getSessionTitles}=require('./session-titles.cjs');
const {DatabaseSync}=require('node:sqlite');
async function scratch(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tokscale-lifecycle-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
test('navigation remounts share a provider request, explicit refresh bypasses the success TTL',async()=>{
  let calls=0,now=100,complete;
  const cache=createProviderCache(()=>{calls++;return new Promise(resolve=>{complete=resolve;});},{now:()=>now,ttl:1000});
  const first=cache.refresh(),second=cache.refresh();
  await Promise.resolve();assert.equal(calls,1);
  complete({remaining:25});assert.deepEqual(await first,await second);
  await cache.refresh();assert.equal(calls,1);
  const forced=cache.refresh({force:true});await Promise.resolve();assert.equal(calls,2);complete({remaining:20});await forced;
  now+=1001;const expired=cache.refresh();await Promise.resolve();assert.equal(calls,3);complete({remaining:15});await expired;
});
test('disconnect invalidates both a cached balance and late response',async()=>{
  let complete;
  const cache=createProviderCache(()=>new Promise(resolve=>{complete=resolve;}));
  const request=cache.refresh();await Promise.resolve();cache.invalidate();complete({connected:true});
  await assert.rejects(request,/Connection changed/);
  const next=cache.refresh();await Promise.resolve();complete({connected:false});assert.deepEqual(await next,{connected:false});
});
test('failed provider requests are retriable rather than retained for the success TTL',async()=>{
  let count=0;const cache=createProviderCache(async()=>{if(count++===0)throw new Error('offline');return {remaining:1};});
  await assert.rejects(cache.refresh(),/offline/);assert.deepEqual(await cache.refresh(),{remaining:1});
  await assert.rejects(cache.refresh({force:'yes'}),/Invalid/);
});
test('concurrent settings patches preserve each other and unfamiliar saved fields',async t=>{
  const dir=await scratch(t),file=path.join(dir,'desktop-settings.json');
  await fs.writeFile(file,JSON.stringify({theme:'dark',futurePreference:{kept:true}}));
  const store=createPreferences(file,{theme:'dark'},security.settings);await store.load();
  await Promise.all([store.save({theme:'light'}),store.save({refreshInterval:60000})]);
  assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')),{theme:'light',futurePreference:{kept:true},refreshInterval:60000});
});
test('a corrupt settings file is backed up byte-for-byte before applying a new preference',async t=>{
  const dir=await scratch(t),file=path.join(dir,'desktop-settings.json'),bad='{"theme":unfinished';await fs.writeFile(file,bad);
  const store=createPreferences(file,{theme:'dark'},security.settings);assert.match((await store.load()).warning,/backed up/);
  await store.save({theme:'light'});
  const backup=(await fs.readdir(dir)).find(name=>name.endsWith('.bak'));assert.ok(backup);
  assert.equal(await fs.readFile(path.join(dir,backup),'utf8'),bad);
  assert.equal(JSON.parse(await fs.readFile(file,'utf8')).theme,'light');
  assert.throws(()=>security.settings({theme:'invented'}),/Unknown/);
  assert.throws(()=>security.settings({defaultPeriod:'unsupported'}),/Unknown/);
});
test('session titles map real rollout filename identities to saved names without modifying the index',async t=>{
  const home=await scratch(t),root=path.join(home,'.codex');await fs.mkdir(root);
  const file=path.join(root,'state_5.sqlite'),db=new DatabaseSync(file);
  db.exec('CREATE TABLE threads(id TEXT,title TEXT,name TEXT,first_user_message TEXT,rollout_path TEXT)');
  const insert=db.prepare('INSERT INTO threads VALUES (?,?,?,?,?)');
  insert.run('019e1111-2222-7333-8444-555555555555','Initial first-message title','Current saved chat title','private text excluded','C:\\Synthetic\\sessions\\rollout-2026-10-03T15-00-00-019e1111-2222-7333-8444-555555555555.jsonl');
  insert.run('fallback','Original saved title','','private text excluded','/synthetic/archived_sessions/rollout-fallback.jsonl');db.close();
  const before=await fs.readFile(file);const result=await getSessionTitles(home,{env:{CODEX_HOME:path.join(home,'wrong')}});
  assert.equal(result.titles['019e1111-2222-7333-8444-555555555555'],'Current saved chat title');
  assert.equal(result.titles['rollout-2026-10-03T15-00-00-019e1111-2222-7333-8444-555555555555'],'Current saved chat title');
  assert.equal(result.titles['rollout-fallback'],'Original saved title');assert.equal(result.titles.fallback,'Original saved title');
  assert.equal(JSON.stringify(result).includes('private text'),false);assert.deepEqual(await fs.readFile(file),before);
});
test('older or absent Codex indexes degrade to identifiers, never inferred conversation titles',async t=>{
  const home=await scratch(t);assert.deepEqual(await getSessionTitles(home),{titles:{},source:null});
  const root=path.join(home,'.codex');await fs.mkdir(root);const db=new DatabaseSync(path.join(root,'state_4.sqlite'));
  db.exec("CREATE TABLE threads(id TEXT,title TEXT); INSERT INTO threads VALUES ('old','Saved title')");db.close();
  assert.equal((await getSessionTitles(home)).titles.old,'Saved title');
  await assert.rejects(getSessionTitles('relative'),/Invalid home/);
});

test('mini window hidden limits accept unique ids only',()=>{
  assert.deepEqual(security.settings({miniHiddenLimits:['claude::weekly usage','claude::weekly usage','codex::5-hour']}).miniHiddenLimits,['claude::weekly usage','codex::5-hour']);
  assert.deepEqual(security.settings({miniHiddenLimits:[]}).miniHiddenLimits,[]);
  for(const bad of ['claude',[1],[''],['x'.repeat(301)]]) assert.throws(()=>security.settings({miniHiddenLimits:bad}),/Invalid mini window limits/);
});
