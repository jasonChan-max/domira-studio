import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {deploymentInfo,writeAssetDeploymentInfo,assetHashes} from '../scripts/deployment-info.mjs';
import worker from '../worker/index.js';
test('deployment metadata hashes exact asset bytes and excludes its own mutable manifest',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'domira-deploy-'));
 try{await mkdir(join(directory,'nested'));await writeFile(join(directory,'app.js'),'export const x=1;\n');await writeFile(join(directory,'nested/icon.svg'),'<svg/>');await writeFile(join(directory,'deployment-info.json'),'old');
 const info={version:'2.0.0',sourceCommit:'a'.repeat(40),branch:'v2.0'};
 const result=await writeAssetDeploymentInfo(pathToFileURL(directory+'/'),info);
 assert.equal(result.sourceCommit,info.sourceCommit);assert.equal(Object.keys(result.assets).length,2);
 assert.equal(result.assets['/app.js'],createHash('sha256').update('export const x=1;\n').digest('hex'));
 assert.ok(!('/deployment-info.json' in result.assets));assert.deepEqual(JSON.parse(await readFile(join(directory,'deployment-info.json'),'utf8')),result);
 assert.deepEqual(assetHashes({'/a':'abc','/deployment-info.json':'ignored'}),{'/a':createHash('sha256').update('abc').digest('hex')});
 }finally{assert.ok(directory.startsWith(join(tmpdir(),'domira-deploy-')));await rm(directory,{recursive:true,force:true});}
});
test('source metadata identifies the Git checkout while the unbundled API reports no fabricated commit',async()=>{
 const info=await deploymentInfo(new URL('../',import.meta.url));assert.match(info.sourceCommit,/^[a-f0-9]{40}$/);assert.equal(info.repository,'https://github.com/jasonChan-max/domira-studio');
 const response=await worker.fetch(new Request('https://domira.test/api/version'));assert.equal(response.status,200);assert.equal((await response.json()).sourceCommit,null);
});
