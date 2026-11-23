import test from 'node:test';
import assert from 'node:assert/strict';
import {doorsToHome} from '../public/opening-detection.js';

// frame 100×100 對應 10m：1px = 0.1m。長寬都以米給，內部換成像素。
const frame = {x: 0, y: 0, w: 100, h: 100};
const door = (cx, cy, long, short, score) => ({
  x: cx - long * 10 / 2, y: cy - short * 10 / 2,
  w: long * 10, h: short * 10, horizontal: true, score, cls: 'door'
});

test('同一门洞叠了两个框：只留分数高的那个', () => {
  // 两个框中心一致、长度接近——真实叠加就是这种形状（如 R(2) 的 x=416 那处）。
  const r = doorsToHome([door(30, 30, .90, .20, .42), door(30, 30, .92, .21, .78)], frame, 10, 10);
  assert.equal(r.doors.length, 1);
  assert.equal(r.doors[0].score, .78);
  assert.ok(r.rejected.some(c => c.reasons.some(s => s.includes('同一门洞'))), '被合并的框要留下原因');
});

test('同一面墙上的相邻门不能合并', () => {
  const r = doorsToHome([door(30, 30, .90, .20, .7), door(45, 30, .90, .20, .7)], frame, 10, 10);
  assert.equal(r.doors.length, 2);
});

test('小门落在大门里不算同一门洞（分母用较长的框）', () => {
  // 0.45m 的小门完全落在一个 2.0m 的大门范围内，但它是另一个门。
  const r = doorsToHome([door(30, 30, 2.0, .40, .7), door(27, 30, .45, .10, .7)], frame, 10, 10);
  assert.equal(r.doors.length, 2);
});

test('不同方向的门即使位置重叠也不合并', () => {
  const vertical = {x: 25, y: 20, w: 2, h: 20, horizontal: false, score: .7, cls: 'door'};
  const r = doorsToHome([door(30, 30, .90, .20, .7), vertical], frame, 10, 10);
  assert.equal(r.doors.length, 2);
});
