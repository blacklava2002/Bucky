// Turns a transcript into a watch action, or decides it's for the agent.
// Pure functions, no Pebble APIs, so it runs under node for tests.
//
// parse(text, now) returns one of:
//   { kind: 'timer', seconds, label }
//   { kind: 'alarm', time (epoch seconds), label }
//   { kind: 'cancel_timer', label } / { kind: 'cancel_alarm', label } / { kind: 'cancel_reminder', label }
//   { kind: 'list', which: 'timer' | 'alarm' | 'reminder' | '' }
//   { kind: 'agent' }                          everything else
//   { kind: 'unclear', reason }                 a timer/alarm ask with no usable time

var brand = require('./brand');

var NUMBER_WORDS = {
  zero: 0, a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, ninety: 90, couple: 2, few: 3
};

var UNIT_SECONDS = { second: 1, sec: 1, minute: 60, min: 60, hour: 3600, hr: 3600 };

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/\ba\.\s*m\.?/g, 'am')
    .replace(/\bp\.\s*m\.?/g, 'pm')
    .replace(/(\d)\s*(am|pm)\b/g, '$1 $2')
    .replace(/[,!?]/g, ' ')
    .replace(/\.(?!\d)/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// "twenty five" -> 25, "4" -> 4, "1.5" -> 1.5. Returns null when not a number.
function wordsToNumber(words) {
  if (!words.length) return null;
  if (words.length === 1 && /^\d+(\.\d+)?$/.test(words[0])) return parseFloat(words[0]);
  // "a 10 minute timer", "a couple minutes": the article isn't a number when others are there.
  var meaningful = words.filter(function (w) { return w !== 'a' && w !== 'an' && w !== 'and'; });
  if (meaningful.length) words = meaningful;
  var total = 0;
  var any = false;
  for (var i = 0; i < words.length; i++) {
    var w = words[i];
    if (w === 'and') continue;
    if (/^\d+(\.\d+)?$/.test(w)) { total += parseFloat(w); any = true; continue; }
    if (NUMBER_WORDS.hasOwnProperty(w)) { total += NUMBER_WORDS[w]; any = true; continue; }
    return null;
  }
  return any ? total : null;
}

var NUM = '(?:\\d+(?:\\.\\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|ninety|couple|few|and|zero)';
var DURATION_PART = new RegExp(
  '((?:' + NUM + ')(?:\\s+(?:' + NUM + '))*)\\s*(?:of\\s+(?:an?\\s+)?)?' +
  '(?:(and\\s+a\\s+half|and\\s+a\\s+quarter)\\s+)?(seconds?|secs?|minutes?|mins?|hours?|hrs?)\\b' +
  '(\\s+and\\s+a\\s+half)?', 'g');

// Sum every "<number> <unit>" in the text. "an hour and a half", "1 hour 20 minutes",
// "two and a half minutes", "half an hour", "90 seconds".
function parseDuration(text) {
  var total = 0;
  var found = false;
  var m;
  var half = /\bhalf (?:an|a) (hour|minute)\b/.exec(text);
  if (half) {
    total += UNIT_SECONDS[half[1]] / 2;
    found = true;
    text = text.replace(half[0], ' ');
  }
  DURATION_PART.lastIndex = 0;
  while ((m = DURATION_PART.exec(text)) !== null) {
    var words = m[1].trim().split(' ');
    // "and a half" inside the number words: "two and a half minutes".
    var extra = 0;
    var joined = words.join(' ');
    var halfIn = /\band a half$/.exec(joined);
    if (halfIn) {
      words = joined.replace(/\s*and a half$/, '').split(' ');
      extra = 0.5;
    }
    while (words.length && words[0] === 'and') words.shift();
    var n = wordsToNumber(words);
    if (n === null) continue;
    var unit = m[3].replace(/s$/, '');
    if (unit === 'mins') unit = 'min';
    if (unit === 'hrs') unit = 'hr';
    if (m[2] === 'and a half' || m[4]) extra += 0.5;
    if (m[2] === 'and a quarter') extra += 0.25;
    total += (n + extra) * UNIT_SECONDS[unit];
    found = true;
  }
  return found ? Math.round(total) : null;
}

var LABEL_STOP = new RegExp('^(?:\\d.*|a|an|the|my|me|new|quick|set|start|create|make|add|put|please|' +
  'can|could|would|will|you|hey|ok|okay|' + brand.wake + '|and|for|to|in|of|' +
  'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|' +
  'forty|forty-five|fifty|sixty|ninety|half|quarter|couple|few|' +
  'seconds?|secs?|minutes?|mins?|hours?|hrs?)$');

// Labels: "pasta timer", "timer for the pasta", "called pasta", "named pasta", "labeled pasta".
function extractLabel(text, noun) {
  var m = /\b(?:called|named|labell?ed|titled)\s+(.+)$/.exec(text);
  if (m) return tidyLabel(m[1]);
  // "for the pasta" / "for pasta" after a duration or time.
  m = new RegExp('(?:seconds?|minutes?|mins?|hours?|hrs?|am|pm|o clock|\\d)\\s+(?:for|to)\\s+(?:the\\s+|my\\s+)?(.+)$').exec(text);
  if (m && !/^(?:\d|a |an |one |two |three |four |five )/.test(m[1])) return tidyLabel(m[1]);
  // Words right before the noun: "tea timer", "set a tea timer", "4 minute tea timer",
  // "airport alarm at 5". Walk back from the noun until a filler, number or unit word.
  m = new RegExp('^(.*?)\\b' + noun + '\\b').exec(text);
  if (m) {
    var words = m[1].trim().split(/\s+/);
    var kept = [];
    for (var i = words.length - 1; i >= 0; i--) {
      if (!words[i] || LABEL_STOP.test(words[i])) break;
      kept.unshift(words[i]);
    }
    if (kept.length) return tidyLabel(kept.join(' '));
  }
  return '';
}

function tidyLabel(label) {
  label = label.replace(/\b(please|thanks|thank you|now|right now)\b/g, '').replace(/\s+/g, ' ').trim();
  label = label.replace(/^(?:the|my)\s+/, '');
  if (!label) return '';
  if (label.length > 18) label = label.slice(0, 18).trim();  // the watch keeps 18 characters
  return label.charAt(0).toUpperCase() + label.slice(1);
}

var HOUR_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12
};
var MINUTE_WORDS = {
  oh: 0, 'o': 0, fifteen: 15, thirty: 30, 'forty five': 45, 'fortyfive': 45, ten: 10, twenty: 20,
  'twenty five': 25, five: 5, forty: 40, fifty: 50, 'fifty five': 55, 'thirty five': 35,
  'oh five': 5, 'o five': 5, 'twenty': 20, 'forty': 40
};

