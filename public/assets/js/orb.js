// Audio-reactive particle-cloud orb for the showcase persona.
//
// A spherical cloud of ~3000 GPU points that breathes gently when idle and
// comes alive with Elena's voice: bass expands the cloud, mids drive its
// rotation, highs and overall amplitude raise particle size, brightness,
// and shift color toward a hot core. Amber, to match the showcase brand.
// Adapted from the Marlow voice widget's particle field; wrapped in our
// createOrb API (setActive / setMode / dispose) and fed by the call's
// existing AudioPlayer analyser instead of a global.
//
// Three.js (~365 KB) is dynamic-imported by the caller so it only loads
// when the showcase flow is entered.

import * as THREE from '../vendor/three.module.js';

const PARTICLE_COUNT = 4200;
const HEIGHTS = { meta: 0, scenario: 148 };

const VERTEX = `
  uniform float uTime;
  uniform float uBass;
  uniform float uMid;
  uniform float uHigh;
  uniform float uAmplitude;
  uniform float uActivation;
  uniform float uPixelRatio;
  attribute float aAngle;
  attribute float aRadius;
  attribute float aSpeed;
  attribute float aSize;
  attribute float aY;
  attribute float aPhase;
  varying float vAlpha;
  varying float vEnergy;
  void main() {
    float a = aAngle + uTime * aSpeed * (0.4 + uMid * 0.9);
    // Radial expansion on bass, gentle breathing at idle, a touch more when active.
    float expand = 1.0 + 0.10 * uBass + 0.05 * uAmplitude + 0.04 * uActivation + 0.03 * sin(uTime * 0.6 + aPhase);
    float r = aRadius * expand + sin(uTime * 0.9 + aPhase) * 0.04;
    float y = aY * expand + sin(uTime * 0.7 + aPhase * 1.3) * 0.05;
    vec3 p = vec3(cos(a) * r, y, sin(a) * r);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    // Point size scales with energy and inverse depth. Slightly higher
    // idle baseline so the cloud reads as a present, fuller mass at rest in
    // the large meta-mode stage, then blooms with her voice.
    float energy = 0.9 + uAmplitude * 0.7 + uHigh * 0.5 + uActivation * 0.3;
    vEnergy = energy;
    gl_PointSize = aSize * uPixelRatio * energy * (30.0 / -mv.z);
    vAlpha = 0.42 + uAmplitude * 0.34 + uHigh * 0.18 + uActivation * 0.14;
  }
`;

const FRAGMENT = `
  uniform vec3 uColor;
  uniform vec3 uColorHot;
  varying float vAlpha;
  varying float vEnergy;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float soft = smoothstep(0.5, 0.0, d);
    vec3 col = mix(uColor, uColorHot, clamp(vEnergy - 0.7, 0.0, 1.0));
    gl_FragColor = vec4(col, soft * vAlpha);
  }
`;

