import test from 'node:test';import assert from 'node:assert/strict';import {validatePlanAnalysis,homeFromAnalysis,validateHome,homeRoomData,homeItems,syncHomeProject,planWalls,homePlanSVG,buildRoomGraph,nightRoute,snapToDimensionLines,solveGrid,solveSlices,polygonArea} from '../public/home-domain.js';import {buildHomeGeometry} from '../public/home-scene.js';import {analyzeFloorplan,visionConfig,mergeAnalyses} from '../worker/floorplan.js';import worker from '../worker/index.js';import {validateRoom} from '../src/domain.js';import {buildProjectQuote} from '../public/budget-domain.js';import {PRODUCTS,toSceneItem} from '../public/products.js';
const analysis=()=>({rooms:[{name:'客廳',kind:'living',rect:{x:0,y:0,w:500,h:1000},confidence:'high',openings:[{kind:'door',edge:'right',offset:.3,width:.2},{kind:'window',edge:'left',offset:.2,width:.3}]},{name:'睡房',kind:'bedroom',rect:{x:500,y:0,w:500,h:1000},confidence:'medium',openings:[]}],scale:{width:8,depth:4,basis:'dimensioned'},summary:'兩個房間',warnings:[]});
// 圖上標註的面積優先於 rect 比例：九空間圖實測誤差曾達 103%（客廳標 8.6 算成 4.62）。
test('labelled areas correct plausible gaps while implausible ones keep the rect',()=>{const raw={rooms:[{name:'客廳',kind:'living',rect:{x:0,y:0,w:500,h:336},area_sqm:10.5,confidence:'high'},{name:'睡房',kind:'bedroom',rect:{x:500,y:0,w:500,h:336},area_sqm:7.44,confidence:'medium'},{name:'走廊',kind:'hall',rect:{x:0,y:336,w:1000,h:336},confidence:'low'}],scale:{width:null,depth:null,basis:'unknown'},summary:'三房',warnings:[]};const home=homeFromAnalysis(raw,4.47,11.45,2.7,false,{stages:['overlap','area','separate']});const living=home.rooms.find(r=>r.name==='客廳'),bed=home.rooms.find(r=>r.name==='睡房');assert.ok(Math.abs(living.width*living.depth-10.5)<.1,`小誤差應校正到標註值，實際 ${(living.width*living.depth).toFixed(2)}`);assert.ok(Math.abs(bed.width*bed.depth-12.8)<.1,`誤差 72% 應保留矩形，實際 ${(bed.width*bed.depth).toFixed(2)}`);assert.ok(home.warnings.some(w=>/差超過 25%/.test(w)),'要說明為什麼沒校正');});
test('rooms without area labels keep rect proportions untouched',()=>{const home=homeFromAnalysis(analysis(),8,4,2.7,false);const living=home.rooms.find(r=>r.name==='客廳');assert.ok(Math.abs(living.width-4)<.02&&Math.abs(living.depth-4)<.02);assert.ok(!home.warnings.some(w=>w.includes('校正')));});
test('floorplan output validates real room extents, filters malformed openings and requires user-calibrated meter geometry',()=>{const a=validatePlanAnalysis(analysis()),home=homeFromAnalysis(a,8,4);assert.equal(home.rooms.length,2);assert.equal(home.rooms[0].x,-2);assert.equal(home.rooms[1].x,2);assert.equal(home.rooms[0].width,4);assert.equal(home.rooms[0].openings.length,2);assert.throws(()=>validatePlanAnalysis({...analysis(),rooms:[]}),/1–20/);const bad=analysis();bad.rooms[0].rect.w=1500;assert.throws(()=>validatePlanAnalysis(bad),/位置格式/);assert.throws(()=>homeFromAnalysis(analysis(),0,4),/全屋/);});
test('whole home rejects overlapping, outside and duplicate rooms and room furniture, supports small service spaces without relaxing standalone scans',()=>{let home=homeFromAnalysis(analysis(),8,4);home.rooms[1].x=0;assert.throws(()=>validateHome(home),/重疊/);home=homeFromAnalysis(analysis(),8,4);home.rooms[0].x=-8;assert.throws(()=>validateHome(home),/超出/);assert.throws(()=>validateRoom({width:1.2,depth:2,height:2.7}));assert.doesNotThrow(()=>validateRoom({width:1.2,depth:2,height:2.7,source:'floorplan-room'}));});
test('shared walls are partitioned once with actual door and window gaps, and all whole-home meshes are finite',()=>{const home=homeFromAnalysis(analysis(),8,4),walls=planWalls(home),shared=walls.filter(s=>s.axis==='z'&&Math.abs(s.x)<.001);assert.equal(Math.round(shared.reduce((n,s)=>n+s.length,0)*100),400);assert.ok(shared.some(s=>s.kind==='door'));assert.ok(walls.some(s=>s.kind==='window'));const group=buildHomeGeometry(home);group.traverse(o=>{if(o.geometry){for(const n of o.geometry.getAttribute('position').array)assert.ok(Number.isFinite(n));o.geometry.dispose();}if(o.material)o.material.dispose();});});
test('room edits persist independently, overview translates local furniture, whole-home quote sums all rooms and JSON retains the complete home',()=>{const home=homeFromAnalysis(analysis(),8,4),p=PRODUCTS.find(p=>p.id==='ikea-kivik');home.rooms[1].items=[{...toSceneItem(p),id:'b',x:0,z:0,rotation:0}];const project={home,activeRoomId:home.rooms[0].id,items:[{...toSceneItem(p),id:'a',x:0,z:0,rotation:0}],style:'warm',purpose:'living'};syncHomeProject(project);assert.equal(home.rooms[0].items.length,1);assert.ok(homePlanSVG(home).includes('KIVIK 雙人沙發'));const all=homeItems(project,true);assert.deepEqual(all.map(i=>i.x),[-2,2]);const quote=buildProjectQuote({...project,items:homeItems(project)},PRODUCTS,{contingency:0});assert.equal(quote.quantity,2);assert.equal(quote.totalLow,6998);assert.equal(quote.rows[0].quantity,2);const restored=JSON.parse(JSON.stringify(home));assert.equal(validateHome(restored).rooms[1].items[0].id,'b');assert.equal(homeRoomData(restored.rooms[0]).source,'floorplan-room');restored.rooms[1].items[0].id='a';assert.throws(()=>validateHome(restored),/重複/);});
test('whole-home SVG includes all room names and geometry with escaped labels',()=>{const home=homeFromAnalysis(analysis(),8,4);home.rooms[0].name='<script>&';const svg=homePlanSVG(home);assert.ok(svg.includes('&lt;script&gt;&amp;'));assert.ok(svg.includes('睡房'));assert.ok(svg.includes('8.00 × 4.00'));assert.ok(svg.includes('stroke-dasharray'));});
test('vision backend sends a real image part in one bounded DeepSeek Flash call and returns validated room data',async()=>{const original=globalThis.fetch;let calls=0;globalThis.fetch=async(url,options)=>{calls++;assert.equal(url,'https://api.deepseek.com/chat/completions');const body=JSON.parse(options.body);assert.equal(body.model,'deepseek-flash');assert.equal(body.max_tokens,4500);assert.equal(body.thinking.type,'disabled');assert.equal(body.messages[1].content[1].type,'image_url');assert.match(body.messages[1].content[1].image_url.url,/^data:image/);return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(analysis())}}]});};try{const result=await analyzeFloorplan({image:'data:image/jpeg;base64,'+Buffer.from([255,216,255,0]).toString('base64'),knownWidth:8},{DEEPSEEK_API_KEY:'test-only'});assert.equal(result.engine,'remote-vision');assert.equal(result.rooms.length,2);assert.equal(calls,1);await assert.rejects(()=>analyzeFloorplan({image:'https://example.com/private.png'},{DEEPSEEK_API_KEY:'test-only'}),/有效/);assert.equal(calls,1);}finally{globalThis.fetch=original;}});
test('vision errors never return a fake house, and endpoint supports explicit capability and bounded request failures',async()=>{const cap=await worker.fetch(new Request('https://test/api/floorplan/capabilities'));assert.equal((await cap.json()).enabled,false);const off=await worker.fetch(new Request('https://test/api/floorplan/analyze',{method:'POST',body:'{}'}));assert.equal(off.status,503);const huge=await worker.fetch(new Request('https://test/api/floorplan/analyze',{method:'POST',headers:{'content-length':'2100000'},body:'{}'}),{DEEPSEEK_API_KEY:'test-only'});assert.equal(huge.status,413);const original=globalThis.fetch;globalThis.fetch=async()=>Response.json({choices:[{message:{content:'not json'}}]});try{await assert.rejects(()=>analyzeFloorplan({image:'data:image/jpeg;base64,'+Buffer.from([255,216,255,0]).toString('base64')},{DEEPSEEK_API_KEY:'test-only'}),/完整圖紙/);}finally{globalThis.fetch=original;}});

