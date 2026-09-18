// Bundles the site's scripts from `_js/` into `assets/js/dist/`.
//
// The output is committed so that a plain `jekyll build` needs no Node step;
// CI runs `npm run check` to make sure it matches the sources.

import { build } from 'esbuild';
import { rm } from 'node:fs/promises';

const outdir = 'assets/js/dist';

await rm(outdir, { recursive: true, force: true });

await build({
  entryPoints: {
    site: '_js/site.js',
    home: '_js/home.js'
  },
  outdir,
  bundle: true,
  splitting: true,
  format: 'esm',
  target: ['es2020'],
  minify: true,
  legalComments: 'linked',
  chunkNames: 'chunks/[name]-[hash]',
  logLevel: 'info'
});
