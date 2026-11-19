// Watch-local timers and alarms.
// Adapted from Bobby's alarm manager (Apache 2.0, Copyright 2025 Google LLC).
#pragma once
#include <pebble.h>

#define CLOCK_MAX_ITEMS 8
#define CLOCK_LABEL_LEN 19

typedef enum {
  ClockKindTimer = 1,
  ClockKindAlarm = 2,
} ClockKind;

// 32 bytes, so all eight fit in one 256-byte persist slot.
typedef struct {
  int32_t when;
  int32_t wakeup_id;
  int32_t duration;  // a timer's length in seconds, so it can be repeated; 0 for alarms
  uint8_t kind;
  char label[CLOCK_LABEL_LEN];
} ClockItem;

void clock_init(void);
// Returns S_SUCCESS or a negative StatusCode (E_RANGE, E_INVALID_ARGUMENT, E_OUT_OF_RESOURCES).
StatusCode clock_add(time_t when, ClockKind kind, const char *label, int32_t duration);
int clock_count(void);
const ClockItem *clock_get(int index);
void clock_remove(int index);
// Removes every item of a kind; returns how many.
int clock_remove_kind(ClockKind kind);
// Removes items of a kind whose label contains `label`; returns how many.
int clock_remove_labelled(ClockKind kind, const char *label);
// If the wakeup belongs to an item, copies it out, removes it, and returns true.
bool clock_take_wakeup(WakeupId id, ClockItem *out);
// "Timer set for 10 min", "Alarm 6:30 AM", or an error, into buf.
void clock_describe_result(StatusCode result, ClockKind kind, time_t when, char *buf, size_t size);
// "6:30 AM" / "18:30", with "tomorrow" or a weekday when not today.
void clock_format_time(time_t when, bool with_day, char *buf, size_t size);
// Called after every change to the list, so the phone can update timeline pins (main.c).
void clock_changed(void);