export function createOrb({ container, getAnalyser }) {
  if (!container) throw new Error('orb_container_required');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  camera.position.set(0, 0, 3.8);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.classList.add('orb-canvas');
  container.appendChild(renderer.domElement);

  // Build the spherical particle volume. Each particle gets its own angle,
  // radius, drift speed, vertical offset, base size, and phase so the cloud
  // feels organic instead of mathematical.
  const positions = new Float32Array(PARTICLE_COUNT * 3);
  const angles = new Float32Array(PARTICLE_COUNT);
  const radii = new Float32Array(PARTICLE_COUNT);
  const speeds = new Float32Array(PARTICLE_COUNT);
  const sizes = new Float32Array(PARTICLE_COUNT);
  const yOff = new Float32Array(PARTICLE_COUNT);
  const phases = new Float32Array(PARTICLE_COUNT);

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const shell = Math.pow(Math.random(), 0.5);
    const rr = 0.25 + shell * 0.85;
    const u = (Math.random() - 0.5) * 2;
    const y = Math.sign(u) * Math.pow(Math.abs(u), 1.3) * rr;
    const horiz = Math.sqrt(Math.max(0, rr * rr - y * y));
    const a = Math.random() * Math.PI * 2;
    positions[i * 3 + 0] = Math.cos(a) * horiz;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = Math.sin(a) * horiz;
    angles[i] = a;
    radii[i] = horiz;
    speeds[i] = (0.05 + Math.random() * 0.25) * (Math.random() > 0.5 ? 1 : -1);
    sizes[i] = 0.4 + Math.random() * 1.1;
    yOff[i] = y;
    phases[i] = Math.random() * Math.PI * 2;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aAngle', new THREE.BufferAttribute(angles, 1));
  geo.setAttribute('aRadius', new THREE.BufferAttribute(radii, 1));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aY', new THREE.BufferAttribute(yOff, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

  const uniforms = {
    uTime: { value: 0 },
    uBass: { value: 0 },
    uMid: { value: 0 },
    uHigh: { value: 0 },
    uAmplitude: { value: 0 },
    uActivation: { value: 0 },
    uPixelRatio: { value: pixelRatio },
    // Brand amber, cooling toward a warm pale gold at the hot core.
    uColor: { value: new THREE.Color(0xf5a524) },
    uColorHot: { value: new THREE.Color(0xfff1d4) },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const particles = new THREE.Points(geo, material);
  scene.add(particles);

  let activationTarget = 0;
  let bassS = 0, midS = 0, highS = 0;
  let amplitude = 0;
  let mode = 'meta';
  let disposed = false;
  let lastT = performance.now();
  const freqBuf = new Uint8Array(256);

  function resize() {
    const rect = container.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Pull the camera back when the orb is in the compact scenario band so
    // the whole cloud stays in frame.
    const targetZ = h < 220 ? 4.7 : 3.8;
    camera.position.z += (targetZ - camera.position.z) * 0.5;
    camera.updateProjectionMatrix();
  }
  resize();
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);

  function tick() {
    if (disposed) return;
    requestAnimationFrame(tick);
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;

    let bass = 0, mid = 0, high = 0, total = 0;
    let analyser = null;
    try { analyser = getAnalyser?.() || null; } catch { analyser = null; }
    if (analyser && analyser.getByteFrequencyData) {
      const bins = Math.min(freqBuf.length, analyser.frequencyBinCount);
      const view = bins === freqBuf.length ? freqBuf : new Uint8Array(bins);
      analyser.getByteFrequencyData(view);
      const bassCut = Math.max(2, Math.floor(bins * 0.08));
      const midCut = Math.max(bassCut + 1, Math.floor(bins * 0.45));
      let bassSum = 0, midSum = 0, highSum = 0, sum = 0;
      for (let i = 0; i < bins; i++) {
        const v = view[i];
        sum += v;
        if (i < bassCut) bassSum += v;
        else if (i < midCut) midSum += v;
        else highSum += v;
      }
      bass = bassSum / (bassCut * 255);
      mid = midSum / ((midCut - bassCut) * 255);
      high = highSum / ((bins - midCut) * 255);
      total = sum / (bins * 255);
    }

    const easeIn = 1 - Math.exp(-dt * 16);
    const easeOut = 1 - Math.exp(-dt * 5);
    bassS += (bass - bassS) * (bass > bassS ? easeIn : easeOut);
    midS += (mid - midS) * (mid > midS ? easeIn : easeOut);
    highS += (high - highS) * (high > highS ? easeIn : easeOut);
    amplitude += (total - amplitude) * (total > amplitude ? easeIn : easeOut);

    uniforms.uBass.value = bassS;
    uniforms.uMid.value = midS;
    uniforms.uHigh.value = highS;
    uniforms.uAmplitude.value = amplitude;
    uniforms.uActivation.value += (activationTarget - uniforms.uActivation.value) * (1 - Math.exp(-dt * 5));
    uniforms.uTime.value += dt;

    particles.rotation.y += dt * (0.04 + midS * 0.08);
    particles.rotation.x = Math.sin(uniforms.uTime.value * 0.25) * 0.05;

    renderer.render(scene, camera);
  }
  requestAnimationFrame(tick);

  return {
    setActive(active) {
      activationTarget = active ? 1.0 : 0.0;
    },
    setMode(next) {
      if (next !== 'meta' && next !== 'scenario') return;
      if (next === mode) return;
      mode = next;
      container.dataset.orbMode = mode;
    },
    getMode() { return mode; },
    dispose() {
      if (disposed) return;
      disposed = true;
      try { resizeObserver.disconnect(); } catch {}
      try { geo.dispose(); } catch {}
      try { material.dispose(); } catch {}
      try { renderer.dispose(); } catch {}
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    },
  };
}

createOrb.HEIGHTS = HEIGHTS;
