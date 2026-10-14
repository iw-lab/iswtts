// 음성 안정화(v1.32.0) — 유튜브 낭독·삼국지 남성 목소리 튜닝에서 배운 것 중 **폰에서 공짜에
// 가까운 것만** 옮긴다. 실측: 앱 HQ 팩(int8 vector_estimator + fp32 vocoder) · 소설 94문장 ×
// 화자 0/6 × 시드 3, 앱 후처리 경로(컴파일한 smartSpeed.ts) 그대로 — 2026-10-14.
//
// ① 문장별 고정 시드. Supertonic 은 flow-matching 이라 시드가 없으면 같은 문장도 매번 다른
//    소리다(음량 폭: 같은 문장 시드 3개 사이 중앙 0.93dB · 최대 3.8dB). 시드를 텍스트에 묶으면
//    일시정지·되감기·배속 경계로 다시 합성돼도 **같은 문장은 같은 목소리**로 돌아온다.
//    sherpa-onnx 1.12.34(앱 네이티브)의 Supertonic 은 extra.seed 를 받는다(소스 확인
//    offline-tts-supertonic-impl.cc: GetExtraInt("seed", -1)) — 같은 시드 2회 = 샘플 완전 일치 실측.
// ② 문장 음량 고르기. 문장마다 합성 음량이 흔들린다(표준편차 1.1dB · 폭 6dB · ±3dB 밖 3~4%).
//    유튜브에서 사용자가 「이 문장만 작게·답답하게」를 짚은 차이가 3.9dB 였다. 길이를 바꾸지
//    않는 이득만 곱하고(자막 정렬 불변), 첨두가 넘치면 이득을 깎는다(클리핑은 작은 것보다 나쁘다
//    — 유튜브 교훈). 서로 다른 화자(지문↔대사)도 같은 목표로 맞춰 화자 교대 때 음량이 안 튄다.
//
// 옮기지 **않은** 것(근거):
//  · 톤 고정(시드 K번 뽑아 기준 음높이에 가장 가까운 것) — 합성을 3배 돌린다 = 배터리 3배.
//  · 「마지막 유성 덩어리 < 80ms = 결함」 재합성 — 이 화자에선 「-었다」의 ㄷ 폐쇄 뒤 「다」를
//    세어 17% 오탐(smartSpeed.ts 반증 주석). 오탐 위에 재합성을 얹으면 배터리만 탄다.

/** 텍스트·화자 → 고정 시드(0 ~ 2^31−2). 네이티브는 int32 로 파싱한다(ToIntOrDefault). */
export function synthSeed(text: string, sid: string | number): number {
  let h = 5381;
  const s = `${sid}\u0000${text}`;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0) % 2147483647;
}

// 음량 측정: 20ms 프레임 RMS 중 피크 프레임 대비 −25dB 이상인 "말하는 프레임"의 평균 전력.
const LEVEL_FRAME_MS = 20;
const LEVEL_ACTIVE_REL_DB = -25;
/** 목표 음량(dBFS, 말하는 프레임 평균). 실측 중앙값(sid 0 −23.4 · sid 6 −22.7)에 맞춘 값 —
 *  대부분의 문장은 거의 안 건드리고 튀는 문장만 당긴다. */
export const LEVEL_TARGET_DB = -23;
/** 편차를 얼마나 메우나(1 = 전부). 같은 문장도 시드마다 ±1dB 흔들리는 걸 보면 문장 간 차이는
 *  대부분 표현이 아니라 잡음이다 — 그래도 외침·속삭임의 결은 조금 남긴다. */
const LEVEL_CORRECTION = 0.85;
/** 이득 상한(dB). 이보다 크게 벗어난 건 측정 실패·퇴화 입력으로 보고 더 당기지 않는다. */
const LEVEL_MAX_GAIN_DB = 6;
/** 첨두 상한(선형). 이득을 곱한 뒤에도 이 아래여야 한다 — 넘으면 이득을 깎는다. */
const LEVEL_PEAK_CEIL = 0.95;

/** 말하는 프레임의 평균 음량(dBFS). 소리가 없으면 null. */
export function speechLevelDb(samples: ArrayLike<number>, sampleRate: number): number | null {
  const win = Math.max(1, Math.round((sampleRate * LEVEL_FRAME_MS) / 1000));
  const frames = Math.floor(samples.length / win);
  if (frames < 1) return null;
  const pw = new Float64Array(frames);
  let maxPw = 0;
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const base = f * win;
    for (let i = 0; i < win; i++) sum += samples[base + i] * samples[base + i];
    pw[f] = sum / win;
    if (pw[f] > maxPw) maxPw = pw[f];
  }
  if (maxPw <= 1e-12) return null;
  const floor = maxPw * 10 ** (LEVEL_ACTIVE_REL_DB / 10);
  let acc = 0;
  let n = 0;
  for (let f = 0; f < frames; f++) if (pw[f] >= floor) { acc += pw[f]; n++; }
  return n ? 10 * Math.log10(acc / n) : null;
}

export type LevelResult = { samples: number[]; gainDb: number };

/** 문장 음량을 목표로 당긴다(길이 불변 · 클리핑 금지). 입력 배열을 제자리에서 바꾼다. */
export function levelUtterance(samples: number[], sampleRate: number): LevelResult {
  const lvl = speechLevelDb(samples, sampleRate);
  if (lvl === null) return { samples, gainDb: 0 };
  let gainDb = Math.max(-LEVEL_MAX_GAIN_DB, Math.min(LEVEL_MAX_GAIN_DB, (LEVEL_TARGET_DB - lvl) * LEVEL_CORRECTION));
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
  }
  if (peak > 0) {
    // 이득 후 첨두가 상한을 넘지 않게(원본이 이미 상한 위면 그만큼 살짝 줄인다).
    gainDb = Math.min(gainDb, 20 * Math.log10(LEVEL_PEAK_CEIL / peak));
  }
  if (Math.abs(gainDb) < 0.1) return { samples, gainDb: 0 };
  const g = 10 ** (gainDb / 20);
  for (let i = 0; i < samples.length; i++) samples[i] *= g;
  return { samples, gainDb };
}
