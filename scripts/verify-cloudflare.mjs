import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url),args=process.argv.slice(2);
const value=(flag,fallback)=>args.includes(flag)?args[args.indexOf(flag)+1]:fallback;
const web=value('--web-origin','https://domira.jiaxun-chen1218.workers.dev'),api=value('--api-origin','https://domira-api.jiaxun-chen1218.workers.dev');
const expected=JSON.parse(await readFile(new URL('dist/cloudflare/assets/deployment-info.json',root),'utf8'));
const revision=value('--revision',process.env.GITHUB_SHA||expected.sourceCommit);
assert.match(revision||'',/^[a-f0-9]{40}$/i,'A full source revision is required');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function read(url,json=false){const response=await fetch(url,{headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(15000)});assert.equal(response.status,200,url);return json?response.json():Buffer.from(await response.arrayBuffer());}
let last;
for(let attempt=0;attempt<8;attempt++){
 try{
  const cache='?verify='+revision+'-'+attempt;
  const [frontend,backend]=await Promise.all([read(web+'/deployment-info.json'+cache,true),read(api+'/api/version'+cache,true)]);
  assert.equal(frontend.sourceCommit,revision,'Frontend source revision');assert.equal(backend.sourceCommit,revision,'API source revision');
  assert.deepEqual(frontend.assets,expected.assets,'Published asset inventory');
  const entries=Object.entries(expected.assets);let cursor=0;
  await Promise.all(Array.from({length:4},async()=>{while(cursor<entries.length){const [name,hash]=entries[cursor++];const content=await read(web+name+cache);assert.equal(createHash('sha256').update(content).digest('hex'),hash,name);}}));
  const health=await read(api+'/api/health'+cache,true);assert.equal(health.ok,true);
  console.log(JSON.stringify({verified:true,sourceCommit:revision,version:frontend.version,assets:entries.length,frontend:web,api}));process.exit(0);
 }catch(error){last=error;if(attempt<7){console.log('Waiting for the published revision to become consistent ('+(attempt+1)+'/8).');await pause(4000);}}
}
throw last;
