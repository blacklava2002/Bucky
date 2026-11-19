// The example prompts on the Up button. The phone sends the list from settings;
// the watch keeps a copy so it works without the phone, and starts with a few defaults.
#include "app.h"

#define PROMPTS_PERSIST_FIRST_KEY 20
#define PROMPTS_PERSIST_CHUNKS 3

static const char DEFAULT_PROMPTS[] =
  "What's the current weather?\n"
  "Set a 5 minute tea timer.\n"
  "Find my phone.\n"
  "What's my phone's battery?\n"
  "Set an alarm for 7am tomorrow.\n"
  "What's on my calendar today?\n"
  "Will I need an umbrella tomorrow?\n"
  "Any important emails?\n"
  "What timers do I have?\n"
  "Skip this song.";

static char s_text[PROMPTS_MAX_TEXT];
static const char *s_items[PROMPTS_MAX];
static int s_count;

static void prv_split(void) {
  s_count = 0;
  char *p = s_text;
  while (*p && s_count < PROMPTS_MAX) {
    char *end = strchr(p, '\n');
    if (end) *end = '\0';
    if (*p) s_items[s_count++] = p;
    if (!end) break;
    p = end + 1;
  }
}

static void prv_use(const char *text) {
  snprintf(s_text, sizeof(s_text), "%s", text);
  prv_split();
}

void prompts_init(void) {
  if (!persist_exists(PROMPTS_PERSIST_FIRST_KEY)) {
    prv_use(DEFAULT_PROMPTS);
    return;
  }
  size_t used = 0;
  for (int i = 0; i < PROMPTS_PERSIST_CHUNKS && persist_exists(PROMPTS_PERSIST_FIRST_KEY + i); i++) {
    int n = persist_read_data(PROMPTS_PERSIST_FIRST_KEY + i, s_text + used, PERSIST_DATA_MAX_LENGTH);
    if (n <= 0) break;
    used += (size_t)n;
  }
  s_text[used < sizeof(s_text) ? used : sizeof(s_text) - 1] = '\0';
  prv_split();
  if (s_count == 0) prv_use(DEFAULT_PROMPTS);
}

// True when text is the list already held, so a launch doesn't rewrite storage.
static bool prv_same(const char *text) {
  const char *p = text;
  for (int i = 0; i < s_count; i++) {
    size_t len = strlen(s_items[i]);
    if (strncmp(p, s_items[i], len) != 0) return false;
    p += len;
    if (i < s_count - 1) {
      if (*p != '\n') return false;
      p++;
    }
  }
  return *p == '\0';
}

void prompts_set(const char *text) {
  if (text && text[0] && prv_same(text)) return;
  snprintf(s_text, sizeof(s_text), "%s", text && text[0] ? text : DEFAULT_PROMPTS);
  size_t len = strlen(s_text);
  for (int i = 0; i < PROMPTS_PERSIST_CHUNKS; i++) {
    size_t start = (size_t)i * PERSIST_DATA_MAX_LENGTH;
    if (start < len) {
      size_t n = len - start < PERSIST_DATA_MAX_LENGTH ? len - start : PERSIST_DATA_MAX_LENGTH;
      persist_write_data(PROMPTS_PERSIST_FIRST_KEY + i, s_text + start, n);
    } else {
      persist_delete(PROMPTS_PERSIST_FIRST_KEY + i);
    }
  }
  // Splitting turns the newlines into ends of strings, so it comes after the save.
  prv_split();
}

int prompts_count(void) {
  return s_count;
}

const char *prompts_get(int index) {
  return index >= 0 && index < s_count ? s_items[index] : "";
}
