// Light/dark switch. The saved choice is applied before first paint by
// `_includes/theme-init.html`; this module handles the toggle and keeps the
// giscus comments frame in step.

const STORAGE_KEY = 'theme';
const root = document.documentElement;
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

export function currentTheme() {
  return root.dataset.theme || (systemDark.matches ? 'dark' : 'light');
}

function save(theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch (_) {
    /* storage can be unavailable (private mode); the choice then lasts for this page */
  }
}

function syncGiscus() {
  const frame = document.querySelector('iframe.giscus-frame');
  if (!frame) return;
  const theme = currentTheme() === 'dark' ? 'noborder_dark' : 'noborder_light';
  frame.contentWindow.postMessage({ giscus: { setConfig: { theme } } }, 'https://giscus.app');
}

function announce() {
  syncGiscus();
  window.dispatchEvent(new CustomEvent('themechange', { detail: currentTheme() }));
}

export function initTheme() {
  document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const next = currentTheme() === 'dark' ? 'light' : 'dark';
      // When the choice matches the system, drop the override so the site
      // keeps following the system from then on.
      if ((next === 'dark') === systemDark.matches) {
        delete root.dataset.theme;
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch (_) {}
      } else {
        root.dataset.theme = next;
        save(next);
      }
      announce();
    });
  });

  systemDark.addEventListener('change', announce);

  // giscus loads lazily; match its theme once its frame reports in.
  window.addEventListener('message', (event) => {
    if (event.origin === 'https://giscus.app') syncGiscus();
  });
}
