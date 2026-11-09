// 驗證門扇扇形的角度與方向：算頂點的世界座標，確認它真的朝房內。
// 這個最容易搞反——CircleGeometry 在 XY 平面、rotation.x=-90° 之後 Y 變 -Z，
// 一旦方向反了，扇形會畫到牆外去，看起來像「門往走廊開」。
import * as THREE from '../public/vendor/three.module.js';

const depth = 4.5, doorWidth = 0.9;
const hingeZ = depth / 2;   // 入口在下方中央
const halfDw = doorWidth / 2;

let allOk = true;
for (const [hx, thetaStart, label] of [[-halfDw, 0, '左鉸鏈'], [halfDw, Math.PI / 2, '右鉸鏈']]) {
  const geo = new THREE.CircleGeometry(doorWidth, 28, thetaStart, Math.PI / 2);
  const mesh = new THREE.Mesh(geo);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(hx, 0.037, hingeZ);
  mesh.updateMatrixWorld(true);

  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  let minZ = Infinity, maxZ = -Infinity, minX = Infinity, maxX = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
    minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
  }

  // 扇形必須全部落在房內：z ≤ hingeZ，且不超過一個門寬
  const insideRoom = maxZ <= hingeZ + 1e-6;
  const reach = hingeZ - minZ;
  const reachOk = Math.abs(reach - doorWidth) < 0.05;

  console.log(`${label}: x∈[${minX.toFixed(2)}, ${maxX.toFixed(2)}]  z∈[${minZ.toFixed(2)}, ${maxZ.toFixed(2)}]`);
  console.log(`        朝向房內=${insideRoom}  掃過深度=${reach.toFixed(2)}m (應=門寬 ${doorWidth})  ${reachOk ? '✓' : '✗'}`);
  if (!insideRoom || !reachOk) allOk = false;
}

console.log(allOk ? '\nPASS 兩片扇形都在房內、掃過深度等於門寬' : '\nFAIL 扇形方向或半徑不對');
process.exit(allOk ? 0 : 1);
