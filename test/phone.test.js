// The phone's battery, from the built-in Phone plugin.
const test = require('node:test');
const assert = require('node:assert');
const { ask, describe } = require('../src/pkjs/phone.js');

test('battery questions', () => {
  for (const t of ["What's my battery level?", 'What is my phones battery percentage?', "What's my phone's battery?",
    'how much battery does my phone have left', 'is my phone charged', 'phone battery', 'how charged is my phone']) {
    assert.deepEqual(ask(t), { what: 'battery' }, t);
  }
});

test('not battery questions', () => {
  for (const t of ['add batteries to the shopping list', 'remind me to charge my phone', "what's my watch battery",
    'find my phone', 'what is the weather']) {
    assert.equal(ask(t), null, t);
  }
});

const level = (n) => ({ numericValue: { value: n, unit: '%' }, shortText: { text: n + '%' } });
const on = (v) => ({ boolean: { value: v } });

test('answers', () => {
  assert.deepEqual(describe({ properties: { battery_level: level(62), wifi: on(true), mobile_data: on(false) } }),
    { headline: 'Phone at 62%', body: 'On Wi-Fi.' });
  assert.deepEqual(describe({ properties: { battery_level: level(100) } }), { headline: 'Phone at 100%', body: 'Fully charged.' });
  assert.deepEqual(describe({ properties: { battery_level: level(9), wifi: on(false), mobile_data: on(true), cell: { shortText: { text: '5G' } } } }),
    { headline: 'Phone at 9%', body: 'Running low. On mobile data (5G).' });
  assert.equal(describe({ properties: {} }), null);
});
