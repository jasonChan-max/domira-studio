// 驗證從整屋帶入門：起居室有兩道門（通玄關、通睡房），都要進到單房間專案。
// 重點是 ratio→公尺 的換算——hkCareHome 存的是 .9/3.6 這種比例，
// 直接當 0.25 m 用會全錯。
import { hkCareHome, roomCareProject } from '../public/care-home-domain.js';
import { careGeometry, doorList } from '../public/care-domain.js';
import { CATALOG } from '../public/domain.js';

const home = hkCareHome();
const living = home.rooms.find(r => r.id === 'living');
console.log(`起居室 ${living.width} × ${living.depth} m，openings ${living.openings.length} 個`);

const p = roomCareProject(home, living);
console.log('帶入的 doors:', JSON.stringify(p.doors));

const ok = [];
ok.push(['doors 數量為 2', (p.doors || []).length === 2]);
ok.push(['兩道門寬都是 0.9 m（不是比例 0.25）', (p.doors || []).every(d => Math.abs(d.width - 0.9) < 0.01)]);

console.log('\ndoorList（房間局部座標）:');
for (const d of doorList(p)) {
  const mid = d.axis === 'x' ? `x=${((d.x0 + d.x1) / 2).toFixed(2)} z=${d.z}` : `x=${d.x} z=${((d.z0 + d.z1) / 2).toFixed(2)}`;
  console.log(`  ${d.edge} 牆  中心 ${mid}  寬 ${d.w}`);
}

const item = (o) => ({ ...CATALOG.cabinet, id: 't1', name: '測試櫃', type: 'cabinet', w: 0.4, d: 0.4, h: 0.8, rotation: 0, color: '#aabbcc', ...o });
const swing = (proj) => careGeometry(proj).failures.filter(f => f.rule === 'door-swing');

const empty = swing(p);
ok.push(['空房不報', empty.length === 0]);

// 玄關門（bottom 牆）前
const atHall = { ...p, items: [item({ x: 1.3, z: 1.5 })] };
const hall = swing(atHall);
ok.push(['玄關門前擋櫃要報', hall.length === 1]);

// 睡房門（right 牆）前 —— 這道是新增的，之前完全不會報
const atBed = { ...p, items: [item({ x: 1.5, z: 0.8 })] };
const bed = swing(atBed);
ok.push(['睡房門前擋櫃要報', bed.length === 1]);

console.log('');
let allOk = true;
for (const [label, pass] of ok) {
  if (!pass) allOk = false;
  console.log(`${pass ? '✓' : '✗'} ${label}`);
}
if (hall[0]) console.log(`   玄關: ${hall[0].message}`);
if (bed[0]) console.log(`   睡房: ${bed[0].message}`);

console.log(allOk ? '\nPASS 整屋門位成功帶入單房間' : '\nFAIL 接線有問題');
process.exit(allOk ? 0 : 1);
