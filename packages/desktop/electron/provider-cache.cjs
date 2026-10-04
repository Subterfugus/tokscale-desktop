function createProviderCache(load, {ttl = 60000, now = Date.now} = {}) {
  let revision = 0, cached, expires = 0, pending;
  return {
    invalidate() { revision++; cached = undefined; expires = 0; pending = undefined; },
    refresh(options = {}) {
      if (!options || typeof options !== 'object' || Array.isArray(options) || (options.force !== undefined && typeof options.force !== 'boolean'))
        return Promise.reject(new Error('Invalid refresh options'));
      if (!options.force && cached !== undefined && expires > now()) return Promise.resolve(cached);
      if (pending) return pending;
      const attempt = revision;
      const task = Promise.resolve().then(load).then(result => {
        if (attempt !== revision) throw new Error('Connection changed while refreshing. Refresh again if needed.');
        cached = result; expires = now()+ttl; return result;
      });
      pending = task;
      task.then(()=>{if(pending===task)pending=undefined;},()=>{if(pending===task)pending=undefined;});
      return task;
    },
  };
}
module.exports = {createProviderCache};
