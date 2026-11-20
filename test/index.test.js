// Drives the phone side with a fake Pebble host.
const test = require('node:test');
const assert = require('node:assert');

function host(plugins, invoke) {
  const listeners = {};
  const sent = [];
  const store = {};
  global.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  };
  global.Pebble = {
    addEventListener: (name, fn) => { listeners[name] = fn; },
    sendAppMessage: (msg, ok) => { sent.push(msg); ok && ok(); },
    enumeratePlugins: () => plugins,
    invokeAction: invoke,
    subscribeToSource: () => ({ unsubscribe() {} }),
    sendConfigMessage: () => {},
  };
  delete require.cache[require.resolve('../src/pkjs/index.js')];
  const mod = require('../src/pkjs/index.js');
  return { listeners, sent, mod, store };
}

const agent = (uuid, name) => ({ uuid, name, sources: [], actions: [{ name: 'send_to_agent' }] });
const PLUGINS = [
  agent('80ee6780-856f-411f-954b-4553ba7f2af8', 'Grok Bot'),
  agent('0d33014e-5d56-42ea-9665-3ebf182b4cfb', 'Claude'),
  agent('b8346592-cd59-4b83-9185-87d94e0734b0', 'Muse'),
  { uuid: 'x', name: 'Hue', sources: [], actions: [{ name: 'toggle' }] },
];
const tick = () => new Promise((r) => setImmediate(r));

test('agents ranked with Claude first, non-agents left out', () => {
  const h = host(PLUGINS, null);
  assert.deepEqual(h.mod.listAgents().map((a) => a.name), ['Claude', 'Muse', 'Grok Bot']);
});

test('timer goes to the watch, not the agent', async () => {
  let called = false;
  const h = host(PLUGINS, () => { called = true; return Promise.resolve({ ok: true }); });
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'set a timer for 10 minutes', REQ_ID: 4 } });
  await tick();
  assert.equal(called, false);
  assert.deepEqual(h.sent.pop(), { REQ_ID: 4, CLOCK_KIND: 1, CLOCK_TIME: 600, CLOCK_LABEL: '' });
});

test('other words go to the chosen agent', async () => {
  let args;
  const h = host(PLUGINS, (a) => { args = a; return Promise.resolve({ ok: true, text: 'Sent' }); });
  h.listeners.configmessage({ data: { type: 'set', agent: 'b8346592-cd59-4b83-9185-87d94e0734b0' }, respond: () => {} });
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'add eggs to the shopping list', REQ_ID: 7 } });
  await tick();
  assert.deepEqual(args, { plugin: 'b8346592-cd59-4b83-9185-87d94e0734b0', action: 'send_to_agent', args: { message: 'add eggs to the shopping list' } });
  const last = h.sent.pop();
  assert.equal(last.RESULT_OK, 1);
  assert.equal(last.RESULT_TEXT, 'Sent to Muse');
  assert.equal(h.sent.pop().RESULT_OK, 2);
});

test('"tell Grok" overrides the default for one message', async () => {
  let args;
  const h = host(PLUGINS, (a) => { args = a; return Promise.resolve({ ok: true }); });
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'Ask Grok what the tide is at Barnegat', REQ_ID: 1 } });
  await tick();
  assert.equal(args.plugin, '80ee6780-856f-411f-954b-4553ba7f2af8');
  assert.equal(args.args.message, 'What the tide is at Barnegat');
});

test('auth errors say what to do and nothing is retried', async () => {
  let calls = 0;
  const h = host(PLUGINS, () => { calls++; return Promise.resolve({ ok: false, code: 'AUTH_REQUIRED' }); });
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'check the build', REQ_ID: 2 } });
  await tick();
  assert.equal(calls, 1);
  const last = h.sent.pop();
  assert.equal(last.RESULT_OK, 0);
  assert.equal(last.RESULT_TEXT, 'Sign in to Claude');
});

test('no agent plugins', async () => {
  const h = host([], () => Promise.resolve({ ok: true }));
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'hello there', REQ_ID: 3 } });
  await tick();
  assert.equal(h.sent.pop().RESULT_TEXT, 'No agent plugin found');
});

test('settings reach the watch on ready', () => {
  const h = host(PLUGINS, null);
  h.listeners.ready();
  const sent = h.sent.pop();
  assert.deepEqual({ ...sent, PROMPTS: undefined }, { AGENT_NAME: 'Claude', CONFIRM: 0, QUICK_TALK: 1, QUIET_LISTEN: 0, VIBE_ALARM: 0, VIBE_TIMER: 0, BG_COLOR: 0, CLOCK_COLOR: 0, PROMPTS: undefined });
  assert.equal(sent.PROMPTS.split('\n')[0], "What's the current weather?");
});

