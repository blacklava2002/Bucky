// The reply screen. The sprite talking, a headline beside it and the answer under it,
// scrolling with Up and Down. Back returns home. Any feature with something to say uses it:
// weather, music and battery today, plugin and agent replies later. A message to send uses it
// too, asking first: Select sends it, Back drops it. So does what you just said, when
// "Confirm transcription" is on. Both check screens count down and send by themselves
// (settings_auto_send()); Up, Down or Back stops the count. Check screens leave the sprite out
// and shrink the headline, so what you said fills the screen.
#include "app.h"

#define HEADLINE_LEN 64
#define BODY_LEN 1024
#define PAD PBL_IF_ROUND_ELSE(18, 6)

static Window *s_window;
static ScrollLayer *s_scroll;
static BitmapLayer *s_sprite;
static TextLayer *s_headline;
static TextLayer *s_body;
static char s_headline_text[HEADLINE_LEN];
static char s_body_text[BODY_LEN];
typedef enum { CheckNone = 0, CheckMessage, CheckTranscript } Check;
static Check s_check;
static int32_t s_confirm_id;
static char s_said[BODY_LEN - 80];
static int s_left;
static AppTimer *s_tick;
// The count, pinned to the bottom of the screen so it shows however far you've scrolled.
static TextLayer *s_count;
static char s_count_text[24];
#define COUNT_H 26

static GFont prv_body_font(void) {
  return fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD);
}

// The width of the longest word, so a headline beside the sprite never breaks mid-word.
static int prv_widest_word(const char *text, GFont font) {
  char word[32];
  int widest = 0;
  const char *p = text;
  while (*p) {
    while (*p == ' ') p++;
    int n = 0;
    while (p[n] && p[n] != ' ') n++;
    if (!n) break;
    int len = n < (int)sizeof(word) - 1 ? n : (int)sizeof(word) - 1;
    memcpy(word, p, len);
    word[len] = 0;
    GSize s = graphics_text_layout_get_content_size(word, font, GRect(0, 0, 400, 100),
                                                    GTextOverflowModeWordWrap, GTextAlignmentLeft);
    if (s.w > widest) widest = s.w;
    p += n;
  }
  return widest;
}

static void prv_stop_count(void) {
  if (s_tick) app_timer_cancel(s_tick);
  s_tick = NULL;
}

// The words under the headline: what's being sent and the buttons. The count has its own strip.
static void prv_check_body(void) {
  const char *how = s_check == CheckTranscript ? "Select sends, Back drops it." : "Select sends, Back cancels.";
  snprintf(s_body_text, sizeof(s_body_text), "\"%s\"\n\n%s", s_said, how);
  snprintf(s_count_text, sizeof(s_count_text), "Sending in %ds", s_left);
  if (s_count) {
    layer_set_hidden(text_layer_get_layer(s_count), !s_tick);
    text_layer_set_text(s_count, s_count_text);
  }
}

static void prv_do_send(void) {
  Check check = s_check;
  int32_t id = s_confirm_id;
  char said[sizeof(s_said)];
  snprintf(said, sizeof(said), "%s", s_said);
  prv_stop_count();
  s_check = CheckNone;
  window_stack_remove(s_window, true);
  if (check == CheckMessage) home_confirm_send(id);
  else if (check == CheckTranscript) home_send_text(said);
}

static void prv_count(void *ctx) {
  s_tick = NULL;
  if (--s_left <= 0) {
    vibes_short_pulse();
    prv_do_send();
    return;
  }
  s_tick = app_timer_register(1000, prv_count, NULL);
  prv_check_body();
}

static void prv_send(ClickRecognizerRef rec, void *ctx) {
  prv_do_send();
}

// Up and Down still scroll, and stop the count so you can keep reading.
static void prv_up(ClickRecognizerRef rec, void *ctx) {
  if (s_tick) {
    prv_stop_count();
    prv_check_body();
  }
  scroll_layer_scroll_up_click_handler(rec, s_scroll);
}

static void prv_down(ClickRecognizerRef rec, void *ctx) {
  if (s_tick) {
    prv_stop_count();
    prv_check_body();
  }
  scroll_layer_scroll_down_click_handler(rec, s_scroll);
}

