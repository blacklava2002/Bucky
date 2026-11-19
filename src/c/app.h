// Shared declarations between the watch modules.
#pragma once
#include <pebble.h>
#include "clock.h"
#include "brand.h"

#define AGENT_NAME_LEN 24

// Settings the phone pushes; kept on the watch so a cold launch shows them.
const char *settings_agent_name(void);
bool settings_confirm(void);
bool settings_quick_talk(void);
// Turn Quiet Time on while listening (the phone does the switching).
bool settings_quiet_listen(void);
// How alarms and timers buzz: the same numbers the phone's settings use.
typedef enum { VibeStrong = 0, VibeGentle = 1, VibeNudge = 2, VibeOff = 3 } Vibe;
Vibe settings_vibe(ClockKind kind);

// Phone link (main.c).
bool comm_send_transcript(const char *text, int32_t request_id, bool done_listening);
bool comm_confirm_send(int32_t request_id);
// Asks the phone to turn Quiet Time on (true) or put it back (false).
bool comm_listen(bool listening);

// Home screen (home.c).
void home_window_push(bool start_talking);
// ok: 0 failed, 1 done, 2 still working, 3 asks first (a message shown with "Select sends").
void home_handle_result(int32_t request_id, int ok, const char *text, const char *detail,
                        const char *reply);
void home_handle_clock(int32_t request_id, int kind, int32_t value, const char *label);
void home_refresh_settings(void);
// Select on the "Send?" screen.
void home_confirm_send(int32_t request_id);
// The phone has turned Quiet Time on: start listening.
void home_quiet_ready(void);

// The Down menu: Alarms and Timers (menu.c).
void menu_window_push(void);
// One list, timers or alarms (lists.c).
void clock_list_push(ClockKind kind);

// Example prompts on the Up button (prompts.c).
#define PROMPTS_MAX 10
#define PROMPTS_MAX_TEXT 700
void prompts_init(void);
void prompts_set(const char *text);
int prompts_count(void);
const char *prompts_get(int index);

// Reply screen: a headline and an answer to read (reply.c).
void reply_window_push(const char *headline, const char *body);
// The same screen asking first: Select calls home_confirm_send(request_id), Back cancels.
void reply_window_push_confirm(const char *headline, const char *body, int32_t request_id);

// Ringing screen (ring.c).
void ring_window_push(const ClockItem *item);

// The sprite's frames (sprite.c). The art is in resources/images/sprite_*.png.
typedef enum {
  SpriteIdle = 0,
  SpriteTalk,
  SpriteWave,
  SpriteListen,
  SpriteFrameCount,
} SpriteFrame;
GBitmap *sprite_frame(SpriteFrame frame);
void sprite_release(void);

