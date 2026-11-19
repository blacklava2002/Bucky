// Things other Pebble plugins can do, said out loud.
// Each entry maps a few phrasings to one plugin action, called through the Pebble app's
// plugin API (Pebble.invokeAction), the same way messages go to the agent plugins.
// To add one: give it the plugin's uuid and action name, the phrases, and what to say
// on the watch; if the plugin needs a permission, add it to usesPermissions in package.json.

var brand = require('./brand');

var FIND_MY_PHONE = '00000000-0000-0000-0001-000000000008';  // built into the Pebble app
var MUSIC = '00000000-0000-0000-0001-000000000003';          // built in: the phone's media player

var LEAD = '^(?:(?:ok|okay|hey|' + brand.wake + '|please|can you|could you)\\s+)*';
var MUSIC_WORD = '(?:the |my )?(?:music|song|track|tune|audio|podcast|playback|player|spotify)';

var ACTIONS = [
  {
    id: 'stop_phone',
    feature: 'findPhone',
    name: 'Find My Phone',
    plugin: FIND_MY_PHONE,
    action: 'stop',
    // "stop ringing", "I found my phone", "stop my phone", "silence my phone"
    match: new RegExp('^(?:(?:ok|okay|hey|' + brand.wake + ')\\s+)*(?:(?:stop|silence|quiet|mute|turn off|cancel)\\s+(?:the\\s+)?(?:ringing|my phone|the phone|phone ringing)|(?:i\\s+)?found (?:it|my phone|the phone)|stop finding my phone)\\b'),
    done: 'Stopped ringing your phone',
    working: 'Stopping your phone...'
  },
  {
    id: 'ring_phone',
    feature: 'findPhone',
    name: 'Find My Phone',
    plugin: FIND_MY_PHONE,
    action: 'ring',
    // "find my phone", "where's my phone", "ring my phone", "I lost my phone"
    match: new RegExp('^(?:(?:ok|okay|hey|' + brand.wake + '|please|can you|could you)\\s+)*(?:(?:find|locate|ring|ping|beep|call)\\s+(?:my|the)\\s+phone|where(?:s| is| did i (?:put|leave))\\s+(?:my|the)\\s+phone|(?:i\\s+)?(?:lost|cant find|can not find|cannot find)\\s+(?:my|the)\\s+phone|make (?:my|the) phone (?:ring|beep))\\b'),
    done: 'Ringing your phone',
    detail: 'It rings for a minute, even on silent. Say "stop ringing" to stop it sooner.',
    working: 'Ringing your phone...'
  },
  {
    id: 'pause_music',
    feature: 'music',
    name: 'Music',
    plugin: MUSIC,
    action: 'set_playing',
    args: { on: false },
    // "pause", "pause the music", "stop the music", "stop playing"
    match: new RegExp(LEAD + '(?:pause|stop|mute)(?: ' + MUSIC_WORD + '| playing| playback)?(?: (?:playing|playback))?$|^' +
      '(?:ok|okay|hey|' + brand.wake + ')?\\s*(?:pause|stop) it$'),
    done: 'Paused',
    working: 'Pausing...'
  },
  {
    id: 'play_music',
    feature: 'music',
    name: 'Music',
    plugin: MUSIC,
    action: 'set_playing',
    args: { on: true },
    // "play", "play music", "resume", "unpause the song", "keep playing"
    match: new RegExp(LEAD + '(?:(?:play|resume|unpause|continue|start)(?: ' + MUSIC_WORD + '| playing| playback)?|keep playing)$'),
    done: 'Playing',
    working: 'Starting the music...'
  },
  {
    id: 'next_track',
    feature: 'music',
    name: 'Music',
    plugin: MUSIC,
    action: 'next_track',
    // "next song", "skip", "skip this song", "play the next track"
    match: new RegExp(LEAD + '(?:(?:play )?(?:the )?next(?: ' + MUSIC_WORD + ')?|skip(?: (?:this|the|a))?(?: ' + MUSIC_WORD + ')?|skip ahead)$'),
    done: 'Skipped ahead',
    working: 'Skipping...'
  },
  {
    id: 'previous_track',
    feature: 'music',
    name: 'Music',
    plugin: MUSIC,
    action: 'previous_track',
    // "previous song", "go back a song", "last track", "play that again"
    match: new RegExp(LEAD + '(?:(?:play )?(?:the )?(?:previous|last)(?: ' + MUSIC_WORD + ')?|go back(?: (?:a|one))?(?: ' + MUSIC_WORD + ')?|(?:back|rewind) (?:a|one) ' + MUSIC_WORD + '|play (?:that|it) again)$'),
    done: 'Went back a song',
    working: 'Going back...'
  }
];

function normalize(text) {
  return String(text || '').toLowerCase().replace(/[’']/g, '').replace(/[,!?.]/g, ' ').replace(/\s+/g, ' ').trim();
}

// The plugin action this sentence asks for, or null. Only whole asks match, so
// "tell Claude to find my phone case" still goes to the agent. `enabled(feature)` can
// turn a group off (settings), so those words go to the agent instead.
function match(text, enabled) {
  var t = normalize(text);
  for (var i = 0; i < ACTIONS.length; i++) {
    if (enabled && ACTIONS[i].feature && !enabled(ACTIONS[i].feature)) continue;
    var m = ACTIONS[i].match.exec(t);
    if (m && t.slice(m[0].length).replace(/\b(please|now|for me|again)\b/g, '').trim() === '') return ACTIONS[i];
  }
  return null;
}

module.exports = { match: match, ACTIONS: ACTIONS, FIND_MY_PHONE: FIND_MY_PHONE, MUSIC: MUSIC };