test('AI image-page margins are removed before meter calibration so the house envelope uses the confirmed outer dimensions',()=>{const raw=analysis();for(const r of raw.rooms){r.rect.x=r.rect.x*.7+100;r.rect.y=r.rect.y*.6+200;r.rect.w*=.7;r.rect.h*=.6;}const normalized=validatePlanAnalysis(raw),home=homeFromAnalysis(normalized,8,4);assert.equal(home.rooms[0].width,4);assert.equal(home.rooms[0].depth,4);assert.equal(home.rooms[0].x,-2);assert.equal(home.rooms[1].x,2);});
// 房間相鄰圖：只有「共享一段牆」而且「門落在共享段上」才算相通。
// 這是方向 3（夜間動線）的前置——openings 只說哪面牆有門，不知道門通往哪間房。
const nightHome=()=>({format:'domira.home.v1',width:8,depth:6,height:2.7,rooms:[
 {id:'a',name:'睡房',kind:'bedroom',x:-2,z:-1.5,width:4,depth:3,height:2.7,openings:[{kind:'door',edge:'right',offset:.3,width:.3}],items:[]},
 {id:'b',name:'走廊',kind:'hall',x:1,z:-1.5,width:2,depth:3,height:2.7,openings:[{kind:'door',edge:'bottom',offset:.25,width:.5}],items:[]},
 {id:'c',name:'浴室',kind:'bathroom',x:1,z:1.5,width:2,depth:3,height:2.7,openings:[{kind:'door',edge:'top',offset:.25,width:.5}],items:[]},
]});
test('room graph links only rooms that share a wall with a door',()=>{const g=buildRoomGraph(nightHome());assert.equal(g.nodes.length,3);assert.equal(g.edges.length,2);const ab=g.edges.find(e=>[e.a,e.b].sort().join('')==='ab');assert.equal(ab.door.width,.9,'門寬要用該牆的實際長度換算');assert.equal(ab.shared.axis,'z');const lonely={...nightHome()};lonely.rooms[0].openings=[];assert.equal(buildRoomGraph(lonely).edges.length,1,'拿掉門就不相連');const apart={...nightHome()};apart.rooms[0].x=-2.6;apart.rooms[0].width=3.5;assert.ok(!buildRoomGraph(apart).edges.some(e=>[e.a,e.b].includes('a')),'牆不再貼合就不相連');});
test('night route walks bedroom to bathroom and flags narrow doors or rooms',()=>{const r=nightRoute(nightHome());assert.equal(r.ok,true);assert.deepEqual(r.path,['睡房','走廊','浴室']);assert.equal(r.status,'pass',r.detail);assert.equal(r.doors.length,2);assert.ok(r.doors.every(d=>d.width>=d.min));assert.equal(r.nightKit.hasWardrobe,false);const narrow=nightHome();narrow.rooms[0].openings=[{kind:'door',edge:'right',offset:.3,width:.2}];const w=nightRoute(narrow);assert.equal(w.status,'warn');assert.equal(w.doors[0].status,'warn');const blocked={...nightHome()};blocked.rooms[1].openings=[];blocked.rooms[2].openings=[];assert.equal(nightRoute(blocked).ok,false,'走廊與浴室之間完全沒有門就該說走不通');const noBed={...nightHome()};noBed.rooms[0].kind='living';assert.equal(nightRoute(noBed).ok,false);});
// 同名切塊合併：AI 依「非矩形就切塊」的規則，會把 L 形客廳切成兩塊並給同樣的名字。
// 應用要把「同名且互相接觸」的切塊用外框併回一間；同名但不相鄰（例如兩個衛生間）不能併。
test('same-name adjacent room pieces merge into one box and keep outer doors',()=>{const split={summary:'',warnings:[],rooms:[{name:'客廳',kind:'living',rect:{x:0,y:0,w:600,h:400},confidence:'high',openings:[]},{name:'客廳',kind:'living',rect:{x:0,y:400,w:300,h:600},confidence:'high',openings:[{kind:'door',edge:'bottom',offset:.2,width:.2}]}]};const a=validatePlanAnalysis(split);assert.equal(a.rooms.length,1,'兩塊同名相鄰應合併成一間');assert.ok(a.warnings.some(w=>/切成 2 塊/.test(w)),'要留下合併紀錄');assert.equal(a.rooms[0].openings.length,1,'外邊界上的門要保留（否則 3D 沒門可畫）');assert.ok(Math.abs(a.rooms[0].openings[0].offset-.1)<.02,'門位要映射到新矩形，實際 '+a.rooms[0].openings[0].offset);const apart={summary:'',warnings:[],rooms:[{name:'衛生間',kind:'bathroom',rect:{x:0,y:0,w:200,h:200},confidence:'high',openings:[]},{name:'衛生間',kind:'bathroom',rect:{x:700,y:700,w:200,h:200},confidence:'high',openings:[]}]};assert.equal(validatePlanAnalysis(apart).rooms.length,2,'同名但不相鄰不能併');});
test('merge is skipped when the merged box would swallow another room',()=>{const clash={summary:'',warnings:[],rooms:[{name:'客廳',kind:'living',rect:{x:0,y:0,w:400,h:400},confidence:'high',openings:[]},{name:'客廳',kind:'living',rect:{x:0,y:400,w:400,h:400},confidence:'high',openings:[]},{name:'睡房',kind:'bedroom',rect:{x:300,y:0,w:400,h:400},confidence:'high',openings:[]}]};const r=validatePlanAnalysis(clash);assert.equal(r.rooms.length,3,'合併外框會蓋住睡房，應該放棄合併而不是吃掉它');});
// 視覺模型可換：預設行為不變（DeepSeek），設定 VISION_* 才改走別的 provider。
// 三個變數都走 OpenAI 的 /chat/completions，所以換模型不用改程式。
test('vision provider is configurable while defaults stay DeepSeek',async()=>{const def=visionConfig({});assert.equal(def.base,'https://api.deepseek.com');assert.equal(def.model,'deepseek-flash');assert.equal(def.key,'');assert.equal(def.provider,'deepseek');const custom=visionConfig({VISION_BASE_URL:'https://generativelanguage.googleapis.com/v1beta/openai/',VISION_MODEL:'gemini-2.5-flash',VISION_API_KEY:'vision-key',DEEPSEEK_API_KEY:'deepseek-key'});assert.equal(custom.base,'https://generativelanguage.googleapis.com/v1beta/openai','尾斜線要吃掉');assert.equal(custom.model,'gemini-2.5-flash');assert.equal(custom.key,'vision-key','VISION_API_KEY 要優先於 DEEPSEEK_API_KEY');assert.equal(custom.provider,'gemini');assert.equal(visionConfig({VISION_BASE_URL:custom.base,DEEPSEEK_API_KEY:'deepseek-key'}).key,'','第三方不可回退至 DeepSeek 金鑰');const original=globalThis.fetch;let seen=null;globalThis.fetch=async(url,options)=>{seen={url,body:JSON.parse(options.body),auth:options.headers.Authorization};return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(analysis())}}]});};try{const r=await analyzeFloorplan({image:'data:image/jpeg;base64,'+Buffer.from([255,216,255,0]).toString('base64')},{VISION_BASE_URL:'https://example.test/v1/',VISION_MODEL:'m1',VISION_API_KEY:'k1'});assert.equal(seen.url,'https://example.test/v1/chat/completions');assert.equal(seen.body.model,'m1');assert.equal(seen.auth,'Bearer k1');assert.equal(r.model,'m1','回傳要標實際模型');assert.equal(r.provider,'custom');const gemini=await analyzeFloorplan({image:'data:image/jpeg;base64,'+Buffer.from([255,216,255,0]).toString('base64')},{VISION_BASE_URL:custom.base,VISION_MODEL:custom.model,VISION_API_KEY:'gemini-test'});assert.equal(seen.url,'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');assert.equal(seen.body.reasoning_effort,'none');assert.equal(seen.body.thinking,undefined);assert.equal(seen.body.messages[1].content[1].image_url.detail,undefined);assert.equal(gemini.provider,'gemini');await analyzeFloorplan({image:'data:image/jpeg;base64,'+Buffer.from([255,216,255,0]).toString('base64')},{VISION_BASE_URL:custom.base,VISION_MODEL:'gemini-3.5-flash',VISION_API_KEY:'gemini-test'});assert.equal(seen.body.reasoning_effort,'low');assert.equal(seen.body.thinking,undefined);}finally{globalThis.fetch=original;}});
// 幾何吸附：AI 給的 rect 是粗略近似，相鄰房間常差一點點（看起來框貼不上）。
// 吸附後縫要縮到可忽略，而且不能因此重疊（strict 模式會驗證）。
test('shared walls are snapped and the result stays overlap-free',()=>{const gapped={summary:'',warnings:[],scale:{width:10,depth:8,basis:'dimensioned'},rooms:[{name:'客廳',kind:'living',rect:{x:0,y:0,w:400,h:600},confidence:'high',openings:[]},{name:'睡房',kind:'bedroom',rect:{x:450,y:0,w:400,h:600},confidence:'high',openings:[]}]};const home=homeFromAnalysis(gapped,10,8,2.7,false,{stages:['overlap','sharedsnap','area','separate']});const a=home.rooms.find(r=>r.name==='客廳'),b=home.rooms.find(r=>r.name==='睡房');const gap=(b.x-b.width/2)-(a.x+a.width/2);assert.ok(Math.abs(gap)<.05,`左右縫應被吸掉，實際 ${gap.toFixed(2)} m`);assert.doesNotThrow(()=>homeFromAnalysis(gapped,10,8,2.7,true,{stages:['overlap','sharedsnap','area','separate']}),'吸附後仍要通過 strict 驗證（不得重疊或出界）');});
// validatePlanAnalysis 的輸出必須能被自己再驗證一次：homeFromAnalysis 內部會再呼叫它。
// 正規化算出的浮點負零（-5.7e-14）曾讓這一步拋「房間位置格式不完整」。
test('normalised output revalidates cleanly without float negative zero',()=>{const edge={summary:'',warnings:[],rooms:[{name:'客廳',kind:'living',rect:{x:100,y:100,w:400,h:400},confidence:'high',openings:[]},{name:'睡房',kind:'bedroom',rect:{x:500,y:100,w:400,h:400},confidence:'high',openings:[]}]};const once=validatePlanAnalysis(edge);assert.ok(once.rooms.every(r=>r.rect.x>=0&&r.rect.y>=0),'正規化後不能有負座標（含 -0）');assert.doesNotThrow(()=>validatePlanAnalysis(once),'輸出要能被再次驗證');assert.doesNotThrow(()=>homeFromAnalysis(once,10,8,2.7,false),'也要能直接餵回 homeFromAnalysis');});
// 開放式客廳：AI 可能把「起居室」和「客廳」回成兩個不同名字的房間（kind 都是 living），
// 同名合併抓不到，兩塊框就互相重疊。要按用途合併、面積相加。
test('open-plan living areas with different names merge by kind',()=>{const raw={summary:'',warnings:[],rooms:[{name:'起居室',kind:'living',rect:{x:0,y:0,w:500,h:400},confidence:'high',openings:[],area_sqm:40.6},{name:'客廳',kind:'living',rect:{x:0,y:400,w:300,h:600},confidence:'high',openings:[],area_sqm:27.54},{name:'睡房',kind:'bedroom',rect:{x:700,y:0,w:300,h:400},confidence:'high',openings:[]}]};const a=validatePlanAnalysis(raw);assert.equal(a.rooms.length,2,'兩個 living 應併成一間');const living=a.rooms.find(r=>r.kind==='living');assert.ok(Math.abs(living.area_sqm-68.14)<.1,`面積要相加，實際 ${living.area_sqm}`);assert.ok(a.warnings.some(w=>/沒有隔牆/.test(w)),'要留下合併紀錄');});
// 尺寸線吸附：圖上的尺寸鏈是唯一量出來的資料，房間邊界要落在累加出來的牆線上。
test('room edges snap to accumulated dimension lines',()=>{const home={width:10,depth:8,rooms:[{x:-1.85,z:0,width:5.9,depth:4,height:2.7},{x:3.1,z:0,width:4.1,depth:4,height:2.7}]};const n=snapToDimensionLines(home,{unit:'mm',bottom:[6000,4000],left:[4000,4000]});assert.equal(n,2,'兩間都該被吸附');const a=home.rooms[0],b=home.rooms[1];assert.ok(Math.abs((a.x-a.width/2)+5)<.01,'左邊要吸到 -5');assert.ok(Math.abs((a.x+a.width/2)-1)<.01,'右邊要吸到 1');assert.ok(Math.abs((b.x-b.width/2)-1)<.01,'b 左邊也要吸到 1（共用同一面牆）');assert.ok(Math.abs((b.x+b.width/2)-5)<.01,'b 右邊要吸到 5');});
// 「沒牆的地方多了一道牆」：房間 rect 有縫時，planWalls 會把同一道牆算成兩條。
// 同軸、座標差 <0.6 m、區間重疊的牆線要併成一道（門窗不併，保留原位）。
test('parallel walls split by a gap merge into one',()=>{const room=(id,name,kind,x)=>({id,name,kind,purpose:kind,x,z:0,width:4.6,depth:4,height:2.7,confidence:'high',notes:'',openings:[],items:[]});const home={format:'domira.home.v1',width:10,depth:8,height:2.7,source:'ai-floorplan',scaleConfirmed:true,summary:'',warnings:[],rooms:[room('a','客廳','living',-2.6),room('b','睡房','bedroom',2.6)]};const walls=planWalls(home).filter(s=>s.kind==='wall'&&s.axis==='z');const middle=walls.filter(s=>Math.abs(s.x)<.4&&s.length>=3.5);assert.equal(middle.length,1,`縫兩側的同軸牆應併成一道，實際 ${middle.length} 道：${middle.map(s=>s.x).join(',')}`);});
// 兜底：AI 給的 rect 重疊到推不開時，要自動縮小（而不是讓使用者在 review 畫面手動改）才能生成。
test('overlapping rooms are forced apart so the home can always be built',()=>{const raw={summary:'',warnings:[],scale:{width:10,depth:8,basis:'dimensioned'},rooms:[{name:'客廳',kind:'living',rect:{x:0,y:0,w:600,h:600},confidence:'high',openings:[]},{name:'睡房',kind:'bedroom',rect:{x:400,y:400,w:600,h:600},confidence:'high',openings:[]}]};const home=homeFromAnalysis(raw,10,8,2.7,true,{stages:['overlap','area','separate']});assert.ok(home.warnings.some(w=>/重疊/.test(w)),'縮過房間要留 warning');const a=home.rooms[0],b=home.rooms[1];const ox=(a.width+b.width)/2-Math.abs(a.x-b.x),oz=(a.depth+b.depth)/2-Math.abs(a.z-b.z);assert.ok(ox<=.02||oz<=.02,`strict 生成成功就代表不再重疊（ox=${ox.toFixed(2)}, oz=${oz.toFixed(2)}）`);});

