// The "Did you mean..." screen. A timer asked for a clock time ("a timer for 4:05")
// can't be set, so this offers the two things it probably meant: Up sets the alarm, Down the
// reminder, Select listens again and Back drops it. The phone sends the words for each
// choice, and a press sends them back as if they had been said.
#include "app.h"

#define HEAD_LEN 64
#define LINE_LEN 64
#define WORDS_LEN 200
#define LABEL_LEN 160
#define PAD PBL_IF_ROUND_ELSE(14, 4)

static Window *s_window;
static ActionBarLayer *s_bar;
static GBitmap *s_icon_alarm;
static GBitmap *s_icon_talk;
static GBitmap *s_icon_reminder;
static TextLayer *s_head;
static TextLayer *s_top;
static TextLayer *s_label;
static TextLayer *s_bottom;
static char s_head_text[HEAD_LEN];
static char s_top_text[LINE_LEN];
static char s_bottom_text[LINE_LEN];
static char s_label_text[LABEL_LEN];
static char s_alarm_words[WORDS_LEN];
static char s_reminder_words[WORDS_LEN];

// Copies line `index` of `text` (lines split by \n) into out.
static void prv_line(const char *text, int index, char *out, size_t size) {
  out[0] = 0;
  if (!text) return;
  const char *p = text;
  for (int i = 0; i < index; i++) {
    p = strchr(p, '\n');
    if (!p) return;
    p++;
  }
  size_t n = 0;
  while (p[n] && p[n] != '\n') n++;
  if (n >= size) n = size - 1;
  memcpy(out, p, n);
  out[n] = 0;
}

static void prv_pick(const char *words) {
  char copy[WORDS_LEN];
  snprintf(copy, sizeof(copy), "%s", words);
  window_stack_remove(s_window, true);
  home_send_text(copy);
}

static void prv_up(ClickRecognizerRef rec, void *ctx) {
  if (s_alarm_words[0]) prv_pick(s_alarm_words);
}

static void prv_down(ClickRecognizerRef rec, void *ctx) {
  if (s_reminder_words[0]) prv_pick(s_reminder_words);
}

static void prv_select(ClickRecognizerRef rec, void *ctx) {
  window_stack_remove(s_window, true);
  home_talk();
}

static void prv_click_config(void *ctx) {
  window_single_click_subscribe(BUTTON_ID_UP, prv_up);
  window_single_click_subscribe(BUTTON_ID_SELECT, prv_select);
  window_single_click_subscribe(BUTTON_ID_DOWN, prv_down);
}

static TextLayer *prv_text(Layer *root, GRect box, const char *text, GFont font, GColor color,
                           GTextAlignment align) {
  TextLayer *layer = text_layer_create(box);
  text_layer_set_text(layer, text);
  text_layer_set_font(layer, font);
  text_layer_set_text_color(layer, color);
  text_layer_set_background_color(layer, GColorClear);
  text_layer_set_text_alignment(layer, align);
  text_layer_set_overflow_mode(layer, GTextOverflowModeTrailingEllipsis);
  layer_add_child(root, text_layer_get_layer(layer));
  return layer;
}

