// Branding for the watch side: the name and colours. The sprite and menu icon are the
// images in resources/images (sprite_*.png, menu_icon*.png); the phone side's branding is
// in src/pkjs/brand.js and package.json. A rebrand only touches those.
#pragma once

#define BRAND_NAME "Bucky"

// Home, reply and ringing screens.
#define THEME_BG PBL_IF_COLOR_ELSE(GColorMidnightGreen, GColorWhite)
#define THEME_FG PBL_IF_COLOR_ELSE(GColorWhite, GColorBlack)
#define THEME_ACCENT PBL_IF_COLOR_ELSE(GColorChromeYellow, GColorBlack)
// Lists are light, like the system's, with the accent on the selected row.
#define LIST_BG GColorWhite
#define LIST_FG GColorBlack
#define LIST_HIGHLIGHT PBL_IF_COLOR_ELSE(GColorChromeYellow, GColorBlack)
#define LIST_HIGHLIGHT_FG PBL_IF_COLOR_ELSE(GColorBlack, GColorWhite)
