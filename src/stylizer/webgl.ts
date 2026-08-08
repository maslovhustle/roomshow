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
uniform vec3  uTintA;
uniform vec3  uTintB;

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

  uv = kaleido(uv, pKaleido, uTime);

  if (pPixel > 0.001) {
    float n = max(10.0, mix(uRes.x, 26.0, pPixel));
    vec2 grid = vec2(n, max(6.0, n * uRes.y / uRes.x));
    uv = (floor(uv * grid) + 0.5) / grid;
  }

  // RGB split. Cheap, and reads as "signal" rather than "filter" on a projector.
  vec2 split = vec2(pChroma * 0.014, 0.0);
  vec3 col = vec3(
    sampleBase(uv + split).r,
    sampleBase(uv).g,
    sampleBase(uv - split).b
  );

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

  if (pDuotone > 0.001) {
    vec3 duo = mix(uTintA, uTintB, smoothstep(0.05, 0.92, luma(col)));
    col = mix(col, duo, pDuotone);
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

const FRAG_COPY = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
void main() { gl_FragColor = texture2D(uTex, vUv); }`;

const SCALAR_PARAMS = [
  'mirror', 'kaleido', 'pixel', 'chroma', 'edge', 'poster',
  'hue', 'duotone', 'feedback', 'warp', 'spin', 'glow', 'vignette',
  'invert', 'halftone', 'scanline', 'grain', 'slice', 'sat', 'contrast', 'smooth',
] as const satisfies readonly ScalarParam[];

type UniformName =
  | 'uSrc' | 'uPrev' | 'uRes' | 'uCover' | 'uTime' | 'uTintA' | 'uTintB'
  | `p${Capitalize<(typeof SCALAR_PARAMS)[number]>}`;

interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
}

export class WebGLStylizer implements Stylizer {
  private gl: WebGLRenderingContext | null = null;
  private progMain!: WebGLProgram;
  private progCopy!: WebGLProgram;
  private quad!: WebGLBuffer;
  private srcTex!: WebGLTexture;
  private uniforms!: Record<UniformName, WebGLUniformLocation | null>;
  private copyUniform: WebGLUniformLocation | null = null;
  private targets: Target[] = [];
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
    this.progCopy = buildProgram(gl, VERT, FRAG_COPY);

    const quad = gl.createBuffer();
    if (!quad) throw new Error('Could not allocate a vertex buffer');
    this.quad = quad;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    this.srcTex = createTexture(gl);
    this.uniforms = collectUniforms(gl, this.progMain);
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
    for (const target of this.targets) {
      gl.deleteFramebuffer(target.fbo);
      gl.deleteTexture(target.tex);
    }
    this.targets = [createTarget(gl, w, h), createTarget(gl, w, h)];
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

    const [coverX, coverY] = coverScale(this.sourceSize, w, h);
    gl.uniform2f(this.uniforms.uRes, w, h);
    gl.uniform2f(this.uniforms.uCover, coverX, coverY);
    gl.uniform1f(this.uniforms.uTime, timeSeconds);

    for (const key of SCALAR_PARAMS) {
      gl.uniform1f(this.uniforms[`p${capitalise(key)}` as UniformName], params[key]);
    }
    gl.uniform3fv(this.uniforms.uTintA, params.tintA as unknown as number[]);
    gl.uniform3fv(this.uniforms.uTintB, params.tintB as unknown as number[]);

    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Blit to the visible canvas.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.progCopy);
    this.bindQuad(this.progCopy);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, write.tex);
    gl.uniform1i(this.copyUniform, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    this.index = 1 - this.index;
  }

  dispose(): void {
    const gl = this.gl;
    if (!gl) return;
    for (const target of this.targets) {
      gl.deleteFramebuffer(target.fbo);
      gl.deleteTexture(target.tex);
    }
    gl.deleteTexture(this.srcTex);
    gl.deleteBuffer(this.quad);
    gl.deleteProgram(this.progMain);
    gl.deleteProgram(this.progCopy);
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
    'uSrc', 'uPrev', 'uRes', 'uCover', 'uTime', 'uTintA', 'uTintB',
    ...SCALAR_PARAMS.map((key) => `p${capitalise(key)}` as UniformName),
  ];
  return Object.fromEntries(
    names.map((name) => [name, gl.getUniformLocation(program, name)]),
  ) as Record<UniformName, WebGLUniformLocation | null>;
}

/** Maps canvas UV onto source UV so the frame fills the screen without stretching. */
function coverScale(src: { w: number; h: number }, w: number, h: number): [number, number] {
  const srcAspect = src.w / src.h;
  const dstAspect = w / h;
  return srcAspect > dstAspect
    ? [dstAspect / srcAspect, 1]
    : [1, srcAspect / dstAspect];
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
