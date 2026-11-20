// The Alarms, Timers or Reminders list, styled like Bobby's.
// A timer row counts down live with its name under it; an alarm row shows its time with
// the day (and name) under it; a reminder row shows its words with the time and day under them.
// Select opens a Delete action.
#include "app.h"

static Window *s_window;
static StatusBarLayer *s_status;
static MenuLayer *s_menu;
static TextLayer *s_empty;
static BitmapLayer *s_sprite;
static AppTimer *s_refresh;
static ClockKind s_kind;
static char s_title[CLOCK_TEXT_LEN];
static char s_subtitle[64];
static char s_empty_text[48];

// The list index of the row-th item of this list's kind, or -1.
static int prv_index(int row) {
  for (int i = 0, seen = 0; i < clock_count(); i++) {
    if (clock_get(i)->kind != s_kind) continue;
    if (seen++ == row) return i;
  }
  return -1;
}

static char toupper_ascii(char c) {
  return c >= 'a' && c <= 'z' ? c - 'a' + 'A' : c;
}

static int prv_count(void) {
  int n = 0;
  for (int i = 0; i < clock_count(); i++) {
    if (clock_get(i)->kind == s_kind) n++;
  }
  return n;
}

static uint16_t prv_rows(MenuLayer *menu, uint16_t section, void *ctx) {
  return prv_count();
}

// "Tea timer", "Airport alarm"; the noun is added unless the name already ends with it.
static void prv_name(const ClockItem *item, char *buf, size_t size) {
  const char *noun = item->kind == ClockKindTimer ? "timer" : "alarm";
  size_t len = strlen(item->label);
  bool has_noun = len >= 5 && strncmp(item->label + len - 5, noun, 5) == 0;
  snprintf(buf, size, has_noun ? "%s" : "%s %s", item->label, noun);
}

// "Today", "Tomorrow", or "Fri, Nov 20".
static void prv_day(time_t when, char *buf, size_t size) {
  time_t now = time(NULL);
  struct tm when_tm = *localtime(&when);
  struct tm now_tm = *localtime(&now);
  time_t tomorrow = now + 24 * 60 * 60;
  struct tm tom_tm = *localtime(&tomorrow);
  if (when_tm.tm_yday == now_tm.tm_yday && when_tm.tm_year == now_tm.tm_year) {
    snprintf(buf, size, "Today");
  } else if (when_tm.tm_yday == tom_tm.tm_yday && when_tm.tm_year == tom_tm.tm_year) {
    snprintf(buf, size, "Tomorrow");
  } else {
    char part[16];
    strftime(part, sizeof(part), "%a, %b", &when_tm);
    if (when_tm.tm_year != now_tm.tm_year) {
      snprintf(buf, size, "%s %d, %d", part, when_tm.tm_mday, when_tm.tm_year + 1900);
    } else {
      snprintf(buf, size, "%s %d", part, when_tm.tm_mday);
    }
  }
}

static void prv_draw_row(GContext *ctx, const Layer *cell, MenuIndex *index, void *data) {
  int i = prv_index(index->row);
  if (i < 0) return;
  const ClockItem *item = clock_get(i);
  if (item->kind == ClockKindReminder) {
    snprintf(s_title, sizeof(s_title), "%s", clock_text(item)[0] ? clock_text(item) : "Reminder");
    s_title[0] = toupper_ascii(s_title[0]);
    char at[16], day[32];
    clock_format_time(item->when, false, at, sizeof(at));
    prv_day(item->when, day, sizeof(day));
    snprintf(s_subtitle, sizeof(s_subtitle), "%s, %s", at, day);
  } else if (item->kind == ClockKindTimer) {
    int left = item->when - time(NULL);
    if (left < 0) left = 0;
    snprintf(s_title, sizeof(s_title), "%d:%02d:%02d", left / 3600, (left / 60) % 60, left % 60);
    if (item->label[0]) {
      prv_name(item, s_subtitle, sizeof(s_subtitle));
      s_subtitle[0] = toupper_ascii(s_subtitle[0]);
    } else if (item->duration >= 60) {
      snprintf(s_subtitle, sizeof(s_subtitle), "%d min timer", (int)(item->duration / 60));
    } else {
      s_subtitle[0] = '\0';
    }
  } else {
    clock_format_time(item->when, false, s_title, sizeof(s_title));
    char day[32];
    prv_day(item->when, day, sizeof(day));
    if (item->label[0]) {
      snprintf(s_subtitle, sizeof(s_subtitle), "%s, %s", item->label, day);
      s_subtitle[0] = toupper_ascii(s_subtitle[0]);
    } else {
      snprintf(s_subtitle, sizeof(s_subtitle), "%s", day);
    }
  }
  menu_cell_basic_draw(ctx, cell, s_title, s_subtitle[0] ? s_subtitle : NULL, NULL);
}

// ------------------------------------------------------------ empty and filled states

static void prv_show_state(void) {
  bool empty = prv_count() == 0;
  layer_set_hidden(menu_layer_get_layer(s_menu), empty);
  layer_set_hidden(text_layer_get_layer(s_empty), !empty);
  layer_set_hidden(bitmap_layer_get_layer(s_sprite), !empty);
  window_set_background_color(s_window, empty ? THEME_BG : LIST_BG);
  status_bar_layer_set_colors(s_status, empty ? THEME_BG : LIST_BG, empty ? THEME_FG : LIST_FG);
  status_bar_layer_set_separator_mode(s_status, empty ? StatusBarLayerSeparatorModeNone : StatusBarLayerSeparatorModeDotted);
  if (empty) {
    window_set_click_config_provider(s_window, NULL);
  } else {
    menu_layer_set_click_config_onto_window(s_menu, s_window);
    menu_layer_reload_data(s_menu);
  }
}

