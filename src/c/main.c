// A Pebble voice agent (the name and look are in brand.h and resources/images).
// Talk, and it either sets a timer or alarm on the watch or hands your words
// to the agent plugin picked in settings (Claude, Muse, Grok, ChatGPT).
#include "app.h"

#define PERSIST_KEY_AGENT 1
#define PERSIST_KEY_CONFIRM 2
#define PERSIST_KEY_QUICK_TALK 3
#define PERSIST_KEY_VIBE_ALARM 4
#define PERSIST_KEY_VIBE_TIMER 5
#define PERSIST_KEY_QUIET_LISTEN 6

static char s_agent_name[AGENT_NAME_LEN] = "your agent";
static bool s_confirm = false;
static bool s_quick_talk = true;
static int s_vibe_alarm = VibeStrong;
static int s_vibe_timer = VibeStrong;
static bool s_quiet_listen = false;

const char *settings_agent_name(void) {
  return s_agent_name;
}

bool settings_confirm(void) {
  return s_confirm;
}

bool settings_quick_talk(void) {
  return s_quick_talk;
}

bool settings_quiet_listen(void) {
  return s_quiet_listen;
}

Vibe settings_vibe(ClockKind kind) {
  int v = kind == ClockKindTimer ? s_vibe_timer : s_vibe_alarm;
  return (v >= VibeStrong && v <= VibeOff) ? (Vibe)v : VibeStrong;
}

static void prv_load_settings(void) {
  if (persist_exists(PERSIST_KEY_AGENT)) {
    persist_read_string(PERSIST_KEY_AGENT, s_agent_name, sizeof(s_agent_name));
  }
  if (persist_exists(PERSIST_KEY_CONFIRM)) s_confirm = persist_read_bool(PERSIST_KEY_CONFIRM);
  if (persist_exists(PERSIST_KEY_QUICK_TALK)) s_quick_talk = persist_read_bool(PERSIST_KEY_QUICK_TALK);
  if (persist_exists(PERSIST_KEY_VIBE_ALARM)) s_vibe_alarm = persist_read_int(PERSIST_KEY_VIBE_ALARM);
  if (persist_exists(PERSIST_KEY_VIBE_TIMER)) s_vibe_timer = persist_read_int(PERSIST_KEY_VIBE_TIMER);
  if (persist_exists(PERSIST_KEY_QUIET_LISTEN)) s_quiet_listen = persist_read_bool(PERSIST_KEY_QUIET_LISTEN);
}

bool comm_send_transcript(const char *text, int32_t request_id, bool done_listening) {
  DictionaryIterator *iter;
  if (app_message_outbox_begin(&iter) != APP_MSG_OK) return false;
  dict_write_cstring(iter, MESSAGE_KEY_TRANSCRIPT, text);
  dict_write_int32(iter, MESSAGE_KEY_REQ_ID, request_id);
  // Quiet Time was turned on for this dictation: the phone puts it back.
  if (done_listening) dict_write_int8(iter, MESSAGE_KEY_LISTEN, 0);
  return app_message_outbox_send() == APP_MSG_OK;
}

bool comm_listen(bool listening) {
  DictionaryIterator *iter;
  if (app_message_outbox_begin(&iter) != APP_MSG_OK) return false;
  dict_write_int8(iter, MESSAGE_KEY_LISTEN, listening ? 1 : 0);
  return app_message_outbox_send() == APP_MSG_OK;
}

// Select on a message's "Send?" screen: the phone sends the message it is holding for this request.
bool comm_confirm_send(int32_t request_id) {
  DictionaryIterator *iter;
  if (app_message_outbox_begin(&iter) != APP_MSG_OK) return false;
  dict_write_int32(iter, MESSAGE_KEY_CONFIRM_SEND, request_id);
  return app_message_outbox_send() == APP_MSG_OK;
}

// ------------------------------------------------------------ timeline pins

// The phone turns this list into timeline pins, so it is sent whole after every
// change. The outbox may be busy, or the phone away, so it retries for a while.
#define SYNC_RETRY_MS 750
#define SYNC_MAX_TRIES 20
// Timeline pins open the app on a list: 1 the menu (older pins), 2 timers, 3 alarms.
#define OPEN_MENU_LAUNCH_CODE 1
#define OPEN_TIMERS_LAUNCH_CODE 2
#define OPEN_ALARMS_LAUNCH_CODE 3

static AppTimer *s_sync_timer;
static bool s_sync_pending;
static int s_sync_tries;
static bool s_comm_open;

