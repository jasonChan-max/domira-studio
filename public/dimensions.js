import * as THREE from './vendor/three.module.js';
export function dimensionProjection(room,camera,root,width,height){
 root.updateMatrixWorld(true);camera.updateMatrixWorld(true);
 const project=p=>{const v=root.localToWorld(new THREE.Vector3(...p)).project(camera);return {x:(v.x+1)*width/2,y:(1-v.y)*height/2,visible:v.z>-1&&v.z<1};};
 const w=room.width/2,d=room.depth/2;
 return [{id:'width',text:'闊 '+room.width.toFixed(2)+' m',a:project([-w,.025,d+.25]),b:project([w,.025,d+.25])},{id:'depth',text:'長 '+room.depth.toFixed(2)+' m',a:project([w+.25,.025,-d]),b:project([w+.25,.025,d])}].map(edge=>({...edge,x:(edge.a.x+edge.b.x)/2,y:(edge.a.y+edge.b.y)/2,visible:edge.a.visible&&edge.b.visible}));
}
