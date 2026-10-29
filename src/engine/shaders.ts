/**
 * GLSL for the procedural layers. All animated terms are functions of `uPhase` (radians around the
 * loop) or explicit time, never accumulated state, so any frame can be evaluated independently.
 */

export const NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+10.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.5-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 105.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float hash12(vec2 p){vec3 p3=fract(vec3(p.xyx)*0.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z);}
vec2 hash22(vec2 p){vec3 p3=fract(vec3(p.xyx)*vec3(0.1031,0.1030,0.0973)); p3+=dot(p3,p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy);}
`;

/** Loop-safe noise: the sample point travels a circle in an extra dimension as phase goes 0→2π. */
export const LOOP_NOISE = /* glsl */ `
uniform float uPhase;
uniform float uLoopRadius;
uniform vec2 uFlow;
float lnoise(vec2 p, float k){
  float a = uPhase + k;
  return snoise(vec3(p + uFlow * uLoopRadius * sin(a), uLoopRadius * cos(a) + k * 3.17));
}
float lfbm(vec2 p, float k){
  float s = 0.0, amp = 0.5;
  for (int i = 0; i < 4; i++) { s += amp * lnoise(p, k + float(i) * 1.31); p = p * 2.03 + vec2(1.7, 9.2); amp *= 0.5; }
  return s;
}
`;

export const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }
`;

export const DEFAULT_SHADE = 'return base;';

export const gradientFrag = (shadeBody: string) => /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec2 uResolution;
uniform vec3 uStops[6];
uniform float uPos[6];
uniform int uCount;
uniform int uMode;
uniform int uInterp;
uniform float uAngle, uScale, uFreq, uAmp, uDistort, uGrain, uOpacity, uSeed, uFrame, uTime;
uniform vec2 uCenter;
${NOISE}
${LOOP_NOISE}
vec3 oklabToSrgb(vec3 c){
  float l=c.x+0.3963377774*c.y+0.2158037573*c.z, m=c.x-0.1055613458*c.y-0.0638541728*c.z, s=c.x-0.0894841775*c.y-1.2914855480*c.z;
  l=l*l*l; m=m*m*m; s=s*s*s;
  vec3 lin=vec3(4.0767416621*l-3.3077115913*m+0.2309699292*s, -1.2684380046*l+2.6097574011*m-0.3413193965*s, -0.0041960863*l-0.7034186147*m+1.7076147010*s);
  lin = clamp(lin, 0.0, 1.0);
  return mix(lin*12.92, 1.055*pow(lin, vec3(1.0/2.4))-0.055, step(0.0031308, lin));
}
vec3 decode(vec3 c){ return uInterp == 2 ? oklabToSrgb(c) : c; }
vec3 ramp(float t){
  t = clamp(t, 0.0, 1.0);
  vec3 c = uStops[0];
  for (int i = 1; i < 6; i++) {
    if (i >= uCount) break;
    float a = uPos[i-1], b = uPos[i];
    float k = clamp((t - a) / max(b - a, 1e-4), 0.0, 1.0);
    if (uInterp == 1) k = k * k * (3.0 - 2.0 * k);
    if (t >= a) c = mix(uStops[i-1], uStops[i], k);
  }
  return decode(c);
}
vec3 stopColor(int i){ for (int j = 0; j < 6; j++) if (j == i) return decode(uStops[j]); return decode(uStops[0]); }
vec3 shade(vec2 uv, float t, vec3 base){ ${shadeBody} }

