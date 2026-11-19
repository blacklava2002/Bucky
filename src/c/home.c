// Home screen, laid out like Bobby's: the time big on top and the sprite below.
// Up shows example prompts, Select talks, Down opens Alarms and Timers.
// Dictation goes to the phone, which either hands back a timer/alarm command
// for the watch or passes the words to the chosen agent plugin.
#include "app.h"

#define MAIN_LEN 64
#define SUB_LEN 160
#define REQUEST_TIMEOUT_MS 45000
#define ANIM_MS 280
#define WAVE_MS 3000
#define QUICK_EXIT_MS 4000
#define CLEAR_MS 8000
// How long to wait for the phone to turn Quiet Time on before listening anyway.
#define QUIET_WAIT_MS 1500

static Window *s_window;
static ActionBarLayer *s_action_bar;
static GBitmap *s_icon_prompts;
static GBitmap *s_icon_talk;
static GBitmap *s_icon_menu;
static TextLayer *s_time;
static BitmapLayer *s_sprite;
static TextLayer *s_main;
static DictationSession *s_dictation;

static char s_time_text[8];
static char s_main_text[MAIN_LEN];
static char s_sub_text[SUB_LEN];
static int32_t s_request_id;
static bool s_waiting;
static bool s_start_talking;
static bool s_quick;
static bool s_anim_on;
static AppTimer *s_anim_timer;
static AppTimer *s_timeout_timer;
static AppTimer *s_settle_timer;
static AppTimer *s_exit_timer;
static AppTimer *s_clear_timer;
static AppTimer *s_quiet_timer;
// The phone was asked to turn Quiet Time on for this dictation and hasn't been told it's over.
static bool s_quieted;
static void prv_unquiet(void);

static void prv_set_frame(SpriteFrame frame) {
  if (s_sprite) {
    bitmap_layer_set_bitmap(s_sprite, sprite_frame(frame));
    layer_mark_dirty(bitmap_layer_get_layer(s_sprite));
  }
}

static void prv_cancel(AppTimer **timer) {
  if (*timer) {
    app_timer_cancel(*timer);
    *timer = NULL;
  }
}

static void prv_anim_tick(void *ctx) {
  s_anim_timer = NULL;
  if (!s_waiting) return;
  s_anim_on = !s_anim_on;
  prv_set_frame(s_anim_on ? SpriteTalk : SpriteListen);
  s_anim_timer = app_timer_register(ANIM_MS, prv_anim_tick, NULL);
}

static void prv_settle(void *ctx) {
  s_settle_timer = NULL;
  if (!s_waiting) prv_set_frame(SpriteIdle);
}

static void prv_quick_exit(void *ctx) {
  s_exit_timer = NULL;
  window_stack_pop_all(true);
}

// One short line between the time and the sprite: what the app is doing or what came of it.
// It clears itself a few seconds after a result, so the idle screen has no text.
static void prv_show(const char *main, const char *sub) {
  snprintf(s_main_text, sizeof(s_main_text), "%s", main ? main : "");
  snprintf(s_sub_text, sizeof(s_sub_text), "%s", sub ? sub : "");
  if (s_main) text_layer_set_text(s_main, s_main_text);
}

static void prv_clear(void *ctx) {
  s_clear_timer = NULL;
  if (!s_waiting) prv_show("", "");
}

static void prv_show_idle(void) {
  prv_show("", "");
  prv_set_frame(SpriteIdle);
}

static void prv_start_waiting(void) {
  s_waiting = true;
  prv_cancel(&s_anim_timer);
  s_anim_timer = app_timer_register(ANIM_MS, prv_anim_tick, NULL);
}