// 相鄰關係：AI 要回「誰跟誰共牆」，並用矩形交叉驗證——不一致的地方就是拓撲求解要修的信號。
test('adjacency from the AI is parsed and cross-checked against rects',()=>{
 const near={summary:'',warnings:[],rooms:[{name:'客廳',kind:'living',rect:{x:0,y:0,w:500,h:500},confidence:'high',openings:[],adjacent:[{to:'睡房',edge:'right'}]},{name:'睡房',kind:'bedroom',rect:{x:500,y:0,w:500,h:500},confidence:'high',openings:[],adjacent:[{to:'客廳',edge:'left'}]}]};
 const a=validatePlanAnalysis(near);
 assert.equal(a.rooms[0].adjacent.length,1,'adjacent 要保留');
 assert.equal(a.rooms[0].adjacent[0].to,'睡房');
 assert.ok(!a.warnings.some(w=>/沒有相接/.test(w)),'真的相鄰不該報 warning');
 const far={summary:'',warnings:[],rooms:[{name:'客廳',kind:'living',rect:{x:0,y:0,w:300,h:300},confidence:'high',openings:[],adjacent:[{to:'睡房',edge:'right'}]},{name:'睡房',kind:'bedroom',rect:{x:700,y:0,w:300,h:300},confidence:'high',openings:[],adjacent:[]}]};
 const b=validatePlanAnalysis(far);
 assert.ok(b.warnings.some(w=>/沒有相接/.test(w)),'說相鄰但矩形分開要留 warning');
});

