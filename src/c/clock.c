// Watch-local timers, alarms and reminders.
// Adapted from Bobby's alarm manager (Apache 2.0, Copyright 2025 Google LLC).
#include "clock.h"

// 0.1 kept a 23-character label and no duration under 100/101; 0.2 moved to 102/103.
#define PERSIST_KEY_V1_ITEMS 100
#define PERSIST_KEY_V1_COUNT 101
#define PERSIST_KEY_ITEMS 102
#define PERSIST_KEY_COUNT 103
// Long labels (a reminder's words), one slot per key, matched to items by wakeup id.
#define PERSIST_KEY_TEXT_BASE 110

typedef struct {
  int32_t wakeup_id;
  char text[CLOCK_TEXT_LEN];
} ClockText;

static ClockText s_texts[CLOCK_MAX_ITEMS];

typedef struct {
  int32_t when;
  int32_t wakeup_id;
  uint8_t kind;
  char label[23];
} ClockItemV1;

static ClockItem s_items[CLOCK_MAX_ITEMS];
static int s_count;

static void prv_save(void) {
  if (s_count == 0) {
    persist_delete(PERSIST_KEY_ITEMS);
    persist_write_int(PERSIST_KEY_COUNT, 0);
  } else {
    persist_write_data(PERSIST_KEY_ITEMS, s_items, sizeof(ClockItem) * CLOCK_MAX_ITEMS);
    persist_write_int(PERSIST_KEY_COUNT, s_count);
  }
  clock_changed();
}

// Reads 0.1's list into the new layout, once, and forgets the old keys.
static int prv_read_v1(ClockItem *out) {
  if (!persist_exists(PERSIST_KEY_V1_COUNT)) return -1;
  int stored = persist_read_int(PERSIST_KEY_V1_COUNT);
  ClockItemV1 old[CLOCK_MAX_ITEMS];
  memset(old, 0, sizeof(old));
  if (stored > 0 && stored <= CLOCK_MAX_ITEMS) persist_read_data(PERSIST_KEY_V1_ITEMS, old, sizeof(old));
  else stored = 0;
  for (int i = 0; i < stored; i++) {
    memset(&out[i], 0, sizeof(ClockItem));
    out[i].when = old[i].when;
    out[i].wakeup_id = old[i].wakeup_id;
    out[i].kind = old[i].kind;
    strncpy(out[i].label, old[i].label, CLOCK_LABEL_LEN - 1);
  }
  persist_delete(PERSIST_KEY_V1_ITEMS);
  persist_delete(PERSIST_KEY_V1_COUNT);
  return stored;
}

static void prv_sort(void) {
  for (int i = 1; i < s_count; i++) {
    ClockItem key = s_items[i];
    int j = i - 1;
    while (j >= 0 && s_items[j].when > key.when) {
      s_items[j + 1] = s_items[j];
      j--;
    }
    s_items[j + 1] = key;
  }
}

// ------------------------------------------------------------ long labels

static ClockText *prv_text_find(int32_t id) {
  if (id <= 0) return NULL;
  for (int i = 0; i < CLOCK_MAX_ITEMS; i++) {
    if (s_texts[i].wakeup_id == id) return &s_texts[i];
  }
  return NULL;
}

static void prv_text_write(int slot) {
  if (s_texts[slot].wakeup_id) persist_write_data(PERSIST_KEY_TEXT_BASE + slot, &s_texts[slot], sizeof(ClockText));
  else persist_delete(PERSIST_KEY_TEXT_BASE + slot);
}

static void prv_text_drop(int32_t id) {
  ClockText *t = prv_text_find(id);
  if (!t) return;
  memset(t, 0, sizeof(*t));
  prv_text_write(t - s_texts);
}

static void prv_text_put(int32_t id, const char *text) {
  for (int i = 0; i < CLOCK_MAX_ITEMS; i++) {
    if (s_texts[i].wakeup_id) continue;
    s_texts[i].wakeup_id = id;
    strncpy(s_texts[i].text, text, CLOCK_TEXT_LEN - 1);
    s_texts[i].text[CLOCK_TEXT_LEN - 1] = '\0';
    prv_text_write(i);
    return;
  }
}

static bool prv_alive(int32_t id) {
  for (int i = 0; i < s_count; i++) {
    if (s_items[i].wakeup_id == id) return true;
  }
  return false;
}

