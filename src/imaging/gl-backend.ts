/**
 * WebGL2 图像处理后端
 * 与 kernels-cpu.ts 保持相同算法与数值口径：
 * 灰度 BT.601、Sobel、暗掩膜、旋转、2×2 降采样、行/列投影。
 * 投影/定位等少量数据回读后在 CPU 完成，ROI 均值直接用 CPU（数据量小）。
 */
import type { FloatImage, RGBImage } from '../core/types.ts';

const VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = vec2((a_pos.x + 1.0) * 0.5, 1.0 - (a_pos.y + 1.0) * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

function frag(inner: string): string {
  return `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_size;
out vec4 outColor;
float px(vec2 off) {
  return texture(u_tex, v_uv + off / u_size).r;
}
void main() {
  vec2 uv = v_uv;
  ${inner}
}`;
}

const FRAG_GRAY = frag(`
  vec3 c = texture(u_tex, uv).rgb;
  outColor = vec4(vec3(0.299*c.r + 0.587*c.g + 0.114*c.b), 1.0);
`);

const FRAG_SOBEL = frag(`
  float tl = px(vec2(-1.0,-1.0)), t = px(vec2(0.0,-1.0)), tr = px(vec2(1.0,-1.0));
  float l = px(vec2(-1.0,0.0)), r = px(vec2(1.0,0.0));
  float bl = px(vec2(-1.0,1.0)), b = px(vec2(0.0,1.0)), br = px(vec2(1.0,1.0));
  float gx = -tl + tr - 2.0*l + 2.0*r - bl + br;
  float gy = -tl - 2.0*t - tr + bl + 2.0*b + br;
  outColor = vec4(vec3(length(vec2(gx, gy)) / 255.0), 1.0);
`);

const FRAG_DARK = frag(`
  float v = texture(u_tex, uv).r;
  outColor = vec4(vec3(v < u_thresh ? 1.0 : 0.0), 1.0);
`).replace('uniform vec2 u_size;', 'uniform vec2 u_size;\nuniform float u_thresh;');

const FRAG_ROTATE = frag(`
  float rad = u_angle;
  vec2 c = u_size * 0.5;
  vec2 d = (uv * u_size - c);
  float ca = cos(rad), sa = sin(rad);
  vec2 s = vec2(ca*d.x + sa*d.y, -sa*d.x + ca*d.y) + c;
  vec2 suv = s / u_size;
  if (suv.x < 0.0 || suv.y < 0.0 || suv.x > 1.0 || suv.y > 1.0) {
    outColor = vec4(1.0);
  } else {
    outColor = vec4(vec3(texture(u_tex, suv).r), 1.0);
  }
`).replace('uniform vec2 u_size;', 'uniform vec2 u_size;\nuniform float u_angle;');

const FRAG_DOWNSAMPLE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_size;
out vec4 outColor;
void main() {
  vec2 px = 1.0 / u_size;
  float v = (
    texture(u_tex, v_uv + vec2(-0.25,-0.25)*px).r +
    texture(u_tex, v_uv + vec2( 0.25,-0.25)*px).r +
    texture(u_tex, v_uv + vec2(-0.25, 0.25)*px).r +
    texture(u_tex, v_uv + vec2( 0.25, 0.25)*px).r
  ) * 0.25;
  outColor = vec4(vec3(v), 1.0);
}`;

export class GlBackend {
  readonly gl: WebGL2RenderingContext;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject;
  private textures: WebGLTexture[] = [];
  private framebuffer: WebGLFramebuffer;
  readonly supported = true;
  /** GPU 累计耗时（ms） */
  gpuTimeMs = 0;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      preserveDrawingBuffer: false,
      antialias: false,
    });
    if (!gl) throw new Error('WebGL2 不可用');
    this.gl = gl;
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('VAO 创建失败');
    this.vao = vao;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const fb = gl.createFramebuffer();
    if (!fb) throw new Error('FBO 创建失败');
    this.framebuffer = fb;
  }

  private compile(fragment: string): WebGLProgram {
    const gl = this.gl;
    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, VERT);
    gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, fragment);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      throw new Error('片元着色器编译失败: ' + gl.getShaderInfoLog(fs));
    }
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('程序链接失败: ' + gl.getProgramInfoLog(prog));
    }
    return prog;
  }

  private useProgram(fragment: string): WebGLProgram {
    if (!this.program || this.lastFrag !== fragment) {
      this.program = this.compile(fragment);
      this.lastFrag = fragment;
    }
    const gl = this.gl;
    gl.useProgram(this.program);
    const loc = gl.getAttribLocation(this.program, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    return this.program;
  }
  private lastFrag = '';

  private makeTexture(): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.textures.push(tex);
    return tex;
  }

  private uploadRgb(img: RGBImage): WebGLTexture {
    const gl = this.gl;
    const tex = this.makeTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGB8,
      img.width,
      img.height,
      0,
      gl.RGB,
      gl.UNSIGNED_BYTE,
      img.data,
    );
    return tex;
  }

  private uploadGray(img: FloatImage, normalized = false): WebGLTexture {
    const gl = this.gl;
    const tex = this.makeTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const data = normalized
      ? new Float32Array(img.data.length)
      : Float32Array.from(img.data);
    if (normalized) for (let i = 0; i < data.length; i++) data[i] = img.data[i] / 255;
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R32F,
      img.width,
      img.height,
      0,
      gl.RED,
      gl.FLOAT,
      data,
    );
    return tex;
  }

  private run(
    fragment: string,
    srcTex: WebGLTexture,
    w: number,
    h: number,
    uniforms: Record<string, number> = {},
    outDims?: [number, number],
  ): FloatImage {
    const gl = this.gl;
    const t0 = performance.now();
    const prog = this.useProgram(fragment);
    const [ow, oh] = outDims ?? [w, h];
    const outTex = this.makeTexture();
    gl.bindTexture(gl.TEXTURE_2D, outTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, ow, oh, 0, gl.RED, gl.FLOAT, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      outTex,
      0,
    );
    gl.viewport(0, 0, ow, oh);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.uniform1i(gl.getUniformLocation(prog, 'u_tex'), 0);
    gl.uniform2f(gl.getUniformLocation(prog, 'u_size'), w, h);
    for (const [k, v] of Object.entries(uniforms)) {
      gl.uniform1f(gl.getUniformLocation(prog, k), v);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    const out = new Float32Array(ow * oh);
    gl.readPixels(0, 0, ow, oh, gl.RED, gl.FLOAT, out);
    // WebGL 原点在左下，翻转行序
    const flipped = new Float32Array(ow * oh);
    for (let y = 0; y < oh; y++) {
      flipped.set(out.subarray((oh - 1 - y) * ow, (oh - y) * ow), y * ow);
    }
    this.gpuTimeMs += performance.now() - t0;
    return { width: ow, height: oh, data: flipped };
  }

  grayscale(img: RGBImage): FloatImage {
    const tex = this.uploadRgb(img);
    const out = this.run(FRAG_GRAY, tex, img.width, img.height);
    return out;
  }

  sobel(gray: FloatImage): FloatImage {
    const tex = this.uploadGray(gray);
    const out = this.run(FRAG_SOBEL, tex, gray.width, gray.height);
    // GL 内核输出归一化到 0..1，恢复到 CPU 的 0..~1443 量纲
    for (let i = 0; i < out.data.length; i++) out.data[i] *= 255;
    return out;
  }

  darkMask(gray: FloatImage, threshold: number): FloatImage {
    const tex = this.uploadGray(gray);
    return this.run(FRAG_DARK, tex, gray.width, gray.height, {
      u_thresh: threshold,
    });
  }

  rotate(gray: FloatImage, angleDeg: number): FloatImage {
    const tex = this.uploadGray(gray);
    return this.run(FRAG_ROTATE, tex, gray.width, gray.height, {
      u_angle: (-angleDeg * Math.PI) / 180,
    });
  }

  downsample2x(gray: FloatImage): FloatImage {
    const tex = this.uploadGray(gray, true);
    const w = Math.floor(gray.width / 2);
    const h = Math.floor(gray.height / 2);
    const out = this.run(FRAG_DOWNSAMPLE, tex, gray.width, gray.height, {}, [w, h]);
    for (let i = 0; i < out.data.length; i++) out.data[i] *= 255;
    return out;
  }

  dispose(): void {
    const gl = this.gl;
    for (const t of this.textures) gl.deleteTexture(t);
    this.textures = [];
  }
}
