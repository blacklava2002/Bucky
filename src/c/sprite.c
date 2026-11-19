// Lazily loaded sprite frames, shared by every window.
#include "app.h"

static GBitmap *s_frames[SpriteFrameCount];
// The big screens (Time 2, Round 2) get the sprite at 1.5x.
static const uint32_t s_ids[SpriteFrameCount] = {
#if PBL_DISPLAY_WIDTH >= 200
  RESOURCE_ID_SPRITE_IDLE_BIG,
  RESOURCE_ID_SPRITE_TALK_BIG,
  RESOURCE_ID_SPRITE_WAVE_BIG,
  RESOURCE_ID_SPRITE_LISTEN_BIG,
#else
  RESOURCE_ID_SPRITE_IDLE,
  RESOURCE_ID_SPRITE_TALK,
  RESOURCE_ID_SPRITE_WAVE,
  RESOURCE_ID_SPRITE_LISTEN,
#endif
};

GBitmap *sprite_frame(SpriteFrame frame) {
  if (frame >= SpriteFrameCount) frame = SpriteIdle;
  if (!s_frames[frame]) s_frames[frame] = gbitmap_create_with_resource(s_ids[frame]);
  return s_frames[frame];
}

void sprite_release(void) {
  for (int i = 0; i < SpriteFrameCount; i++) {
    if (s_frames[i]) {
      gbitmap_destroy(s_frames[i]);
      s_frames[i] = NULL;
    }
  }
}