static void prv_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(root);
  int h = bounds.size.h;
  int left = PAD;
  int width = bounds.size.w - ACTION_BAR_WIDTH - PAD - left;
  bool wide = bounds.size.w >= 200;
  // Narrow and round screens get a smaller headline, so "Did you mean..." fits on one line.
  bool big_head = wide && !PBL_IF_ROUND_ELSE(true, false);
  GFont head_font = fonts_get_system_font(big_head ? FONT_KEY_GOTHIC_28_BOLD : FONT_KEY_GOTHIC_18_BOLD);
  GFont choice_font = fonts_get_system_font(wide ? FONT_KEY_GOTHIC_24_BOLD : FONT_KEY_GOTHIC_18_BOLD);
  GFont label_font = fonts_get_system_font(wide ? FONT_KEY_GOTHIC_24 : FONT_KEY_GOTHIC_18);
  int head_h = big_head ? 34 : 24;
  int choice_h = wide ? 30 : 24;
  GTextAlignment align = PBL_IF_ROUND_ELSE(GTextAlignmentCenter, GTextAlignmentLeft);
  GTextAlignment choice_align = PBL_IF_ROUND_ELSE(GTextAlignmentCenter, GTextAlignmentRight);

  // The headline up top, each choice beside its button, and the words between them.
  int top_y = PBL_IF_ROUND_ELSE(20, 2);
  s_head = prv_text(root, GRect(left, top_y, width, head_h), s_head_text, head_font, theme_accent(), align);
  int up_y = h / 4 + PBL_IF_ROUND_ELSE(4, 2);
  if (up_y < top_y + head_h) up_y = top_y + head_h;
  s_top = prv_text(root, GRect(left, up_y, width, choice_h), s_top_text, choice_font, theme_text(), choice_align);
  int down_y = h * 3 / 4 - choice_h / 2 - PBL_IF_ROUND_ELSE(8, 0);
  s_bottom = prv_text(root, GRect(left, down_y, width, choice_h), s_bottom_text, choice_font, theme_text(), choice_align);
  int label_y = up_y + choice_h + 2;
  int label_h = down_y - label_y - 2;
  if (label_h < 0) label_h = 0;
  s_label = prv_text(root, GRect(left, label_y, width, label_h), s_label_text, label_font, theme_text(), align);
  text_layer_set_overflow_mode(s_label, GTextOverflowModeTrailingEllipsis);

  s_icon_alarm = gbitmap_create_with_resource(RESOURCE_ID_ACTION_ALARM);
  s_icon_talk = gbitmap_create_with_resource(RESOURCE_ID_ACTION_TALK);
  s_icon_reminder = gbitmap_create_with_resource(RESOURCE_ID_ACTION_REMINDER);
  s_bar = action_bar_layer_create();
  action_bar_layer_set_background_color(s_bar, GColorBlack);
  if (s_alarm_words[0]) action_bar_layer_set_icon(s_bar, BUTTON_ID_UP, s_icon_alarm);
  action_bar_layer_set_icon(s_bar, BUTTON_ID_SELECT, s_icon_talk);
  if (s_reminder_words[0]) action_bar_layer_set_icon(s_bar, BUTTON_ID_DOWN, s_icon_reminder);
  action_bar_layer_set_click_config_provider(s_bar, prv_click_config);
  action_bar_layer_add_to_window(s_bar, window);
}

static void prv_unload(Window *window) {
  action_bar_layer_destroy(s_bar);
  gbitmap_destroy(s_icon_alarm);
  gbitmap_destroy(s_icon_talk);
  gbitmap_destroy(s_icon_reminder);
  text_layer_destroy(s_head);
  text_layer_destroy(s_top);
  text_layer_destroy(s_label);
  text_layer_destroy(s_bottom);
  window_destroy(s_window);
  s_window = NULL;
}

// choices: four lines, the alarm's words, the reminder's words, then what each button shows.
// An empty line leaves that button off.
void suggest_window_push(const char *headline, const char *label, const char *choices) {
  if (s_window) window_stack_remove(s_window, false);
  snprintf(s_head_text, sizeof(s_head_text), "%s", headline && headline[0] ? headline : "Did you mean...");
  snprintf(s_label_text, sizeof(s_label_text), "%s", label ? label : "");
  prv_line(choices, 0, s_alarm_words, sizeof(s_alarm_words));
  prv_line(choices, 1, s_reminder_words, sizeof(s_reminder_words));
  prv_line(choices, 2, s_top_text, sizeof(s_top_text));
  prv_line(choices, 3, s_bottom_text, sizeof(s_bottom_text));
  s_window = window_create();
  window_set_background_color(s_window, theme_bg());
  window_set_window_handlers(s_window, (WindowHandlers) {
    .load = prv_load,
    .unload = prv_unload,
  });
  window_stack_push(s_window, true);
  vibes_short_pulse();
}
