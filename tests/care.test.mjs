import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import * as THREE from '../public/vendor/three.module.js';
import {careFurniture} from '../public/care-furniture.js';
import {CARE_DATA} from '../public/care-data.js';
import {newCareProject,safeCareLayout,careGeometry,careReview,placeCareItem,validateCareProject,careCollisions,SAMPLE_ITEMS} from '../public/care-domain.js';
import worker from '../worker/index.js';
const post=(path,body,env={})=>worker.fetch(new Request('https://domira.test/api/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),env);

test('Excel import preserves every source row and field in all four sheets',()=>{
 assert.deepEqual(CARE_DATA.sheets.map(s=>s.records.length),[16,16,25,16]);assert.equal(CARE_DATA.total,73);
 assert.equal(new Set(CARE_DATA.sheets.flatMap(s=>s.records.map(r=>r.id))).size,73);
 for(const s of CARE_DATA.sheets)for(const r of s.records){assert.deepEqual(Object.keys(r.fields),s.headers);assert.equal(r.source_sheet,s.name);assert.ok(r.source_row>=4);}
 assert.match(CARE_DATA.source.sha256,/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(CARE_DATA).includes('D:/'));
});
test('planner never changes dimensions and returns valid placements in small and large rooms',()=>{
 for(const width of [2,2.5,3.2,4.5,6,10])for(const depth of [2,3,4.5,8]){const p=newCareProject({width,depth,height:2.7,source:'manual-guided'}),r=safeCareLayout(p);assert.ok(r.review.ok,JSON.stringify(r.review.failures));for(const i of r.items){const source=SAMPLE_ITEMS.find(s=>s.name===i.name);for(const k of ['w','d','h'])assert.equal(i[k],source[k]);}}
});
test('central furniture is allowed when door positions are unknown, while physical limits still apply',()=>{
 const p=newCareProject();const i={...SAMPLE_ITEMS[0],id:'one',x:2,z:0,rotation:0};assert.ok(careGeometry({...p,items:[i]}).ok);
 assert.ok(careGeometry({...p,items:[{...i,x:0}]}).ok);
 for(const patch of [{x:3},{h:4}])assert.equal(careGeometry({...p,items:[{...i,...patch}]}).ok,false);
 const near={...i,x:2.35,w:.7,d:1.7};assert.ok(careGeometry({...p,items:[near]}).ok);assert.equal(careGeometry({...p,items:[{...near,rotation:90}]}).ok,false);
 assert.ok(careGeometry({...p,items:[i,{...i,id:'two'}]}).failures.some(f=>f.rule==='collision'));
});
test('import cannot bypass geometry with rug, surface or unknown renderer types',()=>{
 const p=newCareProject(),i={...SAMPLE_ITEMS[2],id:'bad',x:0,z:0,rotation:0,type:'rug',role:'surface'};
 assert.throws(()=>validateCareProject({...p,items:[i]}));assert.throws(()=>validateCareProject({...p,items:[{...i,type:'unknown'}]}));
 const thin={...i,w:1,d:1,h:.01,careKind:'surface',sourceRecordId:'AID-016'};assert.ok(careGeometry({...p,items:[thin]}).ok);
 assert.throws(()=>validateCareProject({...p,items:[{...thin,h:1}]}));assert.throws(()=>validateCareProject({...p,items:[{...thin,sourceRecordId:'AID-018'}]}));
});
test('strict Care collision catches thin aids and millimeter penetration with rotated SAT envelopes',()=>{
 const a={id:'a',w:.03,d:.3,x:2,z:0,rotation:0},b={...a,id:'b'};assert.equal(careCollisions([a,b]).length,1);
 assert.equal(careCollisions([{...a,w:.8,d:.8},{...b,w:.8,d:.8,x:2.79}]).length,1);
 assert.equal(careCollisions([{...a,w:.8,d:.8},{...b,w:.8,d:.8,x:2.8}]).length,0);
 const c={...a,w:2,d:.1,rotation:45};assert.equal(careCollisions([c,{...c,id:'b',x:2.3,z:-.3}]).length,0);
});
test('import rejects inherited profile names and conflicting measurement units',()=>{
 const p=newCareProject();for(const profile of ['constructor','__proto__','toString'])assert.throws(()=>validateCareProject({...p,profile}));
 assert.throws(()=>validateCareProject({...p,units:'cm'}));assert.throws(()=>validateCareProject({...p,room:{...p.room,units:'ft'}}));
});
test('adding an instrument preserves edited furniture IDs and positions and can exceed ten items',()=>{
 const p=newCareProject({width:10,depth:10,height:2.7,source:'manual-guided'});p.items=safeCareLayout(p).items;const before=structuredClone(p.items);
 for(let n=0;n<12;n++){const next=placeCareItem(p,{type:'chair',careKind:'pillbox',name:'藥盒',w:.12,d:.12,h:.05,color:'#aabbcc'});assert.ok(next);p.items.push(next);}
 assert.deepEqual(p.items.slice(0,before.length),before);assert.equal(p.items.length,15);assert.ok(careGeometry(p).ok);
});
test('review records scope and pending evidence without issuing legal certification',()=>{
 const p=newCareProject();p.items=safeCareLayout(p).items;const r=careReview(p);assert.equal(r.status,'review-required');assert.equal(r.certified,false);assert.ok(r.pending.some(x=>x.id==='measurement'));assert.ok(r.pending.some(x=>x.id==='STD-004'));assert.ok(r.pending.some(x=>x.id==='furniture-dimensions'));
 assert.equal(careGeometry({...p,doorWidth:.8}).ok,false);assert.equal(careGeometry({...p,profile:'walker',doorWidth:.8}).ok,true);
});
test('all category illustrations have finite exact overall envelopes at supplied meter dimensions',()=>{
 for(const careKind of ['cane','walker','wheelchair','stool','shower','folding','swivel','commode','toilet','rail','surface','care-bed','pillbox']){const item={id:careKind,careKind,w:.7,d:.9,h:1.1,x:0,z:0,rotation:0,color:'#aabbcc'},g=careFurniture(item),s=new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());for(const [axis,key] of [['x','w'],['y','h'],['z','d']])assert.ok(Math.abs(s[axis]-item[key])<1e-6,careKind+' '+axis);}
});
test('care API returns a checked local plan and rejects invalid/malformed projects',async()=>{
 const project=newCareProject(),r=await post('care/layout',{project,purpose:'bedroom'});assert.equal(r.status,200);const d=await r.json();assert.equal(d.engine,'local-care-rules');assert.ok(d.review.ok);assert.ok(d.items.some(i=>i.type==='bed'));
 assert.equal((await post('care/validate',{project:{...project,profile:'invalid'}})).status,400);assert.equal((await post('care/layout',{project,purpose:'unknown'})).status,400);
 const invalid={...project,items:[{...SAMPLE_ITEMS[0],id:'a',x:4,z:0,rotation:0}]};const review=await(await post('care/validate',{project:invalid})).json();assert.equal(review.status,'blocked');
});

function d1(){const sql=new DatabaseSync(':memory:');return {sql,prepare(query){const statement=sql.prepare(query);let values=[];return {bind(...args){values=args;return this;},run(){statement.run(...values);return Promise.resolve({success:true});},first(){return Promise.resolve(statement.get(...values)||null);}};},batch(statements){return Promise.all(statements.map(s=>s.run()));}};}
test('account registration hashes passwords and sessions, login/me/logout work against D1 SQL',async()=>{
 const db=d1(),env={RENDER_DB:db},password='correct horse battery staple',email='MVP@example.test';const request=(path,body,token)=>worker.fetch(new Request('https://domira.test/api/auth/'+path,{method:path==='me'?'GET':'POST',headers:{'Content-Type':'application/json','CF-Connecting-IP':'auth-test',...(token?{Authorization:'Bearer '+token}:{})},...(path==='me'?{}:{body:JSON.stringify(body||{})})}),env);
 const registration=await request('register',{email,password});assert.equal(registration.status,201);const session=await registration.json();assert.equal(session.user.email,email.toLowerCase());assert.equal(session.emailVerified,false);
 const user=db.sql.prepare('SELECT * FROM care_users').get(),row=db.sql.prepare('SELECT * FROM care_sessions').get();assert.notEqual(user.password_hash,password);assert.notEqual(row.token_hash,session.token);assert.equal((await request('me',null,session.token)).status,200);
 assert.equal((await request('login',{email,password:'incorrect password'})).status,401);assert.equal((await request('login',{email,password})).status,200);
 assert.equal((await request('logout',{},session.token)).status,200);assert.equal((await request('me',null,session.token)).status,401);db.sql.close();
});
test('unconfigured or unavailable account storage never reports a successful account',async()=>{
 assert.equal((await post('auth/register',{email:'qa@example.test',password:'twelve characters'})).status,503);
 const r=await post('auth/register',{}, {RENDER_DB:{batch(){throw Error('database unavailable');},prepare(){return {};}}});assert.notEqual(r.status,200);
});
