// Phone side. Takes the watch's transcript, sets timers, alarms and reminders on the
// watch when that's what was asked, and sends everything else to the agent plugin
// chosen in settings through the Pebble app's plugin API (send_to_agent).

var brand = require('./brand');
var intent = require('./intent');
var pins = require('./pins');
var actions = require('./actions');
var weather = require('./weather');
var phone = require('./phone');
var music = require('./music');
var apps = require('./apps');
var messages = require('./messages');
var prefs = require('./prefs');
var indexkit = require('./indexkit');
var destinations = require('./destinations');
var quietMod = require('./quiet');
var sources = require('./sources');

var AGENT_ACTION = 'send_to_agent';
// "Isn't available" comes back before the plugin takes the message, so trying again can't
// send it twice. Two more tries, two seconds apart, ride out a plugin that's waking up.
var AGENT_RETRY = { tries: 2, delayMs: 2000 };
// Store plugins from github.com/coredevices/pebble-apps, in the order we prefer them.
var KNOWN_AGENTS = [
  { uuid: '0d33014e-5d56-42ea-9665-3ebf182b4cfb', name: 'Claude' },
  { uuid: 'b8346592-cd59-4b83-9185-87d94e0734b0', name: 'Muse' },
  { uuid: '80ee6780-856f-411f-954b-4553ba7f2af8', name: 'Grok Bot' },
  { uuid: '3f97d5c5-bc28-48ba-b4af-e7ad7f6000f0', name: 'ChatGPT' }
];
var STORE = { agent: 'agent', confirm: 'confirm', quickTalk: 'quickTalk', pins: 'pins', prompts: 'prompts', weather: 'weather',
  features: 'features', aliases: 'aliases', messenger: 'messenger', checkMessages: 'checkMessages',
  vibeAlarm: 'vibeAlarm', vibeTimer: 'vibeTimer', clockOn: 'clockOn',
  notePlugin: 'notePlugin', reminderPlugin: 'reminderPlugin', listPlugin: 'listPlugin', knownContacts: 'knownContacts',
  chatNames: 'chatNames', quietListen: 'quietListen',
  bgColor: 'bgColor', clockColor: 'clockColor' };
// What the app does itself. Turn one off in settings and those words go to the agent instead.
var FEATURES = ['weather', 'battery', 'findPhone', 'music', 'apps', 'messages', 'notes', 'reminders', 'lists'];
// Ringing patterns, same numbers as ring.c: 0 strong, 1 gentle, 2 a few nudges, 3 silent.
var VIBES = [0, 1, 2, 3];
// The Up button's example prompts. Editable in settings; the watch has the same defaults.
var DEFAULT_PROMPTS = [
  "What's the current weather?",
  'Set a 5 minute tea timer.',
  'Find my phone.',
  "What's my phone's battery?",
  'Set an alarm for 7am tomorrow.',
  "What's on my calendar today?",
  'Will I need an umbrella tomorrow?',
  'Any important emails?',
  'What timers do I have?',
  'Skip this song.'
];
var PROMPTS_MAX = 10;
var PROMPT_MAX_LEN = 60;
var CLOCK = { timer: 1, alarm: 2, cancel_timer: 3, cancel_alarm: 4, list: 5, reminder: 6, cancel_reminder: 7 };
var LIST_WHICH = { timer: 1, alarm: 2, reminder: 3 };  // which list the watch opens; 0 is the menu
// The reminder setting's value for the app's own reminders, which ring on the watch.
var ON_WATCH = 'watch';
var WATCH_REMINDER_LEN = 63;

// ------------------------------------------------------------------ settings

function load(key, fallback) {
  try {
    var value = localStorage.getItem(key);
    return value === null || value === undefined ? fallback : JSON.parse(value);
  } catch (e) {
    return fallback;
  }
}

function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
}

function log(msg) {
  console.log('[' + brand.id + '] ' + msg);
}

// Quiet Time while listening (quiet.js).
var quiet = quietMod.create({
  read: function (request, done, ms) { sources.read(request, done, ms); },
  invoke: function (args) {
    if (typeof Pebble === 'undefined' || !Pebble.invokeAction) return Promise.reject(new Error('no plugin API'));
    return Pebble.invokeAction(args);
  },
  load: function (key) { return load(key, null); },
  save: save,
  setTimeout: function (fn, ms) { return setTimeout(fn, ms); },
  clearTimeout: function (t) { clearTimeout(t); },
  log: log
});

// Installed plugins that can take a message, best known first, then any others.
function listAgents() {
  var found = [];
  try {
    (Pebble.enumeratePlugins ? Pebble.enumeratePlugins() : []).forEach(function (plugin) {
      var actions = plugin.actions || [];
      for (var i = 0; i < actions.length; i++) {
        if (actions[i].name === AGENT_ACTION) {
          found.push({ uuid: plugin.uuid, name: plugin.name || 'Agent' });
          return;
        }
      }
    });
  } catch (e) {
    log('enumeratePlugins failed: ' + e);
  }
  function rank(agent) {
    for (var i = 0; i < KNOWN_AGENTS.length; i++) {
      if (KNOWN_AGENTS[i].uuid === agent.uuid) return i;
    }
    return KNOWN_AGENTS.length;
  }
  found.sort(function (a, b) { return rank(a) - rank(b); });
  return found;
}

