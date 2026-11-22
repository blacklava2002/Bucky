const test = require('node:test');
const assert = require('node:assert');
const m = require('../src/pkjs/messages');

const aliases = m.parseAliases('Sam = Samantha, wife\nMom = Mother, ma').aliases;

test('aliases turn spoken names into the contact name', () => {
  assert.deepEqual(m.ask("text Samantha I'm going to be late", aliases),
    { recipient: 'Sam', spoken: 'Samantha', body: "I'm going to be late", known: true });
  assert.equal(m.ask("tell my wife I'm going to be late", aliases).recipient, 'Sam');
  assert.equal(m.ask("let my wife know I'm on my way", aliases).body, "I'm on my way");
  assert.equal(m.ask('send a message to Mother saying call me back', aliases).recipient, 'Mom');
  assert.equal(m.ask('send my wife a text that I left', aliases).body, 'I left');
});

test('"tell" only sends to names in the alias list', () => {
  assert.equal(m.ask('tell me a joke', aliases), null);
  assert.equal(m.ask('tell Claude to buy milk', aliases), null);
  assert.equal(m.ask('let me know when it rains', aliases), null);
});

test('unknown names are guessed and shown before sending', () => {
  assert.deepEqual(m.ask('text Jordan see you soon', aliases), { recipient: 'Jordan', spoken: 'Jordan', body: 'See you soon', known: false });
  assert.equal(m.ask('send a text to Jordan Lee saying running late', aliases).recipient, 'Jordan Lee');
  assert.equal(m.ask('text 555 123 4567 hello', aliases).recipient, '5551234567');
  assert.equal(m.ask('text Sam', aliases).body, '');
});

test('bad alias lines are dropped', () => {
  assert.deepEqual(m.parseAliases('no equals here\n = x\nA =\nDad = Pops').lines, ['Dad = Pops']);
});

test('providers: Beeper first, then Chat; params read from the schema', () => {
  const list = m.providers([
    { uuid: 'other', name: 'Other', actions: [{ name: 'send_message', parameters: { properties: { to: {}, body: {} } } }] },
    { uuid: m.CHAT, name: 'Chat', actions: [{ name: 'send_message', parameters: { properties: { recipient: {}, text: {}, operation_id: {} } } }] },
    { uuid: 'b', name: 'Beeper', actions: [{ name: 'send_message', parameters: { properties: { recipient: {}, text: {} } } }] },
    { uuid: 'claude', name: 'Claude', actions: [{ name: 'send_to_agent' }] },
  ]);
  assert.deepEqual(list.map((p) => p.name), ['Beeper', 'Chat', 'Other']);
  assert.deepEqual(m.args(list[2], 'Sam', 'Hi', 'op'), { to: 'Sam', body: 'Hi' });
  assert.deepEqual(m.args(list[1], 'Sam', 'Hi', 'op'), { recipient: 'Sam', text: 'Hi', operation_id: 'op' });
  assert.equal(m.choose(list, 'other').name, 'Other');
  assert.equal(m.choose(list, 'gone').name, 'Beeper');
});

test('explainKnown turns Google Messages plugin errors into watch text', () => {
  const m = require('../src/pkjs/messages');
  assert.deepEqual(m.explainKnown('More than one chat matches: Alex Smith, Alex Jones. Say the full name.'),
    ['Which chat?', "More than one matches: Alex Smith, Alex Jones. Say the full name, or add an alias in Bucky's settings."]);
  assert.equal(m.explainKnown('Not sure it sent. Check the chat on your phone before sending again.')[0], 'Not sure it sent');
  assert.equal(m.explainKnown("Couldn't reach the bridge, so it wasn't sent. Check the address.")[0], 'Bridge unreachable');
  assert.equal(m.explainKnown("The bridge didn't accept the token. Copy BRIDGE_TOKEN.")[0], 'Wrong bridge token');
  assert.equal(m.explainKnown('Something else'), null);
  assert.deepEqual(m.chatNames([{ properties: { name: { shortText: { text: 'Alex' } } } }, { properties: { name: { shortText: { text: 'alex' } } } }, {}]), ['Alex']);
});

test('"ask" sends to known names, with or without a colon', () => {
  assert.deepEqual(m.ask('Ask Samantha: what time is dinner', aliases),
    { recipient: 'Sam', spoken: 'Samantha', body: 'What time is dinner?', known: true });
  assert.equal(m.ask('ask my wife to grab milk.', aliases).body, 'Can you grab milk?');
  assert.equal(m.ask('Ask Mom if she wants pizza', aliases).recipient, 'Mom');
  assert.equal(m.ask('ask what the weather is', aliases), null);
  assert.equal(m.ask('ask Claude what the weather is', aliases), null);
});

test('a colon after the name is not part of it', () => {
  assert.equal(m.ask('Text Jordan: on my way.', aliases).recipient, 'Jordan');
  assert.equal(m.ask('Tell Samantha: I am late.', aliases).spoken, 'Samantha');
  assert.equal(m.ask('text Jordan are you home?', aliases).body, 'Are you home?');
});
