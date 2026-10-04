const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
function createPreferences(file, defaults, validate) {
  let current = {...defaults}, writes = Promise.resolve(), needsBackup = false;
  return {
    async load() {
      try {
        const stat = await fs.stat(file);
        if (stat.size > 65536) throw new Error('Settings are too large');
        current = {...defaults,...validate(JSON.parse(await fs.readFile(file,'utf8')))};
        return {values:{...current},warning:''};
      } catch (error) {
        if (error.code === 'ENOENT') return {values:{...current},warning:''};
        needsBackup = true;
        return {values:{...current},warning:'Desktop settings could not be read. Defaults are in use; your saved file will be backed up before any changes.'};
      }
    },
    save(patch) {
      const validated = validate(patch);
      const task = writes.then(async()=>{
        const merged = {...current,...validated};
        await fs.mkdir(path.dirname(file),{recursive:true});
        if (needsBackup) {
          await fs.copyFile(file,file+'.unreadable-'+randomUUID()+'.bak');
          needsBackup=false;
        }
        const temp = file+'.'+randomUUID()+'.tmp';
        try {
          await fs.writeFile(temp,JSON.stringify(merged,null,2),'utf8');
          await fs.rename(temp,file);
          current=merged;
          return {...current};
        } finally {await fs.rm(temp,{force:true});}
      });
      writes=task.catch(()=>{});
      return task;
    },
  };
}
module.exports={createPreferences};
