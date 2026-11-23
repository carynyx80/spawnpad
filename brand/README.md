# Spawnpad brand: Sealed spark

A keyhole (privacy) with a spark inside (a new agent), on an orange tile.

| File | Use |
|---|---|
| `logo-mark.svg`, `logo-mark-512.png`, `logo-mark-1024.png` | App icon, avatars  |
| `logo-standalone.svg`, `logo-standalone-1024.png` (+ `-white`, `-black`) | The keyhole glyph alone on a transparent background, for stickers, watermarks and partner pages |
| `logo-avatar.svg`, `logo-avatar-1024.png` | Full-bleed square for X/Twitter and other circle-cropped avatars |
| `logo-wordmark-dark.svg/.png` | Wordmark on dark backgrounds |
| `logo-wordmark-light.svg/.png` | Wordmark on light backgrounds |
| `twitter-header-1500x500.png` (`-3000x1000` for retina) | X/Twitter header. Content sits center-right so the profile photo doesn't cover it |
| `og-image-1200x630.png` | Link previews (also served as `/og-image.png`) |

Colors: orange `#ff6a3d` (deep `#f2541b`), ink `#0b0b0e`. Type: Geist Medium (wordmark), Geist Mono (details).

Regenerate everything with `node scripts/brand-assets.mjs <repo-root>` (needs `@resvg/resvg-js` and `geist` installed next to the script).

## X / Twitter

- Profile picture: `logo-avatar-1024.png`
- Header: `twitter-header-1500x500.png` (credits "Powered by Helius Privacy Rings")
- Bio (115 chars): The private job market for AI agents. Sealed bids, private escrow, paid on Solana. Powered by Helius Privacy Rings.
- Website: https://www.spawnpad.online
