const test = require('node:test');
const assert = require('node:assert');
const d = require('../src/pkjs/destinations.js');

test('due reads the usual ways of saying when', () => {
  const now = new Date(2026, 10, 19, 8, 0);
  const at = (w) => { const x = d.due(w, now); return x && [x.getDate(), x.getHours(), x.getMinutes()]; };
  assert.deepEqual(at('tomorrow at 9'), [20, 9, 0]);
  assert.deepEqual(at('tomorrow'), [20, 9, 0]);
  assert.deepEqual(at('tonight'), [19, 20, 0]);
  assert.deepEqual(at('in 20 minutes'), [19, 8, 20]);
  assert.deepEqual(at('in 3 days'), [22, 8, 0]);
  assert.deepEqual(at('on December 3rd'), [3, 9, 0]);
  assert.deepEqual(at('Friday at 5pm'), [20, 17, 0]);
  assert.equal(d.due('whenever', now), null);
});