// 行列切分求解器：用「分欄 + 面積」重排，保證欄內貼合、欄間貼合、無重疊、不超出全屋。
test('grid solver packs rooms into columns without overlap or overflow',()=>{
 const home={width:10,depth:8};
 const rooms=[
  {name:'客廳',x:-3,z:0,width:4,depth:4,area_sqm:16},
  {name:'睡房',x:2,z:-1.5,width:3,depth:3,area_sqm:9},
  {name:'廚房',x:2,z:1.5,width:3,depth:3,area_sqm:9},
 ];
 const r=solveGrid(rooms,home);
 assert.ok(r.cols>=2,`應該分成至少 2 欄，實際 ${r.cols}`);
 for(const a of rooms)assert.ok(Math.abs(a.x)+a.width/2<=home.width/2+.02,`${a.name} 超出寬度`);
 for(const a of rooms)assert.ok(Math.abs(a.z)+a.depth/2<=home.depth/2+.02,`${a.name} 超出深度`);
 for(let i=0;i<rooms.length;i++)for(let k=i+1;k<rooms.length;k++){
  const p=rooms[i],q2=rooms[k];
  const ox=(p.width+q2.width)/2-Math.abs(p.x-q2.x),oz=(p.depth+q2.depth)/2-Math.abs(p.z-q2.z);
  assert.ok(ox<=.02||oz<=.02,`${p.name} 與 ${q2.name} 重疊 ox=${ox.toFixed(2)} oz=${oz.toFixed(2)}`);
 }
 const bed=rooms.find(x=>x.name==='睡房'),kit=rooms.find(x=>x.name==='廚房');
 assert.ok(Math.abs((bed.z+bed.depth/2)-(kit.z-kit.depth/2))<.05,'同欄房間要上下貼合');
});