static void prv_finish(bool ok, const char *main, const char *sub) {
  s_waiting = false;
  prv_cancel(&s_anim_timer);
  prv_cancel(&s_timeout_timer);
  prv_show(main, sub);
  prv_set_frame(ok ? SpriteWave : SpriteIdle);
  prv_cancel(&s_settle_timer);
  s_settle_timer = app_timer_register(WAVE_MS, prv_settle, NULL);
  prv_cancel(&s_clear_timer);
  s_clear_timer = app_timer_register(CLEAR_MS, prv_clear, NULL);
  if (ok) {
    vibes_short_pulse();
    if (s_quick) {
      prv_cancel(&s_exit_timer);
      s_exit_timer = app_timer_register(QUICK_EXIT_MS, prv_quick_exit, NULL);
    }
  } else {
    vibes_double_pulse();
  }
}

static void prv_timeout(void *ctx) {
  s_timeout_timer = NULL;
  if (!s_waiting) return;
  s_request_id++;  // ignore a late answer to this one
  prv_finish(false, "No answer from the phone", "Check the Pebble app is running. If it was a message, check the chat before sending again.");
}

static void prv_quote(const char *transcript, char *buf, size_t size) {
  snprintf(buf, size, "\"%s\"", transcript);
}

// Hands words to the phone, whether spoken or picked from the example prompts.
static void prv_send(const char *text) {
  char quoted[SUB_LEN];
  prv_quote(text, quoted, sizeof(quoted));
  prv_cancel(&s_clear_timer);
  s_request_id++;
  bool was_quiet = s_quieted;
  s_quieted = false;
  if (!comm_send_transcript(text, s_request_id, was_quiet)) {
    s_quieted = was_quiet;
    prv_unquiet();
    prv_finish(false, "Couldn't reach the phone", quoted);
    return;
  }
  prv_show("Working on it...", quoted);
  prv_start_waiting();
  prv_cancel(&s_timeout_timer);
  s_timeout_timer = app_timer_register(REQUEST_TIMEOUT_MS, prv_timeout, NULL);
}

// Listening is over: the phone puts Quiet Time back the way it was. The outbox may be
// busy for a moment, so this tries a few times (the phone also puts it back on its own
// after a while if the word never arrives).
static int s_unquiet_tries;

static void prv_unquiet_retry(void *ctx) {
  if (comm_listen(false) || ++s_unquiet_tries >= 5) return;
  app_timer_register(300, prv_unquiet_retry, NULL);
}

static void prv_unquiet(void) {
  if (!s_quieted) return;
  s_quieted = false;
  s_unquiet_tries = 0;
  prv_unquiet_retry(NULL);
}

static void prv_dictation_cb(DictationSession *session, DictationSessionStatus status,
                             char *transcription, void *ctx) {
  // The transcript itself tells the phone listening is over; anything else says so now.
  if (status != DictationSessionStatusSuccess) prv_unquiet();
  switch (status) {
    case DictationSessionStatusSuccess:
      break;
    case DictationSessionStatusFailureTranscriptionRejected:
    case DictationSessionStatusFailureTranscriptionRejectedWithError:
      prv_show_idle();
      return;
    case DictationSessionStatusFailureNoSpeechDetected:
      prv_finish(false, "Didn't catch that", "Select to try again.");
      return;
    case DictationSessionStatusFailureConnectivityError:
    case DictationSessionStatusFailureDisabled:
      prv_finish(false, "Can't listen right now", "The phone or its dictation service isn't reachable.");
      return;
    default:
      prv_finish(false, "Dictation failed", "Select to try again.");
      return;
  }
  prv_send(transcription);
}

static void prv_listen(void *ctx) {
  s_quiet_timer = NULL;
  if (!s_dictation) return;
  dictation_session_enable_confirmation(s_dictation, settings_confirm());
  dictation_session_enable_error_dialogs(s_dictation, false);
  dictation_session_start(s_dictation);
}

static void prv_talk(void) {
  prv_cancel(&s_exit_timer);
  if (s_waiting) return;
  if (!s_dictation) {
    prv_finish(false, "Can't listen", "This watch has no microphone.");
    return;
  }
  // A notification popping up mid-sentence ends the dictation, so the app can have the
  // phone turn Quiet Time on first. The phone answers when it's done; if it doesn't
  // answer soon, it listens anyway.
  if (settings_quiet_listen() && !s_quiet_timer && comm_listen(true)) {
    s_quieted = true;
    s_quiet_timer = app_timer_register(QUIET_WAIT_MS, prv_listen, NULL);
    prv_show("One moment...", "Turning on Quiet Time");
    return;
  }
  if (s_quiet_timer) return;
  prv_listen(NULL);
}

