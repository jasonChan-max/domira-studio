// Read-only position checks: fewer doors is insufficient if the specified false doors remain.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(process.argv[2]||'.screenshots/wall-round9');
const read=async p=>JSON.parse(await readFile(resolve(root,p),'utf8'));
const iou=(a,b)=>{const q=Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));return q/(a.w*a.h+b.w*b.h-q);};
const baseR2=await read('baseline-r2/probe-3d.json'),base46=await read('baseline-46/probe-3d.json');
const refs=[['gray-wall',57,225],['fixed-window',172,139]].map(([name,x,y])=>({name,box:[...baseR2.doorDetections].sort((a,b)=>Math.hypot(a.x-x,a.y-y)-Math.hypot(b.x-x,b.y-y))[0]}));
const slider=baseR2.selection.doors.checks.find(c=>c.valid&&c.longSide>2.5),wide46=base46.selection.doors.checks.find(c=>c.valid&&Math.abs(c.longSide-1.864)<.02);
const trials={};
for(const [key,prefix] of [['100','candidate100'],['50','candidate50'],['fixed-window','candidate-fixed-window']]){
 const r=await read(prefix+'-r2/probe-3d.json'),s=await read(prefix+'-46/probe-3d.json');
 const at=(boxes,reference,threshold=.3)=>boxes.filter(b=>iou(b,reference)>=threshold);
 const falseRegions=refs.map(ref=>({name:ref.name,baselineBox:ref.box,rawMatches:at(r.doorDetections,ref.box),adoptedMatches:r.selection.doors.checks.filter(c=>c.valid&&iou(c.box,ref.box)>=.3)}));
 const newAdopted=r.selection.doors.checks.filter(c=>c.valid&&!baseR2.selection.doors.checks.some(b=>b.valid&&iou(c.box,b.box)>=.5));
 const sliderKept=r.selection.doors.checks.some(c=>c.valid&&iou(c.box,slider.box)>=.5);
 const existing46=base46.selection.doors.checks.filter(c=>c.valid).map(b=>({baselineIndex:b.index,longSide:b.longSide,preserved:s.selection.doors.checks.some(c=>c.valid&&iou(c.box,b.box)>=.5)}));
 const wide46Matches=s.selection.doors.checks.filter(c=>c.valid&&iou(c.box,wide46.box)>=.5);
 const r2Passed=r.doors<=9&&falseRegions.every(f=>!f.rawMatches.length)&&r.windows===12&&r.windowsAllValid&&r.rooms===8&&r.noExposedBayFloors;
 const image46Passed=s.doors===4&&existing46.every(c=>c.preserved)&&s.rooms===4&&s.windows===7&&s.windowsAllValid&&s.maskFidelity.precision===1&&s.vertices===64;
 trials[key]={r2:{doors:r.doors,rooms:r.rooms,windows:r.windows,windowsAllValid:r.windowsAllValid,noExposedBayFloors:r.noExposedBayFloors,falseRegions,newAdopted,originalSlidingDoorPreserved:sliderKept,windowsRawByteEqual:JSON.stringify(r.windowsRaw)===JSON.stringify(baseR2.windowsRaw),passed:r2Passed},image46:{doors:s.doors,rooms:s.rooms,windows:s.windows,windowsAllValid:s.windowsAllValid,precision:s.maskFidelity.precision,vertices:s.vertices,existingDoors:existing46,wideDoorMatches:wide46Matches,windowsRawByteEqual:JSON.stringify(s.windowsRaw)===JSON.stringify(base46.windowsRaw),passed:image46Passed}};
}
await writeFile(resolve(root,'position-audit.json'),JSON.stringify({baseline:{r2:{doors:baseR2.doors,rooms:baseR2.rooms,windows:baseR2.windows},image46:{doors:base46.doors}},matching:'IoU>=0.3 locates supplied false-door regions; IoU>=0.5 checks retained baseline doors. Raw detector conf remains0.25.',trials},null,2)+'\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(trials).map(([k,t])=>[k,{r2Doors:t.r2.doors,falseScores:t.r2.falseRegions.map(f=>f.rawMatches.map(b=>b.score)),newAdopted:t.r2.newAdopted.map(c=>c.index),slider:t.r2.originalSlidingDoorPreserved,r2Passed:t.r2.passed,image46Doors:t.image46.doors,image46Passed:t.image46.passed,rawWindowsEqual:t.r2.windowsRawByteEqual&&t.image46.windowsRawByteEqual}]))));