// 牆識別：adjacent 標了 wall:false 的邊界是開放連通，不該生成牆（否則客廳與走廊之間會多出一道牆）。
test('open boundaries produce no wall segment',()=>{
 const room=(id,name,kind,x,z,w,d,adjacent=[])=>({id,name,kind,purpose:kind,x,z,width:w,depth:d,height:2.7,confidence:'high',notes:'',openings:[],adjacent,items:[]});
 const home={format:'domira.home.v1',width:10,depth:8,height:2.7,source:'ai-floorplan',scaleConfirmed:true,summary:'',warnings:[],rooms:[
  room('a','客廳','living',-2.5,0,5,4,[{to:'走廊',edge:'right',wall:false}]),
  room('b','走廊','hall',2.5,0,5,4,[{to:'客廳',edge:'left',wall:false}]),
 ]};
 const middle=planWalls(home).filter(s=>s.kind==='wall'&&s.axis==='z'&&Math.abs(s.x)<.15);
 assert.equal(middle.length,0,'開放連通的邊界不該生成牆');
 const closed={...home,rooms:[room('a','客廳','living',-2.5,0,5,4,[{to:'走廊',edge:'right',wall:true}]),room('b','走廊','hall',2.5,0,5,4,[{to:'客廳',edge:'left',wall:true}])]};
 const withWall=planWalls(closed).filter(s=>s.kind==='wall'&&s.axis==='z'&&Math.abs(s.x)<.15);
 assert.ok(withWall.length>=1,'有牆的邊界要生成牆');
});

