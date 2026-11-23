// GPU 采样器: 色控条检测轮廓与逐色块颜色计算全部在 WebGL2 中完成。
// 轮廓: 行/列均值暗度(约简到 1 像素宽的浮点纹理, 单次 readPixels 取回)。
// 测量: N×2 浮点图集 —— 第 0 行 (L,a,b,视觉密度), 第 1 行 (Dc,Dm,Dy,Dk)。

import type { Calibration } from '../calib/calibration';
import type { PatchSample, Sampler, StripGeometry } from '../detect/geometry';
import {
  createGL,
  createProgram,
  makeFloatTarget,
  makeFullscreenVao,
  FULLSCREEN_VS,
  type FloatTarget,
} from './gl';

const MAX_PATCHES = 128;

const PROFILE_FS = `#version 300 es
precision highp float;
uniform sampler2D uImg;
uniform ivec2 uRange;   // 行轮廓: 列范围; 列轮廓: 行范围
uniform int uDir;       // 0=行轮廓(目标 1×H), 1=列轮廓(目标 W×1)
out vec4 o;
void main(){
  ivec2 fc = ivec2(gl_FragCoord.xy);
  float acc = 0.0;
  float cnt = 0.0;
  if (uDir == 0) {
    int y = fc.y;
    for (int x = uRange.x; x < uRange.y; x += 2) {
      vec3 v = texelFetch(uImg, ivec2(x, y), 0).rgb;
      acc += 1.0 - (v.r + v.g + v.b) / 3.0;
      cnt += 1.0;
    }
  } else {
    int x = fc.x;
    for (int y = uRange.x; y < uRange.y; y += 2) {
      vec3 v = texelFetch(uImg, ivec2(x, y), 0).rgb;
      acc += 1.0 - (v.r + v.g + v.b) / 3.0;
      cnt += 1.0;
    }
  }
  o = vec4(acc / max(cnt, 1.0), 0.0, 0.0, 1.0);
}
`;

const MEASURE_FS = `#version 300 es
precision highp float;
uniform sampler2D uImg;
uniform sampler2D uLutR;
uniform sampler2D uLutG;
uniform sampler2D uLutB;
uniform vec2 uCenters[${MAX_PATCHES}];
uniform vec2 uAxis;
uniform vec2 uNrm;
uniform int uHalf;
uniform mat3 uCalMat;   // 校准矩阵(列主序上传)
uniform vec3 uCalOff;
uniform ivec2 uSize;
out vec4 o;

// 波段 -> XYZ (列主序: 行向量为 [0.62,0.24,0.10],[0.25,0.67,0.08],[0.005,0.02,0.75])
const mat3 B2X = mat3(
  0.62, 0.25, 0.005,
  0.24, 0.67, 0.02,
  0.10, 0.08, 0.75
);
const vec3 WP = vec3(0.9642, 1.0, 0.8251);

// LUT 连续查找(手动线性插值, 避免 256 级阶梯量化)
float lutS(sampler2D lut, float v){
  float x = clamp(v, 0.0, 1.0) * 255.0 - 0.5;
  float i = clamp(floor(x), 0.0, 254.0);
  float f = clamp(x - i, 0.0, 1.0);
  float a = texelFetch(lut, ivec2(int(i), 0), 0).r;
  float b = texelFetch(lut, ivec2(int(i) + 1, 0), 0).r;
  return mix(a, b, f);
}

vec3 calib(vec3 enc){
  vec3 lin = vec3(lutS(uLutR, enc.r), lutS(uLutG, enc.g), lutS(uLutB, enc.b));
  return clamp(uCalMat * lin + uCalOff, 0.0, 1.0);
}

float labF(float t){
  return t > 0.008856 ? pow(t, 1.0 / 3.0) : 7.787037 * t + 16.0 / 116.0;
}

void main(){
  int idx = int(gl_FragCoord.x);
  int row = int(gl_FragCoord.y);
  vec2 c = uCenters[idx];
  vec3 acc = vec3(0.0);
  vec3 rawAcc = vec3(0.0);
  float cnt = 0.0;
  for (int dy = -20; dy <= 20; dy++) {
    for (int dx = -20; dx <= 20; dx++) {
      if (dx < -uHalf || dx > uHalf || dy < -uHalf || dy > uHalf) continue;
      vec2 p = c + uAxis * float(dx) + uNrm * float(dy);
      ivec2 ip = ivec2(p);
      if (ip.x < 0 || ip.y < 0 || ip.x >= uSize.x || ip.y >= uSize.y) continue;
      vec3 enc = texelFetch(uImg, ip, 0).rgb;
      // 暗角校正(与合成端模型互逆)
      vec2 nxy = (vec2(ip) - vec2(uSize) * 0.5) / (vec2(uSize) * 0.5);
      float vig = 1.0 - 0.05 * dot(nxy, nxy) * 0.5;
      enc = clamp(enc / vig, 0.0, 1.0);
      rawAcc += enc;
      acc += calib(enc);
      cnt += 1.0;
    }
  }
  vec3 band = acc / max(cnt, 1.0);
  if (row == 2) {
    o = vec4(rawAcc / max(cnt, 1.0), 1.0);
    return;
  }
  if (row == 0) {
    vec3 xyz = B2X * band;
    vec3 f = vec3(labF(xyz.x / WP.x), labF(xyz.y / WP.y), labF(xyz.z / WP.z));
    float L = 116.0 * f.y - 16.0;
    float a = 500.0 * (f.x - f.y);
    float b = 200.0 * (f.y - f.z);
    float yvis = 0.25 * band.r + 0.67 * band.g + 0.08 * band.b;
    float dv = -log2(max(yvis, 1e-5)) * 0.30103;
    o = vec4(L, a, b, dv);
  } else {
    vec3 d = -log2(max(band, vec3(1e-5))) * 0.30103;
    float yvis = 0.25 * band.r + 0.67 * band.g + 0.08 * band.b;
    float dv = -log2(max(yvis, 1e-5)) * 0.30103;
    o = vec4(d, dv);
  }
}
`;

