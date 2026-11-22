const test = require('node:test');
const assert = require('node:assert');
const transcripts = require('../src/pkjs/transcripts');

function harness() {
  const store = {};
  let now = 1000;
  const log = transcripts.create({
    load: (k, f) => (k in store ? JSON.parse(store[k]) : f),
    save: (k, v) => { store[k] = JSON.stringify(v); },
    now: () => now,
  });
  return { log, tick: (ms) => { now += ms; } };
}

test('keeps what was said, each step and the outcome, newest first', () => {
  const h = harness();
  h.log.heard(1, 'tell Muse hello');
  h.tick(1500);
  h.log.note(1, 'Muse try 1: PLUGIN_UNAVAILABLE, 0.2s, phone online', null);
  h.log.note(1, 'Retrying Muse (1 of 2)...', 'working');
  h.tick(3000);
  h.log.note(1, 'Sent to Muse', 'done');
  h.log.heard(2, 'set a timer for 5 minutes');
  const [latest, first] = h.log.entries();
  assert.equal(latest.said, 'set a timer for 5 minutes');
  assert.equal(first.outcome, 'done');
  assert.deepEqual(first.steps.map((s) => s.ms), [1500, 1500, 4500]);
});

test('keeps only the newest entries and a clear empties it', () => {
  const h = harness();
  for (let i = 0; i < transcripts.MAX + 5; i++) h.log.heard(i, 'line ' + i);
  const all = h.log.entries();
  assert.equal(all.length, transcripts.MAX);
  assert.equal(all[0].said, 'line ' + (transcripts.MAX + 4));
  h.log.clear();
  assert.equal(h.log.entries().length, 0);
});

test('a reused request ID adds to the newest entry with it', () => {
  const h = harness();
  h.log.heard(1, 'old');
  h.log.heard(1, 'new');
  h.log.note(1, 'Sent to Claude', 'done');
  const [newest, older] = h.log.entries();
  assert.equal(newest.outcome, 'done');
  assert.equal(older.outcome, 'working');
});

test('messages to the watch read as steps', () => {
  assert.equal(transcripts.describe({ READY: 1 }), null);
  assert.deepEqual(transcripts.describe({ REQ_ID: 3, CLOCK_KIND: 1, CLOCK_TIME: 300, CLOCK_LABEL: 'tea' }),
    { text: 'Timer set on the watch: tea', outcome: 'done' });
  assert.deepEqual(transcripts.describe({ REQ_ID: 3, RESULT_OK: 0, RESULT_TEXT: "Muse isn't available", RESULT_DETAIL: 'Plugin not running' }),
    { text: "Muse isn't available — Plugin not running", outcome: 'failed' });
});

test('the log exports as CSV and JSON, oldest first', () => {
  const t = require('../src/pkjs/transcripts.js');
  const entries = [
    { t: new Date(2026, 10, 22, 16, 1).getTime(), said: 'Set a timer for 5 minutes', outcome: 'done', steps: [{ ms: 400, text: 'Timer set' }] },
    { t: new Date(2026, 10, 22, 16, 0).getTime(), said: 'Text Sam "hi", ok', outcome: 'failed', steps: [] },
  ];
  const csv = t.toCsv(entries).split('\r\n');
  assert.equal(csv[0], 'time,said,outcome,result,steps');
  assert.equal(csv[1], '2026-11-22 16:00:00,"Text Sam ""hi"", ok",failed,,');
  assert.equal(csv[2], '2026-11-22 16:01:00,Set a timer for 5 minutes,done,Timer set,+0.4s Timer set');
  const json = JSON.parse(t.toJson(entries));
  assert.equal(json[0].said, 'Text Sam "hi", ok');
  assert.deepEqual(json[1].steps, [{ seconds: 0.4, text: 'Timer set' }]);
});