void home_quiet_ready(void) {
  if (!s_quiet_timer) return;
  app_timer_cancel(s_quiet_timer);
  prv_listen(NULL);
}

static void prv_select(ClickRecognizerRef rec, void *ctx) {
  prv_talk();
}

// ------------------------------------------------------------ example prompts (Up)

static ActionMenuLevel *s_prompt_level;

static void prv_prompt_picked(ActionMenu *menu, const ActionMenuItem *item, void *ctx) {
  const char *text = (const char *)action_menu_item_get_action_data(item);
  if (!text || s_waiting) return;
  prv_send(text);
}

static void prv_prompts_closed(ActionMenu *menu, const ActionMenuItem *performed, void *ctx) {
  action_menu_hierarchy_destroy(action_menu_get_root_level(menu), NULL, NULL);
  s_prompt_level = NULL;
}

static void prv_up(ClickRecognizerRef rec, void *ctx) {
  prv_cancel(&s_exit_timer);
  if (s_waiting || s_prompt_level) return;
  int count = prompts_count();
  if (count == 0) return;
  s_prompt_level = action_menu_level_create(count);
  for (int i = 0; i < count; i++) {
    action_menu_level_add_action(s_prompt_level, prompts_get(i), prv_prompt_picked, (void *)prompts_get(i));
  }
  ActionMenuConfig config = (ActionMenuConfig){
    .root_level = s_prompt_level,
    .colors = {
      .background = PBL_IF_COLOR_ELSE(THEME_BG, GColorBlack),
      .foreground = PBL_IF_COLOR_ELSE(THEME_FG, GColorWhite),
    },
    .align = ActionMenuAlignTop,
    .did_close = prv_prompts_closed,
  };
  action_menu_open(&config);
}

static void prv_down(ClickRecognizerRef rec, void *ctx) {
  prv_cancel(&s_exit_timer);
  menu_window_push();
}

static void prv_click_config(void *ctx) {
  window_single_click_subscribe(BUTTON_ID_SELECT, prv_select);
  window_single_click_subscribe(BUTTON_ID_UP, prv_up);
  window_single_click_subscribe(BUTTON_ID_DOWN, prv_down);
}

// The clock ticks on an app timer, not the tick service: the ringing screen uses that,
// and there is only one subscription per app.
static AppTimer *s_tick_timer;

static void prv_tick(void *ctx) {
  s_tick_timer = NULL;
  if (!s_time) return;
  time_t now = time(NULL);
  struct tm *t = localtime(&now);
  strftime(s_time_text, sizeof(s_time_text), clock_is_24h_style() ? "%H:%M" : "%I:%M", t);
  // "09:41" reads as "9:41" on a 12-hour clock.
  text_layer_set_text(s_time, (!clock_is_24h_style() && s_time_text[0] == '0') ? s_time_text + 1 : s_time_text);
  s_tick_timer = app_timer_register((60 - t->tm_sec) * 1000 + 50, prv_tick, NULL);
}

static void prv_start_talking(void *ctx) {
  prv_talk();
}

static void prv_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(root);
  window_set_background_color(window, THEME_BG);

  s_icon_prompts = gbitmap_create_with_resource(RESOURCE_ID_ACTION_PROMPTS);
  s_icon_talk = gbitmap_create_with_resource(RESOURCE_ID_ACTION_TALK);
  s_icon_menu = gbitmap_create_with_resource(RESOURCE_ID_ACTION_MENU);
  s_action_bar = action_bar_layer_create();
  action_bar_layer_set_background_color(s_action_bar, GColorBlack);
  action_bar_layer_set_icon(s_action_bar, BUTTON_ID_UP, s_icon_prompts);
  action_bar_layer_set_icon(s_action_bar, BUTTON_ID_SELECT, s_icon_talk);
  action_bar_layer_set_icon(s_action_bar, BUTTON_ID_DOWN, s_icon_menu);
  action_bar_layer_set_click_config_provider(s_action_bar, prv_click_config);

  int width = bounds.size.w - ACTION_BAR_WIDTH;
  int left = 0;
