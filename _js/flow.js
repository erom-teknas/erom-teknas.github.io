// Interactive flow diagrams in posts (`_includes/flow.html`).
//
// The markup is an ordered list of steps, each with its detail panel, and it
// reads fine without this script. Here it becomes a diagram: a wire runs
// through the step markers, loops that feed back up the flow are drawn beside
// it, and a packet travels the wire to show which way data moves. Selecting a
// step shows its panel beside the rail on wide screens, or under the step on
// narrow ones. Play walks through the steps in order.

const SVG_NS = 'http://www.w3.org/2000/svg';
const STEP_MS = 3600;
const KIND_NAMES = { stage: 'Stage', gate: 'Gate', store: 'Store' };

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const wideLayout = window.matchMedia('(min-width: 768px)');

const pad = (n) => String(n).padStart(2, '0');

function icon(name) {
  return `<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-${name}"></use></svg>`;
}

function readLoops(root) {
  try {
    return JSON.parse(root.dataset.loops || 'null') || [];
  } catch (_) {
    return [];
  }
}

class Flow {
  constructor(root) {
    this.root = root;
    this.body = root.querySelector('.flow-body');
    this.list = root.querySelector('[data-flow-list]');
    this.playButton = root.querySelector('[data-flow-play]');
    this.modeGroup = root.querySelector('[data-flow-modes]');
    this.mode = root.dataset.mode || null;
    this.loops = readLoops(root);
    this.current = null;
    this.collapsed = false;
    this.playing = false;
    this.timer = 0;
    this.introDone = false;

    this.steps = [...this.list.querySelectorAll('.flow-step')].map((el) => ({
      el,
      id: el.dataset.step,
      kind: el.dataset.kind,
      label: el.dataset.label,
      modes: el.dataset.modes ? el.dataset.modes.split(' ') : null,
      button: el.querySelector('.flow-node'),
      marker: el.querySelector('.flow-node .flow-marker'),
      index: el.querySelector('.flow-index'),
      panel: el.querySelector('.flow-panel'),
      pos: null
    }));
    this.byId = new Map(this.steps.map((step) => [step.id, step]));
    this.loops = this.loops.filter((loop) => this.byId.has(loop.from) && this.byId.has(loop.to));
  }

  // --- Setup ------------------------------------------------------------------

