const test = require('node:test');
const assert = require('node:assert');
const { parse, pickAgent } = require('../src/pkjs/intent.js');

// Tuesday Nov 17 2026, 8:19 AM local.
const NOW = new Date(2026, 10, 17, 8, 19, 0);
const epoch = (d) => Math.round(d.getTime() / 1000);
const at = (day, h, m) => epoch(new Date(2026, 10, day, h, m, 0));

const timers = [
  ['Set a timer for 10 minutes', 600, ''],
  ['set a 10 minute timer', 600, ''],
  ['timer 5 minutes', 300, ''],
  ['Start a timer for an hour and a half', 5400, ''],
  ['set a timer for 1 hour 20 minutes', 4800, ''],
  ['set a timer for two and a half minutes', 150, ''],
  ['timer for half an hour', 1800, ''],
  ['set a timer for 90 seconds', 90, ''],
  ['set a timer for twenty five minutes', 1500, ''],
  ['Set a pasta timer for 12 minutes', 720, 'Pasta'],
  ['set a timer for 12 minutes for the pasta', 720, 'Pasta'],
  ['set a timer for 15 minutes called laundry', 900, 'Laundry'],
  ['set a timer for 1.5 hours', 5400, ''],
  ['set a timer for a couple minutes', 120, ''],
];
for (const [text, seconds, label] of timers) {
  test('timer: ' + text, () => {
    const r = parse(text, NOW);
    assert.equal(r.kind, 'timer');
    assert.equal(r.seconds, seconds);
    assert.equal(r.label, label);
  });
}

const alarms = [
  ['Set an alarm for 6:30 a.m.', at(18, 6, 30)],
  ['set an alarm for 6:30 am tomorrow', at(18, 6, 30)],
  ['wake me up at 7', at(17, 19, 0)],          // next 7 after 8:19 AM is 7 PM
  ['set an alarm for 9', at(17, 9, 0)],        // 9 AM today is next
  ['alarm at 18:45', at(17, 18, 45)],
  ['set an alarm for 5 pm', at(17, 17, 0)],
  ['set an alarm for 5 PM.', at(17, 17, 0)],
  ['set an alarm for seven thirty tomorrow morning', at(18, 7, 30)],
  ['set an alarm for noon', at(17, 12, 0)],
  ['set an alarm for midnight', at(18, 0, 0)],
  ['set an alarm for 630 am', at(18, 6, 30)],
  ['set an alarm for 8 tonight', at(17, 20, 0)],
];
for (const [text, time] of alarms) {
  test('alarm: ' + text, () => {
    const r = parse(text, NOW);
    assert.equal(r.kind, 'alarm', JSON.stringify(r));
    assert.equal(new Date(r.time * 1000).toString(), new Date(time * 1000).toString());
  });
}

test('alarm in 20 minutes', () => {
  const r = parse('set an alarm in 20 minutes', NOW);
  assert.equal(r.kind, 'alarm');
  assert.equal(r.time, epoch(NOW) + 1200);
});

test('alarm label', () => {
  const r = parse('set an alarm for 6 am called gym', NOW);
  assert.equal(r.label, 'Gym');
});

test('cancel', () => {
  assert.deepEqual(parse('cancel my timer', NOW), { kind: 'cancel_timer', label: '' });
  assert.deepEqual(parse('cancel all alarms', NOW), { kind: 'cancel_alarm', label: '' });
  assert.deepEqual(parse('stop the pasta timer', NOW), { kind: 'cancel_timer', label: 'Pasta' });
  assert.deepEqual(parse('turn off my alarm', NOW), { kind: 'cancel_alarm', label: '' });
});

test('list', () => {
  assert.equal(parse('what timers do I have', NOW).kind, 'list');
  assert.equal(parse('show my alarms', NOW).kind, 'list');
  assert.equal(parse('how much time is left on my timer', NOW).kind, 'list');
});

test('unclear', () => {
  assert.equal(parse('set a timer', NOW).kind, 'unclear');
  assert.equal(parse('set an alarm', NOW).kind, 'unclear');
});

test('agent', () => {
  assert.equal(parse('what is the weather like today', NOW).kind, 'agent');
  assert.equal(parse('tell Claude I set an alarm for 6', NOW).kind, 'agent');
  assert.equal(parse('remind me in 10 minutes to check the pool', NOW).kind, 'agent');
  assert.equal(parse('add milk to the grocery list', NOW).kind, 'agent');
  assert.equal(parse('', NOW).kind, 'agent');
});

const AGENTS = [
  { uuid: 'c', name: 'Claude' },
  { uuid: 'm', name: 'Muse' },
  { uuid: 'g', name: 'Grok Bot' },
  { uuid: 'o', name: 'ChatGPT' },
];

test('pick agent', () => {
  assert.deepEqual(pickAgent('Tell Claude to check the build', AGENTS), { agent: AGENTS[0], message: 'Check the build' });
  assert.deepEqual(pickAgent('ask grok what time sunset is', AGENTS), { agent: AGENTS[2], message: 'What time sunset is' });
  assert.deepEqual(pickAgent('ChatGPT, summarize my day', AGENTS), { agent: AGENTS[3], message: 'Summarize my day' });
  assert.deepEqual(pickAgent('Muse add eggs to the list', AGENTS), { agent: AGENTS[1], message: 'Add eggs to the list' });
  assert.equal(pickAgent('what is the weather', AGENTS), null);
  assert.equal(pickAgent('Claude', AGENTS), null);
  assert.equal(pickAgent('Claudette called', AGENTS), null);
});