test('picked colours are checked, saved and sent to the watch', () => {
  const h = host(PLUGINS, null);
  h.listeners.ready();
  let state;
  h.listeners.configmessage({ data: { type: 'set', bgColor: 0xF8, clockColor: 300 }, respond: (s) => { state = s; } });
  assert.equal(state.bgColor, 0xF8);
  assert.equal(state.clockColor, 0);
  assert.equal(state.colorWatch, true);
  assert.ok(state.defaultColors.bg >= 192);
  const sent = h.sent.pop();
  assert.equal(sent.BG_COLOR, 0xF8);
  assert.equal(sent.CLOCK_COLOR, 0);
  h.listeners.configmessage({ data: { type: 'set', bgColor: 0, clockColor: 0xFC }, respond: (s) => { state = s; } });
  assert.deepEqual([h.sent.pop().BG_COLOR, state.clockColor], [0, 0xFC]);
});

test('colours outside the 64 Pebble ones mean the default', () => {
  const { cleanColor } = require('../src/pkjs/index.js');
  assert.deepEqual([192, 255, 0, 191, 256, 200.5, 'x', -1, '197'].map(cleanColor), [192, 255, 0, 0, 0, 0, 0, 0, 197]);
});

test('the watch list becomes timeline pins, and old ones come down', () => {
  const h = host(PLUGINS, null);
  const inserted = [];
  const deleted = [];
  Pebble.insertTimelinePin = (p) => inserted.push(p.id);
  Pebble.deleteTimelinePin = (id) => deleted.push(id);
  h.listeners.appmessage({ payload: { PINS: '1\t1763481600\t600\tpasta\n' } });
  assert.deepEqual(inserted, ['bucky-timer-1763481600']);
  h.listeners.appmessage({ payload: { PINS: '' } });
  assert.deepEqual(deleted, ['bucky-timer-1763481600']);
});

test('example prompts: defaults, edits from settings, sent to the watch', () => {
  const h = host(PLUGINS, () => Promise.resolve({ ok: true }));
  const { cleanPrompts, DEFAULT_PROMPTS } = h.mod;
  assert.ok(DEFAULT_PROMPTS.includes("What's the current weather?"));
  assert.ok(DEFAULT_PROMPTS.includes('Set a 5 minute tea timer.'));
  assert.deepEqual(cleanPrompts(['  Hi  ', '', 'x'.repeat(80)]), ['Hi', 'x'.repeat(60)]);
  assert.equal(cleanPrompts(Array.from({ length: 14 }, (_, i) => 'p' + i)).length, 10);
  assert.deepEqual(cleanPrompts(['', ' ']), DEFAULT_PROMPTS);

  h.listeners.ready();
  assert.equal(h.sent[h.sent.length - 1].PROMPTS, DEFAULT_PROMPTS.join('\n'));
  let state;
  h.listeners.configmessage({ data: { type: 'set', prompts: ['Feed the cat?', '', 'Set a 3 minute egg timer.'] }, respond: (s) => { state = s; } });
  assert.deepEqual(state.prompts, ['Feed the cat?', 'Set a 3 minute egg timer.']);
  assert.equal(h.sent[h.sent.length - 1].PROMPTS, 'Feed the cat?\nSet a 3 minute egg timer.');
});

test('default prompts do what they say', () => {
  const { DEFAULT_PROMPTS } = host(PLUGINS, () => Promise.resolve({ ok: true })).mod;
  const { parse } = require('../src/pkjs/intent.js');
  const now = new Date(2026, 10, 18, 15, 0, 0);
  const kinds = DEFAULT_PROMPTS.map((p) => parse(p, now));
  assert.deepEqual(kinds.find((k, i) => DEFAULT_PROMPTS[i].includes('tea')), { kind: 'timer', seconds: 300, label: 'Tea' });
  assert.equal(kinds.find((k, i) => DEFAULT_PROMPTS[i].includes('7am')).time, Math.round(new Date(2026, 10, 19, 7, 0).getTime() / 1000));
  assert.deepEqual(kinds.find((k, i) => DEFAULT_PROMPTS[i].includes('timers')), { kind: 'list', which: 'timer' });
  assert.equal(kinds[0].kind, 'agent');
});

test('find my phone rings the phone through its plugin, not the agent', async () => {
  const calls = [];
  const h = host(PLUGINS, (a) => { calls.push(a); return Promise.resolve({ ok: true }); });
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'Find my phone.', REQ_ID: 9 } });
  await tick();
  assert.deepEqual(calls, [{ plugin: '00000000-0000-0000-0001-000000000008', action: 'ring', args: {} }]);
  const last = h.sent.pop();
  assert.equal(last.RESULT_OK, 1);
  assert.equal(last.RESULT_TEXT, 'Ringing your phone');
  assert.equal(h.sent.pop().RESULT_OK, 2);
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'I found it', REQ_ID: 10 } });
  await tick();
  assert.equal(calls[1].action, 'stop');
});

test('find my phone explains a blocked permission', async () => {
  const h = host(PLUGINS, () => Promise.resolve({ ok: false, code: 'PERMISSION_DENIED' }));
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'where is my phone', REQ_ID: 11 } });
  await tick();
  const last = h.sent.pop();
  assert.equal(last.RESULT_OK, 0);
  assert.match(last.RESULT_TEXT, /Find My Phone/);
});

test('telling an agent to find the phone still goes to the agent', async () => {
  const calls = [];
  const h = host(PLUGINS, (a) => { calls.push(a); return Promise.resolve({ ok: true }); });
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'tell claude to find my phone', REQ_ID: 12 } });
  await tick();
  assert.equal(calls[0].action, 'send_to_agent');
});