static void prv_sync(void *ctx) {
  s_sync_timer = NULL;
  if (!s_sync_pending) return;
  char text[CLOCK_MAX_ITEMS * 48 + 1];
  size_t used = 0;
  text[0] = '\0';
  for (int i = 0; i < clock_count() && used < sizeof(text); i++) {
    const ClockItem *item = clock_get(i);
    int n = snprintf(text + used, sizeof(text) - used, "%d\t%ld\t%ld\t%s\n",
                     (int)item->kind, (long)item->when, (long)item->duration, item->label);
    if (n < 0) break;
    used += (size_t)n;
  }
  DictionaryIterator *iter;
  if (app_message_outbox_begin(&iter) == APP_MSG_OK) {
    dict_write_cstring(iter, MESSAGE_KEY_PINS, text);
    if (app_message_outbox_send() == APP_MSG_OK) {
      s_sync_pending = false;
      return;
    }
  }
  if (++s_sync_tries < SYNC_MAX_TRIES) {
    s_sync_timer = app_timer_register(SYNC_RETRY_MS, prv_sync, NULL);
  } else {
    s_sync_pending = false;
  }
}

// ------------------------------------------------------------ app glance

// The app's row in the app list shows what's next: a timer counts down live
// (the watch re-renders time_until every second), an alarm shows its time.
static void prv_glance(AppGlanceReloadSession *session, size_t limit, void *ctx) {
  time_t now = time(NULL);
  size_t added = 0;
  for (int i = 0; i < clock_count() && added < limit; i++) {
    const ClockItem *item = clock_get(i);
    if ((time_t)item->when <= now) continue;
    char subtitle[96];
    if (item->kind == ClockKindTimer) {
      snprintf(subtitle, sizeof(subtitle), "%s {time_until(%ld)|format('%%T')}",
               item->label[0] ? item->label : "Timer", (long)item->when);
    } else {
      char at[24];
      clock_format_time(item->when, true, at, sizeof(at));
      snprintf(subtitle, sizeof(subtitle), "%s %s", item->label[0] ? item->label : "Alarm", at);
    }
    // Template strings treat these as special; labels come from speech, so drop them.
    for (char *c = subtitle; *c && !(c[0] == ' ' && c[1] == '{'); c++) {
      if (*c == '{' || *c == '}' || *c == '\\' || *c == '\'' || *c == '%') *c = ' ';
    }
    const AppGlanceSlice slice = {
      .layout = {
        .icon = APP_GLANCE_SLICE_DEFAULT_ICON,
        .subtitle_template_string = subtitle,
      },
      .expiration_time = (time_t)item->when,
    };
    if (app_glance_add_slice(session, slice) != APP_GLANCE_RESULT_SUCCESS) break;
    added++;
  }
}

void clock_changed(void) {
  app_glance_reload(prv_glance, NULL);
  s_sync_pending = true;
  s_sync_tries = 0;
  if (s_comm_open && !s_sync_timer) s_sync_timer = app_timer_register(100, prv_sync, NULL);
}

static void prv_send_ready(void) {
  DictionaryIterator *iter;
  if (app_message_outbox_begin(&iter) != APP_MSG_OK) return;
  dict_write_int8(iter, MESSAGE_KEY_READY, 1);
  app_message_outbox_send();
}

static const char *prv_string(DictionaryIterator *iter, uint32_t key) {
  Tuple *t = dict_find(iter, key);
  return t && t->type == TUPLE_CSTRING ? t->value->cstring : "";
}

static int32_t prv_int(DictionaryIterator *iter, uint32_t key, int32_t fallback) {
  Tuple *t = dict_find(iter, key);
  if (!t) return fallback;
  switch (t->length) {
    case 1: return t->type == TUPLE_INT ? t->value->int8 : t->value->uint8;
    case 2: return t->type == TUPLE_INT ? t->value->int16 : t->value->uint16;
    default: return t->type == TUPLE_INT ? t->value->int32 : (int32_t)t->value->uint32;
  }
}