// Finds a clock time. Returns { hour (0-23 or 1-12), minute, meridiem: 'am'|'pm'|null,
// tomorrow: bool } or null.
function parseClock(text) {
  var tomorrow = /\btomorrow\b/.test(text);
  if (/\bnoon\b/.test(text)) return { hour: 12, minute: 0, meridiem: 'pm', tomorrow: tomorrow, exact24: true };
  if (/\bmidnight\b/.test(text)) return { hour: 0, minute: 0, meridiem: 'am', tomorrow: tomorrow, exact24: true };
  var meridiem = null;
  if (/\b(am|in the morning|this morning|tomorrow morning)\b/.test(text)) meridiem = 'am';
  if (/\b(pm|in the evening|tonight|this evening|in the afternoon|this afternoon)\b/.test(text)) meridiem = 'pm';
  var m = /\b(\d{1,2}):(\d{2})\b/.exec(text) || /\b(?:at|for)\s+(\d{1,2})\s?(\d{2})\b/.exec(text);
  var hour = null, minute = 0;
  if (m) {
    hour = parseInt(m[1], 10);
    minute = parseInt(m[2], 10);
  } else if ((m = /\b(\d{3,4})\s*(am|pm)\b/.exec(text))) {
    // "630 am"
    hour = Math.floor(parseInt(m[1], 10) / 100);
    minute = parseInt(m[1], 10) % 100;
  } else if ((m = /\b(?:at|for|to|until)\s+(\d{1,2})\b(?!\s*(?:seconds?|minutes?|mins?|hours?|hrs?))/.exec(text)) ||
             (m = /\b(\d{1,2})\s*(?:am|pm|o clock|oclock)\b/.exec(text))) {
    hour = parseInt(m[1], 10);
  } else {
    var words = /\b(?:at|for|to)\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:\s+(oh five|o five|fifteen|thirty five|thirty|forty five|fifty five|forty|fifty|twenty five|twenty|ten|five|o clock|oclock))?\b/.exec(text);
    if (!words) return null;
    hour = HOUR_WORDS[words[1]];
    if (words[2] && !/clock/.test(words[2])) minute = MINUTE_WORDS[words[2]] || 0;
  }
  if (/\bhalf past\b/.test(text)) minute = 30;
  if (/\bquarter past\b/.test(text)) minute = 15;
  if (/\bquarter (?:to|til|till)\b/.test(text) && hour !== null) {
    hour = hour - 1;
    minute = 45;
  }
  if (hour === null || hour > 23 || minute > 59) return null;
  return { hour: hour, minute: minute, meridiem: meridiem, tomorrow: tomorrow, exact24: hour > 12 || hour === 0 };
}