#if PBL_DISPLAY_WIDTH >= 200
  int time_h = 48;
  const char *time_font = FONT_KEY_LECO_42_NUMBERS;
#else
  int time_h = 40;
  const char *time_font = FONT_KEY_LECO_36_BOLD_NUMBERS;
#endif
  int time_top = PBL_IF_ROUND_ELSE(14, 2);
  s_time = text_layer_create(GRect(left, time_top, width, time_h));
  text_layer_set_font(s_time, fonts_get_system_font(time_font));
  text_layer_set_text_alignment(s_time, GTextAlignmentCenter);
  text_layer_set_background_color(s_time, GColorClear);
  text_layer_set_text_color(s_time, THEME_FG);
  layer_add_child(root, text_layer_get_layer(s_time));

  // Two short lines for what the app is doing, under the time.
  int status_top = time_top + time_h;
  int status_h = 32;
  int status_inset = PBL_IF_ROUND_ELSE(10, 2);

  // The sprite stands on the bottom edge; on small screens its feet may go off it.
  GBitmap *idle = sprite_frame(SpriteIdle);
  GSize size = gbitmap_get_bounds(idle).size;
  int sprite_top = bounds.size.h - size.h;
  if (sprite_top < status_top + status_h - 4) sprite_top = status_top + status_h - 4;
#if defined(PBL_ROUND)
  sprite_top -= 6;
#endif
  s_sprite = bitmap_layer_create(GRect(left + (width - size.w) / 2, sprite_top, size.w, size.h));
  bitmap_layer_set_compositing_mode(s_sprite, GCompOpSet);
  bitmap_layer_set_bitmap(s_sprite, idle);
  layer_add_child(root, bitmap_layer_get_layer(s_sprite));

  s_main = text_layer_create(GRect(left + status_inset, status_top, width - 2 * status_inset, status_h));
  text_layer_set_font(s_main, fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD));
  text_layer_set_text_alignment(s_main, GTextAlignmentCenter);
  text_layer_set_background_color(s_main, GColorClear);
  text_layer_set_text_color(s_main, THEME_FG);
  text_layer_set_overflow_mode(s_main, GTextOverflowModeTrailingEllipsis);
  layer_add_child(root, text_layer_get_layer(s_main));

  action_bar_layer_add_to_window(s_action_bar, window);

  prv_tick(NULL);

  s_dictation = dictation_session_create(512, prv_dictation_cb, NULL);
  prv_show_idle();
  if (s_start_talking) {
    s_start_talking = false;
    app_timer_register(150, prv_start_talking, NULL);
  }
}

static void prv_appear(Window *window) {
  // Back from a list or a ringing alarm: the minute may have changed meanwhile.
  prv_cancel(&s_tick_timer);
  prv_tick(NULL);
}

static void prv_unload(Window *window) {
  prv_cancel(&s_tick_timer);
  prv_cancel(&s_anim_timer);
  prv_cancel(&s_timeout_timer);
  prv_cancel(&s_settle_timer);
  prv_cancel(&s_exit_timer);
  prv_cancel(&s_clear_timer);
  prv_cancel(&s_quiet_timer);
  prv_unquiet();
  if (s_dictation) dictation_session_destroy(s_dictation);
  s_dictation = NULL;
  text_layer_destroy(s_main);
  bitmap_layer_destroy(s_sprite);
  text_layer_destroy(s_time);
  action_bar_layer_destroy(s_action_bar);
  gbitmap_destroy(s_icon_prompts);
  gbitmap_destroy(s_icon_talk);
  gbitmap_destroy(s_icon_menu);
  s_main = s_time = NULL;
  s_sprite = NULL;
  s_action_bar = NULL;
  s_icon_prompts = s_icon_talk = s_icon_menu = NULL;
  window_destroy(s_window);
  s_window = NULL;
}