// 切分樹：保住原圖的錯落結構（不是壓成直條），同時面積對得上標註值、無重疊。
test('slicing tree matches labelled areas without overlap',()=>{
 const rooms=[
  {name:'客廳',x:-3,z:0,width:4,depth:6,area_sqm:24},
  {name:'廚房',x:2,z:-2,width:3,depth:4,area_sqm:12},
  {name:'睡房',x:2,z:2,width:3,depth:2,area_sqm:6},
 ];
 const home={width:10,depth:8};
 solveSlices(rooms,home);
 for(const r of rooms)assert.ok(Math.abs(r.width*r.depth-r.area_sqm)<r.area_sqm*.1,`${r.name} 面積應接近標註，實際 ${(r.width*r.depth).toFixed(1)} vs ${r.area_sqm}`);
 for(let i=0;i<rooms.length;i++)for(let k=i+1;k<rooms.length;k++){
  const p=rooms[i],q2=rooms[k];
  const ox=(p.width+q2.width)/2-Math.abs(p.x-q2.x),oz=(p.depth+q2.depth)/2-Math.abs(p.z-q2.z);
  assert.ok(ox<=.02||oz<=.02,`${p.name} 與 ${q2.name} 重疊`);
 }
 // 結構：客廳在左、廚房在右上、睡房在右下
 const hall=rooms[0],kit=rooms[1],bed=rooms[2];
 assert.ok(hall.x<kit.x&&hall.x<bed.x,'客廳應在左側');
 assert.ok(kit.z<bed.z,'廚房應在睡房上方');
});