void main(){
  float aspect = uResolution.x / uResolution.y;
  vec2 uv = vUv; uv.y = 1.0 - uv.y;               // origin top-left, like the scene format
  vec2 p = (uv - uCenter) * vec2(aspect, 1.0) / uScale;
  float ca = cos(radians(uAngle)), sa = sin(radians(uAngle));
  vec2 rp = mat2(ca, -sa, sa, ca) * p;
  vec2 warp = uDistort * vec2(lfbm(p * uFreq * 0.7, 0.0), lfbm(p * uFreq * 0.7 + 5.2, 1.0));
  vec3 col;
  if (uMode == 0) {               // linear
    col = ramp(rp.x * 0.5 / max(aspect, 1.0) + 0.5 + uAmp * 0.25 * lfbm(p * uFreq + warp, 2.0));
  } else if (uMode == 1) {        // radial
    col = ramp(length(p + warp * 0.5) * 1.15 + uAmp * 0.2 * lfbm(p * uFreq, 3.0));
  } else if (uMode == 2) {        // mesh: moving colour points blended by inverse distance
    vec3 acc = vec3(0.0); float wsum = 0.0;
    for (int i = 0; i < 6; i++) {
      if (i >= uCount) break;
      float fi = float(i);
      vec2 base = vec2(fract(sin(fi * 12.9898 + uSeed) * 43758.5453), fract(sin(fi * 78.233 + uSeed) * 12543.123)) - 0.5;
      base *= vec2(aspect, 1.0) * 1.1;
      vec2 c = base + uAmp * 0.45 * vec2(lnoise(vec2(fi * 3.1, 0.0), fi), lnoise(vec2(0.0, fi * 2.7), fi + 7.0));
      float d = length(p + warp * 0.6 - c);
      float w = 1.0 / pow(d + 0.06, 2.6);
      acc += stopColor(i) * w; wsum += w;
    }
    col = acc / wsum;
  } else if (uMode == 3) {        // aurora: luminous ribbons over the base stop
    col = stopColor(0) * 0.9;
    vec2 q = vec2(uv.x * aspect, uv.y) + warp * 0.35;
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      float y0 = 0.22 + fi * 0.17 + uAmp * 0.22 * lfbm(vec2(q.x * uFreq * 0.55 + fi * 1.7, fi), fi * 2.0);
      float width = 0.07 + 0.05 * (0.5 + 0.5 * lnoise(vec2(q.x * 1.3, fi * 4.0), fi + 1.0));
      float d = (q.y - y0) / width;
      float curtain = exp(-d * d) + 0.45 * exp(-max(-d, 0.0) * 1.1) * step(d, 0.0);
      float streak = 0.55 + 0.45 * lnoise(vec2(q.x * uFreq * 5.0, fi * 9.0), fi * 0.5);
      vec3 rc = ramp(0.25 + 0.75 * (fi + 0.5 * (0.5 + 0.5 * lnoise(vec2(q.x * 0.8, fi), fi))) / 4.0);
      col += rc * curtain * streak * 0.75;
    }
    col = 1.0 - exp(-col * 1.35);
  } else if (uMode == 4) {        // noise field
    float n = lfbm(p * uFreq + warp * 1.4, 4.0);
    col = ramp(0.5 + n * (0.55 + uAmp * 0.6));
  } else {                        // organic metaballs
    float field = 0.0; vec3 acc = vec3(0.0);
    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      vec2 c = vec2(lnoise(vec2(fi * 1.9, 0.3), fi * 0.7), lnoise(vec2(0.7, fi * 2.3), fi * 0.7 + 3.0)) * vec2(aspect * 0.55, 0.5) * (0.6 + uAmp * 0.5);
      float r = 0.18 + 0.1 * fract(sin(fi * 91.7 + uSeed) * 437.5);
      float d = length(p + warp * 0.4 - c);
      float f = r * r / (d * d + 1e-3);
      field += f;
      acc += ramp(0.35 + 0.65 * fi / 5.0) * f;
    }
    vec3 blob = acc / max(field, 1e-3);
    float edge = smoothstep(0.85, 1.25, field);
    float glow = smoothstep(0.25, 1.0, field) * 0.35;
    col = mix(stopColor(0), blob, edge) + blob * glow * (1.0 - edge);
  }
  col = shade(uv, uTime, col);
  float g = hash12(uv * uResolution + vec2(uFrame * 17.0, uFrame * 31.0)) - 0.5;
  col += g * uGrain;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), uOpacity);
}
`;

export const MESH_VERT = /* glsl */ `
uniform float uDispAmount, uDispFreq;
varying vec3 vNormal; varying vec3 vView; varying vec2 vUv; varying float vDisp;
${NOISE}
${LOOP_NOISE}
// Smooth 3D field; the sample offset travels a closed loop as uPhase goes 0→2π (seamless).
vec3 loopOffset(float k){ return vec3(uFlow * uLoopRadius * sin(uPhase + k), uLoopRadius * cos(uPhase + k)); }
vec3 displace(vec3 p, vec3 n){
  vec3 q = p * uDispFreq;
  float d = snoise(q + loopOffset(0.0)) * 0.88 + snoise(q * 1.6 + 7.3 + loopOffset(1.7)) * 0.12;
  return p + n * d * uDispAmount;
}
void main(){
  vUv = uv;
  vec3 n = normalize(normal);
  vec3 t = normalize(abs(n.y) < 0.99 ? cross(n, vec3(0.0, 1.0, 0.0)) : cross(n, vec3(1.0, 0.0, 0.0)));
  vec3 b = cross(n, t);
  float e = 0.01;
  vec3 p0 = displace(position, n);
  vec3 p1 = displace(position + t * e, n);
  vec3 p2 = displace(position + b * e, n);
  vec3 dn = normalize(cross(p1 - p0, p2 - p0));
  if (dot(dn, n) < 0.0) dn = -dn;
  vDisp = dot(p0 - position, n);
  vec4 mv = modelViewMatrix * vec4(p0, 1.0);
  vNormal = normalize(normalMatrix * dn);
  vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

export const MESH_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColor, uColor2, uLightColor, uLightDir;
uniform float uRough, uFresnel, uIrid, uIntensity, uAmbient, uOpacity, uTexMix, uHasTex;
uniform sampler2D uTex;
varying vec3 vNormal; varying vec3 vView; varying vec2 vUv; varying float vDisp;
void main(){
  vec3 n = normalize(vNormal), v = normalize(vView), l = normalize(uLightDir);
  vec3 base = mix(uColor, uColor2, smoothstep(-0.3, 0.3, vDisp) * 0.35);
  if (uHasTex > 0.5) base = mix(base, texture2D(uTex, vec2(vUv.x, 1.0 - vUv.y)).rgb, uTexMix);
  float ndl = max(dot(n, l), 0.0);
  vec3 h = normalize(l + v);
  float shin = mix(180.0, 6.0, uRough);
  float spec = pow(max(dot(n, h), 0.0), shin) * (1.0 - uRough * 0.7);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 2.0) * uFresnel;
  vec3 irid = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + dot(n, v) * 1.4 + vDisp * 2.0));
  vec3 col = base * (uAmbient + ndl * uIntensity * uLightColor);
  col += uLightColor * spec * uIntensity;
  col += mix(uColor2, irid * uColor2 * 1.6, uIrid) * fres * 0.6;
  col = 1.0 - exp(-col * 1.1);
  gl_FragColor = vec4(col, uOpacity);
}
`;

export const PARTICLE_VERT = /* glsl */ `
attribute vec4 aSeed;
uniform vec2 uRes;
uniform float uTimeP, uLife, uCycles, uVel, uDir, uSpread, uGravity, uNoiseAmt, uSize, uScale;
uniform vec2 uEmitter, uEmitSize;
uniform vec3 uAttr[8];
uniform int uAttrCount;
uniform vec3 uPointer;   // xy normalised, z = signed strength (0 = inactive)
varying float vAlpha; varying float vMix;
${NOISE}
void main(){
  float minDim = min(uRes.x, uRes.y);
  float tt = uTimeP + aSeed.x * uLife;
  float age = mod(tt, uLife);
  float cycle = mod(floor(tt / uLife), uCycles);     // wraps with the loop → seamless
  vec2 r = hash22(aSeed.yz * 97.0 + cycle * 13.13);
  float r2 = hash12(vec2(aSeed.w * 51.0, cycle * 7.7));
  vec2 spawn = (uEmitter + (r - 0.5) * uEmitSize) * uRes;
  float ang = radians(uDir) + (r2 - 0.5) * radians(uSpread);
  vec2 vel = vec2(cos(ang), -sin(ang)) * uVel * minDim * (0.4 + aSeed.w);
  vec2 p = spawn + vel * age + vec2(0.0, 0.5 * uGravity * minDim) * age * age;
  vec2 sp = spawn / minDim;
  p += uNoiseAmt * 0.12 * minDim * vec2(snoise(vec3(sp * 2.0, age * 0.35 + aSeed.x * 10.0)), snoise(vec3(sp * 2.0 + 17.0, age * 0.35 + aSeed.y * 10.0)));
  // Attractors: closed-form vortex. Particles rotate around the attractor and contract towards a
  // seeded orbit radius as they age; repulsors push outward. Pure function of (seed, age).
  for (int i = 0; i < 8; i++) {
    if (i >= uAttrCount) break;
    vec2 a = uAttr[i].xy * uRes;
    float s = uAttr[i].z;
    vec2 d = p - a;
    if (s >= 0.0) {
      float k = 1.0 - exp(-s * age * 1.5);
      float ang = s * age * (0.9 + 0.6 * aSeed.y) * (1.0 + 2.5 / (1.0 + length(d) / minDim * 6.0));
      float c = cos(ang), sn = sin(ang);
      d = mat2(c, sn, -sn, c) * d;
      float orbit = (0.06 + 0.32 * pow(aSeed.w, 1.6)) * minDim;
      d = mix(d, normalize(d + 1e-4) * orbit, k * 0.92);
    } else {
      d *= 1.0 + abs(s) * age * 0.35;
    }
    p = a + d;
  }
  if (uPointer.z != 0.0) {
    vec2 pp = uPointer.xy * uRes;
    vec2 d = p - pp;
    float f = exp(-dot(d, d) / (0.03 * minDim * minDim));
    p += normalize(d + 1e-4) * f * uPointer.z * 0.12 * minDim;
  }
  float lt = age / uLife;
  vAlpha = smoothstep(0.0, 0.12, lt) * (1.0 - smoothstep(0.72, 1.0, lt));
  vMix = aSeed.z;
  gl_PointSize = uSize * uScale * (0.55 + 0.9 * aSeed.w);
  gl_Position = vec4(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0, 0.0, 1.0);
}
`;

export const PARTICLE_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColorA, uColorB;
uniform float uOpacity;
uniform int uShape;
varying float vAlpha; varying float vMix;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float a;
  if (uShape == 0) a = smoothstep(0.5, 0.15, d);
  else if (uShape == 1) a = step(max(abs(c.x), abs(c.y)), 0.42);
  else if (uShape == 2) a = smoothstep(0.08, 0.0, abs(d - 0.34));
  else a = smoothstep(0.5, 0.0, d) * 0.4 + smoothstep(0.06, 0.0, min(abs(c.x), abs(c.y))) * smoothstep(0.5, 0.1, d);
  if (a <= 0.003) discard;
  gl_FragColor = vec4(mix(uColorA, uColorB, vMix), a * vAlpha * uOpacity);
}
`;

