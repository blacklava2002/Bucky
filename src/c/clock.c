// Watch-local timers, alarms and reminders.
// Adapted from Bobby's alarm manager (Apache 2.0, Copyright 2025 Google LLC).
//
// PebbleOS lets an app hold 8 wakeups, so up to CLOCK_MAX_ITEMS are kept and only the 8
// soonest are armed. Every change, every wakeup and every launch arms the next ones, and the
// soonest is always armed, so the app always runs again before an unarmed one is due.
#include "clock.h"

// 0.1 kept a 23-character label and no duration under 100/101; 0.2 moved to 102/103.
// Items 9 to 24 went in 104 and 105 when the list grew past 8.
#define PERSIST_KEY_V1_ITEMS 100
#define PERSIST_KEY_V1_COUNT 101
#define PERSIST_KEY_ITEMS 102
#define PERSIST_KEY_COUNT 103
#define PERSIST_KEY_ITEMS_2 104
#define PERSIST_KEY_ITEMS_3 105
#define ITEMS_PER_KEY 8
// Long labels (a reminder's words), one slot per key, matched to items by time and label.
#define PERSIST_KEY_TEXT_BASE 110
// What the OS allows one app.
#define WAKEUP_SLOTS 8
// A wakeup can't be within a minute of another; a clash rings up to this many minutes late.
#define CLASH_SHIFTS 5
// How late an unarmed item can be found and still ring.
#define MISSED_GRACE_S 3600

static const uint32_t ITEM_KEYS[] = { PERSIST_KEY_ITEMS, PERSIST_KEY_ITEMS_2, PERSIST_KEY_ITEMS_3 };

typedef struct {
  int32_t when;
  char text[CLOCK_TEXT_LEN];
} ClockText;

static ClockText s_texts[CLOCK_TEXT_SLOTS];

typedef struct {
  int32_t when;
  int32_t wakeup_id;
  uint8_t kind;
  char label[23];
} ClockItemV1;

static ClockItem s_items[CLOCK_MAX_ITEMS];
static int s_count;

static void prv_arm(void);

static void prv_save(void) {
  prv_arm();
  for (int k = 0; k < (int)ARRAY_LENGTH(ITEM_KEYS); k++) {
    int first = k * ITEMS_PER_KEY;
    if (first < s_count) persist_write_data(ITEM_KEYS[k], &s_items[first], sizeof(ClockItem) * ITEMS_PER_KEY);
    else persist_delete(ITEM_KEYS[k]);
  }
  persist_write_int(PERSIST_KEY_COUNT, s_count);
  clock_changed();
}

