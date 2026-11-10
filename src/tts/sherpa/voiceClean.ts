// 목소리 깨짐 방지(v1.33.0) — 유튜브 낭독에서 사용자가 귀로 고른 두 목소리를 앱에 넣는다.
//   · «6.25 여자 목소리» = 화자 1(sid 0) + 치찰음 누르기(deess) + 파열음 누르기(tame)
//       사용자 2026-10-24 「태평양전쟁 여자 목소리는 배속하면 약간씩 튀어」 → 치찰 p90 −5.4→−8.1dB(말 중앙 대비)
//   · «삼국지 남자 목소리» = 화자 6(sid 5) + 파열음 누르기(tame)
//       사용자 2026-10-13 「배속시 파열음이 나는 구간 · 최소 2배속까지 안 나도록」 → 고역 폭발 분당 21~24 → 2~3
// 정본 = ~/.claude/skills/yt-video-builder/scripts/tts_burst_tame.py (bt3) — 상수·단계를 그대로 옮겼다.
// 두 처리 모두 «고역(≥5kHz) 성분만» 이득을 곱하고 저역(모음·말의 몸통)은 그대로 — 샘플 수 불변(자막 정렬·길이 그대로).
// 옮기지 않은 것: 유튜브의 «청크마다 3~4번 뽑아 가장 맑은 것»(톤 고정·잡음 거름) — 합성을 3~4배 돌려 배터리가 그만큼 든다(voiceStable.ts 와 같은 판단).

export type CleanMode = 'deess+tame' | 'tame';

/** 앱 목소리 목록에 넣는 «이름 붙은 목소리». id = `${sid}:${key}` — 엔진은 parseInt 로 sid 를 읽고, 캐시 키는 전체 id 로 갈린다. */
export const VOICE_PRESETS: { id: string; sid: number; name: string; clean: CleanMode }[] = [
  { id: '0:w625', sid: 0, name: '6.25 여자 목소리 (맑게)', clean: 'deess+tame' },
  { id: '5:samguk', sid: 5, name: '삼국지 남자 목소리 (안 깨지게)', clean: 'tame' },
];

export function presetOf(voiceId: string | undefined | null) {
  return VOICE_PRESETS.find((p) => p.id === voiceId) || null;
}

const FC = 5000;
const T_DB = 6, RATIO = 8, MAX_CUT = 18, HALF_MS = 12;          // tame (bt3)
const SIB_T = 11, SIB_R = 0.8, SIB_MAX = 8;                     // deess (bt3)

// ── 4차 버터워스 하이패스(2단 바이쿼드) 앞뒤로 = scipy butter(4,…,'high') + sosfiltfilt 와 같은 크기 응답 ──
function biquadHP(fc: number, sr: number, q: number) {
  const w = (2 * Math.PI * fc) / sr, c = Math.cos(w), al = Math.sin(w) / (2 * q), a0 = 1 + al;
  return { b0: (1 + c) / 2 / a0, b1: -(1 + c) / a0, b2: (1 + c) / 2 / a0, a1: (-2 * c) / a0, a2: (1 - al) / a0 };
}
function runBiquad(x: Float64Array, f: ReturnType<typeof biquadHP>, reverse: boolean) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const n = x.length;
  for (let k = 0; k < n; k++) {
    const i = reverse ? n - 1 - k : k, xi = x[i];
    const yi = f.b0 * xi + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = yi; x[i] = yi;
  }
}
/** 고역 성분(≥ FC) — 위상 0(앞뒤 두 번) */
export function highpass(samples: ArrayLike<number>, sr: number, fc = FC): Float64Array {
  const h = Float64Array.from(samples as ArrayLike<number>);
  const s1 = biquadHP(fc, sr, 0.5411961), s2 = biquadHP(fc, sr, 1.3065630);
  runBiquad(h, s1, false); runBiquad(h, s2, false); runBiquad(h, s2, true); runBiquad(h, s1, true);
  return h;
}

