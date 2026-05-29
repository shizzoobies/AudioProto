// "The Living Voice" — a hand-written WebGL1 fragment-shader voice field for
// the demo landing hero. No Three.js, no libraries, no CDN: the shader is an
// inline GLSL string compiled by the browser at runtime (not blocked by the
// strict `script-src 'self'` CSP), driven by plain WebGL1 calls.
//
// Renders one fullscreen triangle through a fragment shader that paints a
// luminous, organically breathing voice orb over the light page: a soft radial
// core glow, 2-3 concentric "breath" rings expanding on a sine of time, and
// hand-rolled domain-warped value noise so the field shimmers like an open
// line. Maroon brand accent (#8c1d2b) warming toward a terracotta/gold core.
//
// Bulletproof-by-design: the caller paints a CSS poster instantly behind the
// canvas; this module fades the canvas in only once the context + shader are
// known-good. Any failure (no WebGL, compile error, reduced-motion) throws or
// returns null so the caller silently keeps the poster. The rAF loop pauses on
// `document.hidden`, caps devicePixelRatio at 2, and is fully cancelled on
// dispose() so nothing runs during the call.

const VERTEX_SRC = `
  attribute vec2 a_pos;
  void main() {
    gl_Position = vec4(a_pos, 0.0, 1.0);
  }
`;

// Fragment shader: the whole orb lives here.
//   - u_time       : seconds, drives breathing + flow
//   - u_resolution : canvas pixel size (for aspect-correct UVs)
//   - u_pointer    : normalized cursor (-1..1), gentle glow nudge
const FRAGMENT_SRC = `
  precision highp float;

  uniform float u_time;
  uniform vec2  u_resolution;
  uniform vec2  u_pointer;

  // Brand palette.
  const vec3 MAROON    = vec3(0.549, 0.114, 0.169); // #8c1d2b
  const vec3 TERRACOTTA = vec3(0.871, 0.451, 0.318); // warm mid
  const vec3 GOLD      = vec3(1.000, 0.851, 0.612); // soft gold core

  // Cheap hash + value noise (hand-rolled, no textures).
  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  // Fractal value noise (2 octaves is plenty + cheap).
  float fbm(vec2 p) {
    float v = 0.0;
    float amp = 0.55;
    for (int i = 0; i < 3; i++) {
      v += amp * vnoise(p);
      p *= 2.02;
      amp *= 0.5;
    }
    return v;
  }

  void main() {
    // Aspect-correct, origin-centered coordinates. The field is square in the
    // shorter dimension so the orb never stretches.
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / min(u_resolution.x, u_resolution.y);

    // Gentle cursor influence: shift the field center a touch toward the
    // pointer. Kept faint — bulletproof, not all-out.
    vec2 center = u_pointer * 0.06;
    vec2 p = uv - center;

    float t = u_time;

    // --- Domain warp: flow the sampling coordinates with slow noise so the
    // whole field breathes and drifts like live voice energy (never static).
    vec2 warp = vec2(
      fbm(p * 2.2 + vec2(0.0, t * 0.10)),
      fbm(p * 2.2 + vec2(5.2, t * 0.12 + 1.7))
    );
    vec2 fp = p + (warp - 0.5) * 0.28;

    float dist = length(fp);

    // --- Core glow: smooth premium falloff that melts into the light page,
    // with a subtle global breath so the whole orb inhales/exhales.
    float breath = 0.5 + 0.5 * sin(t * 0.62);          // 0..1 slow
    float coreR = 0.30 + 0.022 * breath;                // resting radius
    float core = smoothstep(coreR + 0.34, 0.02, dist);  // soft wide falloff
    core = pow(core, 1.45);

    // Hot center bloom for the gold heart.
    float heart = smoothstep(0.20, 0.0, dist);
    heart = pow(heart, 1.8) * (0.85 + 0.15 * breath);

    // --- Breath rings: 3 concentric rings expanding outward on sines of time,
    // the "open line" pulse. Each ring is a thin gaussian band.
    float rings = 0.0;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float phase = t * 0.42 + fi * 2.094;             // staggered ~120deg
      float radius = 0.20 + 0.16 * fi + 0.05 * sin(phase);
      float band = exp(-pow((dist - radius) * 11.0, 2.0));
      // Rings fade as they travel outward and shimmer with the noise field.
      float falloff = smoothstep(0.85, 0.10, dist);
      rings += band * falloff * (0.16 - fi * 0.035);
    }

    // Flowing shimmer texture over the core.
    float flow = fbm(fp * 3.4 + vec2(t * 0.18, -t * 0.14));
    float shimmer = (0.82 + 0.18 * flow);

    // --- Compose color. Gold heart -> terracotta mid -> maroon rim, all
    // additive over the light page (the caller darkens behind the orb only).
    float radial = clamp(dist / 0.62, 0.0, 1.0);
    vec3 col = mix(GOLD, TERRACOTTA, smoothstep(0.0, 0.55, radial));
    col = mix(col, MAROON, smoothstep(0.40, 1.0, radial));

    float intensity = core * shimmer + heart * 1.1 + rings;
    intensity *= 0.92 + 0.08 * breath;

    // Premultiplied-style additive output; alpha follows intensity so the orb
    // blends seamlessly into the page rather than sitting on a hard disc.
    float alpha = clamp(intensity, 0.0, 1.0);
    gl_FragColor = vec4(col * intensity, alpha);
  }
`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('demo_orb_shader_compile: ' + log);
  }
  return sh;
}

