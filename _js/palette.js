// Command palette search: Cmd/Ctrl+K or "/" opens it, results come from
// `/assets/search.json` (fetched on first open), arrow keys move, Enter opens.

import { openDialog } from './dialogs.js';

const MAX_RESULTS = 8;
let indexUrl = '/assets/search.json';
let indexPromise = null;

function loadIndex() {
  indexPromise ??= fetch(indexUrl)
    .then((response) => (response.ok ? response.json() : []))
    .then((posts) =>
      posts.map((post, order) => ({
        ...post,
        order,
        haystack: {
          title: post.title.toLowerCase(),
          meta: `${post.categories} ${post.tags}`.toLowerCase(),
          text: post.text.toLowerCase()
        }
      }))
    )
    .catch(() => []);
  return indexPromise;
}

function score(post, terms) {
  let total = 0;
  for (const term of terms) {
    const { title, meta, text } = post.haystack;
    let best = 0;
    const inTitle = title.indexOf(term);
    if (inTitle !== -1) best = inTitle === 0 || title[inTitle - 1] === ' ' ? 14 : 10;
    else if (meta.includes(term)) best = 6;
    else if (text.includes(term)) best = 1;
    if (best === 0) return 0; // every term has to match somewhere
    total += best;
  }
  return total;
}

function search(posts, query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return posts.slice(0, 6).map((post) => ({ post, terms }));
  return posts
    .map((post) => ({ post, terms, score: score(post, terms) }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.post.order - b.post.order)
    .slice(0, MAX_RESULTS);
}

// Appends `text` to `parent`, wrapping every occurrence of the terms in <mark>.
function appendHighlighted(parent, text, terms) {
  if (terms.length === 0) {
    parent.append(text);
    return;
  }
  const escaped = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');
  text.split(pattern).forEach((part, i) => {
    if (i % 2 === 1) {
      const mark = document.createElement('mark');
      mark.textContent = part;
      parent.append(mark);
    } else if (part) {
      parent.append(part);
    }
  });
}

function snippet(post, terms) {
  const text = post.text;
  const lower = post.haystack.text;
  let at = -1;
  for (const term of terms) {
    at = lower.indexOf(term);
    if (at !== -1) break;
  }
  if (at === -1) return text.slice(0, 150);
  const start = Math.max(0, at - 50);
  return `${start > 0 ? '…' : ''}${text.slice(start, start + 170).trim()}…`;
}

export function initPalette() {
  const dialog = document.getElementById('palette');
  if (!dialog) return;
  indexUrl = dialog.dataset.index || indexUrl;

  const input = dialog.querySelector('#palette-input');
  const list = dialog.querySelector('#palette-results');
  const empty = dialog.querySelector('.palette-empty');
  let items = [];
  let active = -1;

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'false');

  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  document.querySelectorAll('[data-mod-key]').forEach((el) => {
    el.textContent = isMac ? '⌘' : 'Ctrl';
  });

  function setActive(index) {
    items.forEach((item, i) => item.setAttribute('aria-selected', String(i === index)));
    active = index;
    if (index >= 0 && items[index]) {
      input.setAttribute('aria-activedescendant', items[index].id);
      items[index].scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  async function render() {
    const query = input.value.trim();
    const posts = await loadIndex();
    const hits = search(posts, query);

    list.replaceChildren();
    if (!query && hits.length) {
      const group = document.createElement('li');
      group.className = 'palette-group';
      group.setAttribute('role', 'presentation');
      group.textContent = 'Latest guides';
      list.append(group);
    }

    items = hits.map(({ post, terms }, i) => {
      const li = document.createElement('li');
      li.className = 'palette-item';
      li.id = `palette-option-${i}`;
      li.setAttribute('role', 'option');

      const link = document.createElement('a');
      link.href = post.url;
      link.tabIndex = -1;

      const title = document.createElement('span');
      title.className = 'palette-item-title';
      appendHighlighted(title, post.title, terms);

      const meta = document.createElement('span');
      meta.className = 'palette-item-meta';
      meta.textContent = post.date;

      link.append(title, meta);

      if (query) {
        const text = document.createElement('span');
        text.className = 'palette-item-snippet';
        appendHighlighted(text, snippet(post, terms), terms);
        link.append(text);
      }

      li.append(link);
      li.addEventListener('mousemove', () => active !== i && setActive(i));
      list.append(li);
      return li;
    });

    empty.hidden = items.length > 0;
    input.setAttribute('aria-expanded', String(items.length > 0));
    setActive(items.length ? 0 : -1);
  }

  function open() {
    openDialog(dialog);
    input.select();
    render();
  }

  document.querySelectorAll('[data-open-palette]').forEach((button) => button.addEventListener('click', open));

  document.addEventListener('keydown', (event) => {
    const target = event.target;
    const typing = target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
    if ((event.key === 'k' || event.key === 'K') && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      dialog.open ? dialog.close() : open();
    } else if (event.key === '/' && !typing && !dialog.open) {
      event.preventDefault();
      open();
    }
  });

  input.addEventListener('input', render);
  input.addEventListener('focus', loadIndex, { once: true });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!items.length) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((active + step + items.length) % items.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const link = items[active]?.querySelector('a');
      if (link) window.location.assign(link.href);
    }
  });
}
