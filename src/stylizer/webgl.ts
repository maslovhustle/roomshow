// The visual engine.
//
// One fragment shader does the whole chain, driven entirely by uniforms, so a
// look change is a uniform update — no recompile, no hitch mid-set. Frame
// feedback needs the previous output as an input, hence the ping-pong pair of
// framebuffers: render into `write` while sampling `read`, then swap and blit.
//
// WebGL1 on purpose: it runs on the ancient laptop that is inevitably plugged
// into the projector.

import type { Params, ScalarParam, Stylizer } from '../types';

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG_MAIN = `
precision highp float;
varying vec2 vUv;

uniform sampler2D uSrc;
uniform sampler2D uPrev;
uniform vec2  uRes;
uniform vec2  uCover;
uniform float uTime;

uniform float pMirror;
uniform float pKaleido;
uniform float pPixel;
uniform float pChroma;
uniform float pEdge;
uniform float pPoster;
uniform float pHue;
uniform float pDuotone;
uniform float pFeedback;
uniform float pWarp;
uniform float pSpin;
uniform float pGlow;
uniform float pVignette;
uniform float pInvert;
uniform float pHalftone;
uniform float pScanline;
uniform float pGrain;
uniform float pSlice;
uniform float pSat;
uniform float pContrast;
uniform float pSmooth;
uniform float pDither;
uniform float pThreshold;
uniform float pTemp;
uniform float pGamma;
uniform float pSwirl;
uniform float pEmboss;
uniform float pHalation;
uniform float pAscii;
uniform float pLed;
uniform float pRipple;
uniform float pPinch;
uniform float pAberration;
uniform float pMotion;
uniform sampler2D uGlyphs;
uniform float uGlyphCount;
uniform sampler2D uMotionPrev;
uniform sampler2D uMotionCurr;
uniform vec3  uTintA;
uniform vec3  uTintB;
uniform vec3  uTintC;
uniform vec3  uTintD;

const float PI = 3.14159265359;

vec3 sampleSrc(vec2 uv) {
  vec2 c = clamp((uv - 0.5) * uCover + 0.5, 0.002, 0.998);
  return texture2D(uSrc, c).rgb;
}

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// Flattens detail into regions before quantisation. Posterising a sharp frame
// straight away turns noise and texture into confetti; blurring first is what
// makes it read as painted areas with clean boundaries, which is the whole
// basis of a cel-shaded look. Edges are still taken from the sharp source, so
// the outlines stay crisp over the flattened colour.
vec3 sampleBase(vec2 uv) {
  if (pSmooth <= 0.001) return sampleSrc(uv);
  vec2 r = pSmooth * 3.5 / uRes;
  vec3 sum = sampleSrc(uv) * 2.0;
  sum += sampleSrc(uv + vec2( r.x, 0.0));
  sum += sampleSrc(uv + vec2(-r.x, 0.0));
  sum += sampleSrc(uv + vec2( 0.0,  r.y));
  sum += sampleSrc(uv + vec2( 0.0, -r.y));
  sum += sampleSrc(uv + r * 0.7);
  sum += sampleSrc(uv - r * 0.7);
  sum += sampleSrc(uv + vec2( r.x, -r.y) * 0.7);
  sum += sampleSrc(uv + vec2(-r.x,  r.y) * 0.7);
  return sum / 10.0;
}

vec2 kaleido(vec2 uv, float amt, float t) {
  if (amt <= 0.001) return uv;
  float seg = mix(2.0, 12.0, amt);
  vec2 p = uv - 0.5;
  float a = atan(p.y, p.x);
  float r = length(p);
  float wedge = PI * 2.0 / seg;
  // The fold collapses the frame into one narrow wedge, so without a moving
  // offset it would sample the same sliver of the source forever. Drifting the
  // fold sweeps that sliver across the whole image.
  a = abs(mod(a + t * 0.13, wedge) - wedge * 0.5) + t * 0.05;
  return vec2(cos(a), sin(a)) * r + 0.5;
}

// Four-stop gradient map. A two-colour ramp can only ever produce a tint; the
// character in a real colour grade lives in the midtones, which is where the
// extra stops go. Looks that only declare two colours get C and D filled in
// along the A->B line, so they render exactly as they did when this was a
// duotone.
vec3 gradientMap(float l) {
  if (l < 0.3333) return mix(uTintA, uTintB, l * 3.0);
  if (l < 0.6666) return mix(uTintB, uTintC, (l - 0.3333) * 3.0);
  return mix(uTintC, uTintD, (l - 0.6666) * 3.0);
}

// Recursive 2x2 -> 8x8 Bayer. GLSL1 has no bit operations and no dynamic array
// indexing, so the usual lookup-table dither is not available; this builds the
// same ordered matrix arithmetically.
float bayer2(vec2 a) {
  a = floor(a);
  return fract(a.x * 0.5 + a.y * a.y * 0.75);
}
float bayer4(vec2 a) { return bayer2(a * 0.5) * 0.25 + bayer2(a); }
float bayer8(vec2 a) { return bayer4(a * 0.5) * 0.25 + bayer2(a); }

vec3 hueRotate(vec3 c, float a) {
  const vec3 k = vec3(0.57735026919);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}

void main() {
  vec2 uv = vUv;
  if (pMirror > 0.5) uv.x = 1.0 - uv.x;

  if (pSlice > 0.001) {
    // Horizontal band displacement. Only a minority of bands move, and they
    // re-roll on a coarse time step — continuous jitter reads as noise, while
    // intermittent tearing reads as a broken signal.
    float bands = mix(6.0, 40.0, pSlice);
    float band = floor(uv.y * bands);
    float r = hash(vec2(band, floor(uTime * 6.0)));
    uv.x += (r - 0.5) * pSlice * 0.25 * step(0.72, r);
  }

  {
    // Pinch and bulge are one control: below the midpoint the frame is drawn
    // toward the centre, above it the centre pushes out.
    float k = (pPinch - 0.5) * 1.8;
    if (k > 0.002 || k < -0.002) {
      vec2 p = uv - 0.5;
      uv = p * pow(clamp(length(p) * 2.0, 0.001, 1.6), k) + 0.5;
    }
  }

  if (pRipple > 0.001) {
    vec2 p = uv - 0.5;
    float r = length(p);
    uv += (p / max(r, 0.0001)) * sin(r * 42.0 - uTime * 3.2) * pRipple * 0.022;
  }

  if (pSwirl > 0.001) {
    // Twist falls off with radius, so the centre of frame stays readable while
    // the edges smear — the opposite way round looks like a broken lens.
    vec2 p = uv - 0.5;
    float r = length(p);
    float a = atan(p.y, p.x) + (0.6 - r) * pSwirl * 4.0;
    uv = vec2(cos(a), sin(a)) * r + 0.5;
  }

  uv = kaleido(uv, pKaleido, uTime);

  if (pPixel > 0.001) {
    float n = max(10.0, mix(uRes.x, 26.0, pPixel));
    vec2 grid = vec2(n, max(6.0, n * uRes.y / uRes.x));
    uv = (floor(uv * grid) + 0.5) / grid;
  }

  // Two kinds of colour fringing in one offset. chroma is a flat sideways shift
  // and reads as a signal fault; aberration grows with distance from centre,
  // which is what a real lens does — the middle of frame stays clean while the
  // corners smear.
  vec2 split = vec2(pChroma * 0.014, 0.0) + (uv - 0.5) * pAberration * 0.05;
  vec3 col = vec3(
    sampleBase(uv + split).r,
    sampleBase(uv).g,
    sampleBase(uv - split).b
  );

  if (pMotion > 0.001) {
    // Difference against the previous source frame, not the previous output —
    // the output already carries trails and vignettes, so differencing it would
    // detect the effects rather than the room.
    vec2 c = clamp((uv - 0.5) * uCover + 0.5, 0.002, 0.998);
    float now = luma(texture2D(uMotionCurr, c).rgb);
    float was = luma(texture2D(uMotionPrev, c).rgb);
    float moved = clamp(abs(now - was) * mix(5.0, 18.0, pMotion), 0.0, 1.0);
    col = mix(col, col * moved, pMotion);
  }

  if (pEdge > 0.001) {
    vec2 t = 1.0 / uRes;
    float tl = luma(sampleSrc(uv + vec2(-t.x,  t.y)));
    float tc = luma(sampleSrc(uv + vec2( 0.0,  t.y)));
    float tr = luma(sampleSrc(uv + vec2( t.x,  t.y)));
    float ml = luma(sampleSrc(uv + vec2(-t.x,  0.0)));
    float mr = luma(sampleSrc(uv + vec2( t.x,  0.0)));
    float bl = luma(sampleSrc(uv + vec2(-t.x, -t.y)));
    float bc = luma(sampleSrc(uv + vec2( 0.0, -t.y)));
    float br = luma(sampleSrc(uv + vec2( t.x, -t.y)));
    float gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
    float gy = (tl + 2.0 * tc + tr) - (bl + 2.0 * bc + br);
    float mag = clamp(length(vec2(gx, gy)) * 1.6, 0.0, 1.0);
    // Add edges on top of a darkened base rather than replacing colour with
    // them: a full replace flattens smooth footage to grey and kills the look.
    col = mix(col, col * 0.28 + vec3(mag), pEdge);
  }

  col = mix(col, 1.0 - col, pInvert);

  // Both neutral at 0.5, so a look that says nothing about them gets no change.
  col = mix(vec3(luma(col)), col, pSat * 2.0);
  col = clamp((col - 0.5) * pow(4.0, (pContrast - 0.5) * 2.0) + 0.5, 0.0, 1.0);

  if (pPoster > 0.001) {
    float levels = max(2.0, mix(48.0, 3.0, pPoster));
    col = floor(col * levels + 0.5) / levels;
  }

  if (pHue > 0.001) {
    col = hueRotate(col, uTime * pHue * 1.4);
  }

  if (pEmboss > 0.001) {
    vec2 t = 1.5 / uRes;
    float relief = luma(sampleSrc(uv - t)) - luma(sampleSrc(uv + t));
    col = mix(col, vec3(0.5 + relief * 2.2), pEmboss);
  }

  if (pTemp > 0.499 || pTemp < 0.499) {
    float k = (pTemp - 0.5) * 0.5;
    col.r = clamp(col.r + k, 0.0, 1.0);
    col.b = clamp(col.b - k, 0.0, 1.0);
  }

  col = pow(clamp(col, 0.0, 1.0), vec3(pow(4.0, (0.5 - pGamma) * 2.0)));

  if (pThreshold > 0.001) {
    float cut = smoothstep(0.5 - 0.5 / max(1.0, pThreshold * 40.0), 0.5, luma(col));
    col = mix(col, vec3(cut), pThreshold);
  }

  if (pDuotone > 0.001) {
    col = mix(col, gradientMap(smoothstep(0.03, 0.95, luma(col))), pDuotone);
  }

  if (pDither > 0.001) {
    float levels = max(2.0, mix(16.0, 2.0, pDither));
    float b = bayer8(gl_FragCoord.xy) - 0.5;
    col = floor(col * levels + b + 0.5) / levels;
  }

  if (pLed > 0.001) {
    // Square grid with dark gutters, radius driven by cell brightness. Distinct
    // from halftone, which is a rotated screen with no gaps.
    float cells = mix(220.0, 44.0, pLed);
    vec2 grid = vec2(cells, max(8.0, floor(cells * uRes.y / uRes.x)));
    vec3 cell = sampleBase((floor(vUv * grid) + 0.5) / grid);
    float d = length(fract(vUv * grid) - 0.5);
    col = mix(col, cell * smoothstep(0.46, 0.30, d) * 1.3, pLed);
  }

  if (pAscii > 0.001) {
    // One glyph per cell, chosen by the cell's mean brightness from a ramp that
    // runs from sparse to dense. Character cells are taller than wide, so the
    // vertical count is scaled to keep the type from stretching.
    float cells = mix(190.0, 46.0, pAscii);
    vec2 grid = vec2(cells, max(6.0, floor(cells * uRes.y / uRes.x * 0.52)));
    vec2 cellId = floor(vUv * grid);
    vec2 cellUv = fract(vUv * grid);
    vec3 cell = sampleBase((cellId + 0.5) / grid);
    float idx = floor(luma(cell) * (uGlyphCount - 0.001));
    float glyph = texture2D(uGlyphs, vec2((idx + cellUv.x) / uGlyphCount, 1.0 - cellUv.y)).r;
    col = mix(col, cell * glyph, pAscii);
  }

  if (pHalation > 0.001) {
    // Bleed only what is already bright, warm it, and add it back. Real
    // halation is light scattering in the film base, so it must not touch the
    // shadows or the whole frame just goes milky.
    vec2 r = 4.0 / uRes;
    vec3 glow = vec3(0.0);
    glow += sampleBase(uv + vec2( r.x,  0.0));
    glow += sampleBase(uv + vec2(-r.x,  0.0));
    glow += sampleBase(uv + vec2( 0.0,  r.y));
    glow += sampleBase(uv + vec2( 0.0, -r.y));
    glow += sampleBase(uv + r * 1.6);
    glow += sampleBase(uv - r * 1.6);
    glow /= 6.0;
    float lift = smoothstep(0.55, 1.0, luma(glow));
    col += glow * vec3(1.0, 0.72, 0.55) * lift * pHalation * 1.4;
  }

  if (pHalftone > 0.001) {
    float scale = mix(180.0, 45.0, pHalftone);
    vec2 g = vUv * vec2(scale, scale * uRes.y / uRes.x);
    float a = 0.785398;
    vec2 rot = mat2(cos(a), sin(a), -sin(a), cos(a)) * g;
    float d = length(fract(rot) - 0.5);
    float radius = sqrt(luma(col)) * 0.62;
    col = mix(col, col * smoothstep(radius, radius - 0.09, d), pHalftone);
  }

  if (pScanline > 0.001) {
    float s = 0.5 + 0.5 * sin(vUv.y * uRes.y * 1.7 + uTime * 3.0);
    col *= mix(1.0, 0.4 + 0.6 * s, pScanline);
  }

  if (pFeedback > 0.001) {
    // Zoom and rotate the previous frame before mixing it back: static feedback
    // just smears, moving feedback is what reads as motion.
    vec2 f = vUv - 0.5;
    float ang = pSpin * 0.035;
    float zoom = 1.0 - pWarp * 0.035;
    f = mat2(cos(ang), sin(ang), -sin(ang), cos(ang)) * f / max(0.5, zoom);
    vec3 prev = texture2D(uPrev, clamp(f + 0.5, 0.0, 1.0)).rgb;
    vec3 trail = prev * mix(0.80, 0.965, pFeedback);
    col = mix(col, max(col, trail), pFeedback);
  }

  if (pGrain > 0.001) {
    col += (hash(vUv * uRes + fract(uTime) * 91.7) - 0.5) * pGrain * 0.5;
  }

  if (pGlow > 0.001) {
    col += col * col * pGlow * 0.75;
  }

  if (pVignette > 0.001) {
    float v = smoothstep(1.15, 0.30, length(vUv - 0.5) * 1.55);
    col *= mix(1.0, v, pVignette);
  }

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

// Bloom runs as its own chain at half resolution: extract what is bright,
// blur it separably, screen it back over the scene. The single-pass `glow`
// boost cannot do this — it can only brighten a pixel using itself, so light
// never spreads into its neighbours, which is the entire point of a bloom.
const FRAG_BRIGHT = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform float uThreshold;
void main() {
  vec3 c = texture2D(uTex, vUv).rgb;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  gl_FragColor = vec4(c * smoothstep(uThreshold, uThreshold + 0.25, l), 1.0);
}`;