// createDemoOrb({ canvas }) -> { dispose() } | null
// Returns null on any unrecoverable condition so the caller keeps the poster.
// Throwing is also caught by the caller's try/catch — both paths are safe.
export function createDemoOrb({ canvas }) {
  if (!canvas) return null;

  // Honor reduced-motion: never start the loop, keep the static poster.
  const reduce =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return null;

  let gl = null;
  try {
    const opts = { alpha: true, antialias: true, premultipliedAlpha: true, depth: false, stencil: false };
    gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
  } catch {
    gl = null;
  }
  if (!gl) return null;

  let program = null;
  let buffer = null;
  try {
    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SRC);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC);
    program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    // Shaders are linked into the program; safe to delete the standalone objects.
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error('demo_orb_link: ' + gl.getProgramInfoLog(program));
    }
  } catch {
    // Compile/link failed — clean up and let the caller keep the poster.
    try { if (program) gl.deleteProgram(program); } catch {}
    return null;
  }

  // One fullscreen triangle (covers clip space with a single primitive).
  buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

  const aPos = gl.getAttribLocation(program, 'a_pos');
  const uTime = gl.getUniformLocation(program, 'u_time');
  const uRes = gl.getUniformLocation(program, 'u_resolution');
  const uPointer = gl.getUniformLocation(program, 'u_pointer');

  gl.useProgram(program);
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  // Additive blending so the glow melts into the light page.
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);

  let disposed = false;
  let rafId = 0;
  let startT = performance.now();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  // Gentle, smoothed pointer (target vs eased current).
  const pointer = { tx: 0, ty: 0, x: 0, y: 0 };

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  resize();

  let resizeObserver = null;
  try {
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
  } catch {
    window.addEventListener('resize', resize);
  }

  function onPointerMove(e) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    // Normalize to -1..1 around the canvas center.
    pointer.tx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.ty = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
  }
  window.addEventListener('pointermove', onPointerMove, { passive: true });

  function render(now) {
    if (disposed) return;
    // Pause cleanly when the tab is hidden — resume on next frame request.
    if (document.hidden) {
      rafId = requestAnimationFrame(render);
      return;
    }
    const t = (now - startT) / 1000;
    // Ease the pointer toward its target for a soft, non-jittery follow.
    pointer.x += (pointer.tx - pointer.x) * 0.06;
    pointer.y += (pointer.ty - pointer.y) * 0.06;

    gl.uniform1f(uTime, t);
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform2f(uPointer, pointer.x, pointer.y);

    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    rafId = requestAnimationFrame(render);
  }

  // Resume timing correctly after a hidden stretch (avoid a time jump).
  function onVisibility() {
    if (!document.hidden) {
      startT = performance.now() - (performance.now() - startT);
    }
  }
  document.addEventListener('visibilitychange', onVisibility);

  // First frame: reveal the canvas only once we've actually drawn, so the
  // poster is never replaced by an empty buffer.
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.uniform1f(uTime, 0);
  gl.uniform2f(uRes, canvas.width, canvas.height);
  gl.uniform2f(uPointer, 0, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  canvas.classList.add('is-live');

  rafId = requestAnimationFrame(render);

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      try { if (resizeObserver) resizeObserver.disconnect(); } catch {}
      try { window.removeEventListener('resize', resize); } catch {}
      try { window.removeEventListener('pointermove', onPointerMove); } catch {}
      try { document.removeEventListener('visibilitychange', onVisibility); } catch {}
      try { gl.deleteBuffer(buffer); } catch {}
      try { gl.deleteProgram(program); } catch {}
      try {
        const lose = gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
      } catch {}
    },
  };
}
