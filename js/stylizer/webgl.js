// The visual engine.
//
// One fragment shader does the whole chain, driven entirely by uniforms, so a
// look change is a uniform update — no recompile, no hitch mid-set. Frame
// feedback needs the previous output as an input, hence the ping-pong pair of
// framebuffers: render into `write` while sampling `read`, then swap and blit.
//
// WebGL1 on purpose: it runs on the ancient laptop that is inevitably plugged
// into the projector.

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
    sampleSrc(uv + split).r,
    sampleSrc(uv).g,
    sampleSrc(uv - split).b
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

export class WebGLStylizer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = null;
    this.source = null;
    this.sourceSize = { w: 1, h: 1 };
    this.targets = [];
    this.index = 0;
    this.ready = false;
  }

  init() {
    const opts = { alpha: false, antialias: false, depth: false, preserveDrawingBuffer: true };
    const gl = this.canvas.getContext('webgl', opts) || this.canvas.getContext('experimental-webgl', opts);
    if (!gl) throw new Error('WebGL is not available in this browser');
    this.gl = gl;

    this.progMain = buildProgram(gl, VERT, FRAG_MAIN);
    this.progCopy = buildProgram(gl, VERT, FRAG_COPY);

    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    this.srcTex = createTexture(gl);
    this.uniforms = collectUniforms(gl, this.progMain);
    this.copyUniform = gl.getUniformLocation(this.progCopy, 'uTex');

    this.resize(this.canvas.width, this.canvas.height);
    this.ready = true;
    return this;
  }

  // Accepts anything texImage2D takes: a <video>, a <canvas>, an ImageBitmap.
  setSource(source, width, height) {
    this.source = source;
    this.sourceSize = { w: Math.max(1, width), h: Math.max(1, height) };
  }

  resize(width, height) {
    const gl = this.gl;
    const w = Math.max(2, Math.floor(width));
    const h = Math.max(2, Math.floor(height));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.targets.forEach((t) => {
      gl.deleteFramebuffer(t.fbo);
      gl.deleteTexture(t.tex);
    });
    this.targets = [createTarget(gl, w, h), createTarget(gl, w, h)];
    this.index = 0;
  }

  render(params, timeSeconds) {
    if (!this.ready || !this.source) return;
    const gl = this.gl;
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

    const read = this.targets[this.index];
    const write = this.targets[1 - this.index];

    gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.progMain);
    this.#bindQuad(this.progMain);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.uniform1i(this.uniforms.uSrc, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, read.tex);
    gl.uniform1i(this.uniforms.uPrev, 1);

    gl.uniform2f(this.uniforms.uRes, w, h);
    gl.uniform2f(this.uniforms.uCover, ...coverScale(this.sourceSize, w, h));
    gl.uniform1f(this.uniforms.uTime, timeSeconds);

    for (const key of SCALAR_PARAMS) {
      gl.uniform1f(this.uniforms['p' + cap(key)], params[key] ?? 0);
    }
    gl.uniform3fv(this.uniforms.uTintA, params.tintA);
    gl.uniform3fv(this.uniforms.uTintB, params.tintB);

    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Blit to the visible canvas.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.progCopy);
    this.#bindQuad(this.progCopy);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, write.tex);
    gl.uniform1i(this.copyUniform, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    this.index = 1 - this.index;
  }

  dispose() {
    const gl = this.gl;
    if (!gl) return;
    this.targets.forEach((t) => {
      gl.deleteFramebuffer(t.fbo);
      gl.deleteTexture(t.tex);
    });
    gl.deleteTexture(this.srcTex);
    gl.deleteBuffer(this.quad);
    gl.deleteProgram(this.progMain);
    gl.deleteProgram(this.progCopy);
    this.ready = false;
  }

  #bindQuad(program) {
    const gl = this.gl;
    const loc = gl.getAttribLocation(program, 'aPos');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  }
}

const SCALAR_PARAMS = [
  'mirror', 'kaleido', 'pixel', 'chroma', 'edge', 'poster',
  'hue', 'duotone', 'feedback', 'warp', 'spin', 'glow', 'vignette',
  'invert', 'halftone', 'scanline', 'grain', 'slice', 'sat', 'contrast',
];

function cap(s) {
  return s[0].toUpperCase() + s.slice(1);
}

function collectUniforms(gl, program) {
  const names = ['uSrc', 'uPrev', 'uRes', 'uCover', 'uTime', 'uTintA', 'uTintB',
    ...SCALAR_PARAMS.map((k) => 'p' + cap(k))];
  return Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(program, n)]));
}

// Maps canvas UV onto source UV so the frame fills the screen without stretching.
function coverScale(src, w, h) {
  const srcAspect = src.w / src.h;
  const dstAspect = w / h;
  return srcAspect > dstAspect
    ? [dstAspect / srcAspect, 1]
    : [1, srcAspect / dstAspect];
}

function createTexture(gl) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return tex;
}

function createTarget(gl, w, h) {
  const tex = createTexture(gl);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo };
}

function buildProgram(gl, vertSrc, fragSrc) {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertSrc));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragSrc));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error('Shader link failed: ' + gl.getProgramInfoLog(program));
  }
  return program;
}

function compile(gl, type, src) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error('Shader compile failed: ' + gl.getShaderInfoLog(shader));
  }
  return shader;
}
