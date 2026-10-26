import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
export async function deploymentInfo(root){
 const cwd=fileURLToPath(root),git=args=>{try{return execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{return '';}};
 const supplied=process.env.GITHUB_SHA||process.env.DOMIRA_SOURCE_COMMIT||git(['rev-parse','HEAD']);
 const sourceCommit=/^[a-f0-9]{40}$/i.test(supplied)?supplied:null;
 const pkg=JSON.parse(await readFile(new URL('package.json',root),'utf8'));
 return {version:pkg.version||null,sourceCommit,branch:process.env.GITHUB_REF_NAME||git(['branch','--show-current'])||null,builtAt:new Date().toISOString(),repository:'https://github.com/jasonChan-max/domira-studio'};
}
export function assetHashes(assets){return Object.fromEntries(Object.entries(assets).filter(([name])=>name!=='/deployment-info.json').map(([name,content])=>[name,createHash('sha256').update(content).digest('hex')]));}
export async function writeAssetDeploymentInfo(directory,info){
 const assets={};
 async function walk(current,prefix=''){for(const entry of await readdir(current,{withFileTypes:true})){const relative=prefix+entry.name;if(entry.isDirectory())await walk(new URL(entry.name+'/',current),relative+'/');else if(relative!=='deployment-info.json')assets['/'+relative]=await readFile(new URL(entry.name,current));}}
 await walk(directory);const manifest={...info,assets:assetHashes(assets)};
 await writeFile(new URL('deployment-info.json',directory),JSON.stringify(manifest,null,2)+'\n');return manifest;
}
