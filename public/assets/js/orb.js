// Jarvis-style audio-reactive composite for the showcase persona phone view.
//
// Composition (from inner to outer):
//   1. Faceted core sphere - subtle noise displacement, additive amber rim.
//   2. Inner ring system - two thin tori on orthogonal axes, counter-rotating.
//   3. Radial FFT bars - 64 thin bars in a ring around the equator, each
//      height driven by one frequency bin. This is the literal "I'm
//      reacting to audio" cue.
//   4. Equatorial particle dust - 360 GPU-instanced quad sprites orbiting
//      in a flat disk, drifting with the audio.
//   5. Outer ambient glow - backside sphere shader for soft halo.
//
// Three.js (~365 KB) is dynamic-imported by the caller so it only loads
// when the showcase flow is entered.

import * as THREE from '../vendor/three.module.js';

const NOISE_GLSL = `
  vec4 permute(vec4 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
  float snoise(vec3 v) {
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod(i, 289.0);
    vec4 p = permute(permute(permute(
              i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }
`;

const CORE_VERTEX = `
  uniform float uTime;
  uniform float uBass;
  uniform float uMid;
  uniform float uHigh;
  uniform float uActivation;

  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying float vDisplacement;

  ${NOISE_GLSL}

  void main() {
    float t = uTime * 0.45;
    float n1 = snoise(position * 1.4 + vec3(0.0, t * 0.6, 0.0));
    float n2 = snoise(position * 3.1 + vec3(t * 1.2, 0.0, 0.0)) * 0.45;
    float displacement = n1 + n2;
    float strength = mix(0.02, 0.055, uActivation) + uMid * 0.025;
    float scale = 1.0 + uBass * 0.10;
    vec3 newPos = position * scale + normal * displacement * strength;
    vDisplacement = displacement;
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPos = modelViewMatrix * vec4(newPos, 1.0);
    vViewDir = normalize(-mvPos.xyz);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const CORE_FRAGMENT = `
  uniform float uActivation;
  uniform float uAmplitude;
  uniform vec3 uBaseColor;
  uniform vec3 uAccentColor;

  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying float vDisplacement;

  void main() {
    float fresnel = 1.0 - max(dot(normalize(vNormal), normalize(vViewDir)), 0.0);
    fresnel = pow(fresnel, 2.3);
    vec3 base = uBaseColor;
    float rimIntensity = mix(0.35, 0.85, uActivation);
    vec3 rim = uAccentColor * fresnel * rimIntensity;
    float crest = smoothstep(0.4, 1.1, vDisplacement);
    vec3 inner = uAccentColor * crest * 0.08 * (0.4 + uActivation);
    vec3 color = base + rim + inner + uAccentColor * uAmplitude * 0.05;
    float alpha = 0.86 + fresnel * 0.14;
    gl_FragColor = vec4(color, alpha);
  }
`;

const RING_VERTEX = `
  uniform float uTime;
  uniform float uPhase;
  uniform float uSpeed;
  uniform float uActivation;
  varying vec2 vUv;
  varying float vAngle;
  void main() {
    vUv = uv;
    float angle = uTime * uSpeed + uPhase;
    float c = cos(angle);
    float s = sin(angle);
    vec3 p = position;
    // Rotate around Y, then a small wobble around X driven by activation.
    mat3 ry = mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c);
    float wob = sin(uTime * 0.8 + uPhase) * 0.07 * (0.6 + uActivation);
    mat3 rx = mat3(1.0, 0.0, 0.0, 0.0, cos(wob), -sin(wob), 0.0, sin(wob), cos(wob));
    p = rx * ry * p;
    vAngle = atan(p.z, p.x);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const RING_FRAGMENT = `
  uniform vec3 uAccentColor;
  uniform float uActivation;
  uniform float uAmplitude;
  uniform float uTime;
  uniform float uPhase;
  varying vec2 vUv;
  varying float vAngle;
  void main() {
    float sweep = sin(vAngle * 2.0 + uTime * 1.4 + uPhase) * 0.5 + 0.5;
    sweep = pow(sweep, 5.0);
    float tube = smoothstep(0.0, 0.45, vUv.y) * smoothstep(1.0, 0.55, vUv.y);
    float base = 0.3 + uActivation * 0.4;
    float bright = base + sweep * (0.5 + uAmplitude * 0.6);
    vec3 color = uAccentColor * bright;
    float alpha = tube * (0.35 + uActivation * 0.25);
    gl_FragColor = vec4(color, alpha);
  }
`;

