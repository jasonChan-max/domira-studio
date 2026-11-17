import test from 'node:test';
import assert from 'node:assert/strict';
import { roomsFromMask } from '../public/room-polygon.js';

function pair(gapClass = 1, gapHeight = 1) {
  const mask = new Uint8Array(100 * 100).fill(4);
  for (let y = 30; y < 70; y++) {
    for (let x = 9; x < 91; x++) mask[y * 100 + x] = x >= 49 && x < 51 ? 1 : 0;
  }
  for (let y = 49; y < 49 + gapHeight; y++) {
    for (let x = 49; x < 51; x++) mask[y * 100 + x] = gapClass;
  }
  return mask;
}

for (const gapHeight of [1, 2]) {
  test(`${gapHeight}px floor bridge splits into two rooms and preserves floor pixels`, () => {
    const mask = pair(0, gapHeight);
    const copy = mask.slice();
    const rooms = roomsFromMask(mask, 100, 100);
    assert.equal(rooms.length, 2);
    assert.equal(rooms.reduce((sum, room) => sum + room.pixels, 0), 3200 + 2 * gapHeight);
    assert.ok(rooms.every(room => Math.abs(room.pixels - 1600) <= 4));
    assert.deepEqual(mask, copy);
  });
}

test('intact wall keeps two rooms and counts only floor', () => {
  const rooms = roomsFromMask(pair(), 100, 100);
  assert.equal(rooms.length, 2);
  assert.deepEqual(rooms.map(room => room.pixels), [1600, 1600]);
  assert.ok(rooms.every(room => Math.abs(room.area - 1600) < 80));
  assert.deepEqual(rooms.map(room => room.bbox), [[9, 30, 49, 69], [50, 30, 90, 69]]);
});

test('6px door opening is filled and stays between two rooms', () => {
  const rooms = roomsFromMask(pair(2, 6), 100, 100);
  const solid = roomsFromMask(pair(), 100, 100);
  assert.equal(rooms.length, 2);
  assert.deepEqual(rooms, solid);
  assert.ok(rooms.every(room => Math.abs(room.area - 1600) < 80));
});

test('erosion falls back when one original floor component disappears', () => {
  const mask = pair(0);
  // A separate 2px-wide component has no seeds; restore it without disabling the split elsewhere.
  for (let y = 5; y < 15; y++) for (let x = 5; x < 7; x++) mask[y * 100 + x] = 0;
  const rooms = roomsFromMask(mask, 100, 100, { minAreaRatio: 0, absorbWalls: false });
  assert.deepEqual(rooms.map(room => room.pixels), [1601, 1601, 20]);
});

test('all seeds disappearing falls back, including image edges', () => {
  const mask = new Uint8Array(20).fill(0);
  const rooms = roomsFromMask(mask, 2, 10);
  assert.equal(rooms.length, 1);
  assert.equal(rooms[0].pixels, 20);
  assert.deepEqual(rooms[0].bbox, [0, 0, 1, 9]);
  assert.deepEqual(roomsFromMask(new Uint8Array(100).fill(4), 10, 10), []);
});

test('absorbWalls:false restores floor without filling the wall or door', () => {
  const rooms = roomsFromMask(pair(2, 6), 100, 100, { absorbWalls: false });
  assert.equal(rooms.length, 2);
  assert.deepEqual(rooms.map(room => room.pixels), [1600, 1600]);
  assert.deepEqual(rooms.map(room => room.bbox), [[9, 30, 48, 69], [51, 30, 90, 69]]);
});

test('minAreaRatio uses restored floor area rather than seeds or absorbed walls', () => {
  assert.equal(roomsFromMask(pair(), 100, 100, { minAreaRatio: 0.49 }).length, 2);
  assert.equal(roomsFromMask(pair(), 100, 100, { minAreaRatio: 0.51 }).length, 0);
});

test('windows stay unassigned like outside pixels', () => {
  const mask = pair();
  for (let y = 30; y < 70; y++) for (let x = 49; x < 51; x++) mask[y * 100 + x] = 3;
  const rooms = roomsFromMask(mask, 100, 100);
  assert.equal(rooms.length, 2);
  assert.deepEqual(rooms.map(room => room.pixels), [1600, 1600]);
  assert.deepEqual(rooms.map(room => room.bbox), [[9, 30, 48, 69], [51, 30, 90, 69]]);
});
