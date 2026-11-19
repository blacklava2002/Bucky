// A timer or alarm going off.
//   Timer: Up repeats it, Select silences it and keeps counting up, Down dismisses.
//   Alarm: Up snoozes, Select silences it and keeps counting up, Down dismisses.
// Back dismisses too. The screen stays up, counting, until it is dismissed.
#include "app.h"

#define PULSE_MS 2500
#define MAX_PULSES 72  // about three minutes of buzzing, then it just counts
#define SNOOZE_MIN 5

static Window *s_window;
static ActionBarLayer *s_bar;
static BitmapLayer *s_sprite;
static TextLayer *s_title;
static TextLayer *s_count;
static AppTimer *s_pulse;
static int s_pulses;
static bool s_silenced;
static ClockItem s_item;
static char s_title_text[32];
static char s_count_text[16];
static GBitmap *s_icon_up;
static GBitmap *s_icon_select;
static GBitmap *s_icon_down;

static const uint32_t s_pattern[] = { 400, 200, 400, 200, 600 };
static const uint32_t s_gentle[] = { 250 };
#define NUDGE_PULSES 3  // "a few nudges": the strong pattern three times, then quiet

static void prv_update_count(void) {
  int over = (int)(time(NULL) - (time_t)s_item.when);
  if (over < 0) over = 0;
  int h = over / 3600, m = (over % 3600) / 60, s = over % 60;
  if (h) snprintf(s_count_text, sizeof(s_count_text), "+%d:%02d:%02d", h, m, s);
  else snprintf(s_count_text, sizeof(s_count_text), "+%d:%02d", m, s);
  if (s_count) layer_mark_dirty(text_layer_get_layer(s_count));
}

static void prv_tick(struct tm *tick_time, TimeUnits changed) {
  prv_update_count();
}

static void prv_pulse(void *ctx) {
  s_pulse = NULL;
  Vibe vibe = settings_vibe((ClockKind)s_item.kind);
  int max = vibe == VibeNudge ? NUDGE_PULSES : MAX_PULSES;
  if (s_silenced || s_pulses++ >= max) return;
  if (vibe == VibeGentle) {
    VibePattern pattern = { .durations = s_gentle, .num_segments = ARRAY_LENGTH(s_gentle) };
    vibes_enqueue_custom_pattern(pattern);
  } else if (vibe != VibeOff) {
    VibePattern pattern = { .durations = s_pattern, .num_segments = ARRAY_LENGTH(s_pattern) };
    vibes_enqueue_custom_pattern(pattern);
  }
  light_enable_interaction();
  if (s_sprite) {
    bitmap_layer_set_bitmap(s_sprite, sprite_frame(s_pulses % 2 ? SpriteWave : SpriteTalk));
  }
  s_pulse = app_timer_register(PULSE_MS, prv_pulse, NULL);
}

static void prv_stop(void) {
  if (s_pulse) app_timer_cancel(s_pulse);
  s_pulse = NULL;
  vibes_cancel();
}

static void prv_close(void) {
  prv_stop();
  if (s_window) window_stack_remove(s_window, true);
}

static void prv_close_later(void *ctx) {
  prv_close();
}

static void prv_dismiss(ClickRecognizerRef rec, void *ctx) {
  prv_close();
}

static void prv_silence(ClickRecognizerRef rec, void *ctx) {
  if (s_silenced) return;
  s_silenced = true;
  prv_stop();
  if (s_sprite) bitmap_layer_set_bitmap(s_sprite, sprite_frame(SpriteIdle));
}

// Alarm: ring again in five minutes. Timer: start the same timer over.
static void prv_again(ClickRecognizerRef rec, void *ctx) {
  bool timer = s_item.kind == ClockKindTimer;
  int32_t length = timer ? s_item.duration : SNOOZE_MIN * 60;
  if (length <= 0) {
    // A timer set before 0.2 doesn't know its length.
    vibes_double_pulse();
    return;
  }
  prv_stop();
  StatusCode result = clock_add(time(NULL) + length, (ClockKind)s_item.kind, s_item.label, s_item.duration);
  if (result == S_SUCCESS) {
    vibes_short_pulse();
    s_silenced = true;
    snprintf(s_count_text, sizeof(s_count_text), "%s", timer ? "Restarted" : "Snoozed");
    tick_timer_service_unsubscribe();
    if (s_count) layer_mark_dirty(text_layer_get_layer(s_count));
    // A moment on screen also gives the phone time to get the new pin.
    app_timer_register(1500, prv_close_later, NULL);
  } else {
    // Most likely something else rings within a minute of it.
    vibes_double_pulse();
  }
}

static void prv_click_config(void *ctx) {
  window_single_click_subscribe(BUTTON_ID_UP, prv_again);
  window_single_click_subscribe(BUTTON_ID_SELECT, prv_silence);
  window_single_click_subscribe(BUTTON_ID_DOWN, prv_dismiss);
}

