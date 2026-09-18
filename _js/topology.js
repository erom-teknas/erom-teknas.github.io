// The home page hero: the blog drawn as a live infrastructure topology.
//
// Topic hubs (top-level categories) sit on a backbone ring; every post is a
// node wired to its hub, posts that share a tag are cross-linked, and packets
// travel the links like traffic. Hovering a post shows its title, clicking it
// opens the post. The scene is decorative for assistive technology; the same
// posts and topics are listed as plain links further down the page.

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  NormalBlending,
  PerspectiveCamera,
  Points,
  Raycaster,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderer
} from 'three';

// --- Small helpers -----------------------------------------------------------

// Deterministic PRNG so the layout is the same on every visit.
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomUnit(rand, target = new Vector3()) {
  const u = rand() * 2 - 1;
  const phi = rand() * Math.PI * 2;
  const r = Math.sqrt(1 - u * u);
  return target.set(r * Math.cos(phi), u, r * Math.sin(phi));
}

// Reads a CSS colour token ("#rrggbb" or "rgba(r, g, b, a)") into Color + alpha.
function readToken(name) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const rgba = raw.match(/rgba?\(([^)]+)\)/);
  if (rgba) {
    const [r, g, b, a = '1'] = rgba[1].split(',').map((v) => v.trim());
    return { color: new Color(`rgb(${r}, ${g}, ${b})`), alpha: parseFloat(a) };
  }
  return { color: new Color(raw || '#888888'), alpha: 1 };
}

function readNumber(name) {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;
}

// --- Shaders -----------------------------------------------------------------

// Round, soft-edged point sprites with per-point size (in world units),
// colour and alpha. `scale` converts world size to pixels at distance 1.
const pointVertex = /* glsl */ `
  attribute float size;
  attribute vec3 tint;
  attribute float alpha;
  attribute float ring;
  uniform float pixelRatio;
  uniform float scale;
  uniform float maxSize;
  varying vec3 vTint;
  varying float vAlpha;
  varying float vRing;
  void main() {
    vTint = tint;
    vAlpha = alpha;
    vRing = ring;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = min(size * scale / -mv.z, maxSize) * pixelRatio;
    gl_Position = projectionMatrix * mv;
  }
`;

const pointFragment = /* glsl */ `
  uniform float glow;
  varying vec3 vTint;
  varying float vAlpha;
  varying float vRing;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    // Dots are filled discs; hubs (vRing = 1) are a ring around a small core.
    float disc = smoothstep(0.5, 0.36, d);
    float ring = smoothstep(0.5, 0.44, d) * smoothstep(0.30, 0.38, d) + smoothstep(0.2, 0.12, d);
    float shape = mix(disc, ring, vRing);
    float halo = smoothstep(0.5, 0.0, d) * 0.5 * glow;
    float a = max(shape, halo) * vAlpha;
    gl_FragColor = vec4(vTint, a);
  }
`;

// Lines with a per-vertex alpha, so edges and the floor grid fade with distance.
const lineVertex = /* glsl */ `
  attribute float alpha;
  varying float vAlpha;
  void main() {
    vAlpha = alpha;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const lineFragment = /* glsl */ `
  uniform vec3 color;
  uniform float opacity;
  varying float vAlpha;
  void main() {
    gl_FragColor = vec4(color, vAlpha * opacity);
  }