static void prv_inbox(DictionaryIterator *iter, void *ctx) {
  bool settings_changed = false;
  Tuple *agent = dict_find(iter, MESSAGE_KEY_AGENT_NAME);
  if (agent && agent->type == TUPLE_CSTRING) {
    snprintf(s_agent_name, sizeof(s_agent_name), "%s", agent->value->cstring);
    persist_write_string(PERSIST_KEY_AGENT, s_agent_name);
    settings_changed = true;
  }
  if (dict_find(iter, MESSAGE_KEY_CONFIRM)) {
    s_confirm = prv_int(iter, MESSAGE_KEY_CONFIRM, 0) != 0;
    persist_write_bool(PERSIST_KEY_CONFIRM, s_confirm);
    settings_changed = true;
  }
  if (dict_find(iter, MESSAGE_KEY_QUICK_TALK)) {
    s_quick_talk = prv_int(iter, MESSAGE_KEY_QUICK_TALK, 1) != 0;
    persist_write_bool(PERSIST_KEY_QUICK_TALK, s_quick_talk);
    settings_changed = true;
  }
  if (dict_find(iter, MESSAGE_KEY_VIBE_ALARM)) {
    s_vibe_alarm = prv_int(iter, MESSAGE_KEY_VIBE_ALARM, 0);
    persist_write_int(PERSIST_KEY_VIBE_ALARM, s_vibe_alarm);
  }
  if (dict_find(iter, MESSAGE_KEY_VIBE_TIMER)) {
    s_vibe_timer = prv_int(iter, MESSAGE_KEY_VIBE_TIMER, 0);
    persist_write_int(PERSIST_KEY_VIBE_TIMER, s_vibe_timer);
  }
  if (dict_find(iter, MESSAGE_KEY_QUIET_LISTEN)) {
    s_quiet_listen = prv_int(iter, MESSAGE_KEY_QUIET_LISTEN, 0) != 0;
    persist_write_bool(PERSIST_KEY_QUIET_LISTEN, s_quiet_listen);
  }
  if (dict_find(iter, MESSAGE_KEY_LISTEN_READY)) home_quiet_ready();
  Tuple *prompts = dict_find(iter, MESSAGE_KEY_PROMPTS);
  if (prompts && prompts->type == TUPLE_CSTRING) prompts_set(prompts->value->cstring);
  if (settings_changed) home_refresh_settings();

  if (!dict_find(iter, MESSAGE_KEY_REQ_ID)) return;
  int32_t request_id = prv_int(iter, MESSAGE_KEY_REQ_ID, -1);
  if (dict_find(iter, MESSAGE_KEY_CLOCK_KIND)) {
    home_handle_clock(request_id,
                      (int)prv_int(iter, MESSAGE_KEY_CLOCK_KIND, 0),
                      prv_int(iter, MESSAGE_KEY_CLOCK_TIME, 0),
                      prv_string(iter, MESSAGE_KEY_CLOCK_LABEL));
    return;
  }
  if (dict_find(iter, MESSAGE_KEY_RESULT_OK)) {
    home_handle_result(request_id,
                       (int)prv_int(iter, MESSAGE_KEY_RESULT_OK, 0),
                       prv_string(iter, MESSAGE_KEY_RESULT_TEXT),
                       prv_string(iter, MESSAGE_KEY_RESULT_DETAIL),
                       prv_string(iter, MESSAGE_KEY_REPLY));
  }
}

static void prv_wakeup(WakeupId id, int32_t cookie) {
  ClockItem item;
  if (clock_take_wakeup(id, &item)) ring_window_push(&item);
}

static void prv_init(void) {
  prv_load_settings();
  prompts_init();
  clock_init();
  wakeup_service_subscribe(prv_wakeup);
  app_message_register_inbox_received(prv_inbox);
  app_message_open(1024, 1024);
  s_comm_open = true;
  // Bring the phone's pins up to date with whatever changed while it wasn't listening.
  clock_changed();

  AppLaunchReason reason = launch_reason();
  if (reason == APP_LAUNCH_WAKEUP) {
    WakeupId id;
    int32_t cookie;
    ClockItem item;
    if (wakeup_get_launch_event(&id, &cookie) && clock_take_wakeup(id, &item)) {
      ring_window_push(&item);
      return;
    }
  }
  home_window_push(reason == APP_LAUNCH_QUICK_LAUNCH && s_quick_talk);
  if (reason == APP_LAUNCH_TIMELINE_ACTION) {
    uint32_t code = launch_get_args();
    if (code == OPEN_MENU_LAUNCH_CODE) menu_window_push();
    else if (code == OPEN_TIMERS_LAUNCH_CODE) clock_list_push(ClockKindTimer);
    else if (code == OPEN_ALARMS_LAUNCH_CODE) clock_list_push(ClockKindAlarm);
  }
  prv_send_ready();
}

static void prv_deinit(void) {
  sprite_release();
}

int main(void) {
  prv_init();
  app_event_loop();
  prv_deinit();
}
