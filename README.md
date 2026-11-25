# Exporter Canonical Elite Website for Static Page Archiving

A Violentmonkey userscript by A Elite Estrangeira that exports the current
web page as a static ZIP archive, generated entirely in the browser. Nothing
is sent to third-party servers.

## How it works

The export runs in 7 stages and starts only from the Violentmonkey menu
(script icon → script name → "Iniciar exportação ZIP"). The script adds no
panel, button, or overlay to the site; progress is reported in the console.

1. **Sweep and stabilize** — scrolls the page and its scrollable containers
   end to end so lazy-loaded content renders before capture.
2. **Capture DOM and Shadow DOM** — clones the rendered document, including
   open shadow roots and closed roots captured by instrumenting
   `attachShadow` from `document-start`, or recovered through
   `getHTML({serializableShadowRoots: true})` when the browser exposes them.
3. **Archive scripts** — removes every script from the copy and stores the
   original sources (inline and external) under `archive/scripts/` as inert
   text. The exported page runs no JavaScript.
4. **Consolidate CSS** — merges document stylesheets, `@import` chains, and
   adopted stylesheets into one file, `assets/site.css`. Shadow DOM styles
   stay encapsulated inside each shadow root so the appearance is preserved.
5. **Rewrite resources to local paths** — images, media, fonts, icons,
   `srcset`, inline styles, and CSS `url()` references are pointed at local
   files.
6. **Download files** — fetches the resources with `GM_xmlhttpRequest`
   (falling back to `fetch`), with size and count limits.
7. **Generate ZIP** — writes `index.html`, `assets/site.css`,
   `assets/media/`, and an `archive/` folder with the script sources, the
   network URL list, and a full manifest of what was captured, removed, or
   failed.

## Capabilities

- Declarative Shadow DOM output: captured roots are serialized as
  `<template shadowrootmode>` so the static copy renders in modern browsers.
- Private-field protection: password, token, secret, OTP, and API-key inputs
  are blanked in the copy; other form values, checked states, and selected
  options are preserved as rendered.
- Canvas snapshots: canvases are exported as PNG images when the browser
  allows reading them.
- Sanitization: inline event handlers, `javascript:` URLs, iframes, embeds,
  form actions, refresh/CSP meta tags, and preload hints are removed from the
  copy and recorded in the manifest.
- Bounded exports: up to 1,600 resources, 42 MB per resource, 480 MB total,
  160 archived external scripts.

## Limitations

- The archive covers the current page only; it is not a domain crawler.
- The copy is static: JavaScript interactions, logins, APIs, and iframes are
  not reproduced.
- Closed shadow roots created before instrumentation and not serializable
  cannot be captured.
- Font loading from `file://` may require serving the folder locally.
- The archive can contain private data that was visible on the page.

## Install

Install `exporter-canonical-elite-website.user.js` in Violentmonkey, open
the target page, and start the export from the Violentmonkey menu.

## License

Copyright (c) A Elite Estrangeira. All rights reserved.

## Desktop base

This repository also carries the Machinery desktop base (Rust/Tauri shell +
Elixir backend) as the starting point for the future Exporter Elite Website
program: an installable Windows app with signed live updates, an Updates
screen, and the backend sidecar skeleton. The desktop base does not embed
the userscript; the userscript stays at the repository root as the current
exporter, and the program will be built on this base.