`;

function lineMaterial() {
  return new ShaderMaterial({
    uniforms: { color: { value: new Color() }, opacity: { value: 1 } },
    vertexShader: lineVertex,
    fragmentShader: lineFragment,
    transparent: true,
    depthWrite: false
  });
}

// Fills the attributes every point cloud needs; `ring` defaults to 0 (dot).
function pointAttributes(geometry, count) {
  if (!geometry.getAttribute('ring')) geometry.setAttribute('ring', new BufferAttribute(new Float32Array(count), 1));
  return geometry;
}

// `maxSize` (CSS pixels) keeps points that drift close to the camera from ballooning.
function pointMaterial(glow, maxSize) {
  return new ShaderMaterial({
    uniforms: {
      pixelRatio: { value: 1 },
      scale: { value: 300 },
      maxSize: { value: maxSize },
      glow: { value: glow }
    },
    vertexShader: pointVertex,
    fragmentShader: pointFragment,
    transparent: true,
    depthWrite: false
  });
}

// --- Scene ---------------------------------------------------------------------

export function createTopology(stage, data, options = {}) {
  const reducedMotion = Boolean(options.reducedMotion);
  const labelsLayer = stage.querySelector('[data-topology-labels]');
  const tooltip = stage.querySelector('[data-topology-tooltip]');
  const hero = stage.closest('[data-hero]') || stage;

  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  stage.prepend(canvas);

  const scene = new Scene();
  const camera = new PerspectiveCamera(42, 1, 0.1, 100);
  const world = new Group();
  scene.add(world);

  const rand = mulberry32(20240318);

  // --- Layout ---
  const topics = data.topics.map((topic, i) => ({ ...topic, index: i }));
  const topicByName = new Map(topics.map((t) => [t.name, t]));
  const ringRadius = 3.1;

  topics.forEach((topic, i) => {
    const angle = (i / topics.length) * Math.PI * 2 + 0.4;
    const lift = (rand() - 0.5) * 1.6;
    topic.position = new Vector3(Math.cos(angle) * ringRadius, lift, Math.sin(angle) * ringRadius * 0.82);
    // The largest topic sits a little closer to the centre of gravity.
    if (i === 0) topic.position.multiplyScalar(0.55);
    topic.size = 0.16 + Math.sqrt(topic.count) * 0.05; // world units
  });

  const posts = data.posts.map((post, i) => {
    const hub = topicByName.get(post.topic) || topics[0];
    const spread = 0.8 + rand() * 0.75 + Math.sqrt(hub.count) * 0.08;
    const position = randomUnit(rand).multiplyScalar(spread).add(hub.position);
    return { ...post, index: i, hub, position, size: 0.1 };
  });

  // Links: post -> hub, hub -> next hub (backbone), and posts sharing a tag.
  const links = [];
  posts.forEach((post) => links.push({ a: post.position, b: post.hub.position, kind: 'spoke', post }));
  topics.forEach((topic, i) => links.push({ a: topic.position, b: topics[(i + 1) % topics.length].position, kind: 'backbone' }));
  for (let i = 0; i < posts.length; i++) {
    for (let j = i + 1; j < posts.length; j++) {
      if (posts[i].hub === posts[j].hub) continue;
      if (posts[i].tags.some((tag) => posts[j].tags.includes(tag))) {
        links.push({ a: posts[i].position, b: posts[j].position, kind: 'cross', posts: [posts[i], posts[j]] });
      }
    }
  }

  // --- Ambient field: a faint disc of "infrastructure" around the graph ---
  const DUST = 1400;
  const dustPositions = new Float32Array(DUST * 3);
  const dustSizes = new Float32Array(DUST);
  const dustAlpha = new Float32Array(DUST);
  for (let i = 0; i < DUST; i++) {
    const r = 4 + Math.pow(rand(), 0.7) * 9;
    const a = rand() * Math.PI * 2;
    dustPositions.set([Math.cos(a) * r, (rand() - 0.5) * (1.2 + r * 0.18), Math.sin(a) * r], i * 3);
    dustSizes[i] = 0.025 + rand() * 0.035;
    dustAlpha[i] = 0.15 + rand() * 0.35;
  }
  const dustGeometry = new BufferGeometry();
  dustGeometry.setAttribute('position', new BufferAttribute(dustPositions, 3));
  dustGeometry.setAttribute('size', new BufferAttribute(dustSizes, 1));
  dustGeometry.setAttribute('alpha', new BufferAttribute(dustAlpha, 1));
  dustGeometry.setAttribute('tint', new BufferAttribute(new Float32Array(DUST * 3), 3));
  pointAttributes(dustGeometry, DUST);
  const dustMaterial = pointMaterial(0, 5);
  const dust = new Points(dustGeometry, dustMaterial);
  world.add(dust);

  // --- Floor: a receding grid under the graph, like a machine-room floor ---
  const GRID_EXTENT = 12;
  const GRID_STEP = 0.75;
  const gridPositions = [];
  const gridAlpha = [];
  const fade = (x, z) => Math.max(0, 1 - Math.hypot(x, z) / GRID_EXTENT) ** 2;
  for (let v = -GRID_EXTENT; v <= GRID_EXTENT + 1e-6; v += GRID_STEP) {
    for (let u = -GRID_EXTENT; u < GRID_EXTENT; u += GRID_STEP) {
      gridPositions.push(u, 0, v, u + GRID_STEP, 0, v, v, 0, u, v, 0, u + GRID_STEP);
      gridAlpha.push(fade(u, v), fade(u + GRID_STEP, v), fade(v, u), fade(v, u + GRID_STEP));
    }
  }
  const gridGeometry = new BufferGeometry();
  gridGeometry.setAttribute('position', new BufferAttribute(new Float32Array(gridPositions), 3));
  gridGeometry.setAttribute('alpha', new BufferAttribute(new Float32Array(gridAlpha), 1));
  const gridMaterial = lineMaterial();
  const grid = new LineSegments(gridGeometry, gridMaterial);
  grid.position.y = -2.9;
  world.add(grid);

  // --- Edges ---
  const edgePositions = new Float32Array(links.length * 6);
  const edgeAlpha = new Float32Array(links.length * 2);
  links.forEach((link, i) => {
    edgePositions.set([link.a.x, link.a.y, link.a.z, link.b.x, link.b.y, link.b.z], i * 6);
    const strength = link.kind === 'backbone' ? 1 : link.kind === 'spoke' ? 0.8 : 0.45;
    edgeAlpha.set([strength, strength], i * 2);
  });
  const edgeGeometry = new BufferGeometry();
  edgeGeometry.setAttribute('position', new BufferAttribute(edgePositions, 3));
  edgeGeometry.setAttribute('alpha', new BufferAttribute(edgeAlpha, 1));
  const edgeMaterial = lineMaterial();
  const edges = new LineSegments(edgeGeometry, edgeMaterial);
  world.add(edges);

  // Highlighted links of the hovered post, drawn on top in the accent colour.
  const highlightGeometry = new BufferGeometry();
  highlightGeometry.setAttribute('position', new BufferAttribute(new Float32Array(links.length * 6), 3));
  highlightGeometry.setDrawRange(0, 0);
  const highlightMaterial = new LineBasicMaterial({ transparent: true, depthWrite: false, opacity: 0.9 });
  const highlight = new LineSegments(highlightGeometry, highlightMaterial);
  world.add(highlight);

  // --- Nodes: hubs first, then posts ---
  const nodeCount = topics.length + posts.length;
  const nodePositions = new Float32Array(nodeCount * 3);
  const nodeSizes = new Float32Array(nodeCount);
  const nodeAlpha = new Float32Array(nodeCount).fill(1);
  const nodeTint = new Float32Array(nodeCount * 3);
  topics.forEach((topic, i) => {
    nodePositions.set(topic.position.toArray(), i * 3);
    nodeSizes[i] = topic.size;
  });
  posts.forEach((post, i) => {
    const k = topics.length + i;
    nodePositions.set(post.position.toArray(), k * 3);
    nodeSizes[k] = post.size;
  });
  const nodeGeometry = new BufferGeometry();
  nodeGeometry.setAttribute('position', new BufferAttribute(nodePositions, 3));
  nodeGeometry.setAttribute('size', new BufferAttribute(nodeSizes, 1));
  nodeGeometry.setAttribute('alpha', new BufferAttribute(nodeAlpha, 1));
  nodeGeometry.setAttribute('tint', new BufferAttribute(nodeTint, 3));
  const nodeRing = new Float32Array(nodeCount);
  nodeRing.fill(1, 0, topics.length);
  nodeGeometry.setAttribute('ring', new BufferAttribute(nodeRing, 1));
  const nodeMaterial = pointMaterial(1, 48);
  const nodes = new Points(nodeGeometry, nodeMaterial);
  world.add(nodes);

  // --- Packets travelling along links ---
  const PACKETS = reducedMotion ? 0 : Math.min(90, links.length * 2);
  const packets = [];
  for (let i = 0; i < PACKETS; i++) {
    const link = links[Math.floor(rand() * links.length)];
    packets.push({ link, t: rand(), speed: 0.08 + rand() * 0.22, forward: rand() > 0.5 });
  }
  const packetPositions = new Float32Array(Math.max(PACKETS, 1) * 3);
  const packetGeometry = new BufferGeometry();
  packetGeometry.setAttribute('position', new BufferAttribute(packetPositions, 3));
  packetGeometry.setAttribute('size', new BufferAttribute(new Float32Array(Math.max(PACKETS, 1)).fill(0.07), 1));
  packetGeometry.setAttribute('alpha', new BufferAttribute(new Float32Array(Math.max(PACKETS, 1)).fill(1), 1));
  packetGeometry.setAttribute('tint', new BufferAttribute(new Float32Array(Math.max(PACKETS, 1) * 3), 3));
  pointAttributes(packetGeometry, Math.max(PACKETS, 1));
  packetGeometry.setDrawRange(0, PACKETS);
  const packetMaterial = pointMaterial(1, 12);
  const packetPoints = new Points(packetGeometry, packetMaterial);
  world.add(packetPoints);

  // --- Colours from the active theme ---
  let palette;
  function applyTheme() {
    const node = readToken('--graph-node');
    const edge = readToken('--graph-edge');
    const packet = readToken('--graph-packet');
    const glow = readNumber('--graph-glow');
    palette = { node: node.color, edge: edge.color, packet: packet.color, glow };

    const blending = glow > 0.5 ? AdditiveBlending : NormalBlending;
    [dustMaterial, nodeMaterial, packetMaterial].forEach((m) => {
      m.blending = blending;
      m.needsUpdate = true;
    });
    nodeMaterial.uniforms.glow.value = glow;
    packetMaterial.uniforms.glow.value = glow;

    edgeMaterial.uniforms.color.value.copy(edge.color);
    edgeMaterial.uniforms.opacity.value = Math.min(1, edge.alpha * 2.2);
    gridMaterial.uniforms.color.value.copy(edge.color);
    gridMaterial.uniforms.opacity.value = edge.alpha * 1.6;
    highlightMaterial.color.copy(packet.color);

    const dustTint = dustGeometry.getAttribute('tint');
    for (let i = 0; i < DUST; i++) dustTint.setXYZ(i, node.color.r, node.color.g, node.color.b);
    dustTint.needsUpdate = true;

    const packetTint = packetGeometry.getAttribute('tint');
    for (let i = 0; i < PACKETS; i++) packetTint.setXYZ(i, packet.color.r, packet.color.g, packet.color.b);
    packetTint.needsUpdate = true;

    paintNodes();
    requestRender();
  }

  let hovered = null;
  function paintNodes() {
    const tint = nodeGeometry.getAttribute('tint');
    const alpha = nodeGeometry.getAttribute('alpha');
    const focusHub = hovered?.hub;
    topics.forEach((topic, i) => {
      tint.setXYZ(i, palette.packet.r, palette.packet.g, palette.packet.b);
      alpha.setX(i, !hovered || topic === focusHub ? 1 : 0.45);
    });
    posts.forEach((post, i) => {
      const k = topics.length + i;
      const hot = post === hovered;
      const c = hot ? palette.packet : palette.node;
      tint.setXYZ(k, c.r, c.g, c.b);
      alpha.setX(k, !hovered || hot || post.hub === focusHub ? 1 : 0.3);
      nodeSizes[k] = hot ? post.size * 1.9 : post.size;
    });
    tint.needsUpdate = true;
    alpha.needsUpdate = true;
    nodeGeometry.getAttribute('size').needsUpdate = true;
  }

  function highlightLinks(post) {
    const target = highlightGeometry.getAttribute('position');
    let n = 0;
    if (post) {
      links.forEach((link) => {
        if (link.post === post || link.posts?.includes(post)) {
          target.setXYZ(n++, link.a.x, link.a.y, link.a.z);
          target.setXYZ(n++, link.b.x, link.b.y, link.b.z);
        }
      });
    }
    target.needsUpdate = true;
    highlightGeometry.setDrawRange(0, n);
  }

  // --- Topic labels (HTML, so they stay crisp and are real links) ---
  const labels = topics.map((topic) => {
    const a = document.createElement('a');
    a.className = 'topo-label';
    a.href = topic.url;
    a.tabIndex = -1; // the Topics section below is the keyboard path
    a.innerHTML = `${topic.label}<span>${topic.count}</span>`;
    labelsLayer?.append(a);
    return { topic, el: a, width: 0 };
  });

  // --- Sizing ---
  let width = 1;
  let height = 1;
  // Screen boxes of the hero's text, so topic labels never sit on top of it.
  let textBoxes = [];
  function measureText() {
    const origin = stage.getBoundingClientRect();
    const range = document.createRange();
    textBoxes = [];
    // Measure rendered lines of text (not the full-width block boxes) so a
    // label is only hidden when it would really cover words or buttons.
    hero.querySelectorAll('.hero-kicker, .hero-title, .hero-lede, .hero-actions > *, .hero-legend').forEach((el) => {
      range.selectNodeContents(el);
      [...range.getClientRects()].forEach((r) => {
        if (r.width && r.height) textBoxes.push({ x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height });
      });
    });
  }
  let baseDistance = 11;
  function resize() {
    const rect = stage.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    measureText();

    const wide = width >= 900;
    // On wide screens the graph sits to the right of the headline; on narrow
    // ones it is centred and pulled back until the whole ring fits the width.
    world.position.set(wide ? 2.7 : 0, wide ? 0.3 : 0.4, 0);
    const halfWidthTan = Math.tan(MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
    baseDistance = wide ? 11 : Math.max(11, 4.6 / halfWidthTan);
    // Pixels per world unit at distance 1, so point sizes follow perspective.
    const scale = height / (2 * Math.tan(MathUtils.degToRad(camera.fov / 2)));
    [dustMaterial, nodeMaterial, packetMaterial].forEach((m) => {
      m.uniforms.pixelRatio.value = dpr;
      m.uniforms.scale.value = scale;
    });
    requestRender();
  }

  // --- Interaction ---
  const pointer = new Vector2(10, 10);
  const pointerTarget = new Vector2(0, 0);
  const pointerSmooth = new Vector2(0, 0);
  const raycaster = new Raycaster();
  raycaster.params.Points.threshold = 0.22;
  let pointerInside = false;

  function onPointerMove(event) {
    const rect = stage.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    pointerTarget.copy(pointer);
    pointerInside = !event.target.closest('a, button');
    requestRender();
  }

  function onPointerLeave() {
    pointerInside = false;
    pointerTarget.set(0, 0);
    setHovered(null);
  }

  function onClick(event) {
    if (!hovered || event.target.closest('a, button')) return;
    window.location.assign(hovered.url);
  }

  function setHovered(post) {
    if (post === hovered) return;
    hovered = post;
    paintNodes();
    highlightLinks(post);
    hero.style.cursor = post ? 'pointer' : '';
    labels.forEach(({ topic, el }) => el.classList.toggle('is-active', Boolean(post) && topic === post.hub));
    if (tooltip) {
      tooltip.hidden = !post;
      if (post) tooltip.innerHTML = `<strong></strong><span></span>`;
      if (post) {
        tooltip.querySelector('strong').textContent = post.title;
        tooltip.querySelector('span').textContent = `${post.hub.label}, ${post.date}`;
      }
    }
    requestRender();
  }

  const projected = new Vector3();
  function project(worldPosition) {
    projected.copy(worldPosition).applyMatrix4(world.matrixWorld).project(camera);
    return {
      x: (projected.x * 0.5 + 0.5) * width,
      y: (-projected.y * 0.5 + 0.5) * height,
      behind: projected.z > 1
    };
  }

  // --- Loop ---
  let visible = true;
  let running = false;
  let frame = 0;
  let needsRender = true;
  let last = performance.now();
  let elapsed = 0;
  let scrollProgress = 0;
  const intro = { t: reducedMotion ? 1 : 0 };

  function requestRender() {
    needsRender = true;
    if (!running) start();
  }

  function tick(now) {
    frame = 0;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const animating = !reducedMotion;
    if (animating) elapsed += dt;

    // Intro: dolly in from far away.
    if (intro.t < 1) intro.t = Math.min(1, intro.t + dt / 2.4);
    const introEase = 1 - Math.pow(1 - intro.t, 3);

    pointerSmooth.lerp(pointerTarget, reducedMotion ? 1 : 0.06);
    world.rotation.y = elapsed * 0.05 + pointerSmooth.x * 0.35 + scrollProgress * 0.9;
    world.rotation.x = 0.18 - pointerSmooth.y * 0.18 + scrollProgress * 0.25;
    dust.rotation.y = elapsed * -0.012;

    const distance = MathUtils.lerp(baseDistance + 9, baseDistance, introEase) + scrollProgress * 6;
    camera.position.set(0, 1.2 + scrollProgress * 1.5, distance);
    camera.lookAt(0, 0, 0);

    // Packets
    if (PACKETS) {
      const attr = packetGeometry.getAttribute('position');
      packets.forEach((p, i) => {
        p.t += dt * p.speed;
        if (p.t > 1) {
          p.t -= 1;
          // Hop to a new link that touches the current end, like routed traffic.
          const end = p.forward ? p.link.b : p.link.a;
          const next = links.filter((l) => l.a === end || l.b === end);
          p.link = next.length ? next[Math.floor(Math.random() * next.length)] : p.link;
          p.forward = p.link.a === end;
        }
        const from = p.forward ? p.link.a : p.link.b;
        const to = p.forward ? p.link.b : p.link.a;
        attr.setXYZ(i, from.x + (to.x - from.x) * p.t, from.y + (to.y - from.y) * p.t, from.z + (to.z - from.z) * p.t);
      });
      attr.needsUpdate = true;
    }

    world.updateMatrixWorld();

    // Hover
    if (pointerInside) {
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObject(nodes);
      const hit = hits.find((h) => h.index >= topics.length);
      setHovered(hit ? posts[hit.index - topics.length] : null);
    }

    // Labels follow their hubs. Where two would overlap, the topic with more
    // posts keeps its label (labels are ordered by post count already).
    const placed = textBoxes.slice();
    labels.forEach((label) => {
      const { topic, el } = label;
      label.width ||= el.offsetWidth; // measured once; labels never change size
      const p = project(topic.position);
      const x = Math.max(8, Math.min(p.x + 12, width - label.width - 8));
      const y = p.y - 10;
      const box = { x, y, w: label.width, h: 24 };
      const clash = placed.some((o) => box.x < o.x + o.w + 6 && o.x < box.x + box.w + 6 && box.y < o.y + o.h && o.y < box.y + box.h);
      const show = !p.behind && !clash;
      if (show) placed.push(box);
      el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      el.style.opacity = show ? '' : '0';
      el.style.pointerEvents = show ? '' : 'none';
    });
    if (hovered && tooltip) {
      const p = project(hovered.position);
      const x = Math.min(p.x + 16, width - 300);
      tooltip.style.transform = `translate(${Math.round(x)}px, ${Math.round(p.y + 14)}px)`;
    }

    renderer.render(scene, camera);
    needsRender = false;

    const keepGoing = animating || intro.t < 1 || pointerSmooth.distanceTo(pointerTarget) > 0.001;
    if (running && (keepGoing || needsRender)) frame = requestAnimationFrame(tick);
    else running = false;
  }

  function start() {
    if (running || !visible || document.hidden) return;
    running = true;
    last = performance.now();
    frame = requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(frame);
  }

  // Pause entirely when the hero is off-screen or the tab is hidden.
  const visibility = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    visible ? start() : stop();
  });
  visibility.observe(stage);
  const onVisibilityChange = () => (document.hidden ? stop() : start());
  document.addEventListener('visibilitychange', onVisibilityChange);

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(stage);

  hero.addEventListener('pointermove', onPointerMove);
  hero.addEventListener('pointerleave', onPointerLeave);
  hero.addEventListener('click', onClick);
  window.addEventListener('themechange', applyTheme);
  const systemScheme = window.matchMedia('(prefers-color-scheme: dark)');
  systemScheme.addEventListener('change', applyTheme);

  applyTheme();
  resize();
  document.fonts?.ready.then(measureText);
  stage.classList.add('is-ready');
  start();

  return {
    // 0 at the top of the page, 1 once the hero has scrolled away.
    setScrollProgress(value) {
      scrollProgress = value;
      requestRender();
    },
    destroy() {
      stop();
      visibility.disconnect();
      resizeObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      hero.removeEventListener('pointermove', onPointerMove);
      hero.removeEventListener('pointerleave', onPointerLeave);
      hero.removeEventListener('click', onClick);
      window.removeEventListener('themechange', applyTheme);
      systemScheme.removeEventListener('change', applyTheme);
      [dustGeometry, gridGeometry, edgeGeometry, highlightGeometry, nodeGeometry, packetGeometry].forEach((g) => g.dispose());
      [dustMaterial, gridMaterial, edgeMaterial, highlightMaterial, nodeMaterial, packetMaterial].forEach((m) => m.dispose());
      renderer.dispose();
      canvas.remove();
      labels.forEach(({ el }) => el.remove());
    }
  };
}
