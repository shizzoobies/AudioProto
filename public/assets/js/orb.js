// Audio-reactive contour-ring sphere with emanating echo ripples.
//
// The base is a stack of 28 horizontal latitude rings forming a sphere
// silhouette. All rings share one underlying wave field so adjacent
// rings align into a continuous wobbling surface.
//
// Around that sphere, 6 echo rings continuously emanate outward from
// the sphere surface, fading as they expand. They make the "waves
// rippling and expanding outward" behavior obvious.
//
// Audio drives:
//   - Wave amplitude (sphere visibly ripples harder when she talks)
//   - Overall radial expansion (sphere puffs outward with bass)
//   - Echo ripple intensity and reach
//
// Three.js (~365 KB) is dynamic-imported by the caller so it only loads
// when the showcase flow is entered.

import * as THREE from '../vendor/three.module.js';

const SPHERE_RING_COUNT = 28;
const ECHO_RING_COUNT = 6;
const POINTS_PER_RING = 240;
const PARTICLE_COUNT = 120;

const SPHERE_RING_VERTEX = `
  uniform float uTime;
  uniform float uActivation;
  uniform float uAmplitude;
  uniform float uBass;
  uniform float uMid;
  uniform float uHigh;
  uniform float uY;
  uniform float uPhase;
  attribute float aTheta;
  varying float vT;
  varying float vDepth;
  varying float vRipple;
  varying float vLatBright;

  void main() {
    vT = aTheta;
    float y = uY;
    float baseR = sqrt(max(0.0, 1.0 - y * y));

    // Travelling wave field: phase moves around the ring AND across
    // latitudes over time, so adjacent rings stay coherent and the
    // ripples are clearly in motion.
    float tt = uTime * 1.1;
    float w1 = sin(aTheta * 5.0 + y * 3.4 + tt + uPhase * 0.15);
    float w2 = sin(aTheta * 3.0 - y * 4.0 - tt * 0.8 + uPhase * 0.25) * 0.45;
    float w3 = sin(aTheta * 8.0 + y * 5.0 + tt * 1.6) * 0.20;
    float wave = w1 + w2 + w3;
    vRipple = wave;

    float idleAmp = 0.025 + 0.020 * sin(uTime * 0.7 + uPhase * 0.3);
    float liveAmp = 0.065 * uActivation + 0.045 * uMid + 0.020 * uHigh;
    float waveAmp = idleAmp + liveAmp;

    // Strong global radial expansion when she talks.
    float expand = 1.0 + 0.08 * uActivation + 0.18 * uBass + 0.08 * uAmplitude;
    float r = (baseR + wave * waveAmp) * expand;

    float yWobble = sin(uTime * 0.6 + uPhase * 0.5) * 0.008 * (0.5 + uActivation);
    float yOut = y * expand + yWobble;

    vec3 p = vec3(r * position.x, yOut, r * position.z);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vDepth = mv.z;
    vLatBright = mix(0.7, 1.0, 1.0 - abs(y));
    gl_Position = projectionMatrix * mv;
  }
`;

const SPHERE_RING_FRAGMENT = `
  uniform vec3 uAccentColor;
  uniform float uActivation;
  uniform float uAmplitude;
  varying float vDepth;
  varying float vRipple;
  varying float vLatBright;

  void main() {
    float crest = clamp(vRipple * 0.5 + 0.5, 0.0, 1.0);
    float depth = clamp((vDepth + 5.0) / 2.2, 0.0, 1.0);
    float depthFade = mix(0.45, 1.0, depth);
    float bright = (0.8 + crest * 0.55) * depthFade * vLatBright;
    float alpha = (0.36 + uActivation * 0.30 + uAmplitude * 0.10) * (0.7 + crest * 0.30) * depthFade * vLatBright;
    gl_FragColor = vec4(uAccentColor * bright, alpha);
  }
`;

// Echo ripple: starts near the sphere surface, expands outward to a
// larger radius over its life cycle, fading out as it reaches the edge.
const ECHO_RING_VERTEX = `
  uniform float uTime;
  uniform float uActivation;
  uniform float uAmplitude;
  uniform float uBass;
  uniform float uMid;
  uniform float uHigh;
  uniform float uY;
  uniform float uOffset;
  uniform float uSpeed;
  uniform float uPhase;
  attribute float aTheta;
  varying float vT;
  varying float vPhase;
  varying float vRipple;
  varying float vDepth;
  varying float vLatBright;

  void main() {
    vT = aTheta;
    float y = uY;
    float baseR = sqrt(max(0.0, 1.0 - y * y));

    // Life-cycle phase 0..1 per echo, looping.
    float speed = 0.12 + uActivation * 0.22 + uBass * 0.12;
    float phase = fract(uTime * (speed * uSpeed) + uOffset);
    vPhase = phase;

    // Expand from just outside the sphere out to a generous reach.
    float minR = 1.0;
    float maxR = 1.55 + uActivation * 0.55 + uBass * 0.30;
    float radiusFactor = mix(minR, maxR, pow(phase, 0.8));

    float tt = uTime * 1.0;
    float w1 = sin(aTheta * 5.0 + y * 3.4 + tt + uPhase * 0.4);
    float w2 = sin(aTheta * 3.0 - y * 4.0 - tt * 0.7 + uPhase * 1.1) * 0.45;
    float wave = w1 + w2;
    vRipple = wave;

    float waveAmp = 0.025 + 0.06 * uActivation + 0.035 * uMid;
    waveAmp *= 0.4 + phase * 0.9;

    float r = (baseR + wave * waveAmp) * radiusFactor;
    vec3 p = vec3(r * position.x, y * radiusFactor, r * position.z);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vDepth = mv.z;
    vLatBright = mix(0.7, 1.0, 1.0 - abs(y));
    gl_Position = projectionMatrix * mv;
  }
`;

