// The reply screen. The sprite talking, a headline beside it and the answer under it,
// scrolling with Up and Down. Back returns home. Any feature with something to say uses it:
// weather, music and battery today, plugin and agent replies later. A message to send uses it
// too, asking first: Select sends it, Back drops it.
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
static bool s_confirm;
static int32_t s_confirm_id;

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

static void prv_send(ClickRecognizerRef rec, void *ctx) {
  int32_t id = s_confirm_id;
  s_confirm = false;
  window_stack_remove(s_window, true);
  home_confirm_send(id);
}

static void prv_click_config(void *ctx) {
  if (s_confirm) window_single_click_subscribe(BUTTON_ID_SELECT, prv_send);
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

  GBitmap *talk = sprite_frame(SpriteTalk);
  GSize size = gbitmap_get_bounds(talk).size;
  int top = PBL_IF_ROUND_ELSE(12, 4);
  GFont head_font = fonts_get_system_font(wide ? FONT_KEY_GOTHIC_28_BOLD : FONT_KEY_GOTHIC_24_BOLD);
  // Wide screens put the headline beside the sprite when every word fits there; otherwise, and on
  // narrow and round screens, it goes under it.
  bool stacked = PBL_IF_ROUND_ELSE(true, !wide);
  if (!stacked) {
    int column = width - size.w - 2 - PAD;
    if (prv_widest_word(s_headline_text, head_font) > column) {
      head_font = fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD);
      stacked = prv_widest_word(s_headline_text, head_font) > column;
    }
  }
  int sprite_x = stacked ? (width - size.w) / 2 : 0;
  s_sprite = bitmap_layer_create(GRect(sprite_x, top, size.w, size.h));
  bitmap_layer_set_bitmap(s_sprite, talk);
  bitmap_layer_set_compositing_mode(s_sprite, GCompOpSet);
  scroll_layer_add_child(s_scroll, bitmap_layer_get_layer(s_sprite));

  GRect head_box;
  GTextAlignment head_align;
  if (stacked) {
    head_box = GRect(PAD, top + size.h, width - 2 * PAD, 200);
    head_align = GTextAlignmentCenter;
  } else {
    int head_x = size.w + 2;
    head_box = GRect(head_x, top, width - head_x - PAD, 200);
    head_align = GTextAlignmentLeft;
  }
  GSize head = graphics_text_layout_get_content_size(s_headline_text, head_font, head_box,
                                                     GTextOverflowModeWordWrap, head_align);
  // Centre a short headline on the sprite's height.
  if (!stacked && head.h < size.h) head_box.origin.y = top + (size.h - head.h) / 2 - 4;
  head_box.size.h = head.h + 6;
  s_headline = text_layer_create(head_box);
  text_layer_set_text(s_headline, s_headline_text);
  text_layer_set_font(s_headline, head_font);
  text_layer_set_text_alignment(s_headline, head_align);
  text_layer_set_background_color(s_headline, GColorClear);
  text_layer_set_text_color(s_headline, THEME_ACCENT);
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
  text_layer_set_text_color(s_body, THEME_FG);
  scroll_layer_add_child(s_scroll, text_layer_get_layer(s_body));

  int content_h = body_box.origin.y + body_box.size.h + PBL_IF_ROUND_ELSE(30, 8);
  if (content_h < bounds.size.h) content_h = bounds.size.h;
  scroll_layer_set_content_size(s_scroll, GSize(width, content_h));
  layer_add_child(root, scroll_layer_get_layer(s_scroll));
}

static void prv_unload(Window *window) {
  text_layer_destroy(s_body);
  text_layer_destroy(s_headline);
  bitmap_layer_destroy(s_sprite);
  scroll_layer_destroy(s_scroll);
  window_destroy(s_window);
  s_window = NULL;
  s_confirm = false;
}

static void prv_push(const char *headline, const char *body) {
  if (s_window) window_stack_remove(s_window, false);
  snprintf(s_headline_text, sizeof(s_headline_text), "%s", headline ? headline : "");
  if (s_confirm) {
    snprintf(s_body_text, sizeof(s_body_text), "\"%s\"\n\nSelect sends, Back cancels.", body ? body : "");
  } else {
    snprintf(s_body_text, sizeof(s_body_text), "%s", body ? body : "");
  }
  s_window = window_create();
  window_set_background_color(s_window, THEME_BG);
  window_set_window_handlers(s_window, (WindowHandlers) {
    .load = prv_load,
    .unload = prv_unload,
  });
  window_stack_push(s_window, true);
}

void reply_window_push(const char *headline, const char *body) {
  s_confirm = false;
  prv_push(headline, body);
}

void reply_window_push_confirm(const char *headline, const char *body, int32_t request_id) {
  s_confirm = true;
  s_confirm_id = request_id;
  prv_push(headline, body);
  // A message is waiting on you: one buzz, so it isn't missed with the watch down.
  vibes_short_pulse();
}