test('weather asks read the weather source and send a reply', async () => {
  let request;
  const h = host(PLUGINS, () => { throw new Error('no agent'); });
  global.Pebble.subscribeToSource = (r) => {
    request = r;
    setImmediate(() => r.onData({ instances: [{ properties: {
      temperature: { shortText: { text: '52°F' } }, condition: { shortText: { text: 'Sunny' } } } }] }));
    return { unsubscribe() {} };
  };
  h.listeners.appmessage({ payload: { TRANSCRIPT: "What's the current weather?", REQ_ID: 20 } });
  await tick(); await tick(); await new Promise((r) => setTimeout(r, 5));
  assert.equal(request.category, 'weather');
  assert.equal(request.plugin, undefined);
  const last = h.sent.pop();
  assert.equal(last.RESULT_OK, 1);
  assert.equal(last.RESULT_TEXT, '52°, Sunny');
  assert.ok(typeof last.REPLY === 'string');
});

test('weather from a provider picked in settings, and errors explained', async () => {
  let request;
  const h = host(PLUGINS, () => Promise.resolve({ ok: true }));
  global.Pebble.subscribeToSource = (r) => {
    request = r;
    setImmediate(() => r.onError({ code: 'PLUGIN_UNAVAILABLE' }));
    return { unsubscribe() {} };
  };
  h.listeners.configmessage({ data: { type: 'set', weather: 'met-uuid' }, respond: () => {} });
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'will it rain tomorrow', REQ_ID: 21 } });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(request.plugin, 'met-uuid');
  const last = h.sent.pop();
  assert.equal(last.RESULT_OK, 0);
  assert.equal(last.RESULT_TEXT, 'No weather provider');
});

test('battery asks read the Phone plugin and reply', async () => {
  let request;
  const h = host(PLUGINS, () => { throw new Error('no agent'); });
  global.Pebble.subscribeToSource = (r) => {
    request = r;
    setImmediate(() => r.onData({ instances: [{ properties: { battery_level: { numericValue: { value: 81 } } } }] }));
    return { unsubscribe() {} };
  };
  h.listeners.appmessage({ payload: { TRANSCRIPT: "What's my battery level?", REQ_ID: 30 } });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(request.category, 'phone');
  assert.equal(request.plugin, '00000000-0000-0000-0001-000000000001');
  const last = h.sent.pop();
  assert.equal(last.RESULT_TEXT, 'Phone at 81%');
  assert.equal(last.RESULT_OK, 1);
});

const CHAT_PLUGIN = { uuid: '8197c57a-59c8-493e-9db1-eaab2988d010', name: 'Chat', sources: [], actions: [
  { name: 'send_message', parameters: { type: 'object', properties: { recipient: {}, text: {}, operation_id: {}, chat_id: {} } } },
  { name: 'list_chats', parameters: { type: 'object', properties: {} } },
] };

test('a text waits on the watch for Select, then goes to the chat plugin with the alias resolved', async () => {
  const calls = [];
  const h = host(PLUGINS.concat([CHAT_PLUGIN]), (a) => { calls.push(a); return Promise.resolve({ ok: true, text: 'Sent to Sam' }); });
  h.listeners.configmessage({ data: { type: 'set', aliases: 'Sam = Samantha, wife' }, respond: () => {} });
  h.listeners.appmessage({ payload: { TRANSCRIPT: "Tell my wife I'm going to be late", REQ_ID: 21 } });
  await tick();
  assert.equal(calls.length, 0);
  assert.deepEqual(h.sent.pop(), { REQ_ID: 21, RESULT_OK: 3, RESULT_TEXT: 'Send to Sam?', RESULT_DETAIL: '', REPLY: "I'm going to be late" });
  h.listeners.appmessage({ payload: { CONFIRM_SEND: 21 } });
  await tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].plugin, CHAT_PLUGIN.uuid);
  assert.equal(calls[0].action, 'send_message');
  assert.equal(calls[0].args.recipient, 'Sam');
  assert.equal(calls[0].args.text, "I'm going to be late");
  assert.match(calls[0].args.operation_id, /^bucky-/);
  assert.equal(h.sent.pop().RESULT_TEXT, 'Sent to Sam');
});

test('a confirm for an unknown request sends nothing', async () => {
  const calls = [];
  const h = host(PLUGINS.concat([CHAT_PLUGIN]), (a) => { calls.push(a); return Promise.resolve({ ok: true }); });
  h.listeners.appmessage({ payload: { CONFIRM_SEND: 99 } });
  await tick();
  assert.equal(calls.length, 0);
  assert.equal(h.sent.pop().RESULT_OK, 0);
});

test('with messages turned off, "text" goes to the agent', async () => {
  const calls = [];
  const h = host(PLUGINS.concat([CHAT_PLUGIN]), (a) => { calls.push(a); return Promise.resolve({ ok: true }); });
  h.listeners.configmessage({ data: { type: 'set', features: { messages: false } }, respond: () => {} });
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'text Samantha hi', REQ_ID: 5 } });
  await tick();
  assert.equal(calls[0].action, 'send_to_agent');
});