static TextLayer *prv_text(Layer *root, GRect frame, const char *font, const char *text) {
  TextLayer *layer = text_layer_create(frame);
  text_layer_set_font(layer, fonts_get_system_font(font));
  text_layer_set_text_alignment(layer, GTextAlignmentCenter);
  text_layer_set_background_color(layer, GColorClear);
  text_layer_set_text_color(layer, THEME_FG);
  text_layer_set_overflow_mode(layer, GTextOverflowModeTrailingEllipsis);
  text_layer_set_text(layer, text);
  layer_add_child(root, text_layer_get_layer(layer));
  return layer;
}

static void prv_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(root);
  window_set_background_color(window, PBL_IF_COLOR_ELSE(GColorDarkCandyAppleRed, GColorWhite));

  bool timer = s_item.kind == ClockKindTimer;
  s_icon_up = gbitmap_create_with_resource(timer ? RESOURCE_ID_ICON_REPEAT : RESOURCE_ID_ICON_SNOOZE);
  s_icon_select = gbitmap_create_with_resource(RESOURCE_ID_ICON_SILENCE);
  s_icon_down = gbitmap_create_with_resource(RESOURCE_ID_ICON_DISMISS);
  s_bar = action_bar_layer_create();
  action_bar_layer_set_background_color(s_bar, GColorBlack);
  action_bar_layer_set_icon(s_bar, BUTTON_ID_UP, s_icon_up);
  action_bar_layer_set_icon(s_bar, BUTTON_ID_SELECT, s_icon_select);
  action_bar_layer_set_icon(s_bar, BUTTON_ID_DOWN, s_icon_down);
  action_bar_layer_set_click_config_provider(s_bar, prv_click_config);
  action_bar_layer_add_to_window(s_bar, window);

  // The column left of the action bar; on round screens, nudged in from the curve.
  int left = PBL_IF_ROUND_ELSE(12, 0);
  int width = bounds.size.w - ACTION_BAR_WIDTH - left;
  GBitmap *frame = sprite_frame(SpriteWave);
  GSize size = gbitmap_get_bounds(frame).size;
  int top = PBL_IF_ROUND_ELSE(12, 2);
  s_sprite = bitmap_layer_create(GRect(left + (width - size.w) / 2, top, size.w, size.h));
  bitmap_layer_set_compositing_mode(s_sprite, GCompOpSet);
  bitmap_layer_set_bitmap(s_sprite, frame);
  layer_add_child(root, bitmap_layer_get_layer(s_sprite));

  int y = top + size.h;
  s_title = prv_text(root, GRect(left + 2, y - 2, width - 4, 22), FONT_KEY_GOTHIC_18_BOLD, s_title_text);
  s_count = prv_text(root, GRect(left + 2, y + 16, width - 4, 30), FONT_KEY_GOTHIC_24_BOLD, s_count_text);

  prv_update_count();
  tick_timer_service_subscribe(SECOND_UNIT, prv_tick);
  s_pulses = 0;
  s_silenced = false;
  prv_pulse(NULL);
}

static void prv_unload(Window *window) {
  prv_stop();
  tick_timer_service_unsubscribe();
  text_layer_destroy(s_count);
  text_layer_destroy(s_title);
  bitmap_layer_destroy(s_sprite);
  action_bar_layer_destroy(s_bar);
  gbitmap_destroy(s_icon_up);
  gbitmap_destroy(s_icon_select);
  gbitmap_destroy(s_icon_down);
  s_count = s_title = NULL;
  s_sprite = NULL;
  s_bar = NULL;
  s_icon_up = s_icon_select = s_icon_down = NULL;
  window_destroy(s_window);
  s_window = NULL;
}

void ring_window_push(const ClockItem *item) {
  if (s_window) {
    // Already ringing for something else: show the newest.
    prv_stop();
    window_stack_remove(s_window, false);
  }
  s_item = *item;
  bool timer = item->kind == ClockKindTimer;
  // "Tea timer", "Airport alarm"; the label is said as a name, so add the noun.
  const char *noun = timer ? "timer" : "alarm";
  size_t len = strlen(item->label);
  bool has_noun = len >= 5 && strncmp(item->label + len - 5, noun, 5) == 0;
  if (item->label[0]) {
    snprintf(s_title_text, sizeof(s_title_text), has_noun ? "%s" : "%s %s", item->label, noun);
  } else {
    snprintf(s_title_text, sizeof(s_title_text), "%s", timer ? "Timer done" : "Alarm");
  }
  s_window = window_create();
  window_set_window_handlers(s_window, (WindowHandlers){
    .load = prv_load,
    .unload = prv_unload,
  });
  window_stack_push(s_window, true);
}