// 多邊形面積（鞋帶公式）：梯形陽台這種非矩形房間要靠它算面積。
test('polygon area uses the shoelace formula',()=>{
 // 梯形：下底 4、上底 2、高 2 → (4+2)/2*2 = 6
 assert.ok(Math.abs(polygonArea([[0,0],[4,0],[3,2],[1,2]])-6)<.01,'梯形面積應為 6');
 // 矩形 3x2 = 6（頂點順序反過來也要一樣）
 assert.ok(Math.abs(polygonArea([[0,0],[3,0],[3,2],[0,2]])-6)<.01);
 assert.ok(Math.abs(polygonArea([[0,2],[3,2],[3,0],[0,0]])-6)<.01,'反序也要一樣');
 assert.equal(polygonArea([[0,0],[1,1]]),0,'少於三點回 0');
});

test('Google array-shaped invalid-key errors are classified without echoing credentials',async t=>{t.mock.method(globalThis,'fetch',async()=>Response.json([{error:{code:400,message:'Please pass a valid API key',status:'INVALID_ARGUMENT'}}],{status:400}));await assert.rejects(()=>analyzeFloorplan({image:'data:image/jpeg;base64,'+Buffer.from([255,216,255,0]).toString('base64')},{VISION_BASE_URL:'https://generativelanguage.googleapis.com/v1beta/openai/',VISION_MODEL:'gemini-3.5-flash',VISION_API_KEY:'test-key'}),/識圖服務拒絕此 API 密鑰/);});

test('Qwen vision uses dedicated credentials and non-thinking multimodal JSON requests',async t=>{const cfg=visionConfig({VISION_BASE_URL:'https://dashscope.aliyuncs.com/compatible-mode/v1',VISION_MODEL:'qwen3-vl-plus',VISION_API_KEY:'qwen-test'});assert.equal(cfg.provider,'qwen');assert.equal(visionConfig({VISION_BASE_URL:cfg.base,DEEPSEEK_API_KEY:'old-key'}).key,'');let calls=0;t.mock.method(globalThis,'fetch',async(url,request)=>{calls++;assert.equal(url,cfg.base+'/chat/completions');assert.equal(request.headers.Authorization,'Bearer qwen-test');const body=JSON.parse(request.body);assert.equal(body.model,'qwen3-vl-plus');assert.equal(body.enable_thinking,false);assert.equal(body.thinking,undefined);assert.equal(body.reasoning_effort,undefined);assert.equal(body.response_format.type,'json_object');assert.equal(body.messages[1].content[1].image_url.detail,undefined);return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(analysis())}}]});});const result=await analyzeFloorplan({image:'data:image/jpeg;base64,'+Buffer.from([255,216,255,0]).toString('base64')},{VISION_BASE_URL:cfg.base,VISION_MODEL:cfg.model,VISION_API_KEY:'qwen-test'});assert.equal(result.provider,'qwen');assert.equal(result.model,'qwen3-vl-plus');assert.equal(calls,1);});