test('no messaging plugin: "text" goes to the agent', async () => {
  const calls = [];
  const h = host(PLUGINS, (a) => { calls.push(a); return Promise.resolve({ ok: true }); });
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'text Samantha hi', REQ_ID: 6 } });
  await tick();
  assert.equal(calls[0].action, 'send_to_agent');
});

test('a chat plugin error about several chats is turned into a short question', async () => {
  const h = host(PLUGINS.concat([CHAT_PLUGIN]), () => Promise.resolve({ ok: false, code: 'CHAT_SEND_FAILED',
    message: 'Several allowed chats match. Ask which chat to use: Sam (Beeper, Signal; chat:a) ; Sam Lee (iMessage, iMessage; chat:b)' }));
  h.listeners.configmessage({ data: { type: 'set', checkMessages: false }, respond: () => {} });
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'text Sam hello', REQ_ID: 8 } });
  await tick(); await tick();
  const last = h.sent.pop();
  assert.equal(last.RESULT_TEXT, 'Which chat?');
  assert.ok(!/chat:/.test(last.RESULT_DETAIL));
});

test('music words call the Music plugin with a real boolean', async () => {
  const calls = [];
  const h = host(PLUGINS, (a) => { calls.push(a); return Promise.resolve({ ok: true }); });
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'pause the music', REQ_ID: 9 } });
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'skip this song', REQ_ID: 10 } });
  await tick();
  assert.deepEqual(calls[0], { plugin: '00000000-0000-0000-0001-000000000003', action: 'set_playing', args: { on: false } });
  assert.equal(calls[1].action, 'next_track');
});

test('"launch workout" finds the app and opens it', async () => {
  const calls = [];
  const h = host(PLUGINS, (a) => { calls.push(a); return Promise.resolve({ ok: true }); });
  Pebble.subscribeToSource = (req) => {
    setImmediate(() => req.onData({ instances: [
      { instanceId: 'fef82c82-7176-4e22-88de-35a3fc18d43f', properties: { name: { shortText: { text: 'Workout' } }, type: { shortText: { text: 'watchapp' } } } },
      { instanceId: 'u2', properties: { name: { shortText: { text: 'Weather' } }, type: { shortText: { text: 'watchapp' } } } },
    ] }));
    return { unsubscribe() {} };
  };
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'launch workout', REQ_ID: 11 } });
  await tick(); await tick(); await tick();
  assert.deepEqual(calls[0], { plugin: '00000000-0000-0000-0001-000000000007', action: 'launch_app', args: { uuid: 'fef82c82-7176-4e22-88de-35a3fc18d43f' } });
});

test('"open the garage door" with no such app goes to the agent', async () => {
  const calls = [];
  const h = host(PLUGINS, (a) => { calls.push(a); return Promise.resolve({ ok: true }); });
  Pebble.subscribeToSource = (req) => { setImmediate(() => req.onData({ instances: [] })); return { unsubscribe() {} }; };
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'open the garage door', REQ_ID: 12 } });
  await tick(); await tick(); await tick();
  assert.equal(calls[0].action, 'send_to_agent');
});

test('settings page round-trips features, aliases and vibration', () => {
  const h = host(PLUGINS.concat([CHAT_PLUGIN]), null);
  let state;
  h.listeners.configmessage({ data: { type: 'set', features: { music: false }, aliases: 'Sam = Samantha ,wife\nnot a line', vibeAlarm: 1, vibeTimer: 9 }, respond: (s) => { state = s; } });
  assert.equal(state.features.music, false);
  assert.equal(state.features.weather, true);
  assert.equal(state.aliases, 'Sam = Samantha, wife');
  assert.equal(state.vibeAlarm, 1);
  assert.equal(state.vibeTimer, 0);
  assert.deepEqual(state.messengers, [{ uuid: CHAT_PLUGIN.uuid, name: 'Chat' }]);
  assert.equal(state.checkMessages, true);
});

// The Index app's plugins, as the Pebble app lists them (actions are the Index agent's tools).
const idx = (n, name, actions) => ({ uuid: '00000000-0000-0000-0002-00000000000' + n, name, sources: [],
  actions: actions.map(([a, props]) => ({ name: a, parameters: { type: 'object', properties: props } })) });
const INDEX_PLUGINS = [
  idx(1, 'Timers & Alarms (Index)', [['set_alarm', { time_hours: {}, time_minutes: {}, label: {} }], ['set_timer', { time_human: {} }]]),
  idx(2, 'Beeper (Index)', [['send_instant_message', { contact_name: {}, text: {}, room_id: {} }]]),
  idx(3, 'Notes (Index)', [['create_note', { text: {}, automatic: {}, destination: {} }]]),
  idx(4, 'Reminders (Index)', [['create_reminder', { date_time_human: {}, duration_human: {}, message: {} }], ['create_list_item', { list_name: {}, message: {} }]]),
];