// Next time this clock reading happens after `now` (a Date). Without am/pm, picks
// whichever of the two readings comes first.
function nextOccurrence(clock, now) {
  var candidates = [];
  function at(h, dayOffset) {
    var d = new Date(now.getTime());
    d.setDate(d.getDate() + dayOffset);
    d.setHours(h, clock.minute, 0, 0);
    return d;
  }
  var hours = [];
  if (clock.exact24) hours = [clock.hour];
  else if (clock.meridiem === 'am') hours = [clock.hour % 12];
  else if (clock.meridiem === 'pm') hours = [(clock.hour % 12) + 12];
  else hours = [clock.hour % 12, (clock.hour % 12) + 12];
  for (var day = 0; day <= 2; day++) {
    for (var i = 0; i < hours.length; i++) candidates.push(at(hours[i], day));
  }
  candidates.sort(function (a, b) { return a - b; });
  var earliest = clock.tomorrow ? at(0, 1) : now;
  for (var j = 0; j < candidates.length; j++) {
    if (candidates[j] > earliest) return candidates[j];
  }
  return null;
}

var WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
var WEEKDAY_PHRASE = /\b(?:(?:on|for|this|next|coming)\s+)*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?\b/;

// "for Wednesday", "on friday", "next monday" -> { day: 0-6, next: bool, rest: text without it }.
function findWeekday(text) {
  var m = WEEKDAY_PHRASE.exec(text);
  if (!m) return null;
  return {
    day: WEEKDAYS.indexOf(m[1]),
    next: /\bnext\s/.test(m[0]),
    rest: (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim()
  };
}

// The hour on a day ahead. Without am/pm, 5-11 is morning and anything else is
// afternoon or evening, since a day ahead has no "soonest" to go by.
function dayHour(clock) {
  if (clock.exact24) return clock.hour;
  var pm = clock.meridiem ? clock.meridiem === 'pm' : !(clock.hour >= 5 && clock.hour <= 11);
  return (clock.hour % 12) + (pm ? 12 : 0);
}

// The alarm on that weekday: today if it's that day and the time is still ahead, else the
// next one ("next" on the same day means a week out).
function onWeekday(clock, weekday, now) {
  var ahead = (weekday.day - now.getDay() + 7) % 7;
  var d = new Date(now.getTime());
  d.setDate(d.getDate() + ahead);
  d.setHours(dayHour(clock), clock.minute, 0, 0);
  if (ahead === 0 && (weekday.next || d <= now)) d.setDate(d.getDate() + 7);
  return d;
}

var MONTHS = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3, may: 4,
  june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7, september: 8, sept: 8, sep: 8,
  october: 9, oct: 9, november: 10, nov: 10, december: 11, dec: 11
};
var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];
var ORDINALS = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9,
  tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15,
  sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30
};
var MONTH_RE = '(' + Object.keys(MONTHS).join('|') + ')';
var ORDINAL_WORD_RE = '(?:(twenty|thirty) )?(' + Object.keys(ORDINALS).join('|') + ')';
var DAY_RE = '(?:(\\d{1,2})(?:st|nd|rd|th)?|' + ORDINAL_WORD_RE + ')';
var LEAD_RE = '(?:(?:on|for) )?(?:the )?';
var DATE_PATTERNS = [
  // "December 3rd", "dec 3 2027", "december the third"
  { re: new RegExp('\\b' + LEAD_RE + MONTH_RE + ' (?:the )?' + DAY_RE + '(?: (\\d{4}))?\\b'), month: 1, day: 2, year: 5 },
  // "the 3rd of December", "3 december"
  { re: new RegExp('\\b' + LEAD_RE + DAY_RE + ' (?:of )?' + MONTH_RE + '(?: (\\d{4}))?\\b'), month: 4, day: 1, year: 5 },
  // "12/18", "12/18/2026"
  { re: /\b(?:(?:on|for) )?(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?\b/, numeric: true },
  // "on the 25th": this month, or next if that's gone
  { re: new RegExp('\\b(?:(?:on|for) )?the ((\\d{1,2})(?:st|nd|rd|th)|' + ORDINAL_WORD_RE + ')\\b'), dayOnly: true }
];

function dayFrom(m, at) {
  if (m[at]) return parseInt(m[at], 10);
  var word = m[at + 2];
  if (!word) return null;
  return ORDINALS[word] + (m[at + 1] === 'twenty' ? 20 : m[at + 1] === 'thirty' ? 30 : 0);
}

// "December 3rd", "12/18", "the 25th" -> { month (0-11 or null), day, year (or null), rest }.
function findDate(text) {
  for (var i = 0; i < DATE_PATTERNS.length; i++) {
    var p = DATE_PATTERNS[i];
    var m = p.re.exec(text);
    if (!m) continue;
    var found;
    if (p.numeric) {
      var year = m[3] ? parseInt(m[3], 10) : null;
      if (year !== null && year < 100) year += 2000;
      found = { month: parseInt(m[1], 10) - 1, day: parseInt(m[2], 10), year: year };
    } else if (p.dayOnly) {
      found = { month: null, day: dayFrom(m, 2), year: null };
    } else {
      found = { month: MONTHS[m[p.month]], day: dayFrom(m, p.day), year: m[p.year] ? parseInt(m[p.year], 10) : null };
    }
    found.rest = (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
    return found;
  }
  return null;
}

// The alarm on that date. With no year it's the next time that date comes round; with
// only a day of the month it's this month, or next month once that day has gone.
function onDate(clock, date, now) {
  var month = date.month === null ? now.getMonth() : date.month;
  var year = date.year === null ? now.getFullYear() : date.year;
  function build(y, mo) {
    var d = new Date(y, mo, date.day, dayHour(clock), clock.minute, 0, 0);
    return d.getDate() === date.day ? d : null;  // no Feb 30th
  }
  var d = build(year, month);
  if (date.year === null) {
    for (var tries = 0; tries < 12 && (!d || d <= now); tries++) {
      if (date.month === null) {
        month++;
      } else {
        year++;
      }
      d = build(year + Math.floor(month / 12), month % 12);
    }
  }
  return d;
}

function describeDate(date) {
  if (date.month === null) return 'the ' + date.day + ordinalSuffix(date.day);
  return MONTH_NAMES[date.month] + ' ' + date.day;
}

function ordinalSuffix(n) {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][n % 10] || 'th';
}

var TIMER_WORDS = /\b(timer|timers|countdown|count down)\b/;
var ALARM_WORDS = /\b(alarm|alarms|wake me( up)?)\b/;
var REMINDER_WORDS = /\breminders?\b/;
var CANCEL_WORDS = /\b(cancel|stop|delete|remove|clear|turn off|get rid of|kill|dismiss)\b/;
var LIST_WORDS = /\b(what|which|list|show|any|how much time|how long)\b/;
// Words that mean the ask is for the agent, not the watch: "tell Claude I set an alarm".
var DELEGATE_START = /^(tell|ask|message|send|text|email|remind|note|write|search|look up|google|research|draft|explain)\b/;

function parse(text, now) {
  now = now || new Date();
  var t = normalize(text);
  if (!t) return { kind: 'agent' };
  var isTimer = TIMER_WORDS.test(t);
  var isAlarm = ALARM_WORDS.test(t);
  // "What reminders do I have", "cancel the dentist reminder": the watch's own reminders.
  // Setting one ("remind me ...") is read before this, where the reminder settings are known.
  if (!isTimer && !isAlarm && REMINDER_WORDS.test(t) && !DELEGATE_START.test(t)) {
    if (CANCEL_WORDS.test(t)) {
      var rlabel = '';
      var rm = /(?:the|my)\s+([a-z ]{2,30}?)\s+reminder/.exec(t) || /reminders?\s+(?:to|about|for)\s+([a-z ]{2,40})$/.exec(t);
      if (rm && !/^(all|every|current|last|next|only)$/.test(rm[1].trim())) rlabel = tidyLabel(rm[1]);
      return { kind: 'cancel_reminder', label: rlabel };
    }
    if (LIST_WORDS.test(t) && !/\b(set|start|create|make|add)\b/.test(t)) return { kind: 'list', which: 'reminder' };
    return { kind: 'agent' };
  }
  // "remind me in 10 minutes to ..." goes to the agent; only plain timer/alarm asks stay local.
  if (!isTimer && !isAlarm) return { kind: 'agent' };
  if (DELEGATE_START.test(t)) return { kind: 'agent' };

  if (CANCEL_WORDS.test(t)) {
    var kindWord = isTimer ? 'timer' : 'alarm';
    var label = '';
    var m = new RegExp('(?:the|my)\\s+([a-z ]{2,30}?)\\s+' + kindWord).exec(t);
    if (m && !/^(all|every|current|last|next|only)$/.test(m[1].trim())) label = tidyLabel(m[1]);
    return { kind: isTimer ? 'cancel_timer' : 'cancel_alarm', label: label };
  }
  if (LIST_WORDS.test(t) && !/\b(set|start|create|make|add)\b/.test(t)) {
    return { kind: 'list', which: isTimer && !isAlarm ? 'timer' : isAlarm && !isTimer ? 'alarm' : '' };
  }

  if (isTimer) {
    var seconds = parseDuration(t);
    if (!seconds) return { kind: 'unclear', reason: 'How long should the timer be?' };
    if (seconds > 24 * 3600) return { kind: 'unclear', reason: 'Timers can be up to 24 hours.' };
    return { kind: 'timer', seconds: seconds, label: extractLabel(t, 'timer') };
  }

  // Alarm. "alarm in 20 minutes" is a duration too.
  if (/\bin\s/.test(t) && parseDuration(t)) {
    return { kind: 'alarm', time: Math.round(now.getTime() / 1000) + parseDuration(t), label: extractLabel(t, 'alarm') };
  }
  var date = findDate(t);
  if (date) {
    var invalid = date.month === null ? date.day < 1 || date.day > 31
      : date.month < 0 || date.month > 11 || date.day < 1 || date.day > 31;
    if (invalid || !date.day) return { kind: 'unclear', reason: 'Which date was that?' };
    var dateRest = findWeekday(date.rest);  // "Wednesday, December 3rd"
    dateRest = dateRest ? dateRest.rest : date.rest;
    var dateClock = parseClock(dateRest);
    if (!dateClock) return { kind: 'unclear', reason: 'What time on ' + describeDate(date) + '?' };
    var onDay = onDate(dateClock, date, now);
    if (!onDay) return { kind: 'unclear', reason: 'There\'s no ' + describeDate(date) + '.' };
    if (onDay <= now) return { kind: 'unclear', reason: 'That date has already passed.' };
    return { kind: 'alarm', time: Math.round(onDay.getTime() / 1000), label: extractLabel(dateRest, 'alarm') };
  }
  var weekday = findWeekday(t);
  if (weekday) {
    var dayName = WEEKDAYS[weekday.day].charAt(0).toUpperCase() + WEEKDAYS[weekday.day].slice(1);
    var dayClock = parseClock(weekday.rest);
    if (!dayClock) return { kind: 'unclear', reason: 'What time ' + dayName + '?' };
    var onWeek = onWeekday(dayClock, weekday, now);
    return { kind: 'alarm', time: Math.round(onWeek.getTime() / 1000), label: extractLabel(weekday.rest, 'alarm') };
  }
  var clock = parseClock(t);
  if (!clock) return { kind: 'unclear', reason: 'What time should the alarm be?' };
  var when = nextOccurrence(clock, now);
  if (!when) return { kind: 'unclear', reason: 'What time should the alarm be?' };
  return { kind: 'alarm', time: Math.round(when.getTime() / 1000), label: extractLabel(t, 'alarm') };
}

// Words that pick an agent for one message: "tell Claude ...", "ask Grok ...",
// "ChatGPT, ...". `agents` is [{uuid, name}]. Returns {agent, message} or null.
function pickAgent(text, agents) {
  var raw = String(text || '').trim();
  var lower = raw.toLowerCase();
  for (var i = 0; i < agents.length; i++) {
    var names = aliasesFor(agents[i].name);
    for (var j = 0; j < names.length; j++) {
      var re = new RegExp('^(?:(?:hey|ok|okay)\\s+)?(?:(?:tell|ask|message|send( this)? to|text)\\s+)?' +
        names[j].replace(/ /g, '\\s*') + '\\b[\\s,:.-]*(?:to\\s+|that\\s+)?', 'i');
      var m = re.exec(lower);
      if (m && (m[0].length < lower.length)) {
        var rest = raw.slice(m[0].length).trim();
        if (!rest) continue;
        return { agent: agents[i], message: rest.charAt(0).toUpperCase() + rest.slice(1) };
      }
    }
  }
  return null;
}

function aliasesFor(name) {
  var n = String(name || '').toLowerCase();
  var extra = [];
  Object.keys(brand.agentAliases || {}).forEach(function (k) {
    if (n.indexOf(k) >= 0) extra = extra.concat(brand.agentAliases[k]);
  });
  if (/grok/.test(n)) return ['grok bot', 'grok'].concat(extra);
  if (/chatgpt|chat gpt/.test(n)) return ['chatgpt', 'chat gpt', 'chat g p t'].concat(extra);
  if (/claude/.test(n)) return ['claude', 'cloud'].concat(extra);  // dictation often hears "cloud"
  if (/muse/.test(n)) return ['muse'].concat(extra);
  return [n].concat(extra);
}

module.exports = {
  parse: parse,
  pickAgent: pickAgent,
  parseDuration: parseDuration,
  parseClock: parseClock,
  nextOccurrence: nextOccurrence,
  normalize: normalize
};
