import {readFile,writeFile,mkdir,readdir,copyFile} from 'node:fs/promises';
import {join,relative} from 'node:path';
const root=new URL('../',import.meta.url);const assets={};
async function collect(dir){for(const file of await readdir(new URL(dir,root),{withFileTypes:true})){const name=join(dir,file.name);if(file.isDirectory())await collect(name+'/');else assets['/'+relative('public',name).replaceAll('\\','/')]=await readFile(new URL(name,root),'utf8');}}
const model=await readFile(new URL('src/domain.js',root),'utf8');await writeFile(new URL('public/domain.js',root),model);await collect('public/');
await mkdir(new URL('dist/server/',root),{recursive:true});await mkdir(new URL('dist/.openai/',root),{recursive:true});
const server=await readFile(new URL('worker/index.js',root),'utf8');
await writeFile(new URL('dist/server/index.js',root),'const ASSETS='+JSON.stringify(assets)+';\n'+model.replaceAll('export ','')+'\n'+server.replace("import {generateLayout, validateRoom} from '../src/domain.js';",''));
await copyFile(new URL('.openai/hosting.json',root),new URL('dist/.openai/hosting.json',root));console.log('Built Domira Worker with '+Object.keys(assets).length+' local assets.');