test('Beeper (Index) counts as a messenger, ahead of Chat, and gets its own action and arguments', async () => {
  const calls = [];
  const h = host(PLUGINS.concat([CHAT_PLUGIN], INDEX_PLUGINS), (a) => { calls.push(a); return Promise.resolve({ ok: true, text: 'Sent to Sam' }); });
  let state;
  h.listeners.configmessage({ data: { type: 'state' }, respond: (s) => { state = s; } });
  assert.deepEqual(state.messengers.map((m) => m.name), ['Beeper (Index)', 'Chat']);
  h.listeners.configmessage({ data: { type: 'set', aliases: 'Sam = Samantha, wife' }, respond: () => {} });
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'text Samantha on my way', REQ_ID: 40 } });
  h.listeners.appmessage({ payload: { CONFIRM_SEND: 40 } });
  await tick();
  assert.deepEqual(calls[0], { plugin: '00000000-0000-0000-0002-000000000002', action: 'send_instant_message', args: { contact_name: 'Sam', text: 'On my way' } });
});

test('Beeper (Index) refusing a contact it has not approved says so', async () => {
  const h = host(PLUGINS.concat(INDEX_PLUGINS), () => Promise.resolve({ ok: false, code: 'PERMISSION_DENIED', message: 'send_instant_message needs the user\'s confirmation, which only the Index agent can ask for' }));
  h.listeners.configmessage({ data: { type: 'set', checkMessages: false }, respond: () => {} });
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'text Dave see you soon', REQ_ID: 41 } });
  await tick(); await tick();
  assert.equal(h.sent.pop().RESULT_TEXT, 'Not an approved contact');
});

test('notes, reminders and list items go to the Index plugins', async () => {
  const calls = [];
  const h = host(PLUGINS.concat(INDEX_PLUGINS), (a) => { calls.push(a); return Promise.resolve({ ok: true }); });
  h.listeners.configmessage({ data: { type: 'set', reminderPlugin: '00000000-0000-0000-0002-000000000004' }, respond: () => {} });
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'take a note the garage code changed', REQ_ID: 42 } });
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'remind me to call Mom tomorrow at 9', REQ_ID: 43 } });
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'add eggs to my shopping list', REQ_ID: 44 } });
  await tick();
  assert.deepEqual(calls.map((c) => [c.action, c.args]), [
    ['create_note', { text: 'The garage code changed' }],
    ['create_reminder', { message: 'Call Mom', date_time_human: 'tomorrow at 9' }],
    ['create_list_item', { list_name: 'shopping', message: 'Eggs' }],
  ]);
  assert.equal(h.sent.pop().RESULT_TEXT, 'Added to shopping');
});

test('without Index, or with the checkbox off, reminders go to the agent', async () => {
  const calls = [];
  const h = host(PLUGINS.concat(INDEX_PLUGINS), (a) => { calls.push(a); return Promise.resolve({ ok: true }); });
  h.listeners.configmessage({ data: { type: 'set', features: { reminders: false } }, respond: () => {} });
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'remind me to call Mom', REQ_ID: 45 } });
  await tick();
  assert.equal(calls[0].action, 'send_to_agent');
  const h2 = host(PLUGINS, (a) => { calls.push(a); return Promise.resolve({ ok: true }); });
  h2.listeners.appmessage({ payload: { TRANSCRIPT: 'take a note buy filters', REQ_ID: 46 } });
  await tick();
  assert.equal(calls[1].action, 'send_to_agent');
});

test('timers and near alarms ring on the phone when settings say so; far alarms stay on the watch', async () => {
  const calls = [];
  const h = host(PLUGINS.concat(INDEX_PLUGINS), (a) => { calls.push(a); return Promise.resolve({ ok: true }); });
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'set a timer for 90 minutes', REQ_ID: 47 } });
  await tick();
  assert.equal(calls.length, 0);  // the watch is the default
  assert.equal(h.sent.pop().CLOCK_KIND, 1);
  h.listeners.configmessage({ data: { type: 'set', clockOn: 'phone' }, respond: () => {} });
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'set a timer for 90 minutes', REQ_ID: 48 } });
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'set an alarm in 2 hours', REQ_ID: 49 } });
  await tick();
  assert.deepEqual(calls[0], { plugin: '00000000-0000-0000-0002-000000000001', action: 'set_timer', args: { time_human: '1 hour and 30 minutes' } });
  assert.equal(calls[1].action, 'set_alarm');
  const at = new Date(Date.now() + 2 * 3600 * 1000);
  assert.equal(calls[1].args.time_hours, at.getHours());
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'dentist alarm December 3rd at 9am', REQ_ID: 50 } });
  await tick();
  assert.equal(calls.length, 2);
  assert.equal(h.sent.pop().CLOCK_KIND, 2);
});

const store = (uuid, name, actions) => ({ uuid, name, sources: [], actions });
const TODOIST = store('0d520cba-326c-4a22-a269-d1ab1ae38977', 'Todoist', [{ name: 'create_reminder', targets: ['reminders/list'],
  parameters: { type: 'object', properties: { title: {}, due_iso: {}, timezone: {}, notify_before_ms: {}, instanceId: {} } } }]);
