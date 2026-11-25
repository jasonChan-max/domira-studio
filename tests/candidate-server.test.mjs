import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,basename,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';

for(const mode of ['joint','frozen'])test(`candidate HTTP ${mode} serves the intended decoder and window weights`,async t=>{
 const folder=await mkdtemp(join(tmpdir(),'domira-candidate-server-'));
 assert.equal(dirname(resolve(folder)),resolve(tmpdir()));assert.ok(basename(folder).startsWith('domira-candidate-server-'));
 const candidate=join(folder,'candidate.onnx'),frozen=join(folder,'frozen.onnx');
 await writeFile(candidate,'new candidate weights');await writeFile(frozen,'old window weights');
 const child=spawn(process.execPath,[fileURLToPath(new URL('../tools/serve-door-candidate.mjs',import.meta.url)),candidate],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PORT:'0',DOMIRA_CANDIDATE_WINDOW_MODE:mode,DOMIRA_FROZEN_WINDOW_MODEL:frozen}});
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill();await once(child,'exit');}await rm(folder,{recursive:true,force:true});});
 const port=await new Promise((resolvePort,reject)=>{const timer=setTimeout(()=>reject(Error('Preview did not start')),10000);timer.unref();let buffer='';child.stdout.on('data',b=>{buffer+=b;const m=buffer.match(/Candidate preview on (\d+)/);if(m){clearTimeout(timer);resolvePort(Number(m[1]));}});child.on('error',reject);child.on('exit',code=>{if(code)reject(Error('Preview exited '+code));});});
 const base='http://127.0.0.1:'+port;
 assert.equal(await(await fetch(base+'/models/yolo-doors-int8.onnx')).text(),'new candidate weights');
 assert.equal(await(await fetch(base+'/models/yolo-windows-int8.onnx')).text(),mode==='joint'?'new candidate weights':'old window weights');
 const decoder=await(await fetch(base+'/door-detect.js')).text();
 const expected=await readFile(new URL(mode==='joint'?'../public/door-detect.js':'../tools/candidate-door-detect.js',import.meta.url),'utf8');
 assert.equal(decoder,expected);
});
