# Custom pixel art (asset packs)

The office ships with **its own procedural pixel art** (every character and piece of furniture is drawn in code), so it works and can be redistributed with no external assets.

If you own a top-down pixel pack (for example an office/interior pack from itch.io), you can skin the office with it **locally**:

1. Put the pack's PNG files in `~/.virtual-agent-office/assets/` (or any folder passed with `--assets <dir>`).
2. Add a `manifest.json` next to them that says which rectangle of which PNG is which object.
3. Reload the page. **Settings** shows "pack loaded ✓". Anything you don't list keeps the built-in art.

> ⚠️ **Licensing:** most paid (and many free) itch.io packs allow use in your project but **forbid redistributing the raw files**. That's why packs live in your home folder and not in this repo. Don't commit them to a public repository.

## manifest.json

```jsonc
{
  "tileSize": 16,
  "images": {
    "office": "Modern_Office_16x16.png",   // key → file name in the assets folder
    "people": "Characters_16x32.png"
  },

  // Furniture & tiles. x/y/w/h = source rectangle in pixels.
  // Optional ox/oy nudge the drawn position (pixels).
  "sprites": {
    "floor":      { "image": "office", "x": 0,   "y": 0,   "w": 16, "h": 16 },
    "wall":       { "image": "office", "x": 16,  "y": 0,   "w": 16, "h": 32 },
    "desk":       { "image": "office", "x": 64,  "y": 96,  "w": 32, "h": 22 },
    "leaderDesk": { "image": "office", "x": 96,  "y": 96,  "w": 48, "h": 24 },
    "bossDesk":   { "image": "office", "x": 144, "y": 96,  "w": 64, "h": 28 },
    "plant":      { "image": "office", "x": 0,   "y": 128, "w": 16, "h": 24 },
    "bookshelf":  { "image": "office", "x": 16,  "y": 128, "w": 32, "h": 34 },
    "couch":      { "image": "office", "x": 48,  "y": 128, "w": 48, "h": 24 },
    "coffee":     { "image": "office", "x": 96,  "y": 128, "w": 32, "h": 26 },
    "cooler":     { "image": "office", "x": 128, "y": 128, "w": 12, "h": 28 },
    "printer":    { "image": "office", "x": 144, "y": 128, "w": 18, "h": 18 },
    "table":      { "image": "office", "x": 160, "y": 128, "w": 24, "h": 14 }
  },

  // Character sheets. Each one shows up in the character builder as "Pack sprite".
  "characters": {
    "Office Lady": {
      "image": "people",
      "frameW": 16, "frameH": 32,
      "anchorX": 8, "anchorY": 31,          // feet position inside a frame (default: bottom centre)
      "anims": {
        "idle_down":  { "row": 0, "frames": [0] },
        "idle_up":    { "row": 0, "frames": [1] },
        "idle_left":  { "row": 0, "frames": [2] },
        "idle_right": { "row": 0, "frames": [3] },
        "walk_down":  { "row": 1, "frames": [0, 1, 2, 3] },
        "walk_up":    { "row": 1, "frames": [4, 5, 6, 7] },
        "walk_left":  { "row": 1, "frames": [8, 9, 10, 11] },
        "walk_right": { "row": 1, "frames": [12, 13, 14, 15] },
        "sit":        { "row": 2, "frames": [0] }
      }
    }
  }
}
```

(Comments are only for this doc; real JSON can't contain them.)

### Notes

- Sprite keys you can override: `floor`, `wall`, `desk`, `leaderDesk`, `bossDesk`, `plant`, `bookshelf`, `couch`, `coffee`, `cooler`, `printer`, `table`.
- Furniture is drawn bottom-aligned at its spot, so tall sprites grow upwards.
- If `walk_right` / `idle_right` are missing, the left animation is mirrored. Add `"flip": true` to any animation to mirror it.
- Seated agents use `sit` (or `idle_down`). The desk is drawn over their lower body.
- The tile grid is 16 px. Packs drawn at 32 px or 48 px work best if you downscale them to 16 px first.