const APPLE_NOTES = store('04a1a397-7447-4d81-a378-3508ca0de95c', 'Apple Notes', [{ name: 'create_note', targets: ['notes/destination'],
  parameters: { type: 'object', properties: { instanceId: {}, text: {} } } }]);

test('settings list the installed note and reminder plugins, Index first, and use the one picked', async () => {
  const calls = [];
  const h = host(PLUGINS.concat([TODOIST, APPLE_NOTES], INDEX_PLUGINS), (a) => { calls.push(a); return Promise.resolve({ ok: true }); });
  let state;
  h.listeners.configmessage({ data: { type: 'state' }, respond: (s) => { state = s; } });
  assert.deepEqual(state.notePlugins.map((p) => p.name), ['Notes (Index)', 'Apple Notes']);
  assert.deepEqual(state.reminderPlugins.map((p) => p.name), ['On the watch', 'Reminders (Index)', 'Todoist']);
  assert.equal(state.reminderPlugin, 'watch');
  assert.deepEqual(state.listPlugins.map((p) => p.name), ['Reminders (Index)', 'Todoist']);
  assert.equal(state.listPlugin, '00000000-0000-0000-0002-000000000004');
  h.listeners.configmessage({ data: { type: 'set', notePlugin: APPLE_NOTES.uuid, reminderPlugin: TODOIST.uuid }, respond: () => {} });
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'note to self buy filters', REQ_ID: 60 } });
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'remind me to call Mom in 2 hours', REQ_ID: 61 } });
  await tick();
  assert.deepEqual(calls[0], { plugin: APPLE_NOTES.uuid, action: 'create_note', args: { text: 'Buy filters' } });
  assert.equal(calls[1].plugin, TODOIST.uuid);
  assert.equal(calls[1].args.title, 'Call Mom');
  const due = new Date(calls[1].args.due_iso);
  assert.ok(Math.abs(due.getTime() - (Date.now() + 2 * 3600 * 1000)) < 61000);
  assert.match(calls[1].args.due_iso, /T\d\d:\d\d:00[+-]\d\d:\d\d$/);
});

test('a list item for a store plugin goes into the list of that name', async () => {
  const calls = [];
  const h = host(PLUGINS.concat([TODOIST]), (a) => { calls.push(a); return Promise.resolve({ ok: true }); });
  Pebble.subscribeToSource = (cfg) => {
    setImmediate(() => cfg.onData({ instances: [
      { instanceId: 'inbox', properties: { name: { shortText: { text: 'Inbox' } } } },
      { instanceId: 'groc', properties: { name: { shortText: { text: 'Groceries' } } } },
    ] }));
    return { unsubscribe() {} };
  };
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'add eggs to my grocery list', REQ_ID: 62 } });
  await tick(); await tick(); await tick();
  assert.deepEqual(calls[0], { plugin: TODOIST.uuid, action: 'create_reminder', args: { title: 'Eggs', instanceId: 'groc' } });
  assert.equal(h.sent.pop().RESULT_TEXT, 'Added to Groceries');
});

test('a reminder time the app cannot read is asked about, not guessed', async () => {
  const calls = [];
  const h = host(PLUGINS.concat([TODOIST]), (a) => { calls.push(a); return Promise.resolve({ ok: true }); });
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'remind me to water the plants on the 45th', REQ_ID: 63 } });
  await tick();
  assert.equal(calls.length, 0);
  assert.equal(h.sent.pop().RESULT_TEXT, 'When is that?');
});

test('"tell X" reaches someone texted before, even without an alias, and can be forgotten', async () => {
  const calls = [];
  const h = host(PLUGINS.concat(INDEX_PLUGINS), (a) => {
    calls.push(a);
    return Promise.resolve(a.action === 'send_instant_message' ? { ok: true, text: 'Sent to Alex Smith' } : { ok: true });
  });
  h.listeners.configmessage({ data: { type: 'set', checkMessages: false }, respond: () => {} });
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'tell Alex I am on my way', REQ_ID: 70 } });
  await tick(); await tick();
  assert.equal(calls[0].action, 'send_to_agent');
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'text Alex running late', REQ_ID: 71 } });
  await tick(); await tick();
  assert.deepEqual(calls[1].args, { contact_name: 'Alex', text: 'Running late' });
  let state;
  h.listeners.configmessage({ data: { type: 'state' }, respond: (s) => { state = s; } });
  assert.deepEqual(state.knownContacts, ['Alex Smith', 'Alex']);
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'tell Alex I am on my way', REQ_ID: 72 } });
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'let Alex Smith know dinner is ready', REQ_ID: 73 } });
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'tell me a joke', REQ_ID: 74 } });
  await tick(); await tick();
  assert.deepEqual(calls.slice(2).map((c) => [c.action, c.args.contact_name, c.args.text]), [
    ['send_instant_message', 'Alex', 'I am on my way'],
    ['send_instant_message', 'Alex Smith', 'Dinner is ready'],
    ['send_to_agent', undefined, undefined],
  ]);
  h.listeners.configmessage({ data: { type: 'set', forgetContacts: true }, respond: (s) => { state = s; } });
  h.listeners.configmessage({ data: { type: 'state' }, respond: (s) => { state = s; } });
  assert.deepEqual(state.knownContacts, []);
});

