// Scripts for every page. Each module is a no-op on pages without its markup.

import { initTheme } from './theme.js';
import { initHeader } from './header.js';
import { initPalette } from './palette.js';
import { initDialogs } from './dialogs.js';
import { initArticle } from './article.js';

initTheme();
initHeader();
initDialogs();
initPalette();
initArticle();
