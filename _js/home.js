// Home page choreography (GSAP + ScrollTrigger) and the lazily loaded 3D hero.
//
// Every animation here explains structure: the headline assembles once, the
// scene recedes as you scroll into the index, rows arrive in reading order and
// the topic counts tick up to their totals. With reduced motion none of it
// runs and the page renders in its final state.

import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function webglAvailable() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch (_) {
    return false;
  }
}

function splitWords(element) {
  const words = element.textContent.trim().split(/\s+/);
  element.setAttribute('aria-label', element.textContent.trim());
  element.replaceChildren(
    ...words.flatMap((word, i) => {
      const span = document.createElement('span');
      span.className = 'word';
      span.setAttribute('aria-hidden', 'true');
      span.textContent = word;
      return i < words.length - 1 ? [span, ' '] : [span];
    })
  );
  return element.querySelectorAll('.word');
}

async function startTopology() {
  const stage = document.querySelector('[data-topology]');
  const source = document.getElementById('topology-data');
  if (!stage || !source || !webglAvailable()) return null;

  const data = JSON.parse(source.textContent);
  const { createTopology } = await import('./topology.js');
  return createTopology(stage, data, { reducedMotion });
}

function introHero() {
  const title = document.querySelector('.hero-title[data-split]');
  if (!title) return;
  const words = splitWords(title);
  gsap
    .timeline({ defaults: { ease: 'expo.out' } })
    .from('.hero-kicker', { autoAlpha: 0, y: 12, duration: 0.8 })
    .from(words, { yPercent: 60, autoAlpha: 0, duration: 1.1, stagger: 0.06 }, 0.1)
    .from('.hero-lede', { autoAlpha: 0, y: 16, duration: 0.9 }, 0.45)
    .from('.hero-actions', { autoAlpha: 0, y: 16, duration: 0.9 }, 0.6)
    .from('.hero-legend', { autoAlpha: 0, duration: 1.2 }, 1.1);
}

function scrollHero(topology) {
  const hero = document.querySelector('[data-hero]');
  if (!hero) return;

  // The headline drifts up and fades as the index takes over the screen.
  gsap.to('.hero-inner', {
    yPercent: -18,
    autoAlpha: 0,
    ease: 'none',
    scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom 20%', scrub: true }
  });

  if (topology) {
    ScrollTrigger.create({
      trigger: hero,
      start: 'top top',
      end: 'bottom top',
      scrub: true,
      onUpdate: (self) => topology.setScrollProgress(self.progress)
    });
    gsap.to('[data-topology]', {
      autoAlpha: 0.15,
      ease: 'none',
      scrollTrigger: { trigger: hero, start: '35% top', end: 'bottom top', scrub: true }
    });
  }
}

function revealRows() {
  const rows = gsap.utils.toArray('[data-reveal]');
  if (!rows.length) return;
  rows.forEach((row) => row.classList.add('will-reveal'));
  ScrollTrigger.batch(rows, {
    start: 'top 90%',
    once: true,
    onEnter: (batch) =>
      gsap.to(batch, {
        autoAlpha: 1,
        y: 0,
        duration: 0.8,
        ease: 'expo.out',
        stagger: 0.07,
        onComplete: () => batch.forEach((el) => el.classList.remove('will-reveal'))
      })
  });
}

function countTopics() {
  document.querySelectorAll('[data-count]').forEach((el) => {
    const total = Number(el.dataset.count);
    const counter = { value: 0 };
    gsap.to(counter, {
      value: total,
      duration: 1.2,
      ease: 'power2.out',
      scrollTrigger: { trigger: el, start: 'top 90%', once: true },
      onUpdate: () => {
        el.textContent = String(Math.round(counter.value)).padStart(2, '0');
      }
    });
  });
}

async function init() {
  if (reducedMotion) {
    // Still draw the scene (static, no auto-rotation or traffic).
    await startTopology();
    return;
  }

  introHero();
  revealRows();
  countTopics();

  // Load the 3D scene once the page is idle so it never competes with first paint.
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 200));
  idle(async () => {
    const topology = await startTopology();
    scrollHero(topology);
    ScrollTrigger.refresh();
  });
}

init();