static void prv_back(ClickRecognizerRef rec, void *ctx) {
  Check check = s_check;
  prv_stop_count();
  s_check = CheckNone;
  window_stack_remove(s_window, true);
  if (check == CheckTranscript) home_transcript_dropped();
}

static void prv_click_config(void *ctx) {
  if (!s_check) return;
  window_single_click_subscribe(BUTTON_ID_SELECT, prv_send);
  window_single_repeating_click_subscribe(BUTTON_ID_UP, 100, prv_up);
  window_single_repeating_click_subscribe(BUTTON_ID_DOWN, 100, prv_down);
  window_single_click_subscribe(BUTTON_ID_BACK, prv_back);
}

static void prv_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(root);
  int width = bounds.size.w;
  bool wide = width >= 200;

  s_scroll = scroll_layer_create(bounds);
  scroll_layer_set_click_config_onto_window(s_scroll, window);
  scroll_layer_set_callbacks(s_scroll, (ScrollLayerCallbacks){ .click_config_provider = prv_click_config });
  scroll_layer_set_shadow_hidden(s_scroll, true);
#if defined(PBL_ROUND)
  scroll_layer_set_paging(s_scroll, true);
#endif

  // A check screen is about reading what you said, so it drops the sprite and keeps the
  // headline to one small line at the top; the words get the rest of the screen.
  bool check = s_check != CheckNone;
  GBitmap *talk = check ? NULL : sprite_frame(SpriteTalk);
  GSize size = talk ? gbitmap_get_bounds(talk).size : GSize(0, 0);
  int top = check ? PBL_IF_ROUND_ELSE(16, 0) : PBL_IF_ROUND_ELSE(12, 4);
  GFont head_font = fonts_get_system_font(wide ? FONT_KEY_GOTHIC_28_BOLD : FONT_KEY_GOTHIC_24_BOLD);
  // Wide screens put the headline beside the sprite when every word fits there; otherwise, and on
  // narrow and round screens, it goes under it.
  bool stacked = PBL_IF_ROUND_ELSE(true, !wide) || check;
  if (check) head_font = fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD);
  if (!stacked) {
    int column = width - size.w - 2 - PAD;
    if (prv_widest_word(s_headline_text, head_font) > column) {
      head_font = fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD);
      stacked = prv_widest_word(s_headline_text, head_font) > column;
    }
  }
  if (talk) {
    int sprite_x = stacked ? (width - size.w) / 2 : 0;
    s_sprite = bitmap_layer_create(GRect(sprite_x, top, size.w, size.h));
    bitmap_layer_set_bitmap(s_sprite, talk);
    bitmap_layer_set_compositing_mode(s_sprite, GCompOpSet);
    scroll_layer_add_child(s_scroll, bitmap_layer_get_layer(s_sprite));
  }

  GRect head_box;
  GTextAlignment head_align;
  if (stacked) {
    head_box = GRect(PAD, top + size.h, width - 2 * PAD, 200);
    head_align = check ? PBL_IF_ROUND_ELSE(GTextAlignmentCenter, GTextAlignmentLeft) : GTextAlignmentCenter;
  } else {
    int head_x = size.w + 2;
    head_box = GRect(head_x, top, width - head_x - PAD, 200);
    head_align = GTextAlignmentLeft;
  }
  GSize head = graphics_text_layout_get_content_size(s_headline_text, head_font, head_box,
                                                     GTextOverflowModeWordWrap, head_align);
  // Centre a short headline on the sprite's height.
  if (!stacked && head.h < size.h) head_box.origin.y = top + (size.h - head.h) / 2 - 4;
  head_box.size.h = head.h + (check ? 2 : 6);
  s_headline = text_layer_create(head_box);
  text_layer_set_text(s_headline, s_headline_text);
  text_layer_set_font(s_headline, head_font);
  text_layer_set_text_alignment(s_headline, head_align);
  text_layer_set_background_color(s_headline, GColorClear);
  text_layer_set_text_color(s_headline, theme_accent());
  scroll_layer_add_child(s_scroll, text_layer_get_layer(s_headline));

  int body_top = head_box.origin.y + head_box.size.h + 2;
  if (!stacked && body_top < top + size.h + 4) body_top = top + size.h + 4;
  GFont body_font = prv_body_font();
  GRect body_box = GRect(PAD, body_top, width - 2 * PAD, 2000);
  GSize body = graphics_text_layout_get_content_size(s_body_text, body_font, body_box,
                                                     GTextOverflowModeWordWrap,
                                                     PBL_IF_ROUND_ELSE(GTextAlignmentCenter, GTextAlignmentLeft));
  body_box.size.h = body.h + 8;
  s_body = text_layer_create(body_box);
  text_layer_set_text(s_body, s_body_text);
  text_layer_set_font(s_body, body_font);
  text_layer_set_text_alignment(s_body, PBL_IF_ROUND_ELSE(GTextAlignmentCenter, GTextAlignmentLeft));
  text_layer_set_background_color(s_body, GColorClear);
  text_layer_set_text_color(s_body, theme_text());
  scroll_layer_add_child(s_scroll, text_layer_get_layer(s_body));

  int content_h = body_box.origin.y + body_box.size.h + PBL_IF_ROUND_ELSE(30, 8);
  if (content_h < bounds.size.h) content_h = bounds.size.h;
  if (s_check) content_h += COUNT_H;
  scroll_layer_set_content_size(s_scroll, GSize(width, content_h));
  layer_add_child(root, scroll_layer_get_layer(s_scroll));

  if (s_check) {
    int count_y = bounds.size.h - COUNT_H - PBL_IF_ROUND_ELSE(12, 0);
    s_count = text_layer_create(GRect(0, count_y, width, COUNT_H));
    text_layer_set_font(s_count, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD));
    text_layer_set_text_alignment(s_count, GTextAlignmentCenter);
    text_layer_set_background_color(s_count, theme_accent());
    text_layer_set_text_color(s_count, theme_bg());
    text_layer_set_text(s_count, s_count_text);
    layer_set_hidden(text_layer_get_layer(s_count), !s_tick);
    layer_add_child(root, text_layer_get_layer(s_count));
  }
}