// Nine-tap gaussian collapsed to five texture reads by sampling between texels
// and letting bilinear filtering average each pair.
const FRAG_BLUR = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uDir;
void main() {
  vec3 sum = texture2D(uTex, vUv).rgb * 0.227027;
  sum += (texture2D(uTex, vUv + uDir * 1.3846).rgb
        + texture2D(uTex, vUv - uDir * 1.3846).rgb) * 0.3162162;
  sum += (texture2D(uTex, vUv + uDir * 3.2308).rgb
        + texture2D(uTex, vUv - uDir * 3.2308).rgb) * 0.0702702;
  gl_FragColor = vec4(sum, 1.0);
}`;

const FRAG_COMPOSITE = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uAmount;
uniform float uStreak;
void main() {
  vec3 scene = texture2D(uScene, vUv).rgb;
  if (uAmount < 0.001) { gl_FragColor = vec4(scene, 1.0); return; }
  vec3 glow = texture2D(uBloom, vUv).rgb * uAmount * 1.6;
  // Anamorphic flares are blue because the cylindrical element disperses short
  // wavelengths hardest. Tinting only the streak keeps a plain bloom neutral.
  glow = mix(glow, glow * vec3(0.45, 0.68, 1.0) * 1.5, uStreak);
  // Screen rather than add: bloom should lift the highlights, not clip them
  // into flat white.
  gl_FragColor = vec4(1.0 - (1.0 - scene) * (1.0 - clamp(glow, 0.0, 1.0)), 1.0);
}`;