export const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

export const TEXT_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uTex; uniform float uOpacity;
varying vec2 vUv;
void main(){ vec4 c = texture2D(uTex, vUv); if (c.a < 0.002) discard; gl_FragColor = vec4(c.rgb, c.a * uOpacity); }
`;

export const IMAGE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uTex;
uniform float uHasTex, uImgAspect, uBoxAspect, uOpacity, uRadius, uDisp, uReveal;
uniform int uFit, uMask, uRevealMode;
uniform vec4 uCrop;
uniform vec2 uFocal;
varying vec2 vUv;
${NOISE}
${LOOP_NOISE}
float roundedBox(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
void main(){
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec2 box = vec2(uBoxAspect, 1.0);
  vec2 bp = (uv - 0.5) * box;           // box space, height = 1
  // reveal
  float rv = uReveal;
  if (uRevealMode == 2 && uv.x > rv * 1.1 - 0.05) discard;                       // wipe
  if (uRevealMode == 4 && length(bp) > rv * length(box) * 0.5 + 0.001) discard;  // iris
  // mask
  float alpha = 1.0;
  if (uMask == 1) alpha = smoothstep(0.5, 0.497, length(bp / vec2(uBoxAspect, 1.0)));
  else if (uMask == 2) alpha = smoothstep(0.002, -0.002, roundedBox(bp, box * 0.5, uRadius));
  else if (uMask == 3) alpha = smoothstep(0.0, 0.25, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)) * 2.0);
  if (alpha <= 0.0) discard;
  // fit within crop rect
  float crA = uImgAspect * uCrop.z / uCrop.w;
  vec2 t = uv;
  if (uFit == 0) { // cover
    if (crA > uBoxAspect) { float s = uBoxAspect / crA; t.x = (t.x - 0.5) * s + 0.5 + (uFocal.x - 0.5) * (1.0 - s); }
    else { float s = crA / uBoxAspect; t.y = (t.y - 0.5) * s + 0.5 + (uFocal.y - 0.5) * (1.0 - s); }
  } else if (uFit == 1) { // contain
    if (crA > uBoxAspect) { float s = crA / uBoxAspect; t.y = (t.y - 0.5) * s + 0.5; }
    else { float s = uBoxAspect / crA; t.x = (t.x - 0.5) * s + 0.5; }
    if (t.x < 0.0 || t.x > 1.0 || t.y < 0.0 || t.y > 1.0) discard;
  }
  if (uDisp > 0.0) t += uDisp * 0.03 * vec2(lnoise(t * 3.0, 0.0), lnoise(t * 3.0 + 4.0, 1.0));
  t = uCrop.xy + t * uCrop.zw;
  vec3 col;
  if (uHasTex > 0.5) col = texture2D(uTex, t).rgb;
  else { vec2 g = floor(uv * 12.0); col = mix(vec3(0.16), vec3(0.24), mod(g.x + g.y, 2.0)); }
  float a = alpha * uOpacity * (uRevealMode == 1 || uRevealMode == 3 ? rv : 1.0);
  gl_FragColor = vec4(col, a);
}
`;

/** Expert panel shader snippets: a constrained function body only, never a full program. */
export function validateShadeSnippet(src: string): string | null {
  if (src.length > 1500) return 'Snippet exceeds 1500 characters';
  if (/#|\b(for|while|do|discard|uniform|attribute|varying|texture2D|texture|gl_\w+|precision|layout|in|out|inout)\b/.test(src)) return 'Snippets cannot use preprocessor directives, loops, texture lookups, uniforms or built-in outputs';
  if (!/\breturn\b/.test(src)) return 'Snippet must return a vec3';
  const open = (src.match(/\{/g) ?? []).length, close = (src.match(/\}/g) ?? []).length;
  if (open !== close) return 'Unbalanced braces';
  return null;
}
