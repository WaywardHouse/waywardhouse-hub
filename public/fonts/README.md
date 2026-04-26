# public/fonts

Drop the following TTFs here for build-time OG image generation:

- `BarlowCondensed-Regular.ttf`
- `BarlowCondensed-Bold.ttf`
- `IBMPlexMono-Regular.ttf`

Source: https://fonts.google.com/specimen/Barlow+Condensed and https://fonts.google.com/specimen/IBM+Plex+Mono

If these are missing, `scripts/generate-og.mjs` will skip OG generation with a warning, but the site otherwise builds and deploys fine.