static void prv_unload(Window *window) {
  prv_stop_count();
  if (s_count) text_layer_destroy(s_count);
  s_count = NULL;
  text_layer_destroy(s_body);
  text_layer_destroy(s_headline);
  if (s_sprite) bitmap_layer_destroy(s_sprite);
  s_sprite = NULL;
  scroll_layer_destroy(s_scroll);
  window_destroy(s_window);
  s_window = NULL;
  s_body = NULL;
  // Closed some other way (another screen pushed over it and the app left): nothing is sent,
  // and a held transcript lets Quiet Time go back.
  if (s_check == CheckTranscript) home_transcript_dropped();
  s_check = CheckNone;
}

static void prv_push(Check check, const char *headline, const char *body) {
  // A newer screen replaces this one; a check it held is dropped, not sent (see prv_unload).
  if (s_window) window_stack_remove(s_window, false);
  s_check = check;
  snprintf(s_headline_text, sizeof(s_headline_text), "%s", headline ? headline : "");
  prv_stop_count();
  if (s_check) {
    snprintf(s_said, sizeof(s_said), "%s", body ? body : "");
    s_left = settings_auto_send();
    if (s_left > 0) s_tick = app_timer_register(1000, prv_count, NULL);
    prv_check_body();
  } else {
    snprintf(s_body_text, sizeof(s_body_text), "%s", body ? body : "");
  }
  s_window = window_create();
  window_set_background_color(s_window, theme_bg());
  window_set_window_handlers(s_window, (WindowHandlers) {
    .load = prv_load,
    .unload = prv_unload,
  });
  window_stack_push(s_window, true);
}

void reply_window_push(const char *headline, const char *body) {
  prv_push(CheckNone, headline, body);
}

void reply_window_push_confirm(const char *headline, const char *body, int32_t request_id) {
  s_confirm_id = request_id;
  prv_push(CheckMessage, headline, body);
  // A message is waiting on you: one buzz, so it isn't missed with the watch down.
  vibes_short_pulse();
}

void reply_window_push_transcript(const char *text) {
  prv_push(CheckTranscript, "Send this?", text);
}