/** Straight blit, used to snapshot the source frame for motion differencing. */
const FRAG_COPY = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
void main() { gl_FragColor = texture2D(uTex, vUv); }`;

const SCALAR_PARAMS = [
  'mirror', 'kaleido', 'pixel', 'chroma', 'edge', 'poster',
  'hue', 'duotone', 'feedback', 'warp', 'spin', 'glow', 'vignette',
  'invert', 'halftone', 'scanline', 'grain', 'slice', 'sat', 'contrast', 'smooth',
  'dither', 'threshold', 'temp', 'gamma', 'swirl', 'emboss', 'halation',
  'ascii', 'led', 'ripple', 'pinch', 'aberration', 'motion',
] as const satisfies readonly ScalarParam[];

// Ramp from sparse to dense. Rendered into a strip once at startup and sampled
// per cell, which is cheaper and sharper than any analytic glyph.
const ASCII_RAMP = ' .:-=+*#%@';

const TINTS = ['tintA', 'tintB', 'tintC', 'tintD'] as const;

type UniformName =
  | 'uSrc' | 'uPrev' | 'uRes' | 'uCover' | 'uTime' | 'uGlyphs' | 'uGlyphCount'
  | 'uMotionPrev' | 'uMotionCurr'
  | `u${Capitalize<(typeof TINTS)[number]>}`
  | `p${Capitalize<(typeof SCALAR_PARAMS)[number]>}`;

interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
}

export class WebGLStylizer implements Stylizer {
  private gl: WebGLRenderingContext | null = null;
  private progMain!: WebGLProgram;
  private progBright!: WebGLProgram;
  private progBlur!: WebGLProgram;
  private progComposite!: WebGLProgram;
  private progCopy!: WebGLProgram;
  private copyUniform: WebGLUniformLocation | null = null;
  private motion: Target[] = [];
  private motionSize = { w: 2, h: 2 };
  private motionIndex = 0;
  private quad!: WebGLBuffer;
  private srcTex!: WebGLTexture;
  private glyphTex!: WebGLTexture;
  private uniforms!: Record<UniformName, WebGLUniformLocation | null>;
  private uBright!: { tex: WebGLUniformLocation | null; threshold: WebGLUniformLocation | null };
  private uBlur!: { tex: WebGLUniformLocation | null; dir: WebGLUniformLocation | null };
  private uComp!: {
    scene: WebGLUniformLocation | null;
    bloom: WebGLUniformLocation | null;
    amount: WebGLUniformLocation | null;
    streak: WebGLUniformLocation | null;
  };
  private targets: Target[] = [];
  private bloom: Target[] = [];
  private bloomSize = { w: 2, h: 2 };
  private index = 0;
  private source: TexImageSource | null = null;
  private sourceSize = { w: 1, h: 1 };
  private ready = false;

  constructor(private canvas: HTMLCanvasElement) {}

  init(): void {
    const options: WebGLContextAttributes = {
      alpha: false,
      antialias: false,
      depth: false,
      preserveDrawingBuffer: true,
    };
    const gl = (this.canvas.getContext('webgl', options)
      ?? this.canvas.getContext('experimental-webgl', options)) as WebGLRenderingContext | null;
    if (!gl) throw new Error('WebGL is not available in this browser');
    this.gl = gl;

    this.progMain = buildProgram(gl, VERT, FRAG_MAIN);
    this.progBright = buildProgram(gl, VERT, FRAG_BRIGHT);
    this.progBlur = buildProgram(gl, VERT, FRAG_BLUR);
    this.progComposite = buildProgram(gl, VERT, FRAG_COMPOSITE);
    this.progCopy = buildProgram(gl, VERT, FRAG_COPY);

    const quad = gl.createBuffer();
    if (!quad) throw new Error('Could not allocate a vertex buffer');
    this.quad = quad;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    this.srcTex = createTexture(gl);
    this.glyphTex = createTexture(gl);
    gl.bindTexture(gl.TEXTURE_2D, this.glyphTex);
    // The atlas is drawn top-down by canvas 2D and sampled with an explicit
    // flip in the shader, so it must not be flipped again on upload.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, buildGlyphAtlas());

    this.uniforms = collectUniforms(gl, this.progMain);
    this.uBright = {
      tex: gl.getUniformLocation(this.progBright, 'uTex'),
      threshold: gl.getUniformLocation(this.progBright, 'uThreshold'),
    };
    this.uBlur = {
      tex: gl.getUniformLocation(this.progBlur, 'uTex'),
      dir: gl.getUniformLocation(this.progBlur, 'uDir'),
    };
    this.uComp = {
      scene: gl.getUniformLocation(this.progComposite, 'uScene'),
      bloom: gl.getUniformLocation(this.progComposite, 'uBloom'),
      amount: gl.getUniformLocation(this.progComposite, 'uAmount'),
      streak: gl.getUniformLocation(this.progComposite, 'uStreak'),
    };
    this.copyUniform = gl.getUniformLocation(this.progCopy, 'uTex');

    this.resize(this.canvas.width, this.canvas.height);
    this.ready = true;
  }

  /** Accepts anything texImage2D takes: a <video>, a <canvas>, an ImageBitmap. */
  setSource(source: TexImageSource, width: number, height: number): void {
    this.source = source;
    this.sourceSize = { w: Math.max(1, width), h: Math.max(1, height) };
  }

  resize(width: number, height: number): void {
    const gl = this.gl;
    if (!gl) return;
    const w = Math.max(2, Math.floor(width));
    const h = Math.max(2, Math.floor(height));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    for (const target of [...this.targets, ...this.bloom, ...this.motion]) {
      gl.deleteFramebuffer(target.fbo);
      gl.deleteTexture(target.tex);
    }
    this.targets = [createTarget(gl, w, h), createTarget(gl, w, h)];
    // Quarter resolution for motion. Differencing full-res frames mostly
    // detects sensor noise; downsampling first is the cheapest low-pass there
    // is, and motion is a broad signal anyway.
    this.motionSize = { w: Math.max(2, w >> 2), h: Math.max(2, h >> 2) };
    this.motion = [
      createTarget(gl, this.motionSize.w, this.motionSize.h),
      createTarget(gl, this.motionSize.w, this.motionSize.h),
    ];
    // Half resolution: a bloom is a wide blur, so the detail thrown away here is
    // detail the blur would have destroyed anyway, and it quarters the cost.
    this.bloomSize = { w: Math.max(2, w >> 1), h: Math.max(2, h >> 1) };
    this.bloom = [
      createTarget(gl, this.bloomSize.w, this.bloomSize.h),
      createTarget(gl, this.bloomSize.w, this.bloomSize.h),
    ];
    this.index = 0;
  }

  render(params: Params, timeSeconds: number): void {
    const gl = this.gl;
    if (!this.ready || !gl || !this.source) return;
    const { width: w, height: h } = this.canvas;

    // Upload the current source frame. Video decode may not have produced one
    // yet on the first ticks; texImage2D throws on a zero-sized source.
    if (this.sourceSize.w > 1 && this.sourceSize.h > 1) {
      gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, this.source);
      } catch {
        return; // source not decodable this frame — keep the last one on screen
      }
    }

    const read = this.targets[this.index]!;
    const write = this.targets[1 - this.index]!;
    const motionPrev = this.motion[this.motionIndex]!;
    const motionCurr = this.motion[1 - this.motionIndex]!;

    // Snapshot this frame's source before the main pass, so the shader can read
    // both it and the previous snapshot in the same draw.
    if (params.motion > 0.001) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, motionCurr.fbo);
      gl.viewport(0, 0, this.motionSize.w, this.motionSize.h);
      gl.useProgram(this.progCopy);
      this.bindQuad(this.progCopy);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
      gl.uniform1i(this.copyUniform, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.progMain);
    this.bindQuad(this.progMain);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.uniform1i(this.uniforms.uSrc, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, read.tex);
    gl.uniform1i(this.uniforms.uPrev, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.glyphTex);
    gl.uniform1i(this.uniforms.uGlyphs, 2);
    gl.uniform1f(this.uniforms.uGlyphCount, ASCII_RAMP.length);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, motionPrev.tex);
    gl.uniform1i(this.uniforms.uMotionPrev, 3);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, motionCurr.tex);
    gl.uniform1i(this.uniforms.uMotionCurr, 4);

    const [coverX, coverY] = coverScale(this.sourceSize, w, h);
    gl.uniform2f(this.uniforms.uRes, w, h);
    gl.uniform2f(this.uniforms.uCover, coverX, coverY);
    gl.uniform1f(this.uniforms.uTime, timeSeconds);

    for (const key of SCALAR_PARAMS) {
      gl.uniform1f(this.uniforms[`p${capitalise(key)}` as UniformName], params[key]);
    }
    for (const tint of TINTS) {
      const name = `u${capitalise(tint)}` as UniformName;
      gl.uniform3fv(this.uniforms[name], params[tint] as unknown as number[]);
    }

    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (params.bloom > 0.001) this.renderBloom(write, params.streak);

    // Composite to the visible canvas.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.progComposite);
    this.bindQuad(this.progComposite);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, write.tex);
    gl.uniform1i(this.uComp.scene, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.bloom[0]!.tex);
    gl.uniform1i(this.uComp.bloom, 1);
    gl.uniform1f(this.uComp.amount, params.bloom);
    gl.uniform1f(this.uComp.streak, params.streak);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    this.index = 1 - this.index;
    if (params.motion > 0.001) this.motionIndex = 1 - this.motionIndex;
  }

  /** Bright pass, then one separable gaussian, leaving the result in bloom[0]. */
  private renderBloom(scene: Target, streak: number): void {
    const gl = this.gl!;
    const [a, b] = [this.bloom[0]!, this.bloom[1]!];
    const { w, h } = this.bloomSize;
    gl.viewport(0, 0, w, h);

    gl.bindFramebuffer(gl.FRAMEBUFFER, a.fbo);
    gl.useProgram(this.progBright);
    this.bindQuad(this.progBright);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, scene.tex);
    gl.uniform1i(this.uBright.tex, 0);
    gl.uniform1f(this.uBright.threshold, 0.6);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.useProgram(this.progBlur);
    this.bindQuad(this.progBlur);
    gl.uniform1i(this.uBlur.tex, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, b.fbo);
    gl.bindTexture(gl.TEXTURE_2D, a.tex);
    gl.uniform2f(this.uBlur.dir, 1 / w, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, a.fbo);
    gl.bindTexture(gl.TEXTURE_2D, b.tex);
    gl.uniform2f(this.uBlur.dir, 0, 1 / h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Anamorphic: keep widening horizontally only. A cylindrical lens element
    // compresses one axis, so its flares smear sideways while staying tight
    // vertically — an equal blur in both axes is just a bigger bloom.
    if (streak > 0.001) {
      for (let pass = 1; pass <= 3; pass++) {
        const from = pass % 2 === 1 ? a : b;
        const to = pass % 2 === 1 ? b : a;
        gl.bindFramebuffer(gl.FRAMEBUFFER, to.fbo);
        gl.bindTexture(gl.TEXTURE_2D, from.tex);
        gl.uniform2f(this.uBlur.dir, (streak * 5 * pass) / w, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      // Three passes end on b, but the composite reads a.
      gl.bindFramebuffer(gl.FRAMEBUFFER, a.fbo);
      gl.bindTexture(gl.TEXTURE_2D, b.tex);
      gl.uniform2f(this.uBlur.dir, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }

  dispose(): void {
    const gl = this.gl;
    if (!gl) return;
    for (const target of [...this.targets, ...this.bloom, ...this.motion]) {
      gl.deleteFramebuffer(target.fbo);
      gl.deleteTexture(target.tex);
    }
    gl.deleteTexture(this.srcTex);
    gl.deleteTexture(this.glyphTex);
    gl.deleteBuffer(this.quad);
    for (const program of [
      this.progMain, this.progBright, this.progBlur, this.progComposite, this.progCopy,
    ]) {
      gl.deleteProgram(program);
    }
    this.ready = false;
  }

  private bindQuad(program: WebGLProgram): void {
    const gl = this.gl!;
    const location = gl.getAttribLocation(program, 'aPos');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
  }
}

function capitalise<S extends string>(s: S): Capitalize<S> {
  return (s.charAt(0).toUpperCase() + s.slice(1)) as Capitalize<S>;
}

function collectUniforms(
  gl: WebGLRenderingContext,
  program: WebGLProgram,
): Record<UniformName, WebGLUniformLocation | null> {
  const names: UniformName[] = [
    'uSrc', 'uPrev', 'uRes', 'uCover', 'uTime', 'uGlyphs', 'uGlyphCount',
    'uMotionPrev', 'uMotionCurr',
    ...TINTS.map((key) => `u${capitalise(key)}` as UniformName),
    ...SCALAR_PARAMS.map((key) => `p${capitalise(key)}` as UniformName),
  ];
  const found = Object.fromEntries(
    names.map((name) => [name, gl.getUniformLocation(program, name)]),
  ) as Record<UniformName, WebGLUniformLocation | null>;

  // A name missing from `names` yields `undefined`, which WebGL treats as a
  // no-op location — the uniform silently keeps its default and the effect
  // quietly does the wrong thing. Turn that into a crash at startup instead.
  for (const name of names) {
    if (!(name in found)) throw new Error(`Uniform ${name} was never looked up`);
  }
  return found;
}

/** Maps canvas UV onto source UV so the frame fills the screen without stretching. */
function coverScale(src: { w: number; h: number }, w: number, h: number): [number, number] {
  const srcAspect = src.w / src.h;
  const dstAspect = w / h;
  return srcAspect > dstAspect
    ? [dstAspect / srcAspect, 1]
    : [1, srcAspect / dstAspect];
}

/** Renders the ramp into a one-row strip of square cells. */
function buildGlyphAtlas(): HTMLCanvasElement {
  const cell = 24;
  const canvas = document.createElement('canvas');
  canvas.width = cell * ASCII_RAMP.length;
  canvas.height = cell;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available for the glyph atlas');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${cell - 4}px ui-monospace, "SF Mono", Menlo, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < ASCII_RAMP.length; i++) {
    ctx.fillText(ASCII_RAMP[i]!, i * cell + cell / 2, cell / 2 + 1);
  }
  return canvas;
}

function createTexture(gl: WebGLRenderingContext): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error('Could not allocate a texture');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return tex;
}

function createTarget(gl: WebGLRenderingContext, w: number, h: number): Target {
  const tex = createTexture(gl);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const fbo = gl.createFramebuffer();
  if (!fbo) throw new Error('Could not allocate a framebuffer');
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo };
}

function buildProgram(gl: WebGLRenderingContext, vertSrc: string, fragSrc: string): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error('Could not allocate a shader program');
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertSrc));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragSrc));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Shader link failed: ${gl.getProgramInfoLog(program)}`);
  }
  return program;
}

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Could not allocate a shader');
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`Shader compile failed: ${gl.getShaderInfoLog(shader)}`);
  }
  return shader;
}