// Reads the long labels and forgets any whose item is gone.
static void prv_text_load(void) {
  memset(s_texts, 0, sizeof(s_texts));
  for (int i = 0; i < CLOCK_MAX_ITEMS; i++) {
    if (!persist_exists(PERSIST_KEY_TEXT_BASE + i)) continue;
    persist_read_data(PERSIST_KEY_TEXT_BASE + i, &s_texts[i], sizeof(ClockText));
    s_texts[i].text[CLOCK_TEXT_LEN - 1] = '\0';
    if (!prv_alive(s_texts[i].wakeup_id)) {
      memset(&s_texts[i], 0, sizeof(ClockText));
      persist_delete(PERSIST_KEY_TEXT_BASE + i);
    }
  }
}

const char *clock_text(const ClockItem *item) {
  if (!item) return "";
  ClockText *t = prv_text_find(item->wakeup_id);
  return t ? t->text : item->label;
}

void clock_init(void) {
  s_count = 0;
  memset(s_items, 0, sizeof(s_items));
  ClockItem loaded[CLOCK_MAX_ITEMS];
  memset(loaded, 0, sizeof(loaded));
  int stored = prv_read_v1(loaded);
  bool migrated = stored >= 0;
  if (!migrated) {
    stored = persist_exists(PERSIST_KEY_COUNT) ? persist_read_int(PERSIST_KEY_COUNT) : 0;
    if (stored > 0 && stored <= CLOCK_MAX_ITEMS) persist_read_data(PERSIST_KEY_ITEMS, loaded, sizeof(loaded));
  }
  if (stored <= 0 || stored > CLOCK_MAX_ITEMS) {
    // Nothing we know about: make sure no stray wakeups ring.
    wakeup_cancel_all();
    if (migrated) prv_save();
    prv_text_load();
    return;
  }

  WakeupId launch_id = -1;
  int32_t cookie = 0;
  bool woke = launch_reason() == APP_LAUNCH_WAKEUP && wakeup_get_launch_event(&launch_id, &cookie);

  bool dropped = false;
  for (int i = 0; i < stored; i++) {
    bool alive = wakeup_query(loaded[i].wakeup_id, NULL) || (woke && loaded[i].wakeup_id == launch_id);
    if (!alive) {
      dropped = true;
      continue;
    }
    loaded[i].label[CLOCK_LABEL_LEN - 1] = '\0';
    s_items[s_count++] = loaded[i];
  }
  prv_sort();
  prv_text_load();
  if (dropped || migrated) prv_save();
}

StatusCode clock_add(time_t when, ClockKind kind, const char *label, int32_t duration) {
  if (s_count >= CLOCK_MAX_ITEMS) return E_OUT_OF_RESOURCES;
  WakeupId id = wakeup_schedule(when, kind, true);
  if (id < 0) return (StatusCode)id;
  ClockItem *item = &s_items[s_count++];
  memset(item, 0, sizeof(*item));
  item->when = (int32_t)when;
  item->wakeup_id = id;
  item->kind = kind;
  item->duration = kind == ClockKindTimer ? duration : 0;
  if (label) {
    strncpy(item->label, label, CLOCK_LABEL_LEN - 1);
    item->label[CLOCK_LABEL_LEN - 1] = '\0';
    if (strlen(label) >= CLOCK_LABEL_LEN) prv_text_put(id, label);
  }
  prv_sort();
  prv_save();
  return S_SUCCESS;
}

int clock_count(void) {
  return s_count;
}

const ClockItem *clock_get(int index) {
  if (index < 0 || index >= s_count) return NULL;
  return &s_items[index];
}

static void prv_remove_at(int index, bool cancel) {
  if (index < 0 || index >= s_count) return;
  if (cancel) wakeup_cancel(s_items[index].wakeup_id);
  prv_text_drop(s_items[index].wakeup_id);
  for (int i = index; i < s_count - 1; i++) s_items[i] = s_items[i + 1];
  s_count--;
  memset(&s_items[s_count], 0, sizeof(ClockItem));
}

void clock_remove(int index) {
  prv_remove_at(index, true);
  prv_save();
}

// Case-insensitive substring match; labels are short, so the naive loop is fine.
static bool prv_contains(const char *haystack, const char *needle) {
  if (!needle || !needle[0]) return true;
  size_t n = strlen(needle);
  for (const char *h = haystack; *h; h++) {
    size_t k = 0;
    while (k < n && h[k]) {
      char a = h[k], b = needle[k];
      if (a >= 'A' && a <= 'Z') a += 32;
      if (b >= 'A' && b <= 'Z') b += 32;
      if (a != b) break;
      k++;
    }
    if (k == n) return true;
  }
  return false;
}