function features() {
  var saved = load(STORE.features, {}) || {};
  var out = {};
  FEATURES.forEach(function (name) { out[name] = saved[name] !== false; });
  return out;
}

function enabled(name) {
  return features()[name] !== false;
}

function aliasText() {
  return String(load(STORE.aliases, '') || '');
}

function knownContacts() {
  var list = load(STORE.knownContacts, []);
  return Array.isArray(list) ? list : [];
}

// Aliases from settings, everyone this app has texted before, and the messaging plugin's
// recent chats when it shares them.
function messageNames(messenger) {
  var known = knownContacts();
  if (messenger && messenger.chatsSource) known = known.concat(chatNames(messenger));
  return messages.withKnown(messages.parseAliases(aliasText()).aliases, known);
}

function vibe(key) {
  var v = load(key, 0) | 0;
  return VIBES.indexOf(v) >= 0 ? v : 0;
}

function selectedAgent(agents) {
  var chosen = load(STORE.agent, null);
  for (var i = 0; i < agents.length; i++) {
    if (agents[i].uuid === chosen) return agents[i];
  }
  return agents[0] || null;
}

// ------------------------------------------------------------------ "is it set up?"

// Each agent plugin serves agent/configured: true once its sign-in is done.
var configured = {};
var subscriptions = {};

function watchConfigured(agents) {
  if (!Pebble.subscribeToSource) return;
  agents.forEach(function (agent) {
    if (subscriptions[agent.uuid]) return;
    try {
      subscriptions[agent.uuid] = Pebble.subscribeToSource({
        category: 'agent',
        item: 'configured',
        plugin: agent.uuid,
        properties: ['configured'],
        onData: function (envelope) {
          var instance = (envelope.instances || [])[0];
          var prop = instance && instance.properties && instance.properties.configured;
          configured[agent.uuid] = {
            ready: !!(prop && prop.boolean && prop.boolean.value),
            hint: (prop && prop.shortText && prop.shortText.text) || ''
          };
          pushToConfigPage();
        },
        onError: function (err) {
          configured[agent.uuid] = { ready: false, hint: err && err.code === 'AUTH_REQUIRED' ? 'Sign in in its settings' : '' };
          pushToConfigPage();
        }
      });
    } catch (e) {
      log('subscribe ' + agent.name + ' failed: ' + e);
    }
  });
}

// ------------------------------------------------------------------ watch messages

var queue = [];
var sending = false;

function send(message) {
  queue.push(message);
  pump();
}

function pump() {
  if (sending || !queue.length) return;
  sending = true;
  var message = queue[0];
  var attempts = 0;
  function attempt() {
    Pebble.sendAppMessage(message, function () {
      queue.shift();
      sending = false;
      pump();
    }, function (e) {
      if (++attempts < 3) {
        setTimeout(attempt, 400);
        return;
      }
      log('sendAppMessage failed: ' + JSON.stringify(e));
      queue.shift();
      sending = false;
      pump();
    });
  }
  attempt();
}

// Lines from the settings page: trimmed, no blanks, at most 10 of 60 characters.
function cleanPrompts(list) {
  if (!Array.isArray(list)) return DEFAULT_PROMPTS.slice();
  var clean = [];
  list.forEach(function (line) {
    var text = String(line || '').replace(/[\r\n\t]+/g, ' ').trim();
    if (!text || clean.length >= PROMPTS_MAX) return;
    clean.push(text.length > PROMPT_MAX_LEN ? text.slice(0, PROMPT_MAX_LEN).trim() : text);
  });
  return clean.length ? clean : DEFAULT_PROMPTS.slice();
}

function prompts() {
  return cleanPrompts(load(STORE.prompts, DEFAULT_PROMPTS));
}

// A colour from settings: a GColor8 argb byte with full alpha (192 to 255), or 0 for the
// app's own.
function cleanColor(value) {
  var n = Number(value);
  return n >= 192 && n <= 255 && Math.floor(n) === n ? n : 0;
}

function colorWatch() {
  try {
    var info = Pebble.getActiveWatchInfo && Pebble.getActiveWatchInfo();
    if (info && /^(aplite|diorite|flint)$/.test(info.platform)) return false;
  } catch (e) { /* unknown watch */ }
  return true;
}

function pushSettings() {
  var agent = selectedAgent(listAgents());
  send({
    AGENT_NAME: agent ? agent.name : 'no agent yet',
    CONFIRM: load(STORE.confirm, false) ? 1 : 0,
    QUICK_TALK: load(STORE.quickTalk, true) ? 1 : 0,
    QUIET_LISTEN: load(STORE.quietListen, false) ? 1 : 0,
    VIBE_ALARM: vibe(STORE.vibeAlarm),
    VIBE_TIMER: vibe(STORE.vibeTimer),
    BG_COLOR: cleanColor(load(STORE.bgColor, 0)),
    CLOCK_COLOR: cleanColor(load(STORE.clockColor, 0)),
    PROMPTS: prompts().join('\n')
  });
}

