// 驗證扇形判定精確化：門洞「側後方」的家具不該再被算成擋門。
// 舊版用「到鉸鏈距離 < 門寬」，那個圓把門側面與背後的 270° 也包進去了，
// 使用者實測抱怨「這個距離不能放」。新版只認門板真正掃過的 90°。
import { careGeometry, newCareProject } from '../public/care-domain.js';
import { CATALOG } from '../public/domain.js';

const room = { width: 3.6, depth: 3.8, height: 2.7, source: 'demo' };
const DOORS = [{ edge: 'bottom', offset: 2.65 / 3.6, width: 0.9 }];

const p = (x, z) => {
  const proj = newCareProject(room);
  proj.doors = DOORS;
  proj.items = [{ ...CATALOG.cabinet, id: 't1', name: '測試櫃', type: 'cabinet', w: 0.4, d: 0.4, h: 0.8, rotation: 0, color: '#aabbcc', x, z }];
  return careGeometry(proj).failures.filter(f => f.rule === 'door-swing').length;
};

// 門洞 x∈[0.85,1.75]、z=1.9，寬 0.9。房內是 -z 方向。
const cases = [
  ['門正前方 (1.30, 1.50)', 1.30, 1.50, 1],
  ['門右前方 (1.60, 1.45)', 1.60, 1.45, 1],
  ['門左側後方 (0.40, 1.60)', 0.40, 1.60, 0],   // 舊版會誤報：到鉸鏈 0.54 < 0.9
  ['門右側後方 (2.30, 1.55)', 2.30, 1.55, 0],   // 同上
  ['房間中央 (0.00, 0.00)', 0.00, 0.00, 0],
];

let ok = true;
for (const [label, x, z, expect] of cases) {
  const got = p(x, z);
  const pass = got === expect;
  if (!pass) ok = false;
  console.log(`${pass ? '✓' : '✗'} ${label}: 預期 ${expect}, 實際 ${got}`);
}
console.log(ok ? '\nPASS 扇形判定精確化正確' : '\nFAIL 有情況不符');
process.exit(ok ? 0 : 1);
