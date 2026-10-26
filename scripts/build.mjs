import {readFile,writeFile,mkdir,readdir,copyFile} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
const root=new URL('../',import.meta.url),rootPath=fileURLToPath(root),assets={};
for(const name of ['domain.js','render-domain.js'])await copyFile(new URL('src/'+name,root),new URL('public/'+name,root));
async function collect(dir){for(const file of await readdir(new URL(dir,root),{withFileTypes:true})){const name=join(dir,file.name);if(file.isDirectory())await collect(name+'/');else assets['/'+relative('public',name).replaceAll('\\','/')]=await readFile(new URL(name,root),'utf8');}}
await collect('public/');
await mkdir(new URL('dist/server/',root),{recursive:true});await mkdir(new URL('dist/.openai/',root),{recursive:true});
const result=await build({entryPoints:[join(rootPath,'worker','index.js')],bundle:true,format:'esm',platform:'neutral',target:'es2022',write:false,logLevel:'silent',banner:{js:'const ASSETS='+JSON.stringify(assets)+';'}});
await writeFile(new URL('dist/server/index.js',root),result.outputFiles[0].text);
await copyFile(new URL('.openai/hosting.json',root),new URL('dist/.openai/hosting.json',root));
console.log('Built Domira v2.0 Worker with '+Object.keys(assets).length+' assets, including renovation quotation modules.');