test('a failed send teaches the app nothing', async () => {
  const h = host(PLUGINS.concat(INDEX_PLUGINS), () => Promise.resolve({ ok: false, code: 'INVALID_ARGS', message: "No contacts match 'Dave'" }));
  h.listeners.configmessage({ data: { type: 'set', checkMessages: false }, respond: () => {} });
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'text Dave see you soon', REQ_ID: 75 } });
  await tick(); await tick();
  let state;
  h.listeners.configmessage({ data: { type: 'state' }, respond: (s) => { state = s; } });
  assert.deepEqual(state.knownContacts, []);
});

test('listening: Quiet Time off in settings answers at once; on, it switches the watch settings first', async () => {
  const calls = [];
  const h = host(PLUGINS, (a) => { calls.push(a); return Promise.resolve({ ok: true }); });
  h.listeners.appmessage({ payload: { LISTEN: 1 } });
  await tick();
  assert.deepEqual(h.sent.pop(), { LISTEN_READY: 1 });
  assert.equal(calls.length, 0);

  global.Pebble.subscribeToSource = (config) => {
    setImmediate(() => config.onData({ instances: config.item === 'switch_setting'
      ? [{ instanceId: 'dndManuallyEnabled', properties: { value: { boolean: { value: false } } } }]
      : [{ instanceId: 'dndShowNotifications', properties: { value: { shortText: { text: 'Show' } } } }] }));
    return { unsubscribe() {} };
  };
  h.listeners.configmessage({ data: { type: 'set', quietListen: true }, respond: () => {} });
  assert.equal(h.sent.pop().QUIET_LISTEN, 1);
  h.listeners.appmessage({ payload: { LISTEN: 1 } });
  for (let i = 0; i < 5; i++) await tick();
  assert.deepEqual(h.sent.pop(), { LISTEN_READY: 1 });
  assert.deepEqual(calls.map((c) => [c.plugin, c.action, c.args]), [
    ['00000000-0000-0000-0001-000000000006', 'set_on', { instanceId: 'dndManuallyEnabled', on: true }],
    ['00000000-0000-0000-0001-000000000006', 'set_value', { instanceId: 'dndShowNotifications', value: 'Hide' }],
  ]);
  h.listeners.appmessage({ payload: { LISTEN: 0 } });
  for (let i = 0; i < 5; i++) await tick();
  assert.deepEqual(calls.slice(2).map((c) => c.args), [
    { instanceId: 'dndManuallyEnabled', on: false },
    { instanceId: 'dndShowNotifications', value: 'Show' },
  ]);
});

// The Google Messages plugin (pebble-gmessages-plugin): sends like any messaging plugin and
// shares the names of recent chats through a messaging "chats" source.
const GMESSAGES = { uuid: '5dea7cb5-e0f9-4cf2-9842-cca28b0fa6d7', name: 'Google Messages',
  sources: [{ category: 'messaging', items: ['chats'] }],
  actions: [{ name: 'send_message', parameters: { type: 'object', properties: { recipient: {}, text: {}, chat_id: {} } } }] };

test('Google Messages plugin: recent chat names make "tell X" work, and its errors read well', async () => {
  const calls = [];
  let answer = { ok: true, text: 'Sent to Alex Smith.' };
  const h = host(PLUGINS.concat([GMESSAGES]), (a) => { calls.push(a); return Promise.resolve(answer); });
  Pebble.subscribeToSource = (config) => {
    setImmediate(() => {
      if (config.plugin === GMESSAGES.uuid && config.item === 'chats') {
        config.onData({ instances: [{ instanceId: '1', properties: { name: { shortText: { text: 'Alex Smith' } } } }] });
      } else config.onError({ code: 'NO_DATA' });
    });
    return { unsubscribe() {} };
  };
  let state;
  h.listeners.configmessage({ data: { type: 'state' }, respond: (s) => { state = s; } });
  assert.deepEqual(state.messengers, [{ uuid: GMESSAGES.uuid, name: 'Google Messages' }]);
  h.listeners.ready({});
  await tick(); await tick();
  assert.deepEqual(JSON.parse(h.store.chatNames).names, ['Alex Smith']);

  h.listeners.appmessage({ payload: { TRANSCRIPT: "tell Alex Smith dinner's ready", REQ_ID: 60 } });
  h.listeners.appmessage({ payload: { CONFIRM_SEND: 60 } });
  await tick();
  assert.equal(calls[0].plugin, GMESSAGES.uuid);
  assert.equal(calls[0].args.recipient, 'Alex Smith');

  answer = { ok: false, code: 'PLUGIN_UNAVAILABLE', message: "The bridge isn't paired with Google Messages. Pair it again on your server." };
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'text Alex Smith hi', REQ_ID: 61 } });
  h.listeners.appmessage({ payload: { CONFIRM_SEND: 61 } });
  await tick();
  const last = h.sent.filter((m) => m.REQ_ID === 61).pop();
  assert.equal(last.RESULT_OK, 0);
  assert.equal(last.RESULT_TEXT, 'Bridge not paired');
});

