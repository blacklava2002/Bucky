// "Flip a coin", answered without an agent.
const test = require('node:test');
const assert = require('node:assert');
const { ask, flip } = require('../src/pkjs/coin.js');

test('coin asks', () => {
  for (const t of ['Flip a coin.', 'flip a coin', 'Toss a coin', 'Coin flip', 'coin toss', 'Heads or tails?',
    'Can you flip a coin for me?', 'Okay, flip a coin please', "Let's do a coin flip"]) {
    assert.deepEqual(ask(t), { what: 'coin' }, t);
  }
});

test('not coin asks', () => {
  for (const t of ['Ask Claude to flip a coin', 'flip a coin to decide who drives and text Sam', 'remind me to flip a coin',
    'how do you flip a coin', 'add coin batteries to the list', 'set a timer for 5 minutes']) {
    assert.equal(ask(t), null, t);
  }
});

test('flips both ways', () => {
  assert.equal(flip(() => 0.1), 'Heads');
  assert.equal(flip(() => 0.9), 'Tails');
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(flip());
  assert.deepEqual([...seen].sort(), ['Heads', 'Tails']);
});