  build() {
    this.root.classList.add('is-live');

    this.wire = document.createElement('div');
    this.wire.className = 'flow-wire';
    this.lit = document.createElement('div');
    this.lit.className = 'flow-wire flow-wire-lit';
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('class', 'flow-loops');
    this.svg.setAttribute('aria-hidden', 'true');
    this.packet = document.createElement('span');
    this.packet.className = 'flow-packet';
    this.loopPacket = document.createElement('span');
    this.loopPacket.className = 'flow-packet';
    [this.wire, this.lit, this.svg, this.packet, this.loopPacket].forEach((node) => node.setAttribute('aria-hidden', 'true'));
    this.list.prepend(this.wire, this.lit, this.svg);
    this.list.append(this.packet, this.loopPacket);

    this.loopPaths = this.loops.map((loop) => {
      const group = document.createElementNS(SVG_NS, 'g');
      group.setAttribute('class', 'flow-loop');
      const line = document.createElementNS(SVG_NS, 'path');
      line.setAttribute('class', 'flow-loop-line');
      const head = document.createElementNS(SVG_NS, 'path');
      head.setAttribute('class', 'flow-loop-head');
      group.append(line, head);
      this.svg.append(group);
      return { loop, group, line, head, d: '' };
    });

    this.stage = document.createElement('div');
    this.stage.className = 'flow-stage';
    this.body.append(this.stage);

    this.steps.forEach((step) => {
      const head = document.createElement('div');
      head.className = 'flow-panel-head';
      head.innerHTML = '<p class="flow-panel-kicker"></p><p class="flow-panel-title"></p>';
      head.querySelector('.flow-panel-title').textContent = step.label;
      step.panel.prepend(head);
      step.kicker = head.querySelector('.flow-panel-kicker');

      const foot = document.createElement('div');
      foot.className = 'flow-panel-foot';
      step.next = document.createElement('button');
      step.next.type = 'button';
      step.next.className = 'flow-next';
      foot.append(step.next);
      step.panel.append(foot);
      step.panel.setAttribute('aria-labelledby', step.button.id);
      step.panel.setAttribute('role', 'group');

      step.button.addEventListener('click', () => this.onPick(step));
      step.button.addEventListener('keydown', (event) => this.onKey(event, step));
      step.next.addEventListener('click', () => {
        this.stop();
        const target = this.after(step) || this.visible()[0];
        this.select(target, { animate: true });
        target.next.focus({ preventScroll: true });
      });
    });

    if (this.modeGroup) {
      this.modeGroup.hidden = false;
      this.modeGroup.querySelectorAll('[data-mode]').forEach((button) => {
        button.addEventListener('click', () => {
          this.stop();
          this.setMode(button.dataset.mode);
        });
      });
    }

    this.playButton.hidden = false;
    this.playButton.addEventListener('click', () => (this.playing ? this.stop() : this.play()));
    this.root.querySelector('[data-flow-hint]').hidden = false;

    this.placePanels();
    wideLayout.addEventListener('change', () => {
      this.placePanels();
      this.collapsed = false;
      this.render();
    });

    this.applyMode();
    this.select(this.visible()[0], { animate: false });

    let queued = false;
    const relayout = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        this.layout();
      });
    };
    new ResizeObserver(relayout).observe(this.list);
    document.fonts?.ready.then(relayout);

    // Run a packet down the flow the first time it is seen, and pause the
    // walkthrough once it has left the screen.
    new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry.intersectionRatio >= 0.35 && !this.introDone) {
          this.introDone = true;
          this.intro();
        }
        if (!entry.isIntersecting && this.playing) this.stop();
      },
      { threshold: [0, 0.35] }
    ).observe(this.root);
    document.addEventListener('visibilitychange', () => document.hidden && this.stop());
  }

  // Panels sit in their own column beside the rail on wide screens, and under
  // their step (an accordion) on narrow ones.
  placePanels() {
    this.steps.forEach((step) => {
      if (wideLayout.matches) this.stage.append(step.panel);
      else step.button.after(step.panel);
    });
    this.stage.hidden = !wideLayout.matches;
  }

  // --- State ------------------------------------------------------------------

  visible() {
    return this.steps.filter((step) => !step.modes || step.modes.includes(this.mode));
  }

  after(step) {
    const steps = this.visible();
    return steps[steps.indexOf(step) + 1] || null;
  }

  before(step) {
    const steps = this.visible();
    return steps[steps.indexOf(step) - 1] || null;
  }

  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.root.dataset.mode = mode;
    this.applyMode();
    // Show what changed: jump to the first step that only exists in this mode.
    const first = this.visible().find((step) => step.modes) || this.visible()[0];
    this.select(first, { animate: false });
    this.layout();
  }

  applyMode() {
    if (this.modeGroup) {
      this.modeGroup.querySelectorAll('[data-mode]').forEach((button) => {
        button.setAttribute('aria-pressed', String(button.dataset.mode === this.mode));
      });
    }
    this.steps.forEach((step) => {
      step.el.hidden = Boolean(step.modes) && !step.modes.includes(this.mode);
    });
    const steps = this.visible();
    steps.forEach((step, i) => {
      step.index.textContent = pad(i + 1);
      step.kicker.textContent = `${pad(i + 1)} / ${pad(steps.length)} · ${KIND_NAMES[step.kind] || 'Stage'}`;
      const next = steps[i + 1];
      step.next.innerHTML = next
        ? `<span>Next: ${next.label}</span>${icon('arrow-right')}`
        : `<span>Back to the start</span>${icon('arrow-up')}`;
    });
    this.loopPaths.forEach((item) => {
      item.group.style.display = this.byId.get(item.loop.from).el.hidden || this.byId.get(item.loop.to).el.hidden ? 'none' : '';
    });
  }

  select(step, { animate = true } = {}) {
    if (!step) return;
    const previous = this.current;
    const anchor = wideLayout.matches ? null : step.button.getBoundingClientRect().top;
    this.current = step;
    this.collapsed = false;
    this.render();

    // On the accordion, closing the panel above would yank the chosen step
    // upwards; keep it where the reader's finger or eye already is.
    if (anchor !== null && previous && previous !== step) {
      const shift = step.button.getBoundingClientRect().top - anchor;
      if (Math.abs(shift) > 1) window.scrollBy({ top: shift, behavior: 'instant' });
    }

    this.layout();
    if (!animate || reducedMotion.matches || !previous || previous === step) return;
    step.panel.animate(
      [
        { opacity: 0, transform: 'translateY(6px)' },
        { opacity: 1, transform: 'none' }
      ],
      { duration: 280, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
    );
    this.travel(this.packet, this.spinePath(previous, step), Math.min(900, 220 + 140 * this.distance(previous, step)));
    const loop = this.loopPaths.find((item) => item.loop.from === step.id && item.group.style.display !== 'none');
    if (loop) setTimeout(() => this.current === step && this.travel(this.loopPacket, loop.d, 1300), 650);
  }

  render() {
    const steps = this.visible();
    const at = steps.indexOf(this.current);
    this.steps.forEach((step) => {
      const active = step === this.current;
      const open = active && !this.collapsed;
      step.el.classList.toggle('is-active', active);
      step.el.classList.toggle('is-past', steps.indexOf(step) > -1 && steps.indexOf(step) < at);
      step.button.setAttribute('aria-expanded', String(open));
      step.button.tabIndex = active ? 0 : -1;
      step.panel.hidden = !open;
    });
    this.loopPaths.forEach((item) => {
      const hot = item.loop.from === this.current.id || item.loop.to === this.current.id;
      item.group.classList.toggle('is-hot', hot);
    });
  }

  // --- Input ------------------------------------------------------------------

  onPick(step) {
    this.stop();
    if (step === this.current && !wideLayout.matches) {
      this.collapsed = !this.collapsed;
      this.render();
      return;
    }
    this.select(step);
  }

  onKey(event, step) {
    const steps = this.visible();
    const moves = {
      ArrowDown: () => this.after(step),
      ArrowRight: () => this.after(step),
      ArrowUp: () => this.before(step),
      ArrowLeft: () => this.before(step),
      Home: () => steps[0],
      End: () => steps[steps.length - 1]
    };
    const target = moves[event.key]?.();
    if (!moves[event.key]) return;
    event.preventDefault();
    if (!target) return;
    this.stop();
    this.select(target);
    target.button.focus();
  }

  play() {
    this.playing = true;
    this.root.classList.add('is-playing');
    this.playButton.innerHTML = `${icon('pause')}<span>Pause</span>`;
    const steps = this.visible();
    if (this.current === steps[steps.length - 1]) this.select(steps[0], { animate: false });
    this.timer = setTimeout(() => this.tick(), 900);
  }

  tick() {
    const next = this.after(this.current);
    if (!next) {
      this.stop(true);
      return;
    }
    this.select(next);
    if (this.after(next)) this.timer = setTimeout(() => this.tick(), STEP_MS);
    else this.stop(true);
  }

  stop(finished = false) {
    clearTimeout(this.timer);
    if (!this.playing) return;
    this.playing = false;
    this.root.classList.remove('is-playing');
    this.playButton.innerHTML = `${icon('play')}<span>${finished ? 'Replay' : 'Play'}</span>`;
  }

  // --- Geometry and motion -----------------------------------------------------

  layout() {
    const steps = this.visible();
    if (!steps.length || !this.current) return;
    const box = this.list.getBoundingClientRect();
    steps.forEach((step) => {
      const r = step.marker.getBoundingClientRect();
      step.pos = { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top };
    });
    const first = steps[0].pos;
    const last = steps[steps.length - 1].pos;
    Object.assign(this.wire.style, { left: `${first.x - 1}px`, top: `${first.y}px`, height: `${last.y - first.y}px` });
    Object.assign(this.lit.style, {
      left: `${first.x - 1}px`,
      top: `${first.y}px`,
      height: `${this.current.pos.y - first.y}px`
    });

    this.svg.setAttribute('width', box.width);
    this.svg.setAttribute('height', box.height);

    // Shorter loops run closer to the wire so nested loops never cross.
    const shown = this.loopPaths.filter((item) => item.group.style.display !== 'none');
    const span = (item) => Math.abs(this.byId.get(item.loop.from).pos.y - this.byId.get(item.loop.to).pos.y);
    [...shown]
      .sort((a, b) => span(a) - span(b))
      .forEach((item, rank) => {
        const from = this.byId.get(item.loop.from).pos;
        const to = this.byId.get(item.loop.to).pos;
        const x = from.x - 9;
        const bend = Math.max(3, from.x - 13 - rank * 6);
        const r = Math.min(6, (x - bend) / 2);
        item.d = `M ${x} ${from.y} H ${bend + r} Q ${bend} ${from.y} ${bend} ${from.y - r} V ${to.y + r} Q ${bend} ${to.y} ${bend + r} ${to.y} H ${x}`;
        item.line.setAttribute('d', item.d);
        item.head.setAttribute('d', `M ${x - 4} ${to.y - 3.5} L ${x} ${to.y} L ${x - 4} ${to.y + 3.5}`);
      });
  }

  distance(a, b) {
    const steps = this.visible();
    return Math.abs(steps.indexOf(a) - steps.indexOf(b));
  }

  spinePath(a, b) {
    return `M ${a.pos.x} ${a.pos.y} L ${b.pos.x} ${b.pos.y}`;
  }

  travel(packet, d, duration, easing = 'cubic-bezier(0.45, 0, 0.25, 1)') {
    if (reducedMotion.matches || !d || typeof packet.animate !== 'function') return null;
    if (!CSS.supports('offset-path', 'path("M 0 0 L 1 1")')) return null;
    packet.getAnimations().forEach((animation) => animation.cancel());
    packet.style.offsetPath = `path("${d}")`;
    return packet.animate(
      [
        { offsetDistance: '0%', opacity: 0 },
        { opacity: 1, offset: 0.12 },
        { opacity: 1, offset: 0.88 },
        { offsetDistance: '100%', opacity: 0 }
      ],
      { duration, easing }
    );
  }

  // One pass down the whole flow, lighting each marker as the packet reaches it.
  intro() {
    const steps = this.visible();
    if (reducedMotion.matches || steps.length < 2) return;
    const first = steps[0].pos;
    const last = steps[steps.length - 1].pos;
    const duration = 240 * steps.length;
    const run = this.travel(this.packet, `M ${first.x} ${first.y} L ${last.x} ${last.y}`, duration, 'linear');
    if (!run) return;
    steps.forEach((step) => {
      const at = (step.pos.y - first.y) / (last.y - first.y || 1);
      setTimeout(() => {
        step.el.classList.add('is-pinged');
        setTimeout(() => step.el.classList.remove('is-pinged'), 700);
      }, at * duration);
    });
  }
}

export function initFlows() {
  document.querySelectorAll('[data-flow]').forEach((root) => new Flow(root).build());
}
