// Branding for the phone side: the name, the words you call it by and its app ID. The watch
// side's name and colours are in src/c/brand.h, the art in resources/images (sprite_*.png,
// menu_icon*.png), and the store name and UUID in package.json. A rebrand only touches those.

module.exports = {
  name: 'Bucky',
  // Prefix for timeline pin IDs and plugin operation IDs, and the log tag.
  id: 'bucky',
  // This app's UUID; must match "uuid" in package.json. Used to leave this app out of
  // "open ..." matches.
  uuid: '7f05c316-11a1-4eb6-b3bf-29f630ac7ff7',
  // What you call it, as a regex alternation (lower case). Dropped from the start of what you say,
  // so "hey Bucky, set a timer" works. Dictation spells it a few ways.
  wake: 'bucky|buckie|buckey',
  // Extra spoken names for agent plugins, keyed by a word in the plugin's name,
  // like { muse: ['my assistant'] }. "Tell <name> ..." then goes to that agent.
  agentAliases: {},
  // The watch's own colours (THEME_BG and THEME_FG in brand.h) as GColor8 argb bytes,
  // for the settings page's preview.
  colors: { bg: 197, clock: 255 }
};
