import {readFile,writeFile,mkdir,readdir,copyFile} from 'node:fs/promises';
import {join,relative} from 'node:path';
const root=new URL('../',import.meta.url);const assets={};
async function collect(dir){for(const file of await readdir(new URL(dir,root),{withFileTypes:true})){const name=join(dir,file.name);if(file.isDirectory())await collect(name+'/');else assets['/'+relative('public',name).replaceAll('\\','/')]=await readFile(new URL(name,root),'utf8');}}
const model=await readFile(new URL('src/domain.js',root),'utf8');await writeFile(new URL('public/domain.js',root),model);await collect('public/');
const renderDomain=await readFile(new URL('src/render-domain.js',root),'utf8');await writeFile(new URL('public/render-domain.js',root),renderDomain);assets['/render-domain.js']=renderDomain;
await mkdir(new URL('dist/server/',root),{recursive:true});await mkdir(new URL('dist/.openai/',root),{recursive:true});
const server=await readFile(new URL('worker/index.js',root),'utf8');
const renderQuota=await readFile(new URL('worker/render-quota.js',root),'utf8');
const renderServer=await readFile(new URL('worker/render.js',root),'utf8');const strip=source=>source.replace(/^import .*?;\r?$/gm,'').replaceAll('export ','');
await writeFile(new URL('dist/server/index.js',root),'const ASSETS='+JSON.stringify(assets)+';\n'+strip(model)+'\n'+strip(renderDomain)+'\n'+strip(renderQuota)+'\n'+strip(renderServer)+'\n'+server.replace(/^import .*?;\r?$/gm,''));
await copyFile(new URL('.openai/hosting.json',root),new URL('dist/.openai/hosting.json',root));console.log('Built Domira Worker with '+Object.keys(assets).length+' local assets.');
