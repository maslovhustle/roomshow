// Getting a small picture onto a big wall without it turning to mush.
//
// The model generates at 832x480 and there is no changing that: it is the
// resolution it was trained at, and asking for more than doubles the pixels it
// has to invent, which the frame rate cannot afford. So the picture is always
// going to be stretched — by two and a bit, onto a projector.
//
// What matters is how. Drawing the frame into a canvas with drawImage, or
// letting the compositor stretch it, gives bilinear interpolation: each output
// pixel is a blend of four inputs, which is exactly the operation that turns
// an edge into a gradient. The result reads as out of focus.
//
// This does the stretch on the GPU instead, in two parts:
//
//   - Catmull-Rom bicubic sampling, which reconstructs from sixteen inputs
//     with a kernel that overshoots slightly at edges rather than averaging
//     across them. Edges stay edges.
//   - A contrast-adaptive sharpen afterwards, which restores the high
//     frequencies any resampling loses, weighted by local contrast so flat
//     areas do not gain noise and hard edges do not gain halos.
//
// Both are cheap — one pass, a handful of taps — and both run at the display's
// resolution, so the whole path is one good scale rather than two poor ones.

const VERTEX = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  // V is flipped: a texture's origin is at the bottom left, a video frame's is
  // at the top left. Without this the whole picture is upside down — which is
  // obvious the moment anyone looks at it, and invisible in every measurement
  // of sharpness, because a flipped image is exactly as sharp as an upright one.
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const FRAGMENT = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uFrame;
/** Size of the incoming frame in pixels — the grid the bicubic kernel walks. */
uniform vec2 uSource;
/** How hard to sharpen, 0 to 1. */
uniform float uSharpen;

/**
 * Catmull-Rom in one dimension, folded into four bilinear taps.
 *
 * The naive form needs sixteen texture reads. Because the hardware already
 * interpolates between neighbours for free, the same result comes from four
 * reads placed at carefully offset positions — the standard trick, and the
 * reason this is affordable on every frame.
 */
vec3 bicubic(vec2 uv) {
  vec2 texel = 1.0 / uSource;
  vec2 pos = uv * uSource - 0.5;
  vec2 f = fract(pos);
  vec2 base = (pos - f + 0.5) * texel;

  vec2 f2 = f * f;
  vec2 f3 = f2 * f;
  // Catmull-Rom weights: negative lobes on the outside are what keep an edge
  // from smearing, and what a bilinear stretch has none of.
  vec2 w0 = -0.5 * f3 + f2 - 0.5 * f;
  vec2 w1 = 1.5 * f3 - 2.5 * f2 + 1.0;
  vec2 w2 = -1.5 * f3 + 2.0 * f2 + 0.5 * f;
  vec2 w3 = 0.5 * f3 - 0.5 * f2;

  vec2 s0 = w0 + w1;
  vec2 s1 = w2 + w3;
  vec2 o0 = base + (w1 / s0 - 1.0) * texel;
  vec2 o1 = base + (w3 / s1 + 1.0) * texel;

  vec3 a = texture2D(uFrame, vec2(o0.x, o0.y)).rgb;
  vec3 b = texture2D(uFrame, vec2(o1.x, o0.y)).rgb;
  vec3 c = texture2D(uFrame, vec2(o0.x, o1.y)).rgb;
  vec3 d = texture2D(uFrame, vec2(o1.x, o1.y)).rgb;

  return mix(mix(a, b, s1.x), mix(c, d, s1.x), s1.y);
}

void main() {
  vec2 texel = 1.0 / uSource;
  vec3 col = bicubic(vUv);

  // Contrast-adaptive sharpening. The strength is scaled down where the
  // neighbourhood is already high-contrast, so hard edges gain definition
  // without the pale outline that a fixed unsharp mask leaves around them.
  vec3 n = bicubic(vUv + vec2(0.0, -texel.y));
  vec3 s = bicubic(vUv + vec2(0.0, texel.y));
  vec3 e = bicubic(vUv + vec2(texel.x, 0.0));
  vec3 w = bicubic(vUv + vec2(-texel.x, 0.0));

  vec3 lo = min(col, min(min(n, s), min(e, w)));
  vec3 hi = max(col, max(max(n, s), max(e, w)));
  // Headroom left before clipping decides how much sharpening is safe here.
  vec3 room = min(lo, 1.0 - hi);
  vec3 amount = clamp(room / max(hi, 0.0001), 0.0, 1.0) * uSharpen;

  vec3 sharpened = col + (col * 4.0 - n - s - e - w) * amount * 0.25;
  gl_FragColor = vec4(clamp(sharpened, 0.0, 1.0), 1.0);
}
`;

/** Sharpening strength. Enough to undo the resample, not enough to crackle. */
const SHARPEN = 0.6;

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('no shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? 'shader failed to compile');
  }
  return shader;
}

/**
 * Draws a video frame onto a canvas, scaled up properly.
 *
 * Falls back to a plain 2D blit when WebGL is unavailable — a soft picture is
 * better than none, and a venue laptop with no GPU should still put something
 * on the wall.
 */
export class Upscaler {
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private texture: WebGLTexture | null = null;
  private uSource: WebGLUniformLocation | null = null;
  private fallback: CanvasRenderingContext2D | null = null;

  constructor(private canvas: HTMLCanvasElement) {}

  init(): void {
    const gl = this.canvas.getContext('webgl', { alpha: false, antialias: false });
    if (!gl) {
      this.fallback = this.canvas.getContext('2d');
      return;
    }
    this.gl = gl;

    const program = gl.createProgram();
    if (!program) throw new Error('no program');
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? 'program failed to link');
    }
    gl.useProgram(program);
    this.program = program;

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    // CLAMP_TO_EDGE, because the bicubic kernel reaches a texel past the
    // border and wrapping would fold the opposite side of the picture in.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    this.uSource = gl.getUniformLocation(program, 'uSource');
    gl.uniform1i(gl.getUniformLocation(program, 'uFrame'), 0);
    gl.uniform1f(gl.getUniformLocation(program, 'uSharpen'), SHARPEN);
  }

  /** @param frame the decoded video, already known to have dimensions */
  draw(frame: HTMLVideoElement): void {
    const gl = this.gl;
    if (!gl || !this.program) {
      this.fallback?.drawImage(frame, 0, 0, this.canvas.width, this.canvas.height);
      return;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, frame);
    gl.uniform2f(this.uSource, frame.videoWidth, frame.videoHeight);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose(): void {
    const gl = this.gl;
    if (!gl) return;
    if (this.texture) gl.deleteTexture(this.texture);
    if (this.program) gl.deleteProgram(this.program);
    this.gl = null;
    this.program = null;
    this.texture = null;
  }
}
