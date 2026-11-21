// The transcript log: what you said and what came of it, kept on the phone for the settings page.
// Only the newest MAX entries are kept, each with at most MAX_STEPS steps.

var KEY = 'transcripts';
var MAX = 100;
var MAX_STEPS = 12;

function clip(text, n) {
  text = String(text === undefined || text === null ? '' : text);
  return text.length > n ? text.slice(0, n - 1) + '…' : text;
}

// env: load(key, fallback), save(key, value), now() -> ms.
function create(env) {
  function all() {
    var list = env.load(KEY, []);
    return Array.isArray(list) ? list : [];
  }

  function find(list, id) {
    for (var i = list.length - 1; i >= 0; i--) {
      if (list[i] && list[i].id === id) return list[i];
    }
    return null;
  }

  // A new transcript from the watch.
  function heard(id, text) {
    var list = all();
    list.push({ id: id, t: env.now(), said: clip(text, 300), outcome: 'working', steps: [] });
    while (list.length > MAX) list.shift();
    env.save(KEY, list);
  }

  // A step for the newest entry with this request ID. outcome, when given, is the entry's state
  // now: 'working', 'done', 'failed' or 'asked'.
  function note(id, text, outcome) {
    var list = all();
    var entry = find(list, id);
    if (!entry) return;
    entry.steps = Array.isArray(entry.steps) ? entry.steps : [];
    entry.steps.push({ ms: Math.max(0, env.now() - entry.t), text: clip(text, 200) });
    // Keep the first step and the latest ones.
    if (entry.steps.length > MAX_STEPS) entry.steps.splice(1, entry.steps.length - MAX_STEPS);
    if (outcome) entry.outcome = outcome;
    env.save(KEY, list);
  }

  // Newest first.
  function entries() {
    return all().slice().reverse();
  }

  function clear() {
    env.save(KEY, []);
  }

  return { heard: heard, note: note, entries: entries, clear: clear };
}

// What a message to the watch says, as a log step, or null for messages that aren't answers.
var OUTCOMES = { 0: 'failed', 1: 'done', 2: 'working', 3: 'asked' };
var CLOCK_WORDS = { 1: 'Timer set', 2: 'Alarm set', 3: 'Timer cancelled', 4: 'Alarm cancelled', 5: 'List opened',
  6: 'Reminder set', 7: 'Reminder cancelled' };

function describe(message) {
  if (message.REQ_ID === undefined) return null;
  if (message.CLOCK_KIND !== undefined) {
    var words = CLOCK_WORDS[message.CLOCK_KIND] || 'Sent to the watch';
    var label = message.CLOCK_LABEL ? ': ' + message.CLOCK_LABEL : '';
    // The watch can still refuse (a time in the past, a full list); it says so on the watch.
    return { text: words + ' on the watch' + label, outcome: 'done' };
  }
  if (message.RESULT_OK !== undefined) {
    var text = String(message.RESULT_TEXT || '');
    if (message.RESULT_DETAIL) text += ' — ' + message.RESULT_DETAIL;
    else if (message.REPLY && message.RESULT_OK !== 3) text += ' — ' + message.REPLY;
    return { text: text, outcome: OUTCOMES[message.RESULT_OK] || 'working' };
  }
  return null;
}

module.exports = { create: create, describe: describe, MAX: MAX };