const ECHO_RING_FRAGMENT = `
  uniform vec3 uAccentColor;
  uniform float uActivation;
  uniform float uAmplitude;
  varying float vPhase;
  varying float vRipple;
  varying float vDepth;
  varying float vLatBright;

  void main() {
    // Life curve: fade in fast, fade out slow.
    float fadeIn = smoothstep(0.0, 0.18, vPhase);
    float fadeOut = smoothstep(1.0, 0.65, vPhase);
    float life = fadeIn * fadeOut;
    float crest = clamp(vRipple * 0.5 + 0.5, 0.0, 1.0);
    float depth = clamp((vDepth + 5.0) / 2.2, 0.0, 1.0);
    float depthFade = mix(0.55, 1.0, depth);
    float bright = (0.85 + crest * 0.4) * depthFade * vLatBright * life;
    float alpha = (0.22 + uActivation * 0.40 + uAmplitude * 0.14) * life * (0.55 + crest * 0.4) * depthFade * vLatBright;
    gl_FragColor = vec4(uAccentColor * bright, alpha);
  }
`;

const PARTICLE_VERTEX = `
  uniform float uTime;
  uniform float uActivation;
  uniform float uMid;
  uniform float uPixelRatio;
  attribute float aAngle;
  attribute float aRadius;
  attribute float aSpeed;
  attribute float aSize;
  attribute float aY;
  varying float vAlpha;
  void main() {
    float a = aAngle + uTime * aSpeed * (0.5 + uMid * 0.6);
    float r = aRadius + sin(uTime * 0.5 + aAngle * 3.0) * 0.04;
    float y = aY + sin(uTime * 0.45 + aAngle * 4.7) * 0.07;
    vec3 p = vec3(cos(a) * r, y, sin(a) * r);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uPixelRatio * (0.6 + uActivation * 0.5) * (14.0 / -mv.z);
    vAlpha = 0.12 + uActivation * 0.20;
  }
`;

const PARTICLE_FRAGMENT = `
  uniform vec3 uAccentColor;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float soft = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(uAccentColor, soft * vAlpha);
  }
`;

