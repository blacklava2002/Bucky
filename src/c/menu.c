// The Down menu, like Bobby's but with only Alarms, Timers and Reminders.
#include "app.h"

static Window *s_window;
static StatusBarLayer *s_status;
static MenuLayer *s_menu;
static GBitmap *s_icons[3];

static const char *const TITLES[3] = { "Alarms", "Timers", "Reminders" };
static const ClockKind KINDS[3] = { ClockKindAlarm, ClockKindTimer, ClockKindReminder };

static uint16_t prv_rows(MenuLayer *menu, uint16_t section, void *ctx) {
  return 3;
}

static void prv_draw_row(GContext *ctx, const Layer *cell, MenuIndex *index, void *data) {
  ClockKind kind = KINDS[index->row];
  int count = 0;
  for (int i = 0; i < clock_count(); i++) {
    if (clock_get(i)->kind == kind) count++;
  }
  char subtitle[16];
  if (count) snprintf(subtitle, sizeof(subtitle), "%d set", count);
  menu_cell_basic_draw(ctx, cell, TITLES[index->row], count ? subtitle : NULL, s_icons[index->row]);
}

static void prv_select(MenuLayer *menu, MenuIndex *index, void *ctx) {
  clock_list_push(KINDS[index->row]);
}

static void prv_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(root);
  window_set_background_color(window, LIST_BG);
  s_icons[0] = gbitmap_create_with_resource(RESOURCE_ID_MENU_ALARMS);
  s_icons[1] = gbitmap_create_with_resource(RESOURCE_ID_MENU_TIMERS);
  s_icons[2] = gbitmap_create_with_resource(RESOURCE_ID_MENU_REMINDERS);

  s_status = status_bar_layer_create();
  status_bar_layer_set_colors(s_status, LIST_BG, LIST_FG);
  status_bar_layer_set_separator_mode(s_status, StatusBarLayerSeparatorModeDotted);
  layer_add_child(root, status_bar_layer_get_layer(s_status));

  s_menu = menu_layer_create(GRect(0, STATUS_BAR_LAYER_HEIGHT, bounds.size.w, bounds.size.h - STATUS_BAR_LAYER_HEIGHT));
  menu_layer_set_callbacks(s_menu, NULL, (MenuLayerCallbacks){
    .get_num_rows = prv_rows,
    .draw_row = prv_draw_row,
    .select_click = prv_select,
  });
  menu_layer_set_normal_colors(s_menu, LIST_BG, LIST_FG);
  menu_layer_set_highlight_colors(s_menu, LIST_HIGHLIGHT, LIST_HIGHLIGHT_FG);
  menu_layer_set_click_config_onto_window(s_menu, window);
  layer_add_child(root, menu_layer_get_layer(s_menu));
}

static void prv_appear(Window *window) {
  // Counts change when something rings or is deleted from a list.
  if (s_menu) menu_layer_reload_data(s_menu);
}

static void prv_unload(Window *window) {
  menu_layer_destroy(s_menu);
  status_bar_layer_destroy(s_status);
  for (int i = 0; i < 3; i++) {
    gbitmap_destroy(s_icons[i]);
    s_icons[i] = NULL;
  }
  s_menu = NULL;
  s_status = NULL;
  window_destroy(s_window);
  s_window = NULL;
}

void menu_window_push(void) {
  if (s_window) return;
  s_window = window_create();
  window_set_window_handlers(s_window, (WindowHandlers){
    .load = prv_load,
    .appear = prv_appear,
    .unload = prv_unload,
  });
  window_stack_push(s_window, true);
}
