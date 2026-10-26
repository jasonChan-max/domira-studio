import {readFile,writeFile,mkdir,readdir,copyFile} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
const root=new URL('../',import.meta.url);const rootPath=fileURLToPath(root);const assets={};
async function collect(dir){for(const file of await readdir(new URL(dir,root),{withFileTypes:true})){const name=join(dir,file.name);if(file.isDirectory())await collect(name+'/');else assets['/'+relative('public',name).replaceAll('\\','/')]=await readFile(new URL(name,root),'utf8');}}
const model=await readFile(new URL('src/domain.js',root),'utf8');await writeFile(new URL('public/domain.js',root),model);await collect('public/');
const renderDomain=await readFile(new URL('src/render-domain.js',root),'utf8');await writeFile(new URL('public/render-domain.js',root),renderDomain);assets['/render-domain.js']=renderDomain;
await mkdir(new URL('dist/server/',root),{recursive:true});await mkdir(new URL('dist/.openai/',root),{recursive:true});
/* Worker 用 esbuild 真正打包。
 * 原本的手動拼接只認固定的幾支檔案（render.js、render-quota.js…），
 * 新增的 quote/ 與 agents/ 完全不會進 bundle —— 部署後 /api/plan 直接壞。
 * esbuild 只在 build 時用，部署工件仍然是單一 Worker 檔。 */
const result=await build({
  entryPoints:[join(rootPath,'worker','index.js')],
  bundle:true,format:'esm',platform:'neutral',target:'es2022',
  write:false,logLevel:'silent',
  banner:{js:'const ASSETS='+JSON.stringify(assets)+';'},
});
await writeFile(new URL('dist/server/index.js',root),result.outputFiles[0].text);
await copyFile(new URL('.openai/hosting.json',root),new URL('dist/.openai/hosting.json',root));
console.log('Built Domira Worker with '+Object.keys(assets).length+' local assets.');