int clock_remove_labelled(ClockKind kind, const char *label) {
  int removed = 0;
  for (int i = s_count - 1; i >= 0; i--) {
    if (s_items[i].kind == kind && prv_contains(clock_text(&s_items[i]), label)) {
      prv_remove_at(i, true);
      removed++;
    }
  }
  if (removed) prv_save();
  return removed;
}

int clock_remove_kind(ClockKind kind) {
  return clock_remove_labelled(kind, NULL);
}

bool clock_take_wakeup(WakeupId id, ClockItem *out, char *text, size_t size) {
  for (int i = 0; i < s_count; i++) {
    if (s_items[i].wakeup_id == id) {
      if (out) *out = s_items[i];
      if (text && size) snprintf(text, size, "%s", clock_text(&s_items[i]));
      prv_remove_at(i, false);  // it already fired
      prv_save();
      return true;
    }
  }
  return false;
}

void clock_format_time(time_t when, bool with_day, char *buf, size_t size) {
  struct tm when_tm = *localtime(&when);
  time_t now = time(NULL);
  struct tm now_tm = *localtime(&now);
  char clock_part[12];
  strftime(clock_part, sizeof(clock_part), clock_is_24h_style() ? "%H:%M" : "%l:%M %p", &when_tm);
  const char *trimmed = clock_part[0] == ' ' ? clock_part + 1 : clock_part;
  if (!with_day || (when_tm.tm_yday == now_tm.tm_yday && when_tm.tm_year == now_tm.tm_year)) {
    snprintf(buf, size, "%s", trimmed);
    return;
  }
  time_t tomorrow = now + 24 * 60 * 60;
  struct tm tom_tm = *localtime(&tomorrow);
  if (when_tm.tm_yday == tom_tm.tm_yday && when_tm.tm_year == tom_tm.tm_year) {
    snprintf(buf, size, "%s tomorrow", trimmed);
    return;
  }
  // Within the week the weekday is enough; a week or more out (the same weekday next week)
  // also needs the date, so "Wed" can't be mistaken for today.
  char day[12];
  strftime(day, sizeof(day), when - now < 6 * 24 * 60 * 60 ? "%a" : "%a %b", &when_tm);
  if (when - now < 6 * 24 * 60 * 60) snprintf(buf, size, "%s %s", trimmed, day);
  else snprintf(buf, size, "%s %s %d", trimmed, day, when_tm.tm_mday);
}

static void prv_format_duration(int seconds, char *buf, size_t size) {
  int h = seconds / 3600;
  int m = (seconds % 3600) / 60;
  int s = seconds % 60;
  if (h && m) snprintf(buf, size, "%dh %dm", h, m);
  else if (h) snprintf(buf, size, "%d hr", h);
  else if (m && s) snprintf(buf, size, "%dm %ds", m, s);
  else if (m) snprintf(buf, size, "%d min", m);
  else snprintf(buf, size, "%d sec", s);
}

void clock_describe_result(StatusCode result, ClockKind kind, time_t when, char *buf, size_t size) {
  if (result == S_SUCCESS) {
    char part[24];
    if (kind == ClockKindTimer) {
      prv_format_duration((int)(when - time(NULL)), part, sizeof(part));
      snprintf(buf, size, "Timer set: %s", part);
    } else if (kind == ClockKindReminder) {
      clock_format_time(when, true, part, sizeof(part));
      snprintf(buf, size, "Reminder set: %s", part);
    } else {
      clock_format_time(when, true, part, sizeof(part));
      struct tm when_tm = *localtime(&when);
      time_t now = time(NULL);
      struct tm now_tm = *localtime(&now);
      bool today = when_tm.tm_yday == now_tm.tm_yday && when_tm.tm_year == now_tm.tm_year;
      snprintf(buf, size, "Alarm set: %s%s", part, today ? " today" : "");
    }
    return;
  }
  switch (result) {
    case E_RANGE:
      snprintf(buf, size, "Something else rings within a minute of that");
      break;
    case E_INVALID_ARGUMENT:
      snprintf(buf, size, "That time has already passed");
      break;
    case E_OUT_OF_RESOURCES:
      snprintf(buf, size, "Already 8 timers, alarms and reminders set");
      break;
    default:
      snprintf(buf, size, "Couldn't set that (%d)", (int)result);
      break;
  }
}
