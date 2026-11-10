import test from 'node:test';
import assert from 'node:assert/strict';
import {readPlanDimensions,validatePlanAnalysis} from '../public/home-domain.js';
import {snapRoomsToWalls} from '../public/wall-detect.js';
import {wallClass} from '../public/wall-onnx.js';

test('a single legible dimension axis can be recovered without guessing the other axis',()=>{
 const dimensions={unit:'mm',top:[3000,2000],left:[4000,'2000']};
 const plan=validatePlanAnalysis({rooms:[{rect:{x:20,y:20,w:900,h:700}}],dimensions});
 assert.deepEqual(plan.scale,{width:5,depth:null,basis:'dimensioned'});
 assert.equal(plan.dimensions.left,null);
});

test('conflicting opposite dimension lines block the reported total for that axis',()=>{
 const dimensions={unit:'mm',top:[3000,2000],bottom:[5900],right:[5200]};
 const result=readPlanDimensions(dimensions);
 assert.deepEqual(result.conflicts,['width']);
 assert.equal(result.width,null);
 assert.equal(result.depth,5.2);
 const plan=validatePlanAnalysis({rooms:[{rect:{x:20,y:20,w:900,h:700}}],dimensions,scale:{basis:'dimensioned',width:5.9}});
 assert.equal(plan.scale.width,null);
});

test('calibrated wall classification can recover a missed wall without relabeling other classes as floor',()=>{
 const logits=new Float32Array([0,1,-2,2,-3]);
 assert.equal(wallClass(logits,1,0,null),3);
 assert.equal(wallClass(logits,1,0,{weights:[0,1,0,0,0,0,0],blend:1,offset:0}),1);
});

test('wall snapping preserves the padding on the shorter side of the normalized plan',()=>{
 const rect={x:250,y:0,w:500,h:1000};
 const box={x0:10,x1:210,y0:10,y1:410};
 const hLines=[{pos:10,from:10,to:210,len:200},{pos:410,from:10,to:210,len:200}];
 const vLines=[{pos:10,from:10,to:410,len:400},{pos:210,from:10,to:410,len:400}];
 const result=snapRoomsToWalls([{rect}],{hLines,vLines,box},{frame:{w:200,h:400}});
 assert.deepEqual(result.rooms[0].rect,rect);
});
