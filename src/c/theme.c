// The colours picked in settings: a background and a clock colour. 0 means the app's own
// (THEME_BG and THEME_FG in brand.h). Text that isn't the clock turns black or white to
// stay readable on the background; black and white watches use black or white for both.
#include "app.h"

#define PERSIST_KEY_BG_COLOR 7
#define PERSIST_KEY_CLOCK_COLOR 8

static uint8_t s_bg;
static uint8_t s_clock;

// A colour from settings: GColor8's argb byte with full alpha, or 0.
static uint8_t prv_clean(int32_t value) {
  return (value >= 0xC0 && value <= 0xFF) ? (uint8_t)value : 0;
}

// Brightness out of 30, from the three 2-bit channels.
static int prv_brightness(GColor color) {
  return 3 * color.r + 6 * color.g + color.b;
}

static bool prv_light(GColor color) {
  return prv_brightness(color) >= 15;
}

void theme_init(void) {
  if (persist_exists(PERSIST_KEY_BG_COLOR)) s_bg = prv_clean(persist_read_int(PERSIST_KEY_BG_COLOR));
  if (persist_exists(PERSIST_KEY_CLOCK_COLOR)) s_clock = prv_clean(persist_read_int(PERSIST_KEY_CLOCK_COLOR));
}

bool theme_set(int32_t bg, int32_t clock) {
  uint8_t next_bg = prv_clean(bg), next_clock = prv_clean(clock);
  if (next_bg == s_bg && next_clock == s_clock) return false;
  s_bg = next_bg;
  s_clock = next_clock;
  persist_write_int(PERSIST_KEY_BG_COLOR, s_bg);
  persist_write_int(PERSIST_KEY_CLOCK_COLOR, s_clock);
  return true;
}

GColor theme_bg(void) {
  if (!s_bg) return THEME_BG;
  GColor picked = (GColor){ .argb = s_bg };
#if defined(PBL_COLOR)
  return picked;
#else
  return prv_light(picked) ? GColorWhite : GColorBlack;
#endif
}

GColor theme_text(void) {
  if (!s_bg) return THEME_FG;
  return prv_light(theme_bg()) ? GColorBlack : GColorWhite;
}

GColor theme_clock(void) {
#if defined(PBL_COLOR)
  // The same colour as the background would hide the time.
  if (s_clock && s_clock != theme_bg().argb) return (GColor){ .argb = s_clock };
#endif
  return theme_text();
}

GColor theme_accent(void) {
  if (!s_bg) return THEME_ACCENT;
#if defined(PBL_COLOR)
  int gap = prv_brightness(THEME_ACCENT) - prv_brightness(theme_bg());
  if (gap >= 8 || gap <= -8) return THEME_ACCENT;
#endif
  return theme_text();
}
