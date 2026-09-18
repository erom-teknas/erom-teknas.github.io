# Project agent memory

Personal technical blog (Jekyll, GitHub Pages). The theme is our own, in-repo; there is no theme gem.

## Build and verify

- Build like CI: Ruby 3.2, `JEKYLL_ENV=production bundle exec jekyll b`, then the `htmlproofer` step in `.github/workflows/pages-deploy.yml`. If local Ruby is newer than 3.2, build in a `ruby:3.2` container.
- Front-end scripts and the icon sprite are built with Node (`npm run build`) from `_js/` and `tools/`. The output (`assets/js/dist/`, `_includes/icons.svg`) is committed, so plain `jekyll serve` needs no Node. CI runs `npm run check` and fails if that output is stale: rebuild and commit it with any change to `_js/`.
- The previous theme (Chirpy) shipped a PWA; `sw.min.js` is a kill switch that unregisters it for returning visitors. Keep it at that path.

## Sharp edges

- Post URLs (`/posts/:title/`), `/categories/<slug>/` and `/tags/<slug>/` are live links; category names include emoji, and their slugs (some odd, like `/categories/%EF%B8%8F-terraform/`) must not change.
- Posts use Chirpy-era Markdown conventions that the theme still supports: `{: .light }`/`{: .dark }` paired screenshots, `{: .prompt-tip|info|warning|danger }` callouts, and image paths written as `../assets/...` or `assets/...` (rewritten in `_layouts/post.html`).
- The explainer-engine (true-crime video pipeline) must never name or link its YouTube channel or on-screen persona anywhere on the site, including image text; describe it generically.
- Colours are CSS custom properties in `_sass/_tokens.scss`; the home page WebGL scene (`_js/topology.js`) reads its colours from the `--graph-*` tokens, so change them there, not in JS.
- Design rules come from the TasteSkill skill (github.com/Leonxlnx/taste-skill); install with `npx skills add https://github.com/Leonxlnx/taste-skill`. The skills are not committed.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
