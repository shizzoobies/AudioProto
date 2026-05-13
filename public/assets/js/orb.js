// Audio-reactive wave-string sphere for the showcase persona.
//
// Composition: many great circles wrap a sphere at random orientations.
// Each circle is a thin line whose radius is perturbed by stacked sine
// waves. Audio drives both the per-string wave amplitude (so the lines
// "ripple" louder during speech) and a global radial expansion (so the
// whole sphere puffs outward when she talks). During silence the strings
// breathe with a slow noise.
//
// A faint spherical dust scatter sits on top for subtle motion.
//
// Three.js (~365 KB) is dynamic-imported by the caller so it only loads
// when the showcase flow is entered.

import * as THREE from '../vendor/three.module.js';

const STRING_COUNT = 38;
const POINTS_PER_STRING = 220;
const PARTICLE_COUNT = 160;

const STRING_VERTEX = `
  uniform float uTime;
  uniform float uActivation;
  uniform float uAmplitude;
  uniform float uBass;
  uniform float uMid;
  uniform float uHigh;
  uniform float uBaseRadius;
  uniform float uPhase;
  uniform float uFreq1;
  uniform float uFreq2;
  uniform float uFreq3;
  uniform float uSpeed;
  attribute float aTheta;
  varying float vT;
  varying float vRipple;
  varying float vDepth;

  void main() {
    vT = aTheta;
    float tt = uTime * uSpeed;
    float w1 = sin(aTheta * uFreq1 + tt + uPhase);
    float w2 = sin(aTheta * uFreq2 - tt * 0.6 + uPhase * 1.3) * 0.35;
    float w3 = sin(aTheta * uFreq3 + tt * 1.2 + uPhase * 2.1) * 0.15;
    float wave = w1 + w2 + w3;
    vRipple = wave;
    float idleAmp = 0.006 + 0.008 * sin(uTime * 0.55 + uPhase * 0.7);
    float liveAmp = 0.030 * uActivation + 0.024 * uMid + 0.012 * uHigh;
    float waveAmp = idleAmp + liveAmp;
    float expand = 0.025 * uActivation + 0.085 * uBass + 0.035 * uAmplitude;
    float r = uBaseRadius + wave * waveAmp + expand;
    vec3 p = position * r;
    vec4 mvPos = modelViewMatrix * vec4(p, 1.0);
    vDepth = mvPos.z;
    gl_Position = projectionMatrix * mvPos;
  }
`;

const STRING_FRAGMENT = `
  uniform vec3 uAccentColor;
  uniform float uActivation;
  uniform float uAmplitude;
  varying float vT;
  varying float vRipple;
  varying float vDepth;

  void main() {
    float crest = clamp(vRipple * 0.5 + 0.5, 0.0, 1.0);
    // Light depth fade so the sphere has volume without going dim. Camera
    // sits at z=4 so sphere depths span roughly -3 to -5 in view space.
    float depth = clamp((vDepth + 5.0) / 2.2, 0.0, 1.0);
    float depthFade = mix(0.55, 1.0, depth);
    float bright = (0.7 + crest * 0.55) * depthFade;
    float alpha = (0.32 + uActivation * 0.32 + uAmplitude * 0.12) * (0.65 + crest * 0.35) * depthFade;
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
    vAlpha = 0.15 + uActivation * 0.25;
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

function buildCircleGeometry() {
  const positions = new Float32Array(POINTS_PER_STRING * 3);
  const thetas = new Float32Array(POINTS_PER_STRING);
  for (let j = 0; j < POINTS_PER_STRING; j++) {
    const t = (j / POINTS_PER_STRING) * Math.PI * 2;
    positions[j * 3] = Math.cos(t);
    positions[j * 3 + 1] = Math.sin(t);
    positions[j * 3 + 2] = 0;
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
  camera.position.set(0, 0, 4.0);
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

  // Build N wave strings, each on a random great-circle orientation.
  const baseGeo = buildCircleGeometry();
  const strings = new THREE.Group();
  const stringMaterials = [];
  const zAxis = new THREE.Vector3(0, 0, 1);
  for (let i = 0; i < STRING_COUNT; i++) {
    const mat = new THREE.ShaderMaterial({
      vertexShader: STRING_VERTEX,
      fragmentShader: STRING_FRAGMENT,
      uniforms: {
        uTime: shared.uTime,
        uActivation: shared.uActivation,
        uAmplitude: shared.uAmplitude,
        uBass: shared.uBass,
        uMid: shared.uMid,
        uHigh: shared.uHigh,
        uAccentColor: shared.uAccentColor,
        // Slight radius variation across strings so they live in a shell
        // instead of a perfect onion - gives a sense of depth.
        uBaseRadius: { value: 0.95 + Math.random() * 0.12 },
        uPhase: { value: Math.random() * Math.PI * 2 },
        uFreq1: { value: 2.0 + Math.floor(Math.random() * 3) },
        uFreq2: { value: 3.0 + Math.floor(Math.random() * 3) },
        uFreq3: { value: 5.0 + Math.floor(Math.random() * 4) },
        uSpeed: { value: 0.25 + Math.random() * 0.45 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    stringMaterials.push(mat);
    const line = new THREE.LineLoop(baseGeo, mat);
    // Random orientation: rotate the XY-plane circle to a random great circle.
    const axis = new THREE.Vector3(
      (Math.random() - 0.5),
      (Math.random() - 0.5),
      (Math.random() - 0.5)
    ).normalize();
    line.quaternion.setFromUnitVectors(zAxis, axis);
    // Add a small additional rotation around that axis so circles don't all
    // share an alignment seam.
    line.rotateOnAxis(axis, Math.random() * Math.PI * 2);
    strings.add(line);
  }
  scene.add(strings);

  // Spherical particle dust for subtle motion noise.
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
    pRadius[i] = 0.85 + Math.random() * 0.55;
    pSpeed[i] = (0.05 + Math.random() * 0.16) * (Math.random() > 0.5 ? 1 : -1);
    pSize[i] = 0.3 + Math.random() * 0.85;
    const u = (Math.random() - 0.5) * 2;
    pY[i] = Math.sign(u) * Math.pow(Math.abs(u), 1.4) * 1.0;
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
    // Pull the camera back when the orb has a tall hero canvas so the
    // sphere fits and looks generous. When the orb is compact (scenario
    // mode) we pull in so it still reads.
    const targetZ = h < 220 ? 3.4 : 3.85;
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

    strings.rotation.y += dt * (0.04 + midS * 0.06);
    strings.rotation.x += dt * 0.014;
    particles.rotation.y += dt * 0.008;

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
      for (const m of stringMaterials) { try { m.dispose(); } catch {} }
      try { pGeo.dispose(); pMat.dispose(); } catch {}
      try { renderer.dispose(); } catch {}
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    },
  };
}

createOrb.HEIGHTS = { meta: 0, scenario: 148 };
