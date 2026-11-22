const test = require('node:test');
const assert = require('node:assert');
const k = require('../src/pkjs/indexkit.js');
const d = require('../src/pkjs/destinations.js');

test('a bare clock time after "for" is the next one', () => {
  const now = new Date(2026, 10, 22, 14, 0);
  const r = k.reminder('Set a reminder for 4:05 to get the kids ready.');
  assert.equal(r.when, 'at 4:05');
  assert.equal(r.message, 'Get the kids ready');
  assert.equal(d.due(r.when, now).getHours(), 16);
  assert.equal(k.reminder('set a reminder for 5 pm to call mom').when, 'at 5 pm');
  assert.equal(k.reminder('set a reminder for Friday at 9 to pay rent').when, 'Friday at 9');
  assert.equal(k.reminder('remind me at 4:05 to stretch').when, 'at 4:05');
});
