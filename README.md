# Web Portfolio Manager
the private one

## Installing:

`cd` into the `manage` folder

run ```npm install```

## Running:

run ```npm start```

## Building App:

run ```npm run build```

## ArtStation access:

"Add from ArtStation" and "Update from JSON" fetch Cloudflare-protected
ArtStation pages through a headless Chromium browser. The server looks for
an installed Edge/Chrome/Chromium/Brave automatically, or use the
`AS_BROWSER` env var / `artstationBrowser` in `~/.manage-app/config.json`
to point at a specific executable.

## Backgrounds:

The Background tab edits `background/background.json` (used on every page
except Game Art). The "Game Art" toggle in the top bar edits a separate
`background/game-art.json`, which the Game Art page loads via
`<body data-background="game-art.json">`. Each target keeps its own
color/layers/timeline; saving pushes whichever file is currently selected.