// Reads 0.1's list into the new layout, once, and forgets the old keys.
static int prv_read_v1(ClockItem *out) {
  if (!persist_exists(PERSIST_KEY_V1_COUNT)) return -1;
  int stored = persist_read_int(PERSIST_KEY_V1_COUNT);
  ClockItemV1 old[ITEMS_PER_KEY];
  memset(old, 0, sizeof(old));
  if (stored > 0 && stored <= ITEMS_PER_KEY) persist_read_data(PERSIST_KEY_V1_ITEMS, old, sizeof(old));
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

static bool prv_text_matches(const ClockText *t, const ClockItem *item) {
  return t->when && t->when == item->when && strncmp(t->text, item->label, CLOCK_LABEL_LEN - 1) == 0;
}

static ClockText *prv_text_find(const ClockItem *item) {
  for (int i = 0; i < CLOCK_TEXT_SLOTS; i++) {
    if (prv_text_matches(&s_texts[i], item)) return &s_texts[i];
  }
  return NULL;
}

static void prv_text_write(int slot) {
  if (s_texts[slot].when) persist_write_data(PERSIST_KEY_TEXT_BASE + slot, &s_texts[slot], sizeof(ClockText));
  else persist_delete(PERSIST_KEY_TEXT_BASE + slot);
}

static void prv_text_drop(const ClockItem *item) {
  ClockText *t = prv_text_find(item);
  if (!t) return;
  memset(t, 0, sizeof(*t));
  prv_text_write(t - s_texts);
}

// With every slot taken, the item keeps only its short label.
static void prv_text_put(const ClockItem *item, const char *text) {
  for (int i = 0; i < CLOCK_TEXT_SLOTS; i++) {
    if (s_texts[i].when) continue;
    s_texts[i].when = item->when;
    strncpy(s_texts[i].text, text, CLOCK_TEXT_LEN - 1);
    s_texts[i].text[CLOCK_TEXT_LEN - 1] = '\0';
    prv_text_write(i);
    return;
  }
}

static bool prv_has_text(const ClockText *t) {
  for (int i = 0; i < s_count; i++) {
    if (prv_text_matches(t, &s_items[i])) return true;
  }
  return false;
}

// Reads the long labels and forgets any whose item is gone.
static void prv_text_load(void) {
  memset(s_texts, 0, sizeof(s_texts));
  for (int i = 0; i < CLOCK_TEXT_SLOTS; i++) {
    if (!persist_exists(PERSIST_KEY_TEXT_BASE + i)) continue;
    persist_read_data(PERSIST_KEY_TEXT_BASE + i, &s_texts[i], sizeof(ClockText));
    s_texts[i].text[CLOCK_TEXT_LEN - 1] = '\0';
    if (!prv_has_text(&s_texts[i])) {
      memset(&s_texts[i], 0, sizeof(ClockText));
      persist_delete(PERSIST_KEY_TEXT_BASE + i);
    }
  }
}

const char *clock_text(const ClockItem *item) {
  if (!item) return "";
  ClockText *t = prv_text_find(item);
  return t ? t->text : item->label;
}

// ------------------------------------------------------------ arming

static int prv_armed(void) {
  int n = 0;
  for (int i = 0; i < s_count; i++) {
    if (s_items[i].wakeup_id > 0) n++;
  }
  return n;
}

// Schedules an item's wakeup. Another wakeup within a minute pushes it a minute later.
static bool prv_schedule(ClockItem *item) {
  time_t at = item->when;
  time_t soonest = time(NULL) + 2;
  if (at < soonest) at = soonest;  // due now (a clash that waited): ring right away
  for (int shift = 0; shift <= CLASH_SHIFTS; shift++) {
    WakeupId id = wakeup_schedule(at + shift * 60, item->kind, true);
    if (id >= 0) {
      item->wakeup_id = id;
      return true;
    }
    if (id != E_RANGE) return false;
  }
  return false;
}

// Arms the soonest items, taking a wakeup back from the latest armed one when something
// sooner is waiting.
static void prv_arm(void) {
  for (int i = 0; i < s_count; i++) {
    if (s_items[i].wakeup_id > 0) continue;
    if (prv_armed() >= WAKEUP_SLOTS) {
      int last = -1;
      for (int j = s_count - 1; j > i; j--) {
        if (s_items[j].wakeup_id > 0) { last = j; break; }
      }
      if (last < 0) break;  // every armed one is sooner
      wakeup_cancel(s_items[last].wakeup_id);
      s_items[last].wakeup_id = 0;
    }
    if (!prv_schedule(&s_items[i])) break;
  }
}

// ------------------------------------------------------------ the list

void clock_init(void) {
  s_count = 0;
  memset(s_items, 0, sizeof(s_items));
  int stored = prv_read_v1(s_items);
  bool migrated = stored >= 0;
  if (!migrated) {
    stored = persist_exists(PERSIST_KEY_COUNT) ? persist_read_int(PERSIST_KEY_COUNT) : 0;
    if (stored < 0 || stored > CLOCK_MAX_ITEMS) stored = 0;
    for (int k = 0; k * ITEMS_PER_KEY < stored; k++) {
      persist_read_data(ITEM_KEYS[k], &s_items[k * ITEMS_PER_KEY], sizeof(ClockItem) * ITEMS_PER_KEY);
    }
  }
  if (stored <= 0) {
    // Nothing we know about: make sure no stray wakeups ring.
    memset(s_items, 0, sizeof(s_items));
    wakeup_cancel_all();
    prv_text_load();
    if (migrated) prv_save();
    return;
  }
  s_count = stored;

  WakeupId launch_id = -1;
  int32_t cookie = 0;
  bool woke = launch_reason() == APP_LAUNCH_WAKEUP && wakeup_get_launch_event(&launch_id, &cookie);
  time_t now = time(NULL);

  // An armed item whose wakeup is gone either rang (the OS shows a missed one itself) or was
  // cleared by an update; a future one is armed again.
  // One still waiting for a wakeup that came due while the app couldn't run (the watch was
  // off) rings now if it's less than an hour late, and is dropped if it's older.
  bool changed = migrated;
  for (int i = s_count - 1; i >= 0; i--) {
    ClockItem *item = &s_items[i];
    item->label[CLOCK_LABEL_LEN - 1] = '\0';
    bool keep;
    if (item->when <= 0 || item->kind < ClockKindTimer || item->kind > ClockKindReminder) {
      keep = false;
    } else if (item->wakeup_id <= 0) {
      keep = item->when > now - MISSED_GRACE_S;
    } else if (wakeup_query(item->wakeup_id, NULL) || (woke && item->wakeup_id == launch_id)) {
      continue;
    } else {
      keep = item->when > now;
      item->wakeup_id = 0;
    }
    if (keep) continue;
    changed = true;
    for (int j = i; j < s_count - 1; j++) s_items[j] = s_items[j + 1];
    s_count--;
    memset(&s_items[s_count], 0, sizeof(ClockItem));
  }
  prv_sort();
  prv_text_load();
  if (changed || prv_armed() < WAKEUP_SLOTS) prv_save();
}

StatusCode clock_add(time_t when, ClockKind kind, const char *label, int32_t duration) {
  if (s_count >= CLOCK_MAX_ITEMS) return E_OUT_OF_RESOURCES;
  if (when <= time(NULL)) return E_INVALID_ARGUMENT;
  ClockItem *item = &s_items[s_count++];
  memset(item, 0, sizeof(*item));
  item->when = (int32_t)when;
  item->kind = kind;
  item->duration = kind == ClockKindTimer ? duration : 0;
  if (label) {
    strncpy(item->label, label, CLOCK_LABEL_LEN - 1);
    item->label[CLOCK_LABEL_LEN - 1] = '\0';
    if (strlen(label) >= CLOCK_LABEL_LEN) prv_text_put(item, label);
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
  if (cancel && s_items[index].wakeup_id > 0) wakeup_cancel(s_items[index].wakeup_id);
  prv_text_drop(&s_items[index]);
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
  if (id <= 0) return false;
  for (int i = 0; i < s_count; i++) {
    if (s_items[i].wakeup_id == id) {
      if (out) *out = s_items[i];
      if (text && size) snprintf(text, size, "%s", clock_text(&s_items[i]));
      prv_remove_at(i, false);  // it already fired
      prv_save();               // and the next one in line gets its wakeup
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
    case E_INVALID_ARGUMENT:
      snprintf(buf, size, "That time has already passed");
      break;
    case E_OUT_OF_RESOURCES:
      snprintf(buf, size, "Already %d timers, alarms and reminders set", CLOCK_MAX_ITEMS);
      break;
    default:
      snprintf(buf, size, "Couldn't set that (%d)", (int)result);
      break;
  }
}
