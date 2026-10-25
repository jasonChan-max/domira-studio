/* 從 Domira 專案複製報價與法規數據，轉成 Worker 可 import 的 JS module。
 *
 * 為什麼要同步而不是手抄：價目表與法規是「唯一來源」，Python 版與 JS 版
 * 必須吃同一份數字。手抄一定會漂移，漂移後兩邊報價不同，客戶一眼就看出來。
 *
 * 用法：
 *   node scripts/sync-quote-data.mjs
 *   DOMIRA_SRC=<另一個路徑>/data node scripts/sync-quote-data.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SRC = process.env.DOMIRA_SRC || 'C:/Users/20744/Documents/deepseek-harness/default-workspace/Domira/data';
const OUT = path.join(ROOT, 'worker', 'data');

const FILES = [
  ['price_list.json', 'price_list.js'],
  ['aging_kb.json', 'aging_kb.js'],
  ['vendors.json', 'vendors.js'],
];

fs.mkdirSync(OUT, { recursive: true });
for (const [srcName, dstName] of FILES) {
  const srcPath = path.join(SRC, srcName);
  if (!fs.existsSync(srcPath)) {
    console.error('找不到 ' + srcPath + '，跳過');
    continue;
  }
  const data = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
  const body = '// 由 scripts/sync-quote-data.mjs 從 Domira 專案複製，勿手改\n'
    + 'export default ' + JSON.stringify(data) + ';\n';
  fs.writeFileSync(path.join(OUT, dstName), body, 'utf8');
  console.log('已同步 ' + srcName + ' → worker/data/' + dstName
    + '（' + Math.round(body.length / 1024) + ' KB）');
}