const BAR_VERTEX = `
  uniform float uTime;
  uniform float uActivation;
  uniform float uBass;
  attribute float aAngle;
  attribute float aBin;
  varying float vT;
  varying float vAngle;

  void main() {
    vAngle = aAngle;
    float xLocal = position.x;
    float yLocal = position.y;
    vT = yLocal;
    float c = cos(aAngle);
    float s = sin(aAngle);
    float radius = 1.34 + uBass * 0.04;
    float height = aBin * (0.16 + uActivation * 0.40) + 0.02;
    // Anchor on the equator ring, narrow tangential width, upright bar
    // symmetric around y=0 so it grows both up and down with audio.
    vec3 base = vec3(c * radius - s * xLocal, 0.0, s * radius + c * xLocal);
    float vert = (yLocal - 0.5) * height;
    vec3 p = base + vec3(0.0, vert, 0.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const BAR_FRAGMENT = `
  uniform vec3 uAccentColor;
  uniform float uActivation;
  varying float vT;
  varying float vAngle;
  void main() {
    float edge = smoothstep(0.0, 0.22, vT) * smoothstep(1.0, 0.78, vT);
    float intensity = 0.75 + edge * 0.55;
    float alpha = 0.55 * (0.4 + uActivation * 0.6) * (0.45 + edge * 0.55);
    gl_FragColor = vec4(uAccentColor * intensity, alpha);
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
    float y = aY + sin(uTime * 0.45 + aAngle * 4.7) * 0.06;
    vec3 p = vec3(cos(a) * r, y, sin(a) * r);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    // Small, dust-sized points. The 300/-z scale used previously made each
    // point ~30-130 pixels which read as bright blobs.
    gl_PointSize = aSize * uPixelRatio * (0.7 + uActivation * 0.45) * (14.0 / -mv.z);
    vAlpha = 0.22 + uActivation * 0.35;
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

const AMBIENT_VERTEX = `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const AMBIENT_FRAGMENT = `
  uniform float uActivation;
  uniform vec3 uAccentColor;
  varying vec3 vNormal;
  void main() {
    float d = pow(max(0.0, 1.0 + vNormal.z), 2.4);
    float a = (0.025 + uActivation * 0.055) * d;
    gl_FragColor = vec4(uAccentColor, a);
  }
`;

const HEIGHTS = {
  meta: 340,
  scenario: 148,
};

const BAR_COUNT = 56;
const PARTICLE_COUNT = 180;

export function createOrb({ container, getAnalyser }) {
  if (!container) throw new Error('orb_container_required');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  // Slight elevation gives the equatorial bar ring a 3/4 ellipse instead of
  // flattening it to a horizontal line. Pulled back so taller bars + rings
  // sit comfortably inside the frustum.
  camera.position.set(0, 0.55, 4.6);
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
    uBaseColor: { value: new THREE.Color(0x07080d) },
    uAccentColor: { value: new THREE.Color(0xf5a524) },
  };

  // 1. Core sphere.
  const coreGeo = new THREE.IcosahedronGeometry(1, 4);
  const coreMat = new THREE.ShaderMaterial({
    vertexShader: CORE_VERTEX,
    fragmentShader: CORE_FRAGMENT,
    uniforms: shared,
    transparent: true,
  });
  const core = new THREE.Mesh(coreGeo, coreMat);
  scene.add(core);

  // 2. Two crossed rings.
  function makeRing(majorR, minorR, phase, speed) {
    const geo = new THREE.TorusGeometry(majorR, minorR, 24, 220);
    const mat = new THREE.ShaderMaterial({
      vertexShader: RING_VERTEX,
      fragmentShader: RING_FRAGMENT,
      uniforms: {
        uTime: shared.uTime,
        uActivation: shared.uActivation,
        uAmplitude: shared.uAmplitude,
        uAccentColor: shared.uAccentColor,
        uPhase: { value: phase },
        uSpeed: { value: speed },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geo, mat);
    return { mesh, geo, mat };
  }
  const ringA = makeRing(1.18, 0.010, 0.0, 0.16);
  const ringB = makeRing(1.08, 0.008, Math.PI / 3, -0.24);
  // Tilt for crossed orientations that read well from the elevated camera.
  ringA.mesh.rotation.x = Math.PI / 2; // horizontal equator-aligned ring
  ringB.mesh.rotation.x = Math.PI / 2.7; // tilted partner ring
  ringB.mesh.rotation.z = Math.PI / 5;
  scene.add(ringA.mesh);
  scene.add(ringB.mesh);

  // 3. Equator FFT bars (instanced via attributes, one bar per bin).
  // Each instance is a thin upright billboard placed on the equator ring;
  // the vertex shader positions it by angle and extrudes its length by the
  // bar's frequency bin amplitude.
  const barTemplate = new THREE.PlaneGeometry(0.05, 1, 1, 1);
  // Re-anchor so y in [0,1] not [-0.5, 0.5].
  barTemplate.translate(0, 0.5, 0);
  const barGeo = new THREE.InstancedBufferGeometry();
  barGeo.index = barTemplate.index;
  barGeo.attributes.position = barTemplate.attributes.position;
  barGeo.attributes.uv = barTemplate.attributes.uv;
  barGeo.attributes.normal = barTemplate.attributes.normal;
  const angles = new Float32Array(BAR_COUNT);
  const bins = new Float32Array(BAR_COUNT);
  for (let i = 0; i < BAR_COUNT; i++) {
    angles[i] = (i / BAR_COUNT) * Math.PI * 2;
    bins[i] = 0;
  }
  barGeo.setAttribute('aAngle', new THREE.InstancedBufferAttribute(angles, 1));
  const binAttr = new THREE.InstancedBufferAttribute(bins, 1);
  binAttr.setUsage(THREE.DynamicDrawUsage);
  barGeo.setAttribute('aBin', binAttr);
  barGeo.instanceCount = BAR_COUNT;
  const barMat = new THREE.ShaderMaterial({
    vertexShader: BAR_VERTEX,
    fragmentShader: BAR_FRAGMENT,
    uniforms: {
      uTime: shared.uTime,
      uActivation: shared.uActivation,
      uBass: shared.uBass,
      uAccentColor: shared.uAccentColor,
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
  });
  const bars = new THREE.Mesh(barGeo, barMat);
  scene.add(bars);

  // 4. Sparse spherical particle cloud (avoid an equator-stripe pile-up).
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
    pRadius[i] = 1.45 + Math.random() * 0.9;
    pSpeed[i] = (0.04 + Math.random() * 0.14) * (Math.random() > 0.5 ? 1 : -1);
    pSize[i] = 0.4 + Math.random() * 1.0;
    // Spread vertically over ±0.9, biased toward the equator with a cubic so
    // there is still a hint of disk concentration without flat stripe stacking.
    const u = (Math.random() - 0.5) * 2;
    pY[i] = Math.sign(u) * Math.pow(Math.abs(u), 1.6) * 1.0;
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

  // 5. Ambient backside glow.
  const ambient = new THREE.Mesh(
    new THREE.SphereGeometry(2.2, 32, 32),
    new THREE.ShaderMaterial({
      vertexShader: AMBIENT_VERTEX,
      fragmentShader: AMBIENT_FRAGMENT,
      uniforms: {
        uActivation: shared.uActivation,
        uAccentColor: shared.uAccentColor,
      },
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
    })
  );
  scene.add(ambient);

  let activationTarget = 0;
  let bassS = 0, midS = 0, highS = 0;
  let amplitude = 0;
  let mode = 'meta';
  let disposed = false;
  let lastT = performance.now();

  // Smoothed per-bar amplitudes for the radial FFT.
  const barValues = new Float32Array(BAR_COUNT);
  const freqBuf = new Uint8Array(256);

  function resize() {
    const rect = container.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // Tighten the camera when the orb-zone is short so the orb still fills it.
    const targetZ = h < 220 ? 3.5 : 4.0;
    camera.position.z += (targetZ - camera.position.z) * 0.5;
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
    let bins = 0;
    if (analyser && analyser.getByteFrequencyData) {
      bins = Math.min(freqBuf.length, analyser.frequencyBinCount);
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

      // Map FFT bins onto BAR_COUNT bars, taking the max of the bins
      // assigned to each bar (gives crisper peaks than averaging).
      const usableBins = Math.max(1, bins - 2);
      const step = usableBins / BAR_COUNT;
      for (let i = 0; i < BAR_COUNT; i++) {
        const start = Math.floor(i * step);
        const end = Math.min(bins, Math.floor((i + 1) * step) + 1);
        let peak = 0;
        for (let j = start; j < end; j++) {
          const v = view[j] / 255;
          if (v > peak) peak = v;
        }
        const target = peak;
        // Attack fast, release slow for that VU-meter feel.
        const eased = target > barValues[i]
          ? 1 - Math.exp(-dt * 24)
          : 1 - Math.exp(-dt * 6);
        barValues[i] += (target - barValues[i]) * eased;
        bins_array_set(binAttr.array, i, barValues[i]);
      }
      binAttr.needsUpdate = true;
    } else {
      // Idle gentle drift in bars so they're never dead-flat.
      for (let i = 0; i < BAR_COUNT; i++) {
        const idle = (Math.sin((now / 1000) * 0.7 + i * 0.4) * 0.5 + 0.5) * 0.05;
        const target = idle * 0.4;
        const eased = 1 - Math.exp(-dt * 4);
        barValues[i] += (target - barValues[i]) * eased;
        bins_array_set(binAttr.array, i, barValues[i]);
      }
      binAttr.needsUpdate = true;
    }

    const easeIn = 1 - Math.exp(-dt * 12);
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

    core.rotation.y += dt * (0.08 + midS * 0.06);
    core.rotation.x += dt * 0.03;
    particles.rotation.y += dt * 0.012;

    renderer.render(scene, camera);
  }
  requestAnimationFrame(tick);

  function bins_array_set(arr, i, v) { arr[i] = v; }

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
      try { coreGeo.dispose(); } catch {}
      try { coreMat.dispose(); } catch {}
      try { ringA.geo.dispose(); ringA.mat.dispose(); } catch {}
      try { ringB.geo.dispose(); ringB.mat.dispose(); } catch {}
      try { barGeo.dispose(); barMat.dispose(); } catch {}
      try { barTemplate.dispose(); } catch {}
      try { pGeo.dispose(); pMat.dispose(); } catch {}
      try { ambient.geometry.dispose(); ambient.material.dispose(); } catch {}
      try { renderer.dispose(); } catch {}
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    },
  };
}

createOrb.HEIGHTS = HEIGHTS;
