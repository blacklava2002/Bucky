// "text Samantha I'm on my way", "send a message to Mom saying ...", "tell my wife I'll be late".
// The words go straight to a messaging plugin's send_message action (the Chat plugin covers Beeper,
// iMessage, WhatsApp, Telegram and SMS) instead of the agent. Aliases from settings turn the
// names you say ("Samantha", "my wife") into the contact name the plugin knows ("Sam").
// The plugin only sends to chats you've allowed in its own settings.

var brand = require('./brand');

var CHAT = '8197c57a-59c8-493e-9db1-eaab2988d010';  // "Chat", from the Pebble plugin store
var BEEPER_INDEX = '00000000-0000-0000-0002-000000000002';  // "Beeper (Index)", added by the Index app
// Chat and most messengers call it send_message; Beeper (Index) calls it send_instant_message.
var SEND_ACTIONS = ['send_message', 'send_instant_message'];

var LEAD = new RegExp('^(?:(?:ok|okay|hey|hi|' + brand.wake + '|please|can you|could you|would you|will you)[,\\s]+)*', 'i');

function clean(text) {
  return String(text || '').replace(/[’]/g, "'").replace(/\s+/g, ' ').trim();
}

function key(name) {
  return String(name || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// "Sam = Samantha, wife" lines -> { contacts: ['Sam'], aliases: { samantha: 'Sam', wife: 'Sam' } }.
function parseAliases(text) {
  var out = { contacts: [], aliases: {}, lines: [] };
  String(text || '').split(/\r?\n/).forEach(function (line) {
    var parts = line.split('=');
    if (parts.length < 2) return;
    var contact = clean(parts[0]);
    var spoken = parts.slice(1).join('=').split(/[,/;]/).map(clean).filter(Boolean);
    if (!contact || !spoken.length) return;
    out.contacts.push(contact);
    out.lines.push(contact + ' = ' + spoken.join(', '));
    out.aliases[key(contact)] = contact;
    spoken.forEach(function (name) {
      out.aliases[key(name)] = contact;
      out.aliases[key(name.replace(/^my\s+/i, ''))] = contact;
    });
  });
  return out;
}

// People this app has texted before count as known names too, so "tell X" and "let X know" reach
// them. The plugins don't share their approved contacts, so the app learns them from sends that
// worked. Aliases from settings win over these.
var KNOWN_MAX = 50;

function remember(list, names) {
  list = (list || []).slice();
  (names || []).forEach(function (name) {
    name = clean(name);
    if (!name || name.length > 40 || !key(name)) return;
    list = list.filter(function (n) { return key(n) !== key(name); });
    list.unshift(name);
  });
  return list.slice(0, KNOWN_MAX);
}

function withKnown(aliases, known) {
  var out = {};
  (known || []).forEach(function (name) { if (key(name)) out[key(name)] = name; });
  Object.keys(aliases || {}).forEach(function (k) { out[k] = aliases[k]; });
  return out;
}

// The name a plugin says it sent to ("Sent to Alex Smith" -> "Alex Smith").
function sentName(text) {
  var m = /^sent to (.+?)\.?$/i.exec(clean(text));
  return m ? m[1] : null;
}

// The known name the words start with ("my wife ..." -> wife), longest first.
function knownPrefix(rest, aliases) {
  var words = rest.split(' ');
  for (var n = Math.min(words.length, 5); n >= 1; n--) {
    var head = key(words.slice(0, n).join(' '));
    var bare = head.replace(/^my /, '');
    var hit = aliases[head] ? head : aliases[bare] ? bare : null;
    if (hit) return { spoken: words.slice(0, n).join(' '), contact: aliases[hit], body: words.slice(n).join(' ') };
  }
  return null;
}

function tidyBody(body) {
  body = clean(body)
    .replace(/^(?:saying|that says|that|to say|and say|and tell (?:him|her|them)|telling (?:him|her|them)|:)\s*/i, '')
    .replace(/^["“]|["”]$/g, '')
    .replace(/\s+please$/i, '')
    .trim();
  return body ? body.charAt(0).toUpperCase() + body.slice(1) : '';
}

var QUESTION = /^(?:what|when|where|who|whose|why|how|which|can|could|are|is|do|does|did|will|would|should|have|has)\b/i;

// "to grab milk" -> "Can you grab milk?"; a question gets its question mark.
function askBody(body) {
  var m = /^to\s+(.+)$/i.exec(body);
  if (m) body = 'Can you ' + m[1].replace(/\?$/, '') + '?';
  else if (body && QUESTION.test(body) && !/\?$/.test(body)) body += '?';
  return body;
}

// The recipient and the words. Unknown names are guessed as the first word, or everything
// before "saying"/"that", and shown on the watch before anything is sent.
function split(rest, aliases, mayGuess) {
  rest = clean(rest).replace(/^[:,]\s*/, '');
  var known = knownPrefix(rest, aliases);
  if (known) return { recipient: known.contact, spoken: known.spoken.replace(/:$/, ''), body: tidyBody(known.body), known: true };
  if (!mayGuess) return null;
  var said = /^(.{1,40}?)(?:\s+(?:saying|that says|that|to say)|\s*:)\s+(.+)$/i.exec(rest);
  if (said) return { recipient: clean(said[1]).replace(/^my\s+/i, ''), spoken: clean(said[1]), body: tidyBody(said[2]), known: false };
  var phone = /^(\+?\d[\d\s().-]{5,}\d)\s+(\D.*)$/.exec(rest);
  if (phone) return { recipient: phone[1].replace(/[\s().-]/g, ''), spoken: phone[1], body: tidyBody(phone[2]), known: false };
  var m = /^(\S+)\s*(.*)$/.exec(rest);
  if (!m) return null;
  return { recipient: m[1], spoken: m[1], body: tidyBody(m[2]), known: false };
}

// Returns null, or { recipient, spoken, body, known }. body may be '' when only a name was said.
function ask(text, aliases) {
  aliases = aliases || {};
  // A question keeps its question mark; the rest of the end punctuation goes.
  var t = clean(text).replace(LEAD, '').replace(/[.!]+$/, '').replace(/\?{2,}$/, '?');
  var m;
  // "send a text to X ...", "send a message to X ...", "shoot a text to X ..."
  if ((m = /^(?:send|shoot|write)\s+(?:a\s+|an\s+)?(?:quick\s+)?(?:text(?: message)?|message|msg|sms|imessage|whatsapp|beeper message)\s+to\s+(.+)$/i.exec(t))) return split(m[1], aliases, true);
  // "send X a message saying ...", "shoot Samantha a text ..."
  if ((m = /^(?:send|shoot)\s+(.{1,40}?)\s+(?:a\s+)?(?:quick\s+)?(?:text|message|msg)\b\s*(.*)$/i.exec(t))) {
    var who = split(m[1] + ' ' + m[2], aliases, false);
    if (who && key(who.spoken) === key(m[1])) return who;
    return { recipient: clean(m[1]).replace(/^my\s+/i, ''), spoken: clean(m[1]), body: tidyBody(m[2]), known: false };
  }
  // "text X ...", "message X ..."
  if ((m = /^(?:text|message|msg|imessage|whatsapp)\s+(.+)$/i.exec(t))) return split(m[1], aliases, true);
  // "tell X ...", "let X know ..." only for aliases and people texted before, so "tell me a joke" stays with the agent.
  if ((m = /^tell\s+(.+)$/i.exec(t))) return split(m[1], aliases, false);
  // "ask Hannah: what time is dinner", "ask my wife to grab milk", same as "tell".
  if ((m = /^ask\s+(.+)$/i.exec(t))) {
    var asked = split(m[1], aliases, false);
    if (asked) asked.body = askBody(asked.body);
    return asked;
  }
  if ((m = /^let\s+(.+?)\s+know\s+(.*)$/i.exec(t))) {
    var known = knownPrefix(m[1] + ' x', aliases);
    if (known && key(known.spoken) === key(m[1])) return { recipient: known.contact, spoken: known.spoken, body: tidyBody(m[2]), known: true };
  }
  return null;
}

// Whether a plugin shares its recent chats (a messaging "chats" source, like Google Messages).
function sharesChats(plugin) {
  return (plugin.sources || []).some(function (source) {
    return source.category === 'messaging' && (source.items || []).indexOf('chats') >= 0;
  });
}

// Chat names from a "chats" source reading, without duplicates.
function chatNames(instances) {
  var seen = {};
  var out = [];
  (instances || []).forEach(function (instance) {
    var name = instance && instance.properties && instance.properties.name;
    var text = String((name && name.shortText && name.shortText.text) || '').trim();
    if (!text || text.length > 60 || seen[text.toLowerCase()]) return;
    seen[text.toLowerCase()] = true;
    out.push(text);
  });
  return out.slice(0, 100);
}

// Installed plugins that send messages: [{ uuid, name, action, recipientParam, textParam }],
// Beeper first, then Chat, then the rest.
function providers(plugins) {
  var found = [];
  (plugins || []).forEach(function (plugin) {
    (plugin.actions || []).forEach(function (action) {
      if (SEND_ACTIONS.indexOf(action.name) < 0) return;
      var props = (action.parameters && action.parameters.properties) || {};
      var names = Object.keys(props);
      var pickParam = function (choices) {
        for (var i = 0; i < choices.length; i++) if (names.indexOf(choices[i]) >= 0) return choices[i];
        return null;
      };
      var recipientParam = pickParam(['recipient', 'contact_name', 'to', 'contact', 'chat', 'name', 'recipient_name']);
      var textParam = pickParam(['text', 'message', 'body', 'content']);
      if (!names.length) { recipientParam = 'recipient'; textParam = 'text'; }
      if (!recipientParam || !textParam) return;
      found.push({ uuid: plugin.uuid, name: plugin.name || 'Messages', action: action.name, recipientParam: recipientParam, textParam: textParam,
        hasOperationId: names.indexOf('operation_id') >= 0, chatsSource: sharesChats(plugin) });
    });
  });
  function rank(p) {
    if (p.uuid === BEEPER_INDEX || /beeper/i.test(p.name)) return 0;
    if (p.uuid === CHAT) return 1;
    return 2;
  }
  found.sort(function (a, b) { return rank(a) - rank(b); });
  return found;
}

function choose(list, saved) {
  for (var i = 0; i < list.length; i++) if (list[i].uuid === saved) return list[i];
  return list[0] || null;
}

function args(provider, recipient, body, operationId) {
  var out = {};
  out[provider.recipientParam] = recipient;
  out[provider.textParam] = body;
  if (provider.hasOperationId && operationId) out.operation_id = operationId;
  return out;
}

// Beeper (Index) answers with the Index agent's own words.
function explainIndex(res) {
  var m = String((res && res.message) || '');
  if (res.code === 'PERMISSION_DENIED' && /confirmation/i.test(m)) {
    return ['Not an approved contact', 'Approve them in the Index app\'s Beeper settings, or send it from Index.'];
  }
  if (res.code === 'PLUGIN_UNAVAILABLE') return ['Beeper isn\'t set up', 'Approve the contacts ' + brand.name + ' may text in the Index app\'s Beeper settings.'];
  if (/^No contacts match/i.test(m)) return ['No contact by that name', 'Approve them in Index\'s Beeper settings, or add an alias in ' + brand.name + '\'s settings.'];
  return null;
}

// Errors from messaging plugins like Google Messages, as a title and a line for the watch.
// null when the message isn't one of these.
function explainKnown(message) {
  var m = String(message || '');
  var several = /^More than one chat matches(?:: (.*?))?\. Say the full name/i.exec(m);
  if (several) return ['Which chat?', (several[1] ? 'More than one matches: ' + several[1] + '. ' : '') + 'Say the full name, or add an alias in ' + brand.name + '\'s settings.'];
  if (/^No recent .*chat matches/i.test(m)) return ['No chat by that name', m];
  if (/^Not sure it sent/i.test(m)) return ['Not sure it sent', 'Check the chat on your phone before sending again.'];
  if (/^Couldn't reach the bridge/i.test(m)) return ['Bridge unreachable', 'Not sent. Check the server is up and the address in the plugin\'s settings.'];
  if (/didn't accept the token/i.test(m)) return ['Wrong bridge token', 'Copy the token into the plugin\'s settings again.'];
  if (/^Your phone isn't answering/i.test(m)) return ['Phone not answering', m.replace(/^Your phone isn't answering\.\s*/i, '') || 'Check that it\'s online.'];
  if (/isn't paired/i.test(m)) return ['Bridge not paired', 'Pair it with Google Messages again on your server.'];
  if (/isn't set up\. Add your bridge/i.test(m)) return ['Plugin not set up', 'Add your bridge address and token in the plugin\'s settings.'];
  return null;
}

// The Chat plugin's errors can list chat ids; keep only what helps on a watch.
function explainFailure(message) {
  var m = String(message || '');
  if (/^Several allowed chats match/i.test(m)) {
    var names = [];
    m.replace(/(?:: |; )([^;(]+?) \(/g, function (_, name) { names.push(name.trim()); return _; });
    return ['Which chat?', (names.length ? 'More than one matches: ' + names.join(', ') + '. ' : '') +
      'Add an alias in ' + brand.name + '\'s settings for the one you mean.'];
  }
  if (/No allowed chat matches/i.test(m)) return ['No chat by that name', 'Allow the chat in the Chat plugin\'s settings, or add an alias in ' + brand.name + '\'s settings.'];
  if (/unconfirmed/i.test(m)) return ['Not sure it sent', 'Check the chat before sending again.'];
  return ['Message not sent', m.replace(/\s*\([^)]*;[^)]*\)/g, '')];
}

module.exports = { ask: ask, parseAliases: parseAliases, remember: remember, withKnown: withKnown, sentName: sentName, providers: providers, choose: choose, args: args,
  explainFailure: explainFailure, explainIndex: explainIndex, explainKnown: explainKnown, chatNames: chatNames, CHAT: CHAT, BEEPER_INDEX: BEEPER_INDEX };
