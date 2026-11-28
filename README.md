# Bucky

A plugin-powered voice assistant for Pebble, and a spiritual successor to Bobby and Billy. Press Select and talk. Bucky sets timers
and alarms on the watch, answers weather, battery and music questions, plays and skips songs,
opens watch apps, texts your contacts through Beeper and other chat apps, saves notes and
reminders to the app you pick, and hands everything
else to the agent plugin you picked: Claude, Muse, Grok Bot or ChatGPT. No API keys, no server:
it uses the Pebble app's plugin API (`Pebble.invokeAction`, `Pebble.subscribeToSource`), the same
thing the Index ring uses. Each of these can be turned off in settings, and then those words go to
your agent instead.

## What Bucky does

- **Home screen:** laid out like Bobby's: the time big on top, Bucky below, and an action bar.
  Up shows example prompts, Select talks, Down opens Alarms and Timers. A short line under the
  time says what Bucky is doing or what came of it, then clears.
- **Example prompts:** Up lists a few things to say ("What's the current weather?", "Set a 5
  minute tea timer.", ...). Pick one and Bucky acts on it as if you'd said it. Edit the list
  in settings (up to 10).
- **Transcript log:** settings keeps the last 100 things you said and what came of them,
  step by step, including each try at an agent and why it failed, in a scrolling box. Export it
  as JSON or CSV, or clear it any time.
- **Backup:** settings saves every setting as a JSON file (or copies it), and restores one,
  to keep or to move to another phone.
- **Colors:** pick the background and the clock's color in settings, from Pebble's 64 colors.
  Other text turns black or white to stay readable. Black and white watches use black or white.
- **Talk:** Select on the home screen (or open it from a quick-launch button, which starts
  listening straight away). Dictation is the watch's own.
- **Agents:** everything Bucky doesn't handle itself goes to the agent chosen in settings. Say
  "tell Claude ...", "ask Muse ...", "ask Grok ..." or "ChatGPT, ..." to send one message
  somewhere else. You get a receipt ("Sent to Claude"), not the agent's answer.
- **Timers:** "set a timer for 10 minutes", "pasta timer for 12 minutes", "timer for an hour
  and a half", "cancel my timer", "stop the pasta timer".
- **Alarms:** "set an alarm for 6:30 am", "wake me up at 7 tomorrow", "alarm at 18:45",
  "alarm in 20 minutes", "cancel my alarm".
- **Did you mean:** "set a timer for 4:05 ..." is a time, not a length, so the watch asks: Up
  sets an alarm, Down a reminder, Select listens again and Back cancels.
- **Weekdays:** "set Doctor alarm for Wednesday at 1pm", "alarm on friday at 6:30 am". If today is
  that weekday and the time is still ahead, it rings today ("Alarm set: 1:00 PM today");
  otherwise it rings on the next one. "next wednesday" always means a week out. With no am/pm,
  5 to 11 is morning and anything else is afternoon. Alarms ring once; there are no repeats.
- **Dates:** "dentist alarm December 3rd at 9am", "alarm on 12/18 at 7", "the 3rd of January at
  6", "alarm for the 25th at 8" (this month, or next once it's gone). A date with no year is the
  next time it comes round.
- **Alarms and Timers:** Down on the home screen, or "what timers do I have" / "show my alarms".
  Timers count down live with their name under them; alarms show the time with the day and name
  under it. Select one to delete it.
- **Weather:** "what's the weather", "how cold is it", "will I need an umbrella tomorrow", "weather
  on Friday", "is it going to snow this weekend", "forecast for the week". Bucky reads the weather
  provider you picked in the Pebble app (Settings, Weather: the built-in one, MET Norway, or any
  plugin that serves weather) and answers on the reply screen: Bucky talking, the answer beside
  him, the details under it. Up and Down scroll, Back goes home. Bucky's settings can name a
  different provider. The Pebble app asks once to let Bucky use your location for it.
  "When is sunset?" and "what time is sunrise tomorrow?" work too, and times follow the 12 or
  24-hour clock set in the Pebble app (its Preferences plugin).
- **Phone battery:** "what's my battery level", "what is my phone's battery percentage", "is my
  phone charged". Read from the Pebble app's built-in Phone plugin and shown on the reply screen
  ("Phone at 62%", with Wi-Fi or mobile data under it). The plugin gives the level only, not
  whether the phone is charging.
- **Flip a coin:** "flip a coin", "coin toss", "heads or tails". Bucky flips it himself and shows
  Heads or Tails in big letters over a coin with his face (heads) or a deer tail (tails), in his
  place, with a buzz, whichever agent is picked and even with none. Only the coin ask on its own
  counts, so "ask Claude to flip a coin" still goes to Claude.
- **Find my phone:** "find my phone", "where's my phone", "I lost my phone" ring the phone for a
  minute, even on silent, through the Pebble app's built-in Find My Phone plugin. "Stop ringing" or
  "I found it" stops it sooner. The Pebble app asks once to let Bucky use Find My Phone.
- **Music:** "pause", "play music", "skip this song", "next track", "go back a song", "previous
  track" control whatever is playing on the phone, through the Pebble app's built-in Music plugin.
  "What's playing?" or "what song is this?" shows the song and artist on the reply screen.
- **Open apps:** "launch Workout", "open Weather", "start the stopwatch". Bucky reads the watch's
  app list (built-in Watch State plugin), picks the closest name and opens it, which closes Bucky.
  "Launch" with no matching app says so; "open" or "start" with no matching app goes on to timers
  or the agent, so "open the garage door" still reaches your agent.
- **Messages:** "text Samantha I'm on my way", "send a message to Mom saying call me back", "send
  Sam a text that I left", "tell my wife I'll be late", "ask Alex: what time is dinner", "let
  my wife know I'm on my way". Bucky
  sends the words straight to a messaging plugin, not to your agent: Beeper (Index) first, then
  any other Beeper plugin, then the Chat plugin (Beeper, iMessage, WhatsApp, Telegram, SMS). Each
  only sends to chats you've allowed: in the Index app for Beeper (Index), or the plugin's own
  settings for the others.
  - **Google Messages:** on Android, install the Google Messages plugin from
    [pebble-gmessages-plugin](https://github.com/blacklava2002/pebble-gmessages-plugin), which
    sends through a small server you run that pairs with Google Messages on your phone. Bucky
    sends to it like any other messaging plugin and picks up the names of your recent chats from
    it, so aliases and "tell X" work there too.
  - **Name aliases:** in settings, one contact per line, like `Sam = Samantha, wife`. Then
    "text Samantha ..." and "tell my wife ..." both go to Sam. "Tell", "ask" and "let ... know" only
    send to names in this list and to people you've texted through Bucky before, so "tell me a
    joke" and "tell Claude ..." still go to agents. The messaging plugins don't share their
    approved contacts, so Bucky learns them from sends that worked: "text Alex ..." once, and
    "tell Alex ..." works from then on. Settings lists them, with a button to forget them.
  - **Check first:** by default the watch shows "Send to Sam?" and the words before anything is
    sent. Select sends, Back drops it. You can turn this off in settings.
  - **Send by itself:** the message check and the transcript check send by themselves after 15
    seconds, with a countdown on screen. Up, Down or Back stops it. Change the wait or turn it
    off in settings.
- **Notes:** "take a note that the filter is size 16x25", "note to self buy stamps", "jot down
  ...". Saved by the notes plugin picked in settings: Notes (Index), Apple Notes, Google Tasks &
  Keep, Notion, Obsidian, Roam, or any plugin with a `create_note` action.
- **Reminders:** "remind me to call the plumber tomorrow at 9", "remind me in 20 minutes to
  check the oven", "set a reminder for 4:05 to get the kids ready" (the next 4:05). On the
  watch by default: they ring like alarms (Up snoozes 5 minutes), get a timeline pin, and show under Reminders in the Down menu. "What reminders do I have?" and
  "cancel the dentist reminder" work too. Up to 24 timers, alarms and reminders in all.
  Or pick a reminders plugin in settings: Reminders (Index), Google Tasks, Obsidian, Remember The
  Milk, TickTick, Todoist, Tasks.org, or any plugin with `create_reminder`. Bucky works out the
  date and time for the store plugins. A time it can't read gets "When is that?" rather than a
  guess.
- **Lists:** "add eggs to my grocery list". Saved by the lists plugin picked in settings, which can
  be a different one from reminders. Store plugins get the item in the list of that name, or the
  default list if there's none.
- **Where alarms and timers ring:** on the watch (the default), or on the phone through Timers &
  Alarms (Index). The phone's alarm takes a time of day only, so alarms more than a day out stay
  on the watch either way, and Bucky can't list or cancel phone timers.
- **Turn things off:** settings has a checkbox for weather, battery, Find my phone, music, apps,
  messages, notes and reminders. Off means those words go to your agent instead (say, messages to your agent
  rather than Beeper).
- **Big screens:** on the Pebble Time 2 and Round 2 Bucky is drawn half again as big.
- **Ringing:** Bucky waves and the watch buzzes for up to 3 minutes, and the screen counts
  up how long it's been going. Works with the app closed. Alarm and timer vibration are separate
  settings: strong, gentle, a few nudges then quiet, or silent (screen only).
  - Alarm: Up snoozes 5 minutes, Select silences it, Down dismisses.
  - Timer: Up starts the same timer again, Select silences it and keeps counting, Down dismisses.
- **Names:** "tea timer for 4 minutes", "airport alarm at 5", "set a timer for 10 minutes for
  the pasta". The name shows on the pin, the ringing screen and in the list.
- **Live countdown:** Bucky's row in the app list counts the next timer down to the second.
- **Timeline:** every timer and alarm is a timeline pin, so it shows in the timeline and in the
  Quick View peek as it gets close. The peek counts in whole minutes ("In 5 minutes"); that's
  how the watch draws every pin, so seconds only show in the app list and in the app itself. Pins come and go with the list. "Open Bucky" on a pin
  opens the Timers or Alarms list. The Pebble app asks once to let Bucky use the timeline.
- **Settings page** (in the Pebble app): pick the agent (shows whether each is signed in),
  the example prompts, transcript check before acting and how long the checks wait before sending, quick-launch listening, Quiet Time while
  listening (a notification popping up mid-sentence stops the watch's dictation, so Bucky can turn
  Quiet Time on with its notifications hidden while you talk, then put both back), what Bucky does
  itself, the messaging plugin, name aliases, message check, the notes and reminders plugins,
  weather provider, where alarms and timers ring, and alarm and timer vibration.

## What Bucky can't do (yet)

- **The watch's built-in Alarms and Timer apps.** PebbleOS has no way for an app or plugin to
  create those today: apps can only peek at the next system alarm, and the built-in watch
  plugins only list and launch apps. So timers and alarms are Bucky's own (watch wakeups,
  like Bobby's). PebbleOS gives an app 8 wakeups, so Bucky keeps up to 24 and arms the 8
  soonest, arming the next each time one rings or the app opens. Two due in the same minute
  ring a minute apart. If the watch is off when one is due, it rings when the watch is back on
  within the hour, and is dropped after that. With the Index app, timers and alarms can ring
  on the phone instead (see above).
- **Agent replies on the watch.** The agent plugins only send today. The reply screen is ready
  for them when they answer.
- **Charging state.** The Phone plugin gives the battery level, not whether it's charging.
- **Contacts the messaging plugin hasn't been allowed.** Bucky can't add chats; allow them in
  the Chat (or Beeper) plugin's settings. When a name matches more than one chat, Bucky asks you
  to add an alias instead of guessing.
- **Coming back after opening an app.** Launching an app closes Bucky, as any app launch does.
- Maps and the rest of Bobby's Gemini tools.
- English phrasing only for timers and alarms.

## Adding a plugin action

Find My Phone and the music controls are these. Any plugin action can be added the same way: one entry in
`ACTIONS` in `src/pkjs/actions.js` with the plugin's UUID, the action name, any `args`, a regex
for the phrasing, and the lines to show (`working`, `done`, optional `detail`). If the plugin
needs a permission, add it to `usesPermissions` in `package.json`. To show an answer, send it back
with `reply(requestId, headline, body)` in `index.js` and the watch opens the reply screen.
Actions are checked before timers, alarms and agents; "tell Claude ..." always goes to the agent.

## Build and install

Releases follow semantic versioning, and `version` in `package.json` is the one place the
version lives. Each new version pushed to `main` gets its own release, `vX.Y.Z`, with
`Bucky_X.Y.Z.pbw` attached; the newest is always at
https://github.com/blacklava2002/Bucky/releases/latest

Every push to a branch other than `main` also gets a dev build: a pre-release named
`Bucky dev build: <branch>` (tag `dev-<branch>`) with that branch's .pbw to sideload. The next push
to the branch replaces it, so there is one per branch. Dev builds aren't versions and never go to
the app store.

To release, bump the version and push:

```sh
npm version patch --no-git-tag-version   # 0.2.0 -> 0.2.1 (fixes)
npm version minor --no-git-tag-version   # 0.2.1 -> 0.3.0 (new features)
npm version major --no-git-tag-version   # 0.3.0 -> 1.0.0
git commit -am "0.2.1" && git push
```

Pushes that don't change the version are still built and tested, but publish nothing.

Once the app has a listing on the Pebble app store, each new release is also added to that
listing. The first upload is done by hand in the developer dashboard; until then the store
step skips. It needs the repo secret `PEBBLE_APPSTORE_REFRESH_TOKEN`, the `refresh_token` from
`oauth_firebase/firebase_oauth_storage.json` in the Pebble SDK folder after `pebble login`.
Pushes to other branches do a dry run of the same sign-in and lookup.

To build locally you need Pebble SDK 4.44+ / pebble-tool 5.1+ (plugin API).

```sh
uv tool install pebble-tool      # once
pebble sdk install latest        # once
npm test                         # phone-side tests (node 18+)
pebble build                     # writes build/bucky.pbw
pebble install --phone <phone-ip>   # or sideload the .pbw in the Pebble app
```

Then in the Pebble app: turn on **Settings → Plugins**, install and sign in to the agent
plugin(s) you want, and open Bucky's settings to pick one.

Platforms: basalt, chalk, diorite, emery, flint, gabbro (every Pebble with a microphone).

## Layout

| Path | What |
|---|---|
| `src/c/main.c` | Launch, settings, phone link, wakeups |
| `src/c/home.c` | Home screen and the talk flow |
| `src/c/clock.c` | Timers and alarms (watch wakeups, saved across restarts) |
| `src/c/menu.c`, `src/c/lists.c` | The Down menu, and the Bobby-style Alarms, Timers and Reminders lists |
| `src/c/prompts.c` | The example prompts on Up |
| `src/c/reply.c` | The reply screen: Bucky, a headline and a scrolling answer |
| `src/c/suggest.c` | The "Did you mean..." screen: alarm, reminder or listen again |
| `src/c/ring.c` | The ringing screen |
| `src/pkjs/pins.js` | Turns the watch's list into timeline pins |
| `src/pkjs/actions.js` | Plugin actions Bucky runs itself, like Find My Phone |
| `src/pkjs/weather.js` | Weather asks, read from the weather source, turned into a reply |
| `src/pkjs/phone.js` | Phone battery asks, from the built-in Phone plugin |
| `src/pkjs/music.js` | "What's playing?", from the built-in Music plugin |
| `src/pkjs/apps.js` | "Launch X": the watch's app list and launch_app (Watch State plugin) |
| `src/pkjs/messages.js` | "Text X ...": parsing, aliases, the messaging plugin's send action and errors |
| `src/pkjs/indexkit.js` | The Index app's plugins: notes, reminders, lists, phone timers and alarms |
| `src/pkjs/destinations.js` | Which plugin takes notes, reminders and lists, and the store plugins' arguments |
| `src/pkjs/prefs.js` | Units and 12/24-hour clock from the Preferences plugin |
| `src/pkjs/sources.js` | One reading of another plugin's source |
| `src/pkjs/intent.js` | Transcript → timer, alarm, cancel, list, or agent |
| `src/pkjs/index.js` | Routing, agent discovery, `send_to_agent`, settings |
| `store/` | Text and icons for the Pebble App Store listing |
| `config.html` | Settings page |
| `resources/images/` | Sprite frames (`sprite_*.png`), menu icon and other icons, colour and `~bw` |
| `src/c/brand.h`, `src/pkjs/brand.js` | The name, colours, wake word and app ID (see Rebranding) |

## Rebranding

Everything that makes Bucky look and sound like Bucky lives in a few files, so a fork with its own
character only touches these:

- `src/pkjs/brand.js`: the name, the words you call it by, pin and operation ID prefix, the app
  UUID and any extra spoken names for agents.
- `src/c/brand.h`: the name shown on the watch and the theme colours.
- `resources/images/sprite_*.png` (67x82, `_big` 101x122 for Time 2 and Round 2, `~bw` for
  black and white watches) and `menu_icon.png` / `menu_icon~bw.png` (25x25).
- `package.json`: `name`, `displayName`, `uuid` (a new one, so both apps can be installed) and the
  author and links.
- `store/`: the listing text and icons.

`npm test` checks that `brand.js`, `brand.h` and `package.json` agree.

## License and credits

Bucky is under the MIT License ([LICENSE](LICENSE)), except the Bobby parts listed below, which
stay under Apache 2.0.

Thanks to [Bobby](https://github.com/pebble-dev/bobby-assistant) and
[Billy](https://github.com/TomBolger/Billy), whose apps inspired Bucky's layout and flow. Bucky's
alarm code is adapted from Bobby's, and a few of its icons are Bobby's (Apache 2.0, Copyright 2025
Google LLC). See [NOTICE](NOTICE) for exactly which files, and
[licenses/bobby-apache-2.0.txt](licenses/bobby-apache-2.0.txt) for the license.
