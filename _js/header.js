// Header state: transparent over the home hero, solid once the page scrolls,
// plus the back-to-top button. Uses IntersectionObserver, never scroll events.

export function initHeader() {
  const header = document.querySelector('[data-header]');
  const hero = document.querySelector('[data-hero]');
  const backToTop = document.querySelector('[data-back-to-top]');

  if (header && hero) {
    const sentinel = document.createElement('div');
    sentinel.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:48px;pointer-events:none;';
    sentinel.setAttribute('aria-hidden', 'true');
    document.body.prepend(sentinel);
    new IntersectionObserver(([entry]) => {
      header.toggleAttribute('data-over-hero', entry.isIntersecting);
    }).observe(sentinel);
  }

  if (backToTop) {
    const marker = document.createElement('div');
    marker.style.cssText = 'position:absolute;top:130vh;left:0;width:1px;height:1px;pointer-events:none;';
    marker.setAttribute('aria-hidden', 'true');
    document.body.prepend(marker);
    new IntersectionObserver(([entry]) => {
      backToTop.hidden = entry.isIntersecting || entry.boundingClientRect.top > 0;
    }).observe(marker);
    backToTop.addEventListener('click', () => {
      const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
      document.querySelector('#main')?.focus({ preventScroll: true });
    });
  }
}
