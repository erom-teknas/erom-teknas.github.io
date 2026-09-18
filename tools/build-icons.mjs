// Builds `_includes/icons.svg`, an SVG sprite of the Phosphor icons the site
// uses (https://phosphoricons.com, MIT). Reference an icon with
// `{% include icon.html name="copy" %}`.

import { readFile, writeFile } from 'node:fs/promises';

const WEIGHT = 'regular';
const ICONS = [
  'arrow-counter-clockwise',
  'arrow-left',
  'arrow-right',
  'arrow-up',
  'arrow-up-right',
  'check',
  'circle-half',
  'command',
  'copy',
  'corners-out',
  'envelope-simple',
  'github-logo',
  'hash',
  'link-simple',
  'linkedin-logo',
  'list',
  'magnifying-glass',
  'pause',
  'play',
  'prohibit',
  'rss-simple',
  'x'
];

const symbols = await Promise.all(
  ICONS.map(async (name) => {
    const file = `node_modules/@phosphor-icons/core/assets/${WEIGHT}/${name}.svg`;
    const svg = await readFile(file, 'utf8');
    const viewBox = svg.match(/viewBox="([^"]+)"/)[1];
    const body = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
    return `<symbol id="i-${name}" viewBox="${viewBox}">${body}</symbol>`;
  })
);

const sprite =
  '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">' +
  symbols.join('') +
  '</svg>\n';

await writeFile('_includes/icons.svg', sprite);
console.log(`_includes/icons.svg: ${ICONS.length} icons`);
