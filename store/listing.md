# Bucky: Pebble App Store listing

Text and pictures for the store page. Nothing here is uploaded automatically.

## Name

Bucky

## Category

Tools & Utilities

## Short description

Talk to your watch. Timers, alarms, weather, music, apps, texts, notes and reminders, with your AI agent for the rest.

## Description

Bucky is a plugin-powered voice assistant for your Pebble, and a spiritual successor to Bobby and
Billy. Press Select and talk. Bucky does the everyday things right on the watch and hands everything
else to the AI agent you choose: Claude, Muse, Grok Bot or ChatGPT. There are no API keys and no
accounts to set up in Bucky. It uses the Pebble app's plugins, so whatever you've installed and
signed in to there, Bucky can use.

**Timers and alarms**
- "Set a timer for 10 minutes", "pasta timer for 12 minutes", "timer for an hour and a half".
- "Wake me up at 6:30", "alarm at 18:45", "alarm in 20 minutes".
- Days and dates: "doctor alarm Wednesday at 1pm", "dentist alarm December 3rd at 9am",
  "alarm on 12/18 at 7".
- Name them and the name shows everywhere: on the ringing screen, in the lists and on the timeline.
- They ring on the watch even when Bucky is closed. Bucky waves and the screen counts up how
  long it's been going.
  - Alarms: Up snoozes 5 minutes, Select silences, Down dismisses.
  - Timers: Up starts the same timer again, Select silences and keeps counting, Down dismisses.
- Every timer and alarm is a timeline pin, so it shows in your timeline and in Quick View as it
  gets close. Bucky's row in the app list counts the next timer down to the second.
- "What timers do I have?", "show my alarms" or Down on the home screen opens the lists. Select
  one to delete it. "Cancel my timer" or "stop the pasta timer" works too.
- Choose how alarms and timers buzz, separately: strong, gentle, a few nudges then quiet, or silent.
- With the Index app, alarms and timers can ring on your phone instead. The watch is the default.

**Weather**
- "What's the weather?", "how cold is it?", "will I need an umbrella tomorrow?", "is it going to
  snow this weekend?", "weather on Friday", "forecast for the week".
- "When is sunset?", "what time is sunrise tomorrow?"
- Answers come up on a reply screen with Bucky, a headline and the details. Uses the weather
  provider you picked in the Pebble app (built in, MET Norway or any weather plugin), in your units
  and your 12 or 24-hour clock.

**Music**
- "Pause", "play music", "skip this song", "next track", "go back a song".
- "What's playing?" shows the song, artist and album.
- Works with whatever is playing on your phone.

**Apps**
- "Launch Workout", "open Weather", "start the stopwatch". Bucky finds the app on your watch by
  name and opens it.

**Messages**
- "Text Sam I'm on my way", "send a message to Mom saying call me back", "tell my wife I'll be
  late", "let my wife know I'm on my way".
- Sends through Beeper (Index), another Beeper plugin or the Chat plugin (Beeper, iMessage,
  WhatsApp, Telegram, SMS), to the chats you've allowed there.
- On Android, it can also send through the Google Messages plugin, which uses a small bridge
  server you host yourself (github.com/blacklava2002/pebble-gmessages-plugin).
- Name aliases: add "Sam = Samantha, wife" in settings, and "text Samantha" and "tell my wife"
  both reach the chat named Sam.
- Text someone once and "tell Alex I'm on my way" or "let Alex know dinner's ready" works for
  them from then on.
- Bucky shows each message on the watch before it goes. Select sends it, Back drops it.

**Notes and reminders**
- "Take a note that the filter is 16x25", "note to self buy stamps".
- "Remind me to call the plumber tomorrow at 9", "remind me in 20 minutes to check the oven".
  Reminders ring on the watch with a timeline pin, no other app needed.
- "Add eggs to my grocery list" puts it in the list of that name.
- Pick where notes, lists and (if you like) reminders go in settings, from the plugins you've
  installed: Index, Apple Notes, Google Tasks & Keep, Notion, Obsidian, Roam, Remember The Milk,
  TickTick, Todoist and more.

**Your phone**
- "Find my phone" rings it, even on silent. "Stop ringing" or "I found it" stops it.
- "What's my phone's battery?" shows the battery level and whether it's on Wi-Fi or mobile data.

**Your AI agent**
- Anything else goes to the agent you chose in settings: "what's on my calendar today?", "plan
  a dinner for Saturday".
- Say "tell Claude ...", "ask Muse ...", "ask Grok ..." or "ChatGPT, ..." to send one message to a different agent.
- You get a receipt on the watch ("Sent to Claude"). The agent answers in its own app.

**Made to fit how you use it**
- Up on the home screen lists example prompts. Pick one and Bucky acts on it as if you'd said it.
  Change the list in settings.
- Open Bucky from a quick-launch button and it starts listening straight away.
- Optionally check the transcript before Bucky acts.
- Optionally turn on Quiet Time while Bucky listens, so a notification can't cut you off mid-sentence.
  Your Quiet Time settings go back the way they were afterwards.
- Every feature has a checkbox in settings. Turn one off and those words go to your agent instead,
  for example messages to your agent rather than Beeper.
- On the Pebble Time 2 and Round 2, Bucky is drawn bigger to fill the screen.

**What you need**
- The Pebble app with plugins turned on (Settings, Plugins).
- An agent plugin (Claude, Muse, Grok Bot or ChatGPT) for agent messages, and the Chat plugin for
  texts, and a notes or reminders plugin for those. Timers, alarms, weather, music, apps and
  your phone work without them.
- Any Pebble with a microphone: Pebble Time, Time Steel, Time Round, Pebble 2, Pebble 2 Duo,
  Pebble Time 2 and Round 2. Speech is the watch's own dictation, in English.

Bucky is open source under the MIT License. Thanks to Bobby and Billy, whose apps inspired it.

## Store assets

The developer portal asks for these. Make them from the chosen icon and the CI emulator screenshots.

- Large icon and small icon (144 x 144 and 48 x 48 PNG): `icon-144.png` and `icon-48.png` here
- Up to 5 unframed screenshots per platform, at the watch's own size: basalt and diorite 144 x 168, chalk 180 x 180, emery 200 x 228
- A marketing banner (720 x 320 PNG), plus up to 3 optional header images

## Source

https://github.com/blacklava2002/Bucky
