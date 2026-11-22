// The plugins the Index app adds to the Pebble app while Index is turned on.
// Timers & Alarms (Index) rings on the phone, Notes (Index) saves a note, Reminders (Index)
// sets a reminder or adds to a list. Beeper (Index) is in messages.js with the other messengers.
// Each is a Pebble plugin whose actions are the Index agent's own tools, with snake_case
// arguments (github.com/coredevices/mobileapp, experimental/.../ring/agent/builtin_servlets).

var brand = require('./brand');

var CLOCK = '00000000-0000-0000-0002-000000000001';      // Timers & Alarms (Index)
var BEEPER = '00000000-0000-0000-0002-000000000002';     // Beeper (Index)
var NOTES = '00000000-0000-0000-0002-000000000003';      // Notes (Index)
var REMINDERS = '00000000-0000-0000-0002-000000000004';  // Reminders (Index)

// The plugin, if it's installed and has that action.
function find(plugins, uuid, action) {
  for (var i = 0; i < (plugins || []).length; i++) {
    var p = plugins[i];
    if (p.uuid !== uuid) continue;
    var acts = p.actions || [];
    for (var j = 0; j < acts.length; j++) if (acts[j].name === action) return p;
  }
  return null;
}

function clean(text) {
  return String(text || '').replace(/[’]/g, "'").replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '');
}

