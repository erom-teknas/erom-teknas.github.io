// Reading enhancements for posts and pages: code block headers with a copy
// button, heading anchors, the table of contents, a screenshot lightbox and
// "copy link". Everything here is progressive: the article reads fine without it.

import { openDialog } from './dialogs.js';

const LANGUAGE_NAMES = {
  shell: 'Shell',
  bash: 'Bash',
  sh: 'Shell',
  console: 'Console',
  yaml: 'YAML',
  yml: 'YAML',
  json: 'JSON',
  hcl: 'HCL',
  tf: 'Terraform',
  terraform: 'Terraform',
  python: 'Python',
  py: 'Python',
  js: 'JavaScript',
  javascript: 'JavaScript',
  ts: 'TypeScript',
  dockerfile: 'Dockerfile',
  docker: 'Dockerfile',
  xml: 'XML',
  html: 'HTML',
  css: 'CSS',
  sql: 'SQL',
  ruby: 'Ruby',
  go: 'Go',
  plaintext: 'Text',
  text: 'Text',
  powershell: 'PowerShell',
  ini: 'INI',
  toml: 'TOML'
};

function icon(name) {
  return `<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-${name}"></use></svg>`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    return false;
  }
}

function enhanceCode(root) {
  root.querySelectorAll('div.highlighter-rouge').forEach((block) => {
    if (block.querySelector('.code-head')) return;
    const langClass = [...block.classList].find((c) => c.startsWith('language-'));
    const lang = langClass ? langClass.slice('language-'.length) : 'text';
    const code = block.querySelector('pre code') || block.querySelector('pre');
    if (!code) return;

    const head = document.createElement('div');
    head.className = 'code-head';

    const label = document.createElement('span');
    label.className = 'code-lang';
    label.textContent = LANGUAGE_NAMES[lang] || lang;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'code-copy';
    button.innerHTML = `${icon('copy')}<span>Copy</span>`;
    button.setAttribute('aria-label', `Copy ${label.textContent} code`);

    let reset;
    button.addEventListener('click', async () => {
      const ok = await copyText(code.textContent.replace(/\n$/, ''));
      button.classList.toggle('is-copied', ok);
      button.innerHTML = ok ? `${icon('check')}<span>Copied</span>` : `${icon('copy')}<span>Press Ctrl+C</span>`;
      clearTimeout(reset);
      reset = setTimeout(() => {
        button.classList.remove('is-copied');
        button.innerHTML = `${icon('copy')}<span>Copy</span>`;
      }, 1800);
    });

    head.append(label, button);
    block.prepend(head);
  });
}

function addHeadingAnchors(root) {
  root.querySelectorAll('h1[id], h2[id], h3[id], h4[id]').forEach((heading) => {
    if (heading.querySelector('.heading-anchor')) return;
    const link = document.createElement('a');
    link.className = 'heading-anchor';
    link.href = `#${heading.id}`;
    link.setAttribute('aria-label', `Link to section: ${heading.textContent.trim()}`);
    link.innerHTML = icon('hash');
    heading.prepend(link);
  });
}

function buildToc(root) {
  const rail = document.querySelector('[data-toc]');
  if (!rail) return;
  const headings = [...root.querySelectorAll('h1[id], h2[id], h3[id]')];
  if (headings.length < 3) return;

  // The first heading in most posts repeats the title; leave it out.
  const title = document.querySelector('.post-title')?.textContent.trim().toLowerCase();
  const entries = headings.filter((h, i) => !(i === 0 && h.textContent.trim().toLowerCase().startsWith(title)));

  const makeList = () => {
    const top = document.createElement('ol');
    let sub = null;
    entries.forEach((heading) => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = `#${heading.id}`;
      a.textContent = heading.textContent.trim();
      a.dataset.target = heading.id;
      li.append(a);
      if (heading.tagName === 'H3' && top.lastElementChild) {
        if (!sub) {
          sub = document.createElement('ol');
          top.lastElementChild.append(sub);
        }
        sub.append(li);
      } else {
        sub = null;
        top.append(li);
      }
    });
    return top;
  };

  rail.querySelector('.toc-nav').append(makeList());
  rail.hidden = false;

  // A collapsible copy above the article for screens without the rail.
  const details = document.createElement('details');
  details.className = 'toc-inline';
  details.innerHTML = '<summary>On this page</summary>';
  const nav = document.createElement('nav');
  nav.className = 'toc-nav';
  nav.setAttribute('aria-label', 'On this page');
  nav.append(makeList());
  details.append(nav);
  root.prepend(details);
  nav.addEventListener('click', (event) => event.target.closest('a') && details.removeAttribute('open'));

  // Highlight the section being read: the last heading above the upper third.
  const links = [...document.querySelectorAll('.toc-nav a')];
  const update = () => {
    let current = entries[0];
    for (const heading of entries) {
      if (heading.getBoundingClientRect().top < window.innerHeight * 0.3) current = heading;
    }
    links.forEach((a) => a.setAttribute('aria-current', String(a.dataset.target === current.id)));
  };
  // Headings crossing the top 40% of the viewport are the only moments the
  // answer can change, so recompute there instead of on every scroll event.
  const observer = new IntersectionObserver(update, { rootMargin: '0px 0px -60% 0px' });
  entries.forEach((heading) => observer.observe(heading));
  update();
}

function initLightbox(root) {
  const images = [...root.querySelectorAll('img')].filter((img) => !img.closest('a'));
  if (!images.length) return;

  const dialog = document.createElement('dialog');
  dialog.className = 'lightbox';
  dialog.setAttribute('aria-label', 'Image viewer');
  dialog.innerHTML = `<button type="button" class="icon-btn" data-close-dialog aria-label="Close image">${icon('x')}</button><img alt=""><p class="lightbox-caption"></p>`;
  document.body.append(dialog);
  const big = dialog.querySelector('img');
  const caption = dialog.querySelector('.lightbox-caption');
  big.addEventListener('click', () => dialog.close());

  images.forEach((img) => {
    img.classList.add('zoomable');
    img.tabIndex = 0;
    img.setAttribute('role', 'button');
    img.setAttribute('aria-label', `Enlarge image${img.alt && img.alt !== 'alt text' ? `: ${img.alt}` : ''}`);
    const show = () => {
      big.src = img.currentSrc || img.src;
      big.alt = img.alt;
      caption.textContent = img.alt && img.alt !== 'alt text' ? img.alt : '';
      openDialog(dialog);
    };
    img.addEventListener('click', show);
    img.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        show();
      }
    });
  });
}

function initCopyLink() {
  document.querySelectorAll('[data-copy-link]').forEach((button) => {
    const label = button.getAttribute('aria-label');
    button.addEventListener('click', async () => {
      const ok = await copyText(window.location.href.split('#')[0]);
      button.setAttribute('aria-label', ok ? 'Link copied' : label);
      button.innerHTML = icon(ok ? 'check' : 'link-simple');
      setTimeout(() => {
        button.setAttribute('aria-label', label);
        button.innerHTML = icon('link-simple');
      }, 1800);
    });
  });
}

export function initArticle() {
  const prose = document.querySelector('[data-prose]') || document.querySelector('.prose');
  if (!prose) return;
  enhanceCode(prose);
  addHeadingAnchors(prose);
  buildToc(prose);
  initLightbox(prose);
  initCopyLink();
}