// ------------------------------------------------------------ delete

static int s_delete_index = -1;

static void prv_delete(ActionMenu *menu, const ActionMenuItem *item, void *ctx) {
  if (s_delete_index >= 0 && s_delete_index < clock_count()) {
    clock_remove(s_delete_index);
    vibes_short_pulse();
  }
  s_delete_index = -1;
}

static void prv_action_closed(ActionMenu *menu, const ActionMenuItem *performed, void *ctx) {
  action_menu_hierarchy_destroy(action_menu_get_root_level(menu), NULL, NULL);
  if (s_window) prv_show_state();
}

static void prv_select(MenuLayer *menu, MenuIndex *index, void *ctx) {
  s_delete_index = prv_index(index->row);
  if (s_delete_index < 0) return;
  ActionMenuLevel *level = action_menu_level_create(1);
  action_menu_level_add_action(level, "Delete", prv_delete, NULL);
  ActionMenuConfig config = (ActionMenuConfig){
    .root_level = level,
    .colors = {
      .background = PBL_IF_COLOR_ELSE(THEME_BG, GColorBlack),
      .foreground = PBL_IF_COLOR_ELSE(THEME_FG, GColorWhite),
    },
    .align = ActionMenuAlignCenter,
    .did_close = prv_action_closed,
  };
  action_menu_open(&config);
}

// ------------------------------------------------------------ window

static void prv_tick(void *ctx) {
  s_refresh = app_timer_register(1000, prv_tick, NULL);
  if (!s_menu) return;
  // Something may have rung and gone since the last second.
  if ((prv_count() == 0) != layer_get_hidden(menu_layer_get_layer(s_menu))) prv_show_state();
  else if (s_kind == ClockKindTimer) menu_layer_reload_data(s_menu);
}

static void prv_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(root);

  s_menu = menu_layer_create(GRect(0, STATUS_BAR_LAYER_HEIGHT, bounds.size.w, bounds.size.h - STATUS_BAR_LAYER_HEIGHT));
  menu_layer_set_callbacks(s_menu, NULL, (MenuLayerCallbacks){
    .get_num_rows = prv_rows,
    .draw_row = prv_draw_row,
    .select_click = prv_select,
  });
  menu_layer_set_normal_colors(s_menu, LIST_BG, LIST_FG);
  menu_layer_set_highlight_colors(s_menu, LIST_HIGHLIGHT, LIST_HIGHLIGHT_FG);
  layer_add_child(root, menu_layer_get_layer(s_menu));

  // Empty: a line of text and the sprite standing at the bottom.
  GBitmap *idle = sprite_frame(SpriteIdle);
  GSize size = gbitmap_get_bounds(idle).size;
  int sprite_top = bounds.size.h - size.h + PBL_IF_ROUND_ELSE(-8, 0);
  s_sprite = bitmap_layer_create(GRect((bounds.size.w - size.w) / 2, sprite_top, size.w, size.h));
  bitmap_layer_set_compositing_mode(s_sprite, GCompOpSet);
  bitmap_layer_set_bitmap(s_sprite, idle);
  layer_add_child(root, bitmap_layer_get_layer(s_sprite));

  snprintf(s_empty_text, sizeof(s_empty_text), "No %s set. Ask " BRAND_NAME " to set one.",
           s_kind == ClockKindTimer ? "timers" : s_kind == ClockKindReminder ? "reminders" : "alarms");
  int inset = PBL_IF_ROUND_ELSE(22, 8);
  int text_top = STATUS_BAR_LAYER_HEIGHT + PBL_IF_ROUND_ELSE(6, 0);
  s_empty = text_layer_create(GRect(inset, text_top, bounds.size.w - 2 * inset, sprite_top - text_top));
  text_layer_set_font(s_empty, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD));
  text_layer_set_text_alignment(s_empty, GTextAlignmentCenter);
  text_layer_set_background_color(s_empty, GColorClear);
  text_layer_set_text_color(s_empty, THEME_FG);
  text_layer_set_text(s_empty, s_empty_text);
  layer_add_child(root, text_layer_get_layer(s_empty));

  s_status = status_bar_layer_create();
  layer_add_child(root, status_bar_layer_get_layer(s_status));

  prv_show_state();
  s_refresh = app_timer_register(1000, prv_tick, NULL);
}

static void prv_appear(Window *window) {
  if (s_menu) prv_show_state();
}

static void prv_unload(Window *window) {
  if (s_refresh) app_timer_cancel(s_refresh);
  s_refresh = NULL;
  menu_layer_destroy(s_menu);
  text_layer_destroy(s_empty);
  bitmap_layer_destroy(s_sprite);
  status_bar_layer_destroy(s_status);
  s_menu = NULL;
  s_empty = NULL;
  s_sprite = NULL;
  s_status = NULL;
  window_destroy(s_window);
  s_window = NULL;
}

void clock_list_push(ClockKind kind) {
  if (s_window) {
    if (s_kind == kind) return;
    window_stack_remove(s_window, false);
  }
  s_kind = kind;
  s_window = window_create();
  window_set_window_handlers(s_window, (WindowHandlers){
    .load = prv_load,
    .appear = prv_appear,
    .unload = prv_unload,
  });
  window_stack_push(s_window, true);
}
