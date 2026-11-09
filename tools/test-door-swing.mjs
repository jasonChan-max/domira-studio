// 驗證門扇開合區這條新規則真的會擋人，不是寫了沒作用。
import { careGeometry, newCareProject } from '../public/care-domain.js';
import { CATALOG } from '../public/domain.js';

const base = () => newCareProject({ width: 6, depth: 4.5, height: 2.7, source: 'demo' });

function mk(over) {
  const p = base();
  p.doorWidth = 0.9;
  p.items.push({
    ...CATALOG.cabinet, id: 'test-1', name: '測試櫃', type: 'cabinet',
    x: 0, z: 0, w: 0.8, d: 0.4, h: 0.8, rotation: 0, color: '#aabbcc',
    ...over,
  });
  return p;
}

// 1. 空房：不該報 door-swing
const empty = careGeometry(base());
console.log('空房 door-swing:', empty.failures.filter(f => f.rule === 'door-swing').length);

// 2. 家具堵在門口（z 接近 depth/2=2.25）：應該報
const atDoor = careGeometry(mk({ z: 2.0 }));
const hit = atDoor.failures.filter(f => f.rule === 'door-swing');
console.log('堵門口 door-swing:', hit.length, hit[0] ? '→ ' + hit[0].message : '');

// 3. 家具移到房間中央：不該再報（但可能撞到迴轉區，那是另一條規則）
const center = careGeometry(mk({ z: 0 }));
console.log('放中央 door-swing:', center.failures.filter(f => f.rule === 'door-swing').length);

// 4. 家具靠側牆、離門很遠：不該報
const corner = careGeometry(mk({ x: 2.4, z: 1.9, w: 0.5, d: 0.5 }));
console.log('貼側牆 door-swing:', corner.failures.filter(f => f.rule === 'door-swing').length);

const ok = empty.failures.filter(f => f.rule === 'door-swing').length === 0
  && hit.length === 1
  && center.failures.filter(f => f.rule === 'door-swing').length === 0
  && corner.failures.filter(f => f.rule === 'door-swing').length === 0;
console.log(ok ? '\nPASS 門扇開合區規則正常' : '\nFAIL 規則沒按預期觸發');
process.exit(ok ? 0 : 1);