export class GpuSampler implements Sampler {
  readonly kind = 'gpu' as const;
  private gl: WebGL2RenderingContext;
  private vao: ReturnType<typeof makeFullscreenVao>;
  private profileProg: WebGLProgram;
  private measureProg: WebGLProgram;
  private imgTex: WebGLTexture | null = null;
  private imgW = 0;
  private imgH = 0;
  private lutTex: WebGLTexture[] = [];
  private cal: Calibration;

  constructor(cal: Calibration) {
    const gl = createGL();
    if (!gl) throw new Error('WebGL2 不可用');
    this.gl = gl;
    this.cal = cal;
    this.vao = makeFullscreenVao(gl);
    this.profileProg = createProgram(gl, FULLSCREEN_VS, PROFILE_FS);
    this.measureProg = createProgram(gl, FULLSCREEN_VS, MEASURE_FS);
    this.uploadLuts();
  }

  setCalibration(cal: Calibration): void {
    this.cal = cal;
    this.uploadLuts();
  }

  private uploadLuts(): void {
    const gl = this.gl;
    for (const t of this.lutTex) gl.deleteTexture(t);
    this.lutTex = [];
    for (let ch = 0; ch < 3; ch++) {
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 256, 1, 0, gl.RED, gl.FLOAT, this.cal.lut[ch]);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.lutTex.push(tex);
    }
  }

  setImage(img: ImageData): void {
    const gl = this.gl;
    if (this.imgTex && (this.imgW !== img.width || this.imgH !== img.height)) {
      gl.deleteTexture(this.imgTex);
      this.imgTex = null;
    }
    if (!this.imgTex) {
      this.imgTex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, this.imgTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.imgW = img.width;
      this.imgH = img.height;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, img.width, img.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, img.data);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, this.imgTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, img.width, img.height, gl.RGBA, gl.UNSIGNED_BYTE, img.data);
    }
  }

  private runProfile(dir: 0 | 1, r0: number, r1: number, outLen: number): Float32Array {
    const gl = this.gl;
    const target = makeFloatTarget(gl, dir === 0 ? 1 : outLen, dir === 0 ? outLen : 1);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, target.w, target.h);
    gl.useProgram(this.profileProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.imgTex);
    gl.uniform1i(gl.getUniformLocation(this.profileProg, 'uImg'), 0);
    gl.uniform2i(gl.getUniformLocation(this.profileProg, 'uRange'), Math.floor(r0), Math.ceil(r1));
    gl.uniform1i(gl.getUniformLocation(this.profileProg, 'uDir'), dir);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const out = new Float32Array(outLen * 4);
    gl.readPixels(0, 0, target.w, target.h, gl.RGBA, gl.FLOAT, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteTexture(target.tex);
    gl.deleteFramebuffer(target.fbo);
    const res = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) res[i] = out[i * 4];
    return res;
  }

  rowProfile(x0: number, x1: number): Float32Array {
    return this.runProfile(0, x0, x1, this.imgH);
  }

  colProfile(y0: number, y1: number): Float32Array {
    return this.runProfile(1, y0, y1, this.imgW);
  }

  private renderAtlas(geom: StripGeometry, half: number): Float32Array {
    const gl = this.gl;
    const n = geom.centers.length;
    if (n > MAX_PATCHES) throw new Error('色块数量超限');
    const target: FloatTarget = makeFloatTarget(gl, n, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, n, 3);
    gl.useProgram(this.measureProg);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.imgTex);
    gl.uniform1i(gl.getUniformLocation(this.measureProg, 'uImg'), 0);
    const lutNames = ['uLutR', 'uLutG', 'uLutB'];
    for (let ch = 0; ch < 3; ch++) {
      gl.activeTexture(gl.TEXTURE1 + ch);
      gl.bindTexture(gl.TEXTURE_2D, this.lutTex[ch]);
      gl.uniform1i(gl.getUniformLocation(this.measureProg, lutNames[ch]), 1 + ch);
    }
    const centers = new Float32Array(MAX_PATCHES * 2);
    geom.centers.forEach((c, i) => {
      centers[i * 2] = c.x;
      centers[i * 2 + 1] = c.y;
    });
    gl.uniform2fv(gl.getUniformLocation(this.measureProg, 'uCenters[0]'), centers);
    gl.uniform2f(gl.getUniformLocation(this.measureProg, 'uAxis'), geom.axis.x, geom.axis.y);
    gl.uniform2f(gl.getUniformLocation(this.measureProg, 'uNrm'), geom.nrm.x, geom.nrm.y);
    gl.uniform1i(gl.getUniformLocation(this.measureProg, 'uHalf'), half);
    // 校准矩阵行主序 -> 列主序上传
    const m = this.cal.matrix;
    gl.uniformMatrix3fv(
      gl.getUniformLocation(this.measureProg, 'uCalMat'),
      false,
      new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]])
    );
    gl.uniform3fv(gl.getUniformLocation(this.measureProg, 'uCalOff'), this.cal.offset);
    gl.uniform2i(gl.getUniformLocation(this.measureProg, 'uSize'), this.imgW, this.imgH);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const buf = new Float32Array(n * 3 * 4);
    gl.readPixels(0, 0, n, 3, gl.RGBA, gl.FLOAT, buf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteTexture(target.tex);
    gl.deleteFramebuffer(target.fbo);
    return buf;
  }

  measure(geom: StripGeometry, half: number): PatchSample[] {
    const n = geom.centers.length;
    const buf = this.renderAtlas(geom, half);
    const out: PatchSample[] = [];
    for (let i = 0; i < n; i++) {
      const r0 = i * 4; // 行 0: L,a,b,dv
      const r1 = (n + i) * 4; // 行 1: dc,dm,dy,dk
      out.push({
        lab: [buf[r0], buf[r0 + 1], buf[r0 + 2]],
        dens: { C: buf[r1], M: buf[r1 + 1], Y: buf[r1 + 2], K: buf[r1 + 3] },
      });
    }
    return out;
  }

  measureRaw(geom: StripGeometry, half: number): [number, number, number][] {
    const n = geom.centers.length;
    const buf = this.renderAtlas(geom, half);
    const out: [number, number, number][] = [];
    for (let i = 0; i < n; i++) {
      const r2 = (2 * n + i) * 4; // 行 2: 原始 RGB
      out.push([buf[r2], buf[r2 + 1], buf[r2 + 2]]);
    }
    return out;
  }
}