function sentence(text) {
  text = clean(text).replace(/^["“]|["”]$/g, '').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

var LEAD = new RegExp('^(?:(?:ok|okay|hey|hi|' + brand.wake + '|please|can you|could you|would you|will you)[,\\s]+)*', 'i');

// "take a note ...", "note to self ...", "jot down ..." -> { text } or null.
function note(text) {
  var t = clean(text).replace(LEAD, '');
  var m = /^(?:(?:take|make|save|add|write|create|leave)\s+(?:a\s+|me\s+a\s+|myself\s+a\s+)?(?:quick\s+|new\s+)?note|new note|note to self|note)\s*(?:that|saying|to say|of|:|,|-)?\s+(.+)$/i.exec(t) ||
    /^(?:jot|write)\s+(?:this\s+|that\s+)?down\s*(?:that|:|,)?\s+(.+)$/i.exec(t);
  if (!m) return null;
  var body = sentence(m[1]);
  return body ? { text: body } : null;
}

var UNIT = '(?:seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?)';
var NUM = '(?:\\d+(?:\\.\\d+)?|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|forty five|fifty|sixty|ninety|a couple(?: of)?|a few|half an?)';
var DAY = '(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)';
var MONTH = '(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)';
// Where a time phrase starts. The plugin reads the phrase itself; this app only splits it off.
var WHEN = new RegExp('(?:^|\\s)(in\\s+' + NUM + '\\s+' + UNIT + '\\b.*|(?:at|by|around)\\s+(?:\\d|noon|midnight)\\S*.*|' +
  '(?:tomorrow|tonight|today|later today|this (?:morning|afternoon|evening|weekend)|next (?:week|month|' + DAY + ')|' +
  '(?:on\\s+)?' + DAY + '|on\\s+' + MONTH + '\\s+\\d+(?:st|nd|rd|th)?|on\\s+the\\s+\\d+(?:st|nd|rd|th)?|' + MONTH + '\\s+\\d+(?:st|nd|rd|th)?\\b)\\b.*)$', 'i');

var STARTS = new RegExp('^(?:in\\s+' + NUM + '\\s+' + UNIT + '\\b|(?:at|by|around)\\s+(?:\\d|noon|midnight)|tomorrow|tonight|today|later today|this (?:morning|afternoon|evening|weekend)|next\\s|on\\s|' + DAY + '|' + MONTH + '\\s+\\d)', 'i');

var CLOCK_START = /^(?:\d{1,2}:\d{2}|\d{1,2}\s*(?:[ap]\.?\s?m\.?|o'?clock))(?:\s*[ap]\.?\s?m\.?)?\s/i;

function timeArgs(when) {
  when = clean(when);
  if (!when) return {};
  if (new RegExp('^in\\s+' + NUM + '\\s+' + UNIT + '\\b', 'i').test(when) && !/\b(at|on|tomorrow|tonight)\b/i.test(when)) return { duration_human: when };
  return { date_time_human: when };
}

// "remind me to call Mom tomorrow at 9", "remind me in 20 minutes to check the oven",
// "set a reminder for Friday to pay rent" -> { message, when, args } or null.
function reminder(text) {
  var t = clean(text).replace(LEAD, '');
  var m = /^(?:remind me|(?:set|make|create|add)\s+(?:me\s+)?an?\s+reminder|new reminder|reminder)\s*(.*)$/i.exec(t);
  if (!m) return null;
  var rest = m[1].replace(/^(?:to|that|about|:|,)\s+/i, '').trim();
  var when = '', message = rest;
  // Time first: "in 20 minutes to check the oven", "for Friday at 9 to pay rent".
  var lead = rest.replace(/^for\s+/i, '');
  // A bare clock time means the next one: "for 4:05 to get the kids ready", "for 5 pm to ...".
  if (CLOCK_START.test(lead)) lead = 'at ' + lead;
  var first = /^(.+?)\s+(?:to|that|about)\s+(.+)$/i.exec(lead);
  if (first && STARTS.test(lead)) {
    when = first[1];
    message = first[2];
  } else {
    var w = WHEN.exec(rest);
    if (w && w.index > 0) {
      when = w[1];
      message = rest.slice(0, w.index);
    }
  }
  message = sentence(message.replace(/^(?:to|that|about)\s+/i, ''));
  if (!message) return null;
  var args = { message: message };
  var ta = timeArgs(when);
  Object.keys(ta).forEach(function (k) { args[k] = ta[k]; });
  return { message: message, when: clean(when), args: args };
}

// "add eggs to my shopping list", "put milk on the grocery list" -> { list, item, args } or null.
function listItem(text) {
  var t = clean(text).replace(LEAD, '');
  var m = /^(?:add|put|stick)\s+(.+?)\s+(?:to|on|onto|in)\s+(?:my|the|our)\s+(.+?)\s+list$/i.exec(t) ||
    /^(?:add|put)\s+(.+?)\s+(?:to|on|onto)\s+(?!my\b|the\b|our\b)(.+?)\s+list$/i.exec(t);
  if (!m) return null;
  var item = sentence(m[1]);
  var list = clean(m[2]).toLowerCase().replace(/^to[\s-]?do$/, 'todo').replace(/^groceries$/, 'grocery');
  if (!item || !list) return null;
  return { item: item, list: list, args: { list_name: list, message: item } };
}

// Seconds -> "1 hour and 30 minutes", the way the timer tool expects.
function duration(seconds) {
  seconds = Math.max(1, Math.round(seconds));
  var h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
  var parts = [];
  if (h) parts.push(h + (h === 1 ? ' hour' : ' hours'));
  if (m) parts.push(m + (m === 1 ? ' minute' : ' minutes'));
  if (s) parts.push(s + (s === 1 ? ' second' : ' seconds'));
  return parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0];
}

function timerArgs(seconds) {
  return { time_human: duration(seconds) };
}

// The phone's alarm takes a clock time only, so it can only be the next one: within 24 hours.
// Returns null for anything further out; those stay on the watch.
function alarmArgs(epochSeconds, label, now) {
  now = now || new Date();
  var ahead = epochSeconds * 1000 - now.getTime();
  if (ahead <= 0 || ahead > 24 * 3600 * 1000 - 60000) return null;
  var at = new Date(epochSeconds * 1000);
  var out = { time_hours: at.getHours(), time_minutes: at.getMinutes() };
  if (label) out.label = label;
  return out;
}

module.exports = { CLOCK: CLOCK, BEEPER: BEEPER, NOTES: NOTES, REMINDERS: REMINDERS, find: find,
  note: note, reminder: reminder, listItem: listItem, duration: duration, timerArgs: timerArgs, alarmArgs: alarmArgs };