test('"isn\'t available" is retried twice (3 tries), then explained with the reason', async () => {
  let calls = 0;
  const h = host(PLUGINS, () => { calls++; return Promise.resolve({ ok: false, code: 'PLUGIN_UNAVAILABLE', message: 'plugin is restarting' }); });
  h.mod.AGENT_RETRY.delayMs = 1;
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'check the build', REQ_ID: 3 } });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(calls, 3);
  const last = h.sent.pop();
  assert.equal(last.RESULT_OK, 0);
  assert.equal(last.RESULT_TEXT, "Claude isn't available");
  assert.equal(last.RESULT_DETAIL, 'plugin is restarting');
  assert.equal(h.sent.pop().RESULT_TEXT, 'Retrying Claude (2 of 2)...');
});

test('a retry that gets through reports sent', async () => {
  let calls = 0;
  const h = host(PLUGINS, () => { calls++; return Promise.resolve(calls < 3 ? { ok: false, code: 'PLUGIN_UNAVAILABLE' } : { ok: true }); });
  h.mod.AGENT_RETRY.delayMs = 1;
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'check the build', REQ_ID: 5 } });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(calls, 3);
  assert.equal(h.sent.pop().RESULT_TEXT, 'Sent to Claude');
});

test('a timeout is never retried', async () => {
  let calls = 0;
  const h = host(PLUGINS, () => { calls++; return Promise.resolve({ ok: false, code: 'TIMEOUT' }); });
  h.mod.AGENT_RETRY.delayMs = 1;
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'check the build', REQ_ID: 6 } });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls, 1);
});


test('reminders ring on the watch unless a plugin is picked', async () => {
  const calls = [];
  const h = host(PLUGINS.concat(INDEX_PLUGINS), (a) => { calls.push(a); return Promise.resolve({ ok: true }); });
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'remind me to call Mom in 2 hours', REQ_ID: 70 } });
  await tick();
  assert.equal(calls.length, 0);
  const msg = h.sent.pop();
  assert.equal(msg.CLOCK_KIND, 6);
  assert.equal(msg.CLOCK_LABEL, 'Call Mom');
  assert.ok(Math.abs(msg.CLOCK_TIME * 1000 - (Date.now() + 2 * 3600 * 1000)) < 61000);
});

test('a watch reminder with no time asks when', async () => {
  const h = host(PLUGINS, () => Promise.resolve({ ok: true }));
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'remind me to call Mom', REQ_ID: 71 } });
  await tick();
  const msg = h.sent.pop();
  assert.equal(msg.RESULT_OK, 0);
  assert.equal(msg.RESULT_TEXT, 'When is that?');
});

test('listing and cancelling reminders work on the watch, and go to the agent with a plugin picked', async () => {
  const calls = [];
  const h = host(PLUGINS.concat(INDEX_PLUGINS), (a) => { calls.push(a); return Promise.resolve({ ok: true }); });
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'what reminders do I have', REQ_ID: 72 } });
  await tick();
  assert.deepEqual(h.sent.pop(), { REQ_ID: 72, CLOCK_KIND: 5, CLOCK_TIME: 3, CLOCK_LABEL: '' });
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'cancel the dentist reminder', REQ_ID: 73 } });
  await tick();
  assert.deepEqual(h.sent.pop(), { REQ_ID: 73, CLOCK_KIND: 7, CLOCK_TIME: 0, CLOCK_LABEL: 'Dentist' });
  h.listeners.configmessage({ data: { type: 'set', reminderPlugin: '00000000-0000-0000-0002-000000000004' }, respond: () => {} });
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'what reminders do I have', REQ_ID: 74 } });
  await tick();
  assert.equal(calls[0].action, 'send_to_agent');
});

test('lists can go to a different plugin than reminders', async () => {
  const calls = [];
  const h = host(PLUGINS.concat([TODOIST], INDEX_PLUGINS), (a) => { calls.push(a); return Promise.resolve({ ok: true }); });
  h.listeners.configmessage({ data: { type: 'set', reminderPlugin: TODOIST.uuid, listPlugin: '00000000-0000-0000-0002-000000000004' }, respond: () => {} });
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'add eggs to my shopping list', REQ_ID: 75 } });
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'remind me to call Mom in 2 hours', REQ_ID: 76 } });
  await tick();
  assert.deepEqual(calls[0], { plugin: '00000000-0000-0000-0002-000000000004', action: 'create_list_item', args: { list_name: 'shopping', message: 'Eggs' } });
  assert.equal(calls[1].plugin, TODOIST.uuid);
});

test('lists turned off go to the agent, reminders still ring on the watch', async () => {
  const calls = [];
  const h = host(PLUGINS.concat(INDEX_PLUGINS), (a) => { calls.push(a); return Promise.resolve({ ok: true }); });
  h.listeners.configmessage({ data: { type: 'set', features: { lists: false } }, respond: () => {} });
  h.listeners.appmessage({ payload: { TRANSCRIPT: 'add eggs to my shopping list', REQ_ID: 77 } });
  await tick();
  assert.equal(calls[0].action, 'send_to_agent');
});