test('names said right before timer or alarm', () => {
  const now = new Date('2026-11-18T11:00:00-05:00');
  assert.equal(parse('tea timer for 4 minutes', now).label, 'Tea');
  assert.equal(parse('4 minute tea timer', now).label, 'Tea');
  assert.equal(parse('airport alarm at 5', now).label, 'Airport');
  assert.equal(parse('my morning run alarm at 6 am', now).label, 'Morning run');
  assert.equal(parse('set a five minute timer', now).label, '');
  assert.equal(parse('can you set a timer for ten minutes', now).label, '');
});

test('alarms on a weekday', () => {
  const now = new Date(2026, 10, 18, 11, 0, 0); // Wednesday, 11:00 AM
  const when = (text) => parse(text, now);
  // Same weekday, time still ahead: today.
  assert.deepEqual(when('Set Doctor alarm for Wednesday at 1pm'), { kind: 'alarm', time: at(18, 13, 0), label: 'Doctor' });
  // Same weekday, time already gone: next week.
  assert.equal(when('set doctor alarm for wednesday at 9 am').time, at(25, 9, 0));
  // "next" on the same weekday skips today.
  assert.equal(when('next wednesday alarm at 1pm').time, at(25, 13, 0));
  // Later days this week.
  assert.equal(when('set an alarm for friday at 1 pm').time, at(20, 13, 0));
  assert.equal(when('alarm on monday at 6:30 am').time, at(23, 6, 30));
  // No am/pm: 5-11 is morning, the rest afternoon.
  assert.equal(when('wake me up on friday at 6').time, at(20, 6, 0));
  assert.equal(when('alarm for thursday at 3').time, at(19, 15, 0));
  // The weekday is never part of the name.
  assert.deepEqual(when('airport alarm saturday at 5 am'), { kind: 'alarm', time: at(21, 5, 0), label: 'Airport' });
  assert.equal(when('alarm at 1pm on thursday for the dentist').label, 'Dentist');
  assert.equal(when('set an alarm for friday at 7').label, '');
  // A day with no time asks for one.
  assert.equal(when('set an alarm for sunday').kind, 'unclear');
});

test('alarms on a date', () => {
  const now = new Date(2026, 10, 18, 15, 0, 0); // Wednesday Nov 18, 3:00 PM
  const when = (text) => parse(text, now);
  const on = (y, mo, d, h, m) => epoch(new Date(y, mo, d, h, m, 0));
  assert.deepEqual(when('dentist alarm December 3rd at 9am'), { kind: 'alarm', time: on(2026, 11, 3, 9, 0), label: 'Dentist' });
  assert.equal(when('alarm on 12/18 at 7').time, on(2026, 11, 18, 7, 0));
  assert.equal(when('alarm on the third of december at 10 am').time, on(2026, 11, 3, 10, 0));
  assert.equal(when('alarm for december the third at 9').time, on(2026, 11, 3, 9, 0));
  assert.equal(when('alarm for dec twenty first at 7').time, on(2026, 11, 21, 7, 0));
  assert.equal(when('alarm on 3/14/2027 at 6:30 am').time, on(2027, 2, 14, 6, 30));
  assert.equal(when('alarm for dec 3 2027 at 9').time, on(2027, 11, 3, 9, 0));
  // A date that has gone this year means next year.
  assert.equal(when('set an alarm for november 10 at 7').time, on(2027, 10, 10, 7, 0));
  assert.equal(when('airport alarm on january 5th at 4 am').label, 'Airport');
  // Only a day of the month: this month, or next once it's gone.
  assert.equal(when('alarm for the 25th at 8').time, on(2026, 10, 25, 8, 0));
  assert.equal(when('alarm on the 18th at 9 pm').time, on(2026, 10, 18, 21, 0));
  assert.equal(when('set an alarm on the 18th at 9 am').time, on(2026, 11, 18, 9, 0));
  // A weekday said with the date is fine.
  assert.equal(when('set an alarm for wednesday december 2nd at 1pm').time, on(2026, 11, 2, 13, 0));
  // Asks back when something's off.
  assert.equal(when('set an alarm for december 3').reason, 'What time on December 3?');
  assert.equal(when('alarm for february 30 at 7').kind, 'unclear');
  assert.equal(when('alarm for 1/1/2025 at 7').reason, 'That date has already passed.');
});

test('list asks say which list', () => {
  assert.deepEqual(parse('what timers do I have', NOW), { kind: 'list', which: 'timer' });
  assert.deepEqual(parse('show my alarms', NOW), { kind: 'list', which: 'alarm' });
});

test('brand agent aliases add spoken names for an agent', () => {
  const brand = require('../src/pkjs/brand');
  const saved = brand.agentAliases;
  brand.agentAliases = { muse: ['my helper'] };
  try {
    assert.deepEqual(pickAgent('Tell my helper to add eggs', AGENTS), { agent: AGENTS[1], message: 'Add eggs' });
  } finally { brand.agentAliases = saved; }
});

test('the wake word is dropped from the start', () => {
  assert.deepEqual(parse('hey bucky set a timer for 5 minutes', NOW), { kind: 'timer', seconds: 300, label: '' });
  assert.deepEqual(parse('Bucky, pasta timer for 12 minutes', NOW), parse('pasta timer for 12 minutes', NOW));
});