function movMax(a: Float64Array, size: number) {
  const r = Math.floor(size / 2), out = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) { let m = -Infinity; for (let j = Math.max(0, i - r); j <= Math.min(a.length - 1, i + r); j++) if (a[j] > m) m = a[j]; out[i] = m; }
  return out;
}
/** 이동 평균(가장자리 = 끝값 반복, scipy uniform_filter1d mode='nearest') — 누적합 O(n). 샘플 단위(수십만 개)에도 쓴다 */
function movMean(a: Float64Array, size: number) {
  const r = Math.floor(size / 2), n = a.length, w = 2 * r + 1, out = new Float64Array(n);
  const at = (j: number) => a[j < 0 ? 0 : j >= n ? n - 1 : j];
  let s = 0;
  for (let j = -r; j <= r; j++) s += at(j);
  for (let i = 0; i < n; i++) { out[i] = s / w; s += at(i + r + 1) - at(i - r); }
  return out;
}
function movMedian(a: Float64Array, size: number) {
  const r = Math.floor(size / 2), out = new Float64Array(a.length), w: number[] = new Array(2 * r + 1);
  for (let i = 0; i < a.length; i++) { for (let j = -r; j <= r; j++) w[j + r] = a[Math.min(a.length - 1, Math.max(0, i + j))]; w.sort((p, q) => p - q); out[i] = w[r]; }
  return out;
}
/** 프레임 이득(dB 깎을 양) → 샘플 이득, 고역에만 곱해 되돌린다 */
function applyHfGain(x: ArrayLike<number>, h: Float64Array, redDb: Float64Array, frame: number, smooth: number): Float32Array {
  const n = x.length, gs = new Float64Array(n);
  const fg = new Float64Array(redDb.length); for (let f = 0; f < redDb.length; f++) fg[f] = 10 ** (-redDb[f] / 20);   // 거듭제곱은 프레임마다 한 번(샘플마다면 폰에서 느리다)
  for (let i = 0, f = 0, k = 0; i < n; i++) { gs[i] = f < fg.length ? fg[f] : 1; if (++k === frame) { k = 0; f++; } }
  const g = movMean(gs, smooth % 2 ? smooth : smooth + 1);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) y[i] = (x[i] - h[i]) + h[i] * g[i];
  return y;
}

/** 파열음(터지는 자음의 순간 고역 폭발)만 누른다 — 배속 재생에서 «딱·툭» 방지 */
export function tame(x: ArrayLike<number>, sr: number): Float32Array {
  const h = highpass(x, sr), n = Math.max(1, Math.round(sr * 0.001)), m = Math.floor(x.length / n);
  if (m < 2 * HALF_MS + 2) return Float32Array.from(x as ArrayLike<number>);
  const e = new Float64Array(m);
  for (let f = 0; f < m; f++) { let s = 0; for (let i = f * n; i < f * n + n; i++) s += h[i] * h[i]; e[f] = 20 * Math.log10(Math.sqrt(s / n + 1e-14) + 1e-7); }
  const ref = movMedian(e, 2 * HALF_MS + 1), red = new Float64Array(m);
  for (let f = 0; f < m; f++) red[f] = Math.min(MAX_CUT, Math.max(0, (e[f] - ref[f] - T_DB) * (1 - 1 / RATIO)));
  const r2 = movMean(movMax(red, 5), 3);
  return applyHfGain(x, h, r2, n, Math.max(3, Math.round(sr * 0.002)));
}

/** 치찰음(ㅅ·ㅆ·ㅊ 의 길게 이어지는 쉿 소리)을 말 중앙 레벨 기준으로 누른다 */
export function deess(x: ArrayLike<number>, sr: number): Float32Array {
  const h = highpass(x, sr), n = Math.max(1, Math.round(sr * 0.005)), m = Math.floor(x.length / n);
  if (m < 10) return Float32Array.from(x as ArrayLike<number>);
  const lf = new Float64Array(m), lh = new Float64Array(m);
  let maxLf = -Infinity;
  for (let f = 0; f < m; f++) {
    let ef = 0, eh = 0;
    for (let i = f * n; i < f * n + n; i++) { ef += x[i] * x[i]; eh += h[i] * h[i]; }
    lf[f] = 10 * Math.log10(ef / n + 1e-12); lh[f] = 10 * Math.log10(eh / n + 1e-12); if (lf[f] > maxLf) maxLf = lf[f];
  }
  const sp: number[] = []; for (let f = 0; f < m; f++) if (lf[f] > maxLf - 40) sp.push(lf[f]);
  if (sp.length < 10) return Float32Array.from(x as ArrayLike<number>);
  sp.sort((a, b) => a - b);
  const ref = sp.length % 2 ? sp[(sp.length - 1) / 2] : (sp[sp.length / 2 - 1] + sp[sp.length / 2]) / 2;
  const red = new Float64Array(m);
  for (let f = 0; f < m; f++) red[f] = Math.min(SIB_MAX, Math.max(0, (lh[f] - (ref - SIB_T)) * SIB_R));
  const r2 = movMean(movMax(red, 3), 3);
  return applyHfGain(x, h, r2, n, Math.max(3, Math.round(sr * 0.003)));
}

/** 프리셋대로 처리 — 같은 길이 Float32Array. 프리셋이 아니면 그대로 */
export function cleanVoice(samples: ArrayLike<number>, sr: number, voiceId: string | undefined | null): Float32Array | null {
  const p = presetOf(voiceId);
  if (!p) return null;
  const a = p.clean === 'deess+tame' ? deess(samples, sr) : samples;
  return tame(a, sr);
}
