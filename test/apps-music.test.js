const test = require('node:test');
const assert = require('node:assert');
const apps = require('../src/pkjs/apps');
const music = require('../src/pkjs/music');
const actions = require('../src/pkjs/actions');

const LIST = [
  { uuid: 'w', name: 'Workout', type: 'watchapp' },
  { uuid: 'wf', name: 'Weather Face', type: 'watchface' },
  { uuid: 'we', name: 'Weather', type: 'watchapp' },
  { uuid: 's', name: 'Stopwatch', type: 'watchapp' },
  { uuid: apps.SELF, name: 'Bucky', type: 'watchapp' },
];

test('launch phrases', () => {
  assert.deepEqual(apps.ask('launch workout'), { name: 'workout', strict: true });
  assert.deepEqual(apps.ask('open the weather app'), { name: 'weather', strict: false });
  assert.equal(apps.ask('start a timer'), null);
  assert.equal(apps.ask('start a 10 minute pasta timer'), null);
  assert.equal(apps.ask('what time is it'), null);
});

test('picking the app', () => {
  assert.equal(apps.pick(LIST, 'workout').uuid, 'w');
  assert.equal(apps.pick(LIST, 'work out').uuid, 'w');
  assert.equal(apps.pick(LIST, 'weather').uuid, 'we');
  assert.equal(apps.pick(LIST, 'stop watch').uuid, 's');
  assert.equal(apps.pick(LIST, 'bucky'), null);
  assert.equal(apps.pick(LIST, 'garage door'), null);
});

test('music controls', () => {
  const id = (t) => (actions.match(t) || {}).id;
  assert.equal(id('pause'), 'pause_music');
  assert.equal(id('play music'), 'play_music');
  assert.equal(id('skip'), 'next_track');
  assert.equal(id('next song'), 'next_track');
  assert.equal(id('go back a song'), 'previous_track');
  assert.equal(id('previous track'), 'previous_track');
  assert.equal(id('play some jazz'), undefined);
  assert.equal(id('skip the meeting'), undefined);
  assert.deepEqual(actions.match('pause').args, { on: false });
  assert.equal(actions.match('pause', (f) => f !== 'music'), null);
});

test("what's playing", () => {
  assert.ok(music.ask("what's playing"));
  assert.ok(music.ask('what song is this'));
  assert.equal(music.ask("what's playing at the movies tonight"), null);
  const answer = music.describe({ properties: {
    title: { shortText: { text: 'Harvest Moon' } }, artist: { shortText: { text: 'Neil Young' } },
    album: { shortText: { text: '?' } }, playing: { boolean: { value: false } } } });
  assert.equal(answer.headline, 'Harvest Moon');
  assert.match(answer.body, /^By Neil Young\. Paused\./);
  assert.equal(music.describe({ properties: {} }), null);
});