function result(requestId, ok, text, detail) {
  send({ REQ_ID: requestId, RESULT_OK: ok, RESULT_TEXT: clip(text, 60), RESULT_DETAIL: clip(detail || '', 150) });
}

// An answer to read: the watch opens the reply screen with the headline over the body.
function reply(requestId, headline, body) {
  send({ REQ_ID: requestId, RESULT_OK: 1, RESULT_TEXT: clip(headline, 60), RESULT_DETAIL: '', REPLY: clip(body || ' ', 500) });
}

function clip(text, max) {
  text = String(text || '');
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

// ------------------------------------------------------------------ the work

function handleTranscript(text, requestId) {
  log('heard: ' + text);
  prefs.refresh();
  var agents = listAgents();
  var addressed = intent.pickAgent(text, agents);
  if (addressed) {
    sendToAgent(addressed.agent, addressed.message, requestId);
    return;
  }
  var pluginAction = actions.match(text, enabled);
  if (pluginAction) {
    runAction(pluginAction, requestId);
    return;
  }
  var weatherAsk = enabled('weather') ? weather.ask(text, new Date()) : null;
  if (weatherAsk) {
    answerWeather(weatherAsk, requestId);
    return;
  }
  var phoneAsk = enabled('battery') ? phone.ask(text) : null;
  if (phoneAsk) {
    answerPhone(phoneAsk, requestId);
    return;
  }
  var musicAsk = enabled('music') ? music.ask(text) : null;
  if (musicAsk) {
    answerMusic(requestId);
    return;
  }
  if (indexAsk(text, requestId)) return;
  var messenger = enabled('messages') ? selectedMessenger() : null;
  var messageAsk = messenger ? messages.ask(text, messageNames(messenger)) : null;
  if (messageAsk) {
    prepareMessage(messenger, messageAsk, requestId);
    return;
  }
  var appAsk = enabled('apps') ? apps.ask(text) : null;
  if (appAsk) {
    launchApp(appAsk, requestId, function () { handleRest(text, requestId, agents); });
    return;
  }
  handleRest(text, requestId, agents);
}

// Notes, reminders and list items, through the note and reminder plugins chosen in settings.
function noteDest() {
  return destinations.choose(destinations.notePlugins(Pebble.enumeratePlugins ? safePlugins() : []), load(STORE.notePlugin, ''));
}

// Reminders ring on the watch unless a reminder plugin is picked in settings.
function reminderDest() {
  var saved = load(STORE.reminderPlugin, '');
  if (!saved || saved === ON_WATCH) return null;
  var found = destinations.reminderPlugins(Pebble.enumeratePlugins ? safePlugins() : []);
  for (var i = 0; i < found.length; i++) if (found[i].uuid === saved) return found[i];
  return null;
}

// Lists live in a plugin: the one picked for lists, or else the reminder plugin, or else the first.
function listDest() {
  var found = destinations.reminderPlugins(Pebble.enumeratePlugins ? safePlugins() : []);
  var saved = load(STORE.listPlugin, '') || load(STORE.reminderPlugin, '');
  return destinations.choose(found, saved);
}

// A reminder that rings on the watch, with a pin on the timeline.
function watchReminder(r, requestId) {
  var now = new Date();
  var at = r.when ? destinations.due(r.when, now) : null;
  if (!at) {
    result(requestId, 0, 'When is that?', (r.when ? 'I couldn\'t tell when "' + r.when + '" is. ' : '') + 'Try "tomorrow at 9" or "in 2 hours".');
    return;
  }
  send({ REQ_ID: requestId, CLOCK_KIND: CLOCK.reminder, CLOCK_TIME: Math.round(at.getTime() / 1000), CLOCK_LABEL: clip(r.message, WATCH_REMINDER_LEN) });
}

function indexAsk(text, requestId) {
  var nd = enabled('notes') ? noteDest() : null;
  var n = nd ? indexkit.note(text) : null;
  if (n) {
    runAction({ name: nd.name, plugin: nd.uuid, action: 'create_note', args: destinations.noteArgs(nd, n.text),
      working: 'Saving to ' + nd.name + '...', done: 'Note saved to ' + nd.name, detail: '"' + clip(n.text, 120) + '"' }, requestId);
    return true;
  }
  var r = enabled('reminders') ? indexkit.reminder(text) : null;
  if (r) {
    var rd = reminderDest();
    if (!rd) {
      watchReminder(r, requestId);
      return true;
    }
    var built = destinations.reminderArgs(rd, r, new Date());
    if (built.error) {
      result(requestId, 0, 'When is that?', built.error + ' Try "tomorrow at 9" or "in 2 hours".');
      return true;
    }
    var when = built.at ? prefs.time(built.at) + (built.at.toDateString() === new Date().toDateString() ? '' : ', ' + built.at.toDateString().slice(0, 10)) : r.when;
    runAction({ name: rd.name, plugin: rd.uuid, action: 'create_reminder', args: built.args,
      working: 'Setting the reminder...', done: 'Reminder set in ' + rd.name,
      detail: '"' + clip(r.message, 100) + '"' + (when ? ', ' + when : '') }, requestId);
    return true;
  }
  var ld = enabled('lists') ? listDest() : null;
  var li = ld ? indexkit.listItem(text) : null;
  if (!li) return false;
  if (ld.lists) {
    runAction({ name: ld.name, plugin: ld.uuid, action: 'create_list_item', args: li.args,
      working: 'Adding it...', done: 'Added to ' + li.list, detail: '"' + clip(li.item, 120) + '"' }, requestId);
    return true;
  }
  // Store plugins keep lists as their reminders/list source; the item goes in as a reminder there.
  result(requestId, 2, 'Adding it...', '');
  destinations.findList(ld, li.list, function (instanceId, listName) {
    var args = { title: li.item };
    if (instanceId) args.instanceId = instanceId;
    runAction({ name: ld.name, plugin: ld.uuid, action: 'create_reminder', args: args, working: 'Adding it...',
      done: instanceId ? 'Added to ' + listName : 'Added to ' + ld.name,
      detail: '"' + clip(li.item, 100) + '"' + (instanceId ? '' : ' (no list called ' + li.list + ', so it\'s in your default list)') }, requestId);
  });
  return true;
}

// Alarms and timers ring on the phone instead when settings say so and Timers & Alarms (Index) is there.
function clockOnPhone(action) {
  if (load(STORE.clockOn, 'watch') !== 'phone') return false;
  return !!indexkit.find(Pebble.enumeratePlugins ? safePlugins() : [], indexkit.CLOCK, action);
}

// Timers and alarms on the watch (or the phone), or else the agent.
function handleRest(text, requestId, agents) {
  var parsed = intent.parse(text, new Date());
  switch (parsed.kind) {
    case 'timer':
      if (clockOnPhone('set_timer')) {
        var length = indexkit.duration(parsed.seconds);
        runAction({ name: 'Timers & Alarms', plugin: indexkit.CLOCK, action: 'set_timer', args: indexkit.timerArgs(parsed.seconds),
          working: 'Setting a timer on your phone...', done: 'Timer set on your phone',
          detail: (parsed.label ? parsed.label + ', ' : '') + length }, requestId);
        return;
      }
      send({ REQ_ID: requestId, CLOCK_KIND: CLOCK.timer, CLOCK_TIME: parsed.seconds, CLOCK_LABEL: parsed.label || '' });
      return;
    case 'alarm':
      var phoneAlarm = clockOnPhone('set_alarm') ? indexkit.alarmArgs(parsed.time, parsed.label, new Date()) : null;
      if (phoneAlarm) {
        runAction({ name: 'Timers & Alarms', plugin: indexkit.CLOCK, action: 'set_alarm', args: phoneAlarm,
          working: 'Setting an alarm on your phone...', done: 'Alarm set on your phone',
          detail: (parsed.label ? parsed.label + ', ' : '') + prefs.time(new Date(parsed.time * 1000)) }, requestId);
        return;
      }
      // Phone alarms only take a time of day, so anything more than a day out stays on the watch.
      send({ REQ_ID: requestId, CLOCK_KIND: CLOCK.alarm, CLOCK_TIME: parsed.time, CLOCK_LABEL: parsed.label || '' });
      return;
    case 'cancel_reminder':
      // Only the watch's own reminders; a reminder plugin's are the agent's to handle.
      if (!enabled('reminders') || reminderDest()) break;
      send({ REQ_ID: requestId, CLOCK_KIND: CLOCK.cancel_reminder, CLOCK_TIME: 0, CLOCK_LABEL: parsed.label || '' });
      return;
    case 'cancel_timer':
    case 'cancel_alarm':
      send({ REQ_ID: requestId, CLOCK_KIND: CLOCK[parsed.kind], CLOCK_TIME: 0, CLOCK_LABEL: parsed.label || '' });
      return;
    case 'list':
      if (parsed.which === 'reminder' && (!enabled('reminders') || reminderDest())) break;
      send({ REQ_ID: requestId, CLOCK_KIND: CLOCK.list, CLOCK_TIME: LIST_WHICH[parsed.which] || 0, CLOCK_LABEL: '' });
      return;
    case 'unclear':
      result(requestId, 0, parsed.reason, '"' + text + '"');
      return;
  }
  sendToAgent(selectedAgent(agents), text, requestId);
}

function sendToAgent(agent, message, requestId) {
  if (!Pebble.invokeAction) {
    result(requestId, 0, 'Pebble app too old', 'Update the Pebble app to use agent plugins.');
    return;
  }
  if (!agent) {
    result(requestId, 0, 'No agent plugin found', 'In the Pebble app, turn on Settings > Plugins and add Claude, Muse, Grok Bot or ChatGPT.');
    return;
  }
  result(requestId, 2, 'Sending to ' + agent.name + '...', '"' + message + '"');
  attemptAgent(agent, message, requestId, 0);
}

function attemptAgent(agent, message, requestId, retries) {
  var finished = false;
  Pebble.invokeAction({ plugin: agent.uuid, action: AGENT_ACTION, args: { message: message } })
    .then(function (res) {
      finished = true;
      if (res && res.ok) {
        result(requestId, 1, 'Sent to ' + agent.name, '"' + message + '"');
      } else if (res && res.code === 'PLUGIN_UNAVAILABLE' && retries < AGENT_RETRY.tries) {
        result(requestId, 2, 'Retrying ' + agent.name + ' (' + (retries + 1) + ' of ' + AGENT_RETRY.tries + ')...', res.message || '');
        setTimeout(function () { attemptAgent(agent, message, requestId, retries + 1); }, AGENT_RETRY.delayMs);
      } else {
        var why = explain(agent, res || {});
        result(requestId, 0, why[0], why[1]);
      }
    }, function (err) {
      if (finished) return;
      finished = true;
      result(requestId, 0, agent.name + ' failed', String((err && err.message) || err || ''));
    });
}

// Another plugin's action, like Find My Phone's ring. Same receipts as an agent message.
function runAction(entry, requestId) {
  if (!Pebble.invokeAction) {
    result(requestId, 0, 'Pebble app too old', 'Update the Pebble app to use plugins.');
    return;
  }
  result(requestId, 2, entry.working, '');
  Pebble.invokeAction({ plugin: entry.plugin, action: entry.action, args: entry.args || {} })
    .then(function (res) {
      if (res && res.ok) {
        result(requestId, 1, entry.done, entry.detail || '');
      } else {
        var why = explain({ name: entry.name }, res || {});
        result(requestId, 0, why[0], why[1]);
      }
    }, function (err) {
      result(requestId, 0, entry.name + ' failed', String((err && err.message) || err || ''));
    });
}

// ------------------------------------------------------------------ messages

// Installed messaging plugins, best first.
function messengers() {
  return messages.providers(Pebble.enumeratePlugins ? safePlugins() : []);
}

function selectedMessenger() {
  return messages.choose(messengers(), load(STORE.messenger, ''));
}

// Recent chat names from a plugin that shares them (a messaging "chats" source, like
// Google Messages), so "tell Alex ..." and multi-word names work. Kept for 10 minutes.
var NAMES_FRESH_MS = 10 * 60 * 1000;
function chatNames(messenger) {
  var saved = load(STORE.chatNames, null);
  return saved && saved.uuid === messenger.uuid && Array.isArray(saved.names) ? saved.names : [];
}

function refreshChatNames(force) {
  var messenger = selectedMessenger();
  if (!messenger || !messenger.chatsSource) return;
  var saved = load(STORE.chatNames, null);
  if (!force && saved && saved.uuid === messenger.uuid && Date.now() - (saved.at || 0) < NAMES_FRESH_MS) return;
  sources.read({ plugin: messenger.uuid, category: 'messaging', item: 'chats', all: true }, function (err, list) {
    if (err || !Array.isArray(list)) return;
    save(STORE.chatNames, { uuid: messenger.uuid, at: Date.now(), names: messages.chatNames(list) });
  }, 15000);
}

// Messages waiting for Select on the watch, by request id.
var pendingMessages = {};
var PENDING_MS = 5 * 60 * 1000;

function prepareMessage(provider, ask, requestId) {
  var to = ask.recipient;
  if (!ask.body) {
    result(requestId, 0, 'What should it say?', 'Say the name and the message together, like "text ' + to + ' I\'m on my way".');
    return;
  }
  if (!Pebble.invokeAction) {
    result(requestId, 0, 'Pebble app too old', 'Update the Pebble app to send messages.');
    return;
  }
  if (!load(STORE.checkMessages, true)) {
    sendMessage(provider, ask, requestId);
    return;
  }
  Object.keys(pendingMessages).forEach(function (id) {
    if (Date.now() - pendingMessages[id].at > PENDING_MS) delete pendingMessages[id];
  });
  pendingMessages[requestId] = { provider: provider, ask: ask, at: Date.now() };
  // The watch shows the words with "Select sends"; nothing goes out until then.
  send({ REQ_ID: requestId, RESULT_OK: 3, RESULT_TEXT: clip('Send to ' + to + '?', 60), RESULT_DETAIL: '', REPLY: clip(ask.body, 500) });
}

function confirmMessage(requestId) {
  var pending = pendingMessages[requestId];
  delete pendingMessages[requestId];
  if (!pending || Date.now() - pending.at > PENDING_MS) {
    result(requestId, 0, 'Not sent', 'That message waited too long. Say it again.');
    return;
  }
  sendMessage(pending.provider, pending.ask, requestId);
}

function sendMessage(provider, ask, requestId) {
  result(requestId, 2, 'Sending to ' + ask.recipient + '...', '"' + clip(ask.body, 120) + '"');
  var operation = brand.id + '-' + Date.now().toString(36) + '-' + requestId;
  Pebble.invokeAction({ plugin: provider.uuid, action: provider.action || 'send_message', args: messages.args(provider, ask.recipient, ask.body, operation) })
    .then(function (res) {
      if (res && res.ok) {
        save(STORE.knownContacts, messages.remember(knownContacts(), [ask.recipient, messages.sentName(res.text)]));
        refreshChatNames(false);
        result(requestId, 1, clip(res.text || 'Sent to ' + ask.recipient, 60), '"' + clip(ask.body, 120) + '"');
        return;
      }
      res = res || {};
      var why = (provider.uuid === messages.BEEPER_INDEX && messages.explainIndex(res)) || messages.explainKnown(res.message) ||
        (res.code === 'CHAT_SEND_FAILED' || res.code === 'UNKNOWN' ? messages.explainFailure(res.message)
          : explain({ name: provider.name }, res));
      if (res.code === 'TIMEOUT') why = ['Not sure it sent', 'Check the chat before sending again.'];
      result(requestId, 0, why[0], why[1]);
    }, function (err) {
      result(requestId, 0, 'Not sure it sent', 'Check the chat before sending again. ' + String((err && err.message) || err || ''));
    });
}

// ------------------------------------------------------------------ apps

var APPS_ERRORS = {
  PERMISSION_DENIED: ['Pebble app blocked it', 'Allow ' + brand.name + ' to see and open your watch apps in the Pebble app.'],
  UNSUPPORTED: ['Pebble app too old', 'Update the Pebble app to open apps by voice.']
};

// Opens the app if there's one by that name; otherwise "launch" says so and other verbs go on.
function launchApp(ask, requestId, otherwise) {
  if (ask.strict) result(requestId, 2, 'Looking for ' + ask.name + '...', '');
  apps.list(function (err, list) {
    var app = err ? null : apps.pick(list, ask.name);
    if (!app) {
      if (!ask.strict) return otherwise();
      var why = err ? (APPS_ERRORS[err.code] || ['Couldn\'t read your apps', err.message || 'Try again in a minute.'])
        : ['No app called ' + ask.name, 'Check the name in your watch\'s app list.'];
      result(requestId, 0, clip(why[0], 60), why[1]);
      return;
    }
    runAction({ name: 'Watch', plugin: apps.WATCH_STATE, action: 'launch_app', args: { uuid: app.uuid },
      working: 'Opening ' + app.name + '...', done: 'Opening ' + app.name }, requestId);
  });
}

// ------------------------------------------------------------------ music

var MUSIC_ERRORS = {
  NO_DATA: ['Nothing playing', 'Start something on your phone first.'],
  PERMISSION_DENIED: ['Pebble app blocked music', 'Allow ' + brand.name + ' to see what\'s playing in the Pebble app.'],
  UNSUPPORTED: ['Pebble app too old', 'Update the Pebble app to read the music.']
};

function answerMusic(requestId) {
  result(requestId, 2, 'Checking the music...', '');
  music.read(function (err, instance) {
    var answer = err ? null : music.describe(instance);
    if (!answer) {
      var why = MUSIC_ERRORS[(err && err.code) || 'NO_DATA'] || ['No music info', 'The Pebble app had nothing. Try again in a minute.'];
      result(requestId, 0, why[0], why[1]);
      return;
    }
    reply(requestId, answer.headline, answer.body);
  });
}

// Weather from the provider picked in the Pebble app, or the one picked in this app's settings.
var WEATHER_ERRORS = {
  PLUGIN_UNAVAILABLE: ['No weather provider', 'Pick one in the Pebble app under Settings, Weather.'],
  PERMISSION_DENIED: ['Pebble app blocked weather', 'Allow ' + brand.name + ' to use your location in the Pebble app.'],
  NO_LOCATION: ['No weather location', 'Add one in the Pebble app under Settings, Weather.'],
  TIMEOUT: ['No weather yet', 'The weather provider did not answer. Try again in a minute.'],
  UNSUPPORTED: ['Pebble app too old', 'Update the Pebble app to get weather.']
};

function answerWeather(question, requestId) {
  result(requestId, 2, 'Checking the weather...', '');
  weather.read(load(STORE.weather, '') || null, function (err, location) {
    var answer = err ? null : weather.describe(location, question, new Date());
    if (!answer) {
      var why = WEATHER_ERRORS[(err && err.code) || 'TIMEOUT'] || ['No weather', (err && err.message) || 'The weather provider had no forecast.'];
      if (!err) why = ['No weather yet', 'The weather provider has nothing yet. Try again in a minute.'];
      result(requestId, 0, why[0], why[1]);
      return;
    }
    reply(requestId, answer.headline, answer.body);
  });
}

// The phone's battery, from the Pebble app's built-in Phone plugin.
var PHONE_ERRORS = {
  PLUGIN_UNAVAILABLE: ['Phone plugin is off', 'Turn on the Phone plugin in the Pebble app under Settings, Plugins.'],
  UNSUPPORTED: ['Pebble app too old', 'Update the Pebble app to read the phone battery.']
};

function answerPhone(question, requestId) {
  result(requestId, 2, 'Checking your phone...', '');
  phone.read(function (err, instance) {
    var answer = err ? null : phone.describe(instance);
    if (!answer) {
      var why = PHONE_ERRORS[err && err.code] || ['No battery reading', 'The Pebble app had no battery level. Try again in a minute.'];
      result(requestId, 0, why[0], why[1]);
      return;
    }
    reply(requestId, answer.headline, answer.body);
  });
}

// Turns a plugin error into a headline and a next step. Only "isn't available" is retried
// (in attemptAgent): a timeout may still have delivered, and the agent plugins ask callers
// not to resend blindly.
function explain(agent, res) {
  var name = agent.name;
  switch (res.code) {
    case 'AUTH_REQUIRED':
      return ['Sign in to ' + name, 'Open the ' + name + ' plugin settings in the Pebble app.'];
    case 'PLUGIN_UNAVAILABLE':
      return [name + ' isn\'t available', res.message || 'Check the plugin is installed and plugins are on in the Pebble app.'];
    case 'PERMISSION_DENIED':
      return ['Pebble app blocked ' + name, res.message || 'Allow ' + brand.name + ' to use it in the Pebble app.'];
    case 'TIMEOUT':
      return [name + ' didn\'t confirm', 'It may still have arrived. Check the chat before sending again.'];
    case 'RATE_LIMITED':
      return [name + ' is busy', 'Try again in a minute.'];
    case 'INVALID_ARGS':
    case 'INVALID_REQUEST':
      return [name + ' refused it', res.message || ''];
    default:
      return [name + ' failed', res.message || res.code || ''];
  }
}

// ------------------------------------------------------------------ settings page

function pageState() {
  var agents = listAgents();
  var chosen = selectedAgent(agents);
  return {
    brand: brand.name,
    agents: agents.map(function (agent) {
      var status = configured[agent.uuid];
      return { uuid: agent.uuid, name: agent.name, ready: status ? status.ready : null, hint: status ? status.hint : '' };
    }),
    agent: chosen ? chosen.uuid : null,
    confirm: !!load(STORE.confirm, false),
    quickTalk: !!load(STORE.quickTalk, true),
    quietListen: !!load(STORE.quietListen, false),
    quietAvailable: !!(Pebble.invokeAction && Pebble.subscribeToSource),
    prompts: prompts(),
    defaultPrompts: DEFAULT_PROMPTS,
    weatherProviders: weather.providers(Pebble.enumeratePlugins ? safePlugins() : []),
    weather: load(STORE.weather, ''),
    features: features(),
    aliases: messages.parseAliases(aliasText()).lines.join('\n'),
    knownContacts: knownContacts(),
    messengers: messengers().map(function (m) { return { uuid: m.uuid, name: m.name }; }),
    messenger: (selectedMessenger() || {}).uuid || '',
    checkMessages: !!load(STORE.checkMessages, true),
    vibeAlarm: vibe(STORE.vibeAlarm),
    vibeTimer: vibe(STORE.vibeTimer),
    bgColor: cleanColor(load(STORE.bgColor, 0)),
    clockColor: cleanColor(load(STORE.clockColor, 0)),
    defaultColors: brand.colors || { bg: 192, clock: 255 },
    colorWatch: colorWatch(),
    clockOn: load(STORE.clockOn, 'watch') === 'phone' ? 'phone' : 'watch',
    index: { clock: !!indexkit.find(Pebble.enumeratePlugins ? safePlugins() : [], indexkit.CLOCK, 'set_timer') },
    notePlugins: destinations.notePlugins(Pebble.enumeratePlugins ? safePlugins() : []).map(function (d) { return { uuid: d.uuid, name: d.name }; }),
    notePlugin: (noteDest() || {}).uuid || '',
    reminderPlugins: [{ uuid: ON_WATCH, name: 'On the watch' }].concat(destinations.reminderPlugins(Pebble.enumeratePlugins ? safePlugins() : []).map(function (d) { return { uuid: d.uuid, name: d.name }; })),
    reminderPlugin: (reminderDest() || {}).uuid || ON_WATCH,
    listPlugins: destinations.reminderPlugins(Pebble.enumeratePlugins ? safePlugins() : []).map(function (d) { return { uuid: d.uuid, name: d.name }; }),
    listPlugin: (listDest() || {}).uuid || '',
    pluginsSupported: !!(Pebble.enumeratePlugins && Pebble.invokeAction)
  };
}

function safePlugins() {
  try { return Pebble.enumeratePlugins() || []; } catch (e) { return []; }
}

function pushToConfigPage() {
  if (!Pebble.sendConfigMessage) return;
  try {
    var state = pageState();
    state.type = 'state';
    Pebble.sendConfigMessage(state);
  } catch (e) { /* no page open */ }
}

Pebble.addEventListener('configmessage', function (e) {
  var message = e.data || {};
  if (message.type === 'state') {
    watchConfigured(listAgents());
    e.respond(pageState());
    return;
  }
  if (message.type === 'set') {
    if (message.agent !== undefined) save(STORE.agent, message.agent);
    if (message.confirm !== undefined) save(STORE.confirm, !!message.confirm);
    if (message.quickTalk !== undefined) save(STORE.quickTalk, !!message.quickTalk);
    if (message.quietListen !== undefined) save(STORE.quietListen, !!message.quietListen);
    if (message.prompts !== undefined) save(STORE.prompts, cleanPrompts(message.prompts));
    if (message.weather !== undefined) save(STORE.weather, String(message.weather || ''));
    if (message.features && typeof message.features === 'object') {
      var next = features();
      FEATURES.forEach(function (name) { if (message.features[name] !== undefined) next[name] = !!message.features[name]; });
      save(STORE.features, next);
    }
    if (message.forgetContacts) save(STORE.knownContacts, []);
    if (message.aliases !== undefined) save(STORE.aliases, messages.parseAliases(String(message.aliases || '').slice(0, 4000)).lines.join('\n'));
    if (message.messenger !== undefined) {
      save(STORE.messenger, String(message.messenger || ''));
      refreshChatNames(false);
    }
    if (message.checkMessages !== undefined) save(STORE.checkMessages, !!message.checkMessages);
    if (message.vibeAlarm !== undefined) save(STORE.vibeAlarm, VIBES.indexOf(message.vibeAlarm | 0) >= 0 ? message.vibeAlarm | 0 : 0);
    if (message.notePlugin !== undefined) save(STORE.notePlugin, String(message.notePlugin || ''));
    if (message.reminderPlugin !== undefined) save(STORE.reminderPlugin, String(message.reminderPlugin || ''));
    if (message.listPlugin !== undefined) save(STORE.listPlugin, String(message.listPlugin || ''));
    if (message.clockOn !== undefined) save(STORE.clockOn, message.clockOn === 'phone' ? 'phone' : 'watch');
    if (message.bgColor !== undefined) save(STORE.bgColor, cleanColor(message.bgColor));
    if (message.clockColor !== undefined) save(STORE.clockColor, cleanColor(message.clockColor));
    if (message.vibeTimer !== undefined) save(STORE.vibeTimer, VIBES.indexOf(message.vibeTimer | 0) >= 0 ? message.vibeTimer | 0 : 0);
    pushSettings();
    e.respond(pageState());
    return;
  }
  e.respond({ error: 'unknown request' });
});

// ------------------------------------------------------------------ lifecycle

// ------------------------------------------------------------------ timeline

// The watch sends its whole timer, alarm and reminder list after every change.
function syncPins(text) {
  if (typeof Pebble.insertTimelinePin !== 'function') {
    log('this Pebble app has no local timeline; no pins');
    return;
  }
  var next = pins.plan(text, load(STORE.pins, []));
  next.remove.forEach(function (id) {
    try { Pebble.deleteTimelinePin(id); } catch (e) { log('delete pin ' + id + ': ' + e); }
  });
  next.pins.forEach(function (pin) {
    try { Pebble.insertTimelinePin(pin); } catch (e) { log('insert pin ' + pin.id + ': ' + e); }
  });
  save(STORE.pins, next.ids);
  log('pins: ' + next.pins.length + ' up, ' + next.remove.length + ' down');
}

Pebble.addEventListener('ready', function () {
  var agents = listAgents();
  log('ready; agents: ' + agents.map(function (a) { return a.name; }).join(', '));
  watchConfigured(agents);
  prefs.refresh(true);
  // Anything left switched from a listen that never got its "done" (the app was closed mid-way).
  quiet.stop();
  pushSettings();
  refreshChatNames(false);
});

Pebble.addEventListener('appmessage', function (e) {
  var payload = e.payload || {};
  if (payload.READY !== undefined) {
    pushSettings();
    return;
  }
  if (payload.LISTEN !== undefined) {
    if ((payload.LISTEN | 0) && load(STORE.quietListen, false)) {
      quiet.start(function () { send({ LISTEN_READY: 1 }); });
    } else if (payload.LISTEN | 0) {
      send({ LISTEN_READY: 1 });
    } else {
      quiet.stop();
    }
    // A transcript can carry the end of listening with it.
    if (payload.TRANSCRIPT === undefined) return;
  }
  if (payload.PINS !== undefined) {
    syncPins(String(payload.PINS));
  }
  if (payload.CONFIRM_SEND !== undefined) {
    confirmMessage(payload.CONFIRM_SEND | 0);
    return;
  }
  if (payload.TRANSCRIPT !== undefined) {
    handleTranscript(String(payload.TRANSCRIPT), payload.REQ_ID | 0);
  }
});

module.exports = { handleTranscript: handleTranscript, listAgents: listAgents, explain: explain, syncPins: syncPins, cleanPrompts: cleanPrompts, DEFAULT_PROMPTS: DEFAULT_PROMPTS, runAction: runAction, confirmMessage: confirmMessage, AGENT_RETRY: AGENT_RETRY, cleanColor: cleanColor };
