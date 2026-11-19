// Plugin actions the app runs itself, like Find My Phone.
const test = require('node:test');
const assert = require('node:assert');
const { match, FIND_MY_PHONE } = require('../src/pkjs/actions.js');

const id = (t) => (match(t) || {}).id || null;

test('ways of asking to find the phone', () => {
  for (const t of ['Find my phone.', "Where's my phone?", 'I lost my phone', 'Bucky, find my phone',
    "I can't find my phone", 'make my phone ring', 'ring my phone', 'Find my phone please']) {
    assert.equal(id(t), 'ring_phone', t);
  }
});

test('ways of asking to stop it', () => {
  for (const t of ['stop ringing', 'I found it', 'found my phone', 'silence my phone', 'Stop the ringing.']) {
    assert.equal(id(t), 'stop_phone', t);
  }
});

test('near misses go elsewhere', () => {
  for (const t of ['find my phone case', 'tell claude to find my phone', 'find my phone number',
    'set a timer for 5 minutes', 'what is the weather']) {
    assert.equal(id(t), null, t);
  }
});

test('both use the built-in Find My Phone plugin', () => {
  assert.equal(match('find my phone').plugin, FIND_MY_PHONE);
  assert.equal(match('find my phone').action, 'ring');
  assert.equal(match('stop ringing').action, 'stop');
});