function buildRingGeometry() {
  const positions = new Float32Array(POINTS_PER_RING * 3);
  const thetas = new Float32Array(POINTS_PER_RING);
  for (let j = 0; j < POINTS_PER_RING; j++) {
    const t = (j / POINTS_PER_RING) * Math.PI * 2;
    positions[j * 3] = Math.cos(t);
    positions[j * 3 + 1] = 0;
    positions[j * 3 + 2] = Math.sin(t);
    thetas[j] = t;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aTheta', new THREE.BufferAttribute(thetas, 1));
  return geo;
}

export function createOrb({ container, getAnalyser }) {
  if (!container) throw new Error('orb_container_required');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(0, 0.05, 4.0);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.classList.add('orb-canvas');
  container.appendChild(renderer.domElement);

  const shared = {
    uTime: { value: 0 },
    uBass: { value: 0 },
    uMid: { value: 0 },
    uHigh: { value: 0 },
    uActivation: { value: 0 },
    uAmplitude: { value: 0 },
    uAccentColor: { value: new THREE.Color(0xf5a524) },
  };

  const baseGeo = buildRingGeometry();
  const allMaterials = [];

  // Sphere contour rings.
  const sphere = new THREE.Group();
  for (let i = 0; i < SPHERE_RING_COUNT; i++) {
    const t = (i + 0.5) / SPHERE_RING_COUNT;
    const lat = -Math.PI / 2 + t * Math.PI;
    const y = Math.sin(lat) * 0.95;
    const mat = new THREE.ShaderMaterial({
      vertexShader: SPHERE_RING_VERTEX,
      fragmentShader: SPHERE_RING_FRAGMENT,
      uniforms: {
        uTime: shared.uTime,
        uActivation: shared.uActivation,
        uAmplitude: shared.uAmplitude,
        uBass: shared.uBass,
        uMid: shared.uMid,
        uHigh: shared.uHigh,
        uAccentColor: shared.uAccentColor,
        uY: { value: y },
        uPhase: { value: i * 0.31 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    allMaterials.push(mat);
    sphere.add(new THREE.LineLoop(baseGeo, mat));
  }
  scene.add(sphere);

  // Echo ripple rings: one per latitude band around the equator, life
  // cycles staggered so ripples continuously emanate outward.
  const echos = new THREE.Group();
  for (let i = 0; i < ECHO_RING_COUNT; i++) {
    // Echo rings cluster around the equator with slight vertical spread,
    // so the ripples look like they come from the sphere's middle band.
    const y = (i / (ECHO_RING_COUNT - 1) - 0.5) * 0.45;
    const mat = new THREE.ShaderMaterial({
      vertexShader: ECHO_RING_VERTEX,
      fragmentShader: ECHO_RING_FRAGMENT,
      uniforms: {
        uTime: shared.uTime,
        uActivation: shared.uActivation,
        uAmplitude: shared.uAmplitude,
        uBass: shared.uBass,
        uMid: shared.uMid,
        uHigh: shared.uHigh,
        uAccentColor: shared.uAccentColor,
        uY: { value: y },
        uOffset: { value: i / ECHO_RING_COUNT },
        uSpeed: { value: 0.85 + Math.random() * 0.30 },
        uPhase: { value: Math.random() * Math.PI * 2 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    allMaterials.push(mat);
    echos.add(new THREE.LineLoop(baseGeo, mat));
  }
  scene.add(echos);

  // Particle dust (subtle ambient motion).
  const pGeo = new THREE.BufferGeometry();
  const pPositions = new Float32Array(PARTICLE_COUNT * 3);
  const pAngles = new Float32Array(PARTICLE_COUNT);
  const pRadius = new Float32Array(PARTICLE_COUNT);
  const pSpeed = new Float32Array(PARTICLE_COUNT);
  const pSize = new Float32Array(PARTICLE_COUNT);
  const pY = new Float32Array(PARTICLE_COUNT);
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    pPositions[i * 3] = 0;
    pPositions[i * 3 + 1] = 0;
    pPositions[i * 3 + 2] = 0;
    pAngles[i] = Math.random() * Math.PI * 2;
    pRadius[i] = 0.4 + Math.random() * 1.6;
    pSpeed[i] = (0.04 + Math.random() * 0.14) * (Math.random() > 0.5 ? 1 : -1);
    pSize[i] = 0.3 + Math.random() * 0.7;
    const u = (Math.random() - 0.5) * 2;
    pY[i] = Math.sign(u) * Math.pow(Math.abs(u), 1.5) * 0.9;
  }
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPositions, 3));
  pGeo.setAttribute('aAngle', new THREE.BufferAttribute(pAngles, 1));
  pGeo.setAttribute('aRadius', new THREE.BufferAttribute(pRadius, 1));
  pGeo.setAttribute('aSpeed', new THREE.BufferAttribute(pSpeed, 1));
  pGeo.setAttribute('aSize', new THREE.BufferAttribute(pSize, 1));
  pGeo.setAttribute('aY', new THREE.BufferAttribute(pY, 1));
  const pMat = new THREE.ShaderMaterial({
    vertexShader: PARTICLE_VERTEX,
    fragmentShader: PARTICLE_FRAGMENT,
    uniforms: {
      uTime: shared.uTime,
      uActivation: shared.uActivation,
      uMid: shared.uMid,
      uAccentColor: shared.uAccentColor,
      uPixelRatio: { value: pixelRatio },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const particles = new THREE.Points(pGeo, pMat);
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
    const targetZ = h < 220 ? 3.4 : 4.0;
    camera.position.z += (targetZ - camera.position.z) * 0.4;
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
      let bassSum = 0, midSum = 0, highSum = 0, sum = 0;
      const bassCut = Math.max(2, Math.floor(bins * 0.08));
      const midCut = Math.max(bassCut + 1, Math.floor(bins * 0.45));
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

    const easeIn = 1 - Math.exp(-dt * 14);
    const easeOut = 1 - Math.exp(-dt * 4);
    bassS += (bass - bassS) * (bass > bassS ? easeIn : easeOut);
    midS += (mid - midS) * (mid > midS ? easeIn : easeOut);
    highS += (high - highS) * (high > highS ? easeIn : easeOut);
    amplitude += (total - amplitude) * (total > amplitude ? easeIn : easeOut);

    shared.uBass.value = bassS;
    shared.uMid.value = midS;
    shared.uHigh.value = highS;
    shared.uAmplitude.value = amplitude;
    shared.uActivation.value += (activationTarget - shared.uActivation.value) * (1 - Math.exp(-dt * 5));
    shared.uTime.value += dt;

    sphere.rotation.y += dt * (0.05 + midS * 0.04);
    echos.rotation.y += dt * (0.03 + midS * 0.02);
    particles.rotation.y += dt * 0.01;

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
      try { baseGeo.dispose(); } catch {}
      for (const m of allMaterials) { try { m.dispose(); } catch {} }
      try { pGeo.dispose(); pMat.dispose(); } catch {}
      try { renderer.dispose(); } catch {}
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    },
  };
}

createOrb.HEIGHTS = { meta: 0, scenario: 148 };