void home_window_push(bool start_talking) {
  s_start_talking = start_talking;
  s_quick = start_talking;
  s_window = window_create();
  window_set_window_handlers(s_window, (WindowHandlers){
    .load = prv_load,
    .appear = prv_appear,
    .unload = prv_unload,
  });
  window_stack_push(s_window, true);
}

void home_refresh_settings(void) {
  // Nothing on the home screen shows a setting any more.
}

void home_handle_result(int32_t request_id, int ok, const char *text, const char *detail,
                        const char *reply) {
  if (!s_window || request_id != s_request_id || !s_waiting) return;
  if (ok == 2) {
    prv_show(text, detail && detail[0] ? detail : s_sub_text);
    // Still working: give a slow plugin (a message, an app list) the full wait again.
    prv_cancel(&s_timeout_timer);
    s_timeout_timer = app_timer_register(REQUEST_TIMEOUT_MS, prv_timeout, NULL);
    return;
  }
  if (ok == 3) {
    // A message to check: nothing is sent until Select on the next screen.
    s_waiting = false;
    s_quick = false;
    prv_cancel(&s_anim_timer);
    prv_cancel(&s_timeout_timer);
    prv_show("", "");
    prv_set_frame(SpriteIdle);
    reply_window_push_confirm(text, reply, request_id);
    return;
  }
  if (ok == 1 && reply && reply[0]) {
    // Something to read: stay open, and show it on the reply screen.
    s_quick = false;
    prv_finish(true, text, "");
    reply_window_push(text, reply);
    return;
  }
  prv_finish(ok == 1, text, detail && detail[0] ? detail : s_sub_text);
}

void home_confirm_send(int32_t request_id) {
  if (!s_window || request_id != s_request_id || s_waiting) return;
  if (!comm_confirm_send(request_id)) {
    prv_finish(false, "Couldn't reach the phone", "Nothing was sent.");
    return;
  }
  prv_show("Sending...", "");
  prv_start_waiting();
  prv_cancel(&s_timeout_timer);
  s_timeout_timer = app_timer_register(REQUEST_TIMEOUT_MS, prv_timeout, NULL);
}

void home_handle_clock(int32_t request_id, int kind, int32_t value, const char *label) {
  if (!s_window || request_id != s_request_id || !s_waiting) return;
  char main[MAIN_LEN];
  char sub[SUB_LEN];
  snprintf(sub, sizeof(sub), "%s", label && label[0] ? label : "");
  switch (kind) {
    case 1:
    case 2: {
      ClockKind clock_kind = kind == 1 ? ClockKindTimer : ClockKindAlarm;
      time_t when = kind == 1 ? time(NULL) + value : (time_t)value;
      StatusCode result = clock_add(when, clock_kind, label, kind == 1 ? value : 0);
      clock_describe_result(result, clock_kind, when, main, sizeof(main));
      prv_finish(result == S_SUCCESS, main, sub);
      return;
    }
    case 3:
    case 4: {
      ClockKind clock_kind = kind == 3 ? ClockKindTimer : ClockKindAlarm;
      int removed = clock_remove_labelled(clock_kind, label);
      const char *noun = clock_kind == ClockKindTimer ? "timer" : "alarm";
      if (removed == 0) snprintf(main, sizeof(main), "No %s to cancel", noun);
      else snprintf(main, sizeof(main), "Cancelled %d %s%s", removed, noun, removed == 1 ? "" : "s");
      prv_finish(removed > 0, main, sub);
      return;
    }
    case 5:
    default:
      // value says which list: 1 timers, 2 alarms, 0 the menu with both.
      s_quick = false;
      prv_finish(true, value == 1 ? "Timers" : value == 2 ? "Alarms" : "Alarms and timers", "");
      if (value == 1) clock_list_push(ClockKindTimer);
      else if (value == 2) clock_list_push(ClockKindAlarm);
      else menu_window_push();
      return;
  }
}
