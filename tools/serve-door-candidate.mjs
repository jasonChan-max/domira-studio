// Local-only candidate overlay. Production public/models is not replaced before acceptance.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const root=resolve(import.meta.dirname,'../public'),candidate=process.argv[2]&&resolve(process.argv[2]);
const frozenWindow=process.env.DOMIRA_FROZEN_WINDOW_MODEL?resolve(process.env.DOMIRA_FROZEN_WINDOW_MODEL):resolve(root,'models/yolo-doors-int8.onnx');
if(!candidate)throw Error('Usage: node tools/serve-door-candidate.mjs <candidate-int8.onnx>');
const types={'.js':'text/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg'};
createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost'),file=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
 if(!file.startsWith(root+'/')&&!file.startsWith(root+'\\'))throw Error('Invalid path');
 const content=await readFile(url.pathname==='/models/yolo-doors-int8.onnx'?candidate:url.pathname==='/models/yolo-windows-int8.onnx'?frozenWindow:url.pathname==='/door-detect.js'?resolve(import.meta.dirname,'candidate-door-detect.js'):file);
 res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Content-Length':content.length,'Cache-Control':'no-store'});res.end(content);
 }catch{res.writeHead(404);res.end();}}).listen(Number(process.env.PORT)||3010,'127.0.0.1',()=>console.log('Candidate preview on '+(process.env.PORT||3010)));