// 雙模型合併：面積與名稱用主來源（Qwen 讀印刷數字準），矩形位置與門窗用副來源（deepseek 的相對位置較對）。
test('merging takes area from primary and rect from secondary',()=>{
 const area={model:'qwen3-vl-plus',provider:'qwen',warnings:[],rooms:[
  {name:'客廳',kind:'living',rect:{x:0,y:0,w:500,h:500},area_sqm:32.35,openings:[],adjacent:[]},
  {name:'主臥',kind:'bedroom',rect:{x:500,y:0,w:500,h:500},area_sqm:12.4,openings:[],adjacent:[]},
 ]};
 const pos={model:'deepseek-flash',provider:'deepseek',warnings:[],rooms:[
  {name:'客廳',kind:'living',rect:{x:10,y:20,w:400,h:300},openings:[{kind:'door',edge:'top',offset:.4,width:.2}],adjacent:[]},
  {name:'主臥',kind:'bedroom',rect:{x:600,y:50,w:300,h:400},openings:[],adjacent:[]},
 ]};
 const m=mergeAnalyses(area,pos,'deepseek-flash');
 assert.equal(m.rooms[0].area_sqm,32.35,'面積要保留主來源');
 assert.deepEqual(m.rooms[0].rect,{x:10,y:20,w:400,h:300},'矩形要取自副來源');
 assert.equal(m.rooms[0].openings.length,1,'門窗要取自副來源');
 assert.equal(m.rooms[1].rect.x,600,'第二間也要合併到');
 assert.ok(m.warnings.some(w=>/對上 2\/2/.test(w)),'要回報對上幾間');
});

const mergeEnv={VISION_PROVIDER:'qwen',VISION_BASE_URL:'https://dashscope.aliyuncs.com/compatible-mode/v1',VISION_MODEL:'qwen3-vl-plus',VISION_API_KEY:'qwen-test',VISION_MERGE_PROVIDER:'deepseek',VISION_MERGE_BASE_URL:'https://api.deepseek.com',VISION_MERGE_MODEL:'deepseek-flash',DEEPSEEK_API_KEY:'deepseek-test'};
const mergeBody={image:'data:image/jpeg;base64,'+Buffer.from([255,216,255,0]).toString('base64')};
test('second vision source reuses existing DeepSeek secret only on its official endpoint and discloses no keys',async t=>{let calls=0;t.mock.method(globalThis,'fetch',async(url,request)=>{calls++;assert.equal(request.headers.Authorization,calls===1?'Bearer qwen-test':'Bearer deepseek-test');if(calls===2){assert.equal(url,'https://api.deepseek.com/chat/completions');assert.equal(JSON.parse(request.body).thinking.type,'disabled');}return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(analysis())}}]});});const result=await analyzeFloorplan(mergeBody,mergeEnv);assert.equal(calls,2);assert.equal(result.provider,'qwen+deepseek');assert.equal(result.merge.status,'complete');assert.ok(result.warnings.some(w=>w.includes('qwen3-vl-plus')&&w.includes('deepseek-flash')));const cap=await worker.fetch(new Request('https://test/api/floorplan/capabilities'),mergeEnv),text=await cap.text();assert.equal(JSON.parse(text).merge.enabled,true);assert.ok(!text.includes('deepseek-test'));assert.ok(!text.includes('qwen-test'));});
test('secondary outage preserves primary rooms and openly reports fallback',async t=>{let calls=0;t.mock.method(globalThis,'fetch',async()=>++calls===1?Response.json({choices:[{message:{content:JSON.stringify(analysis())}}]}):Response.json({error:{message:'unavailable'}},{status:503}));const result=await analyzeFloorplan(mergeBody,mergeEnv);assert.equal(calls,2);assert.equal(result.provider,'qwen');assert.equal(result.rooms.length,2);assert.equal(result.merge.status,'fallback');assert.ok(result.warnings.some(w=>w.includes('已保留主來源')));});
test('DeepSeek merge secret never falls back across providers or lookalike hosts',async t=>{let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({choices:[{message:{content:JSON.stringify(analysis())}}]});});for(const patch of [{VISION_MERGE_PROVIDER:'custom'},{VISION_MERGE_BASE_URL:'https://api.deepseek.com.example.test'}]){const result=await analyzeFloorplan(mergeBody,{...mergeEnv,...patch});assert.equal(result.provider,'qwen');}assert.equal(calls,2);});
