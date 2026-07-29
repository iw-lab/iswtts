// sherpa(Supertonic) 배속 매핑(순수 함수 — 테스트 대상).
//
// 사용자 방침(2026-07-06): 배속 상한 두지 않음 — 설정 배속은 무조건 그 속도로 재생하고
// 품질 판단은 사용자가 한다. 단 같은 속도에서 가장 잘 들리는 분담을 쓴다(Whisper CER 실측):
// - 모델 speed 솔로: 1.2=14%(온전), 1.5=26%, 2.0=72%, 3.0=82%, ≥4.0=전구간 무음.
// - 재생 스트레치(피치보정) 솔로(자연속도 소스): 2.0=10%, 3.0=18%, 3.2=22%, 3.5=62%(절벽).
// - 총 3.2× 초과에서는 "스트레치 고정 + 초과분 모델"이 순수 스트레치보다 우수
//   (3.6×: 조합38% vs 순수62% / 4.0×: 조합48% vs 순수76%).
// → 분담: 스트레치가 **2.1×**까지 우선 → 초과분은 모델(무음 경계 3.0 클램프) → 잔여는
//   다시 스트레치(하드맥스 10, expo-audio 패치 상한과 일치).
//   ⚠️ 이 경계는 v1.28.0에서 3.0 → 2.5, v1.29.0에서 2.5 → 2.1 로 내렸다(근거는 SONIC_FIRST_MAX 주석).
//   위 CER 수치들은 v1.11 시절 실측이고 같은 도구로 재현되지 않았다 — 현재 유효한 근거는
//   SONIC_FIRST_MAX 주석의 2026-07-26 실측이다.
// + 스마트 스피드(v1.11.0): >3×에서는 합성 오디오의 긴 쉼을 먼저 압축(smartSpeed.ts,
//   왜곡 0 배속 f≈1.1~1.3)하고, 그만큼 스트레치를 덜어낸다(실효 스트레치 = 3/f).
//   ≤3×는 미적용 — 사용자가 청감 확정한 소리를 바꾸지 않는다.

import { endsWithEllipsis } from '../../lib/pacing';

export const SHERPA_QUALITY_MAX = 3.2; // 품질 무손상 임계(시스템 음성 전환 옵션의 기준점)
// 스트레치 단독 온전 상한. **v1.29.0: 2.5 → 2.1**(사용자 요청 2026-07-29 "배속시 더
// 노력해봐", 상시 사용 배속 2.5~3.0×).
//
// v1.28.0 은 3.0× 에서 두 점만 비교해 "분담이 낫다"만 확인하고 경계를 2.5 로 놨다 —
// **어느 비율이 최선인지는 재지 않았다**. v1.29.0 에서 격자로 훑고(split_grid.py), 결론이
// 타깃마다 어긋나 노이즈로 판명돼 결정 지점만 표본 4배(문장 12 × 화자 2 = 24)로 짝비교
// 재측정했다(split_confirm.py, 2026-07-29):
//   2.5×  model 1.0(구) CER 0.216 → model 1.2 **0.123**  (문장별 개선 14 / 악화 6)
//   3.0×  model 1.2(구) CER 0.399 → model 1.4 **0.309**  (평균차 −0.090)
// 두 최적점이 가리키는 경계가 같다: 2.5/1.2 = 2.083, 3.0/1.4 = 2.143 → **2.1**.
// 독립된 두 타깃이 같은 값으로 수렴한 것이 이 상수의 근거다.
//
// 대가(정직하게): 모델 speed 는 F0 를 함께 바꾸므로 음색이 원음에서 더 멀어진다
// (mel 거리 2.5× 27.5 → 30.1). 명료도를 위해 음색 변화를 감수하는 교환이다.
// 2.0× 이하는 종전과 100% 동일하다 — 그 구간의 모델 개입은 CER 8배 악화로 이미 확인됐다.
// ⚠️ 이 실측의 스트레치는 WSOLA 간이판이고 앱의 실제 재생은 Android Media3 의 Sonic 이다 —
// 같은 시간영역 계열이지만 동일 구현은 아니다. 절벽의 정확한 위치는 실기기 청감으로 확인할 것.
const SONIC_FIRST_MAX = 2.1;
// 스마트 스피드(무음 압축) 시작 배속. ⚠️ SONIC_FIRST_MAX 와 분리해 둔다(v1.28.0) — 예전엔
// 같은 상수를 공유해서, 스트레치 경계를 내리면 무음 압축까지 함께 켜져 낭독 리듬이 통째로
// 바뀌었다. 두 경계는 서로 다른 근거로 움직인다.
//
// ⚠️ v1.29.0에서 3.0× 를 압축 대상에 **포함시켰다가 되돌렸다**. 그 판단 근거를 남긴다 —
// 같은 실수를 반복하지 않도록.
//   짝비교 CER(n=24, chop3x.py): 3.0× 압축 없음 0.361 → 압축 0.254 (개선 14/악화 8).
//   숫자만 보면 명백한 개선이라 채택했는데, **사용자 청감은 정반대였다**
//   (2026-07-29 "압축 없는 게 더 낫다. 압축한 게 끝에 잘린다").
//   재현: 압축은 문장 사이 쉼을 길이 무관하게 80ms 로 깎는데, 그중 400·320ms 짜리는
//   문장 사이 쉼이 아니라 **문장 끝 여운**이다. 재생 시 190ms·152ms → 둘 다 42ms.
//   마지막 음절이 사그라들기 전에 다음 문장이 들어와 "끝이 잘린" 것처럼 들린다.
//   CER 은 이걸 못 본다 — 글자는 그대로라 오히려 점수가 좋아진다("알아들림 ≠ 좋게 들림",
//   22kHz 다운샘플 사건과 같은 교훈).
//   ⇒ 다시 시도한다면 "압축을 켜냐 마냐"가 아니라 **긴 쉼(문장 끝 여운)은 건드리지 않는
//     선택적 압축**이어야 한다. 그전까지는 3.0× 를 제외한다.
// 같은 실측에서 모델 분담 확대(1.60·1.75)는 확실히 나빠 기각했다(개선 5/악화 18, 1/22).
const SMART_SPEED_MIN = 3.0;
const MODEL_MAX = 3.0; // 모델 speed ≥4.0 = 전 구간 무음(실측) — 하드 경계
const PLAYBACK_HARD_MAX = 10.0; // expo-audio 패치(coerceIn 상한)와 일치
const PLAYBACK_MIN = 0.5; // expo-audio 재생속도 하한(coerceIn) — trimFactorBudget 의 근거

// 모델이 분담할 배수. 저속(≤1×)은 모델 전담, 스트레치 온전 구간(≤SONIC_FIRST_MAX)은 모델 개입 금지,
// 그 초과분만 모델이 흡수한다.
export function sherpaModelSpeed(rate?: number): number {
  const r = Number.isFinite(rate as number) ? (rate as number) : 1.0;
  if (r <= 1) return Math.max(0.5, r);
  if (r <= SONIC_FIRST_MAX) return 1;
  return Math.min(MODEL_MAX, r / SONIC_FIRST_MAX);
}

// 짧은 문장 템포 평준화(v1.24.0). 모델은 짧은 입력을 눈에 띄게 빠르게 읽는다(실측
// 2026-07-19: 평문 8.0±0.6 syl/s vs 장문 5.9~6.6 — 긴 문장 뒤 짧은 문장에서 "갑자기
// 빨라짐" 체감의 진범). 음절 수 기준으로 소폭 늦춰(≤12음절 0.88, 35음절+ 1.0 선형)
// 문장 간 템포를 고르게 한다. 실측: 0.88 → 8.45→7.51 syl/s.
// ⚠️ v1.26.1: 적용처가 합성 speed → "재생 스트레치"로 이동(sherpaPaceComp). 모델 speed 는
// F0(음높이)를 함께 바꾼다는 실측(0.90 → +10Hz/+5%, tone_probe EXP2 2026-07-20) — 짧은
// 문장마다 톤이 붕 뜨는 "톤 깨짐"의 원인이었다. 재생 스트레치는 피치 보존이라 페이스만
// 변한다. 텍스트의 순수 함수인 건 동일(캐시 파일과 자동 정합 — 이제 파일에 굽지도 않는다).
const TEMPO_FULL_SYL = 35;
const TEMPO_SHORT_SYL = 12;
const TEMPO_MIN_COMP = 0.88;
export function sherpaTempoComp(text: string): number {
  let syl = 0;
  for (const c of text) if (c >= '가' && c <= '힣') syl++;
  if (syl >= TEMPO_FULL_SYL) return 1;
  const t = Math.max(0, syl - TEMPO_SHORT_SYL) / (TEMPO_FULL_SYL - TEMPO_SHORT_SYL);
  return TEMPO_MIN_COMP + (1 - TEMPO_MIN_COMP) * t;
}

// 루바토(문장 완급 변주, v1.25.0). 사용자 발견에서 출발: 1.5× 낭독 중 모델이 장문을
// 고유하게 천천히 읽는 순간이 "오히려 사람 같다" — 그 완급을 의도된 변주로 정식화한다.
// 문장의 ~30%만(가끔이어야 사람같다) 결정론 해시로 골라 0.90~0.96 으로 늦춘다(실측
// 2026-07-20: 발화속도 −3~−7%, Whisper CER 열화 없음 — rubato_probe.py).
// ⚠️ v1.26.1: 적용처가 합성 speed → 재생 스트레치로 이동(sherpaPaceComp — tempoComp 주석의
// F0 실측 근거 동일). 원문 텍스트의 순수 함수라 같은 문장은 항상 같은 완급(재생마다
// 달라지면 "고장"으로 들린다).
// "너무 느려지지만 않으면"(사용자 조건) → 하한 0.90, tempoComp 와 곱 하한은
// SPEED_COMP_FLOOR 로 클램프(sherpaPaceComp).
const RUBATO_PORTION = 0.3;
const RUBATO_MIN = 0.9;
const RUBATO_MAX = 0.96;
// 문맥 완급(v1.26.0): 말줄임(…)으로 끝나는 문장은 주사위와 무관하게 "항상" 느긋하게 —
// 사람 낭독자는 여운 문장을 끌어 읽는다(일레븐랩스류 대형 모델이 학습으로 얻는 문맥
// 프로소디를, 우리는 구두점 단서로 규칙화). 감속 폭은 검증 구간(0.90 하한) 안에서 살짝
// 깊게 0.90~0.94 — pacing.ts 의 말줄임 여운 쉼(+250ms)과 합쳐져 하나의 관습이 된다.
const ELLIPSIS_RUBATO_MIN = 0.9;
const ELLIPSIS_RUBATO_MAX = 0.94;
// tempoComp × rubato 곱의 하한 — 실측 검증 구간(0.88 단독 −11%) 근방까지만 허용.
export const SPEED_COMP_FLOOR = 0.85;
// 루바토를 적용하는 배속 상한(v1.27.1). 루바토는 1~1.5× 감상 속도에서 "사람 같다"로 태어난
// 기능인데(v1.25.0), 2.5× 훑어 듣기에선 문장 ~30%가 4~10% 느려지는 게 "가끔 문장이
// 느려진다"는 결함으로 체감된다(사용자 보고 2026-07-23 — 말줄임 문장은 "항상" 감속이라
// 말줄임 많은 소설에서 특히 잦다). 완급 변주가 의미 있는 통상 감상 속도(≤2×)에만 적용.
// 템포 평준화(tempoComp)는 모델의 짧은 문장 과속 "보정"이라 게이트하지 않는다.
export const RUBATO_MAX_RATE = 2.0;
/** 이 배속에서 루바토(문장 완급 변주)가 실효인가 — sherpaPaceComp 와 재생부(pacing
 *  afterRubato 숨 고르기 판정)가 같은 게이트를 공유한다. */
export function rubatoActive(rate?: number): boolean {
  return !Number.isFinite(rate as number) || (rate as number) <= RUBATO_MAX_RATE;
}
export function sherpaRubato(text: string): number {
  // djb2 — pacing.ts 지터와 같은 계열(결정론 변주의 공용 도구).
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  const v = (h >>> 10) % 1000; // 감속 정도 주사위(선택과 다른 비트 대역)
  if (endsWithEllipsis(text)) {
    return ELLIPSIS_RUBATO_MIN + ((ELLIPSIS_RUBATO_MAX - ELLIPSIS_RUBATO_MIN) * v) / 1000;
  }
  const u = (h >>> 0) % 1000; // 선택 주사위(하위 비트)
  if (u >= RUBATO_PORTION * 1000) return 1;
  return RUBATO_MIN + ((RUBATO_MAX - RUBATO_MIN) * v) / 1000;
}

// 스마트 스피드(무음 압축) 적용 여부 — 확정된 소리(≤3×)는 건드리지 않고, 훑어 듣는
// 초고배속에서만 쉼을 압축해 스트레치 부담을 덜어낸다(3.0× 를 제외하는 근거는
// SMART_SPEED_MIN 주석의 청감 실측).
export function sherpaTrimEnabled(rate?: number): boolean {
  return Number.isFinite(rate as number) && (rate as number) > SMART_SPEED_MIN;
}

// 재생 완급 인자(v1.26.1) — 템포 평준화 × 루바토를 "피치 보존 재생 스트레치"에 곱한다.
// 최종 재생속도 = sherpaPlaybackRate(rate, trim) × sherpaPaceComp(...). 합성 speed 는 이제
// 순수 sherpaModelSpeed 만(F0 부작용 근거는 sherpaTempoComp 주석) — 완급이 파일에 안
// 구워지므로 캐시 키에서 루바토 플래그도 사라진다.
// >3×(스마트 스피드)는 훑어 듣는 속도라 완급 무의미 + 압축 몫 계산과 얽히지 않게 1 고정.
// 하한: comp ≤ 1 이고 rate ≤ 1 에서도 최종 재생속도 = 1 × comp ≥ SPEED_COMP_FLOOR(0.85)
// ≥ expo-audio 하한(0.5) — 클램프 충돌 없음.
export function sherpaPaceComp(
  tempoComp: number,
  rubatoRaw: number,
  opts: { rate?: number; rubatoOn?: boolean },
): number {
  if (sherpaTrimEnabled(opts.rate)) return 1;
  const t = Number.isFinite(tempoComp) && tempoComp > 0 ? tempoComp : 1;
  const r =
    opts.rubatoOn && rubatoActive(opts.rate) && Number.isFinite(rubatoRaw) && rubatoRaw > 0
      ? rubatoRaw
      : 1;
  // min(1): 현 도메인(t·r ≤ 1)에선 no-op — 미래에 가속 변주(>1)가 생겨도 완급이 설정
  // 배속을 넘지 않게 하는 방어선.
  return Math.max(SPEED_COMP_FLOOR, Math.min(1, t * r));
}

// ⚠️ v1.27.3에서 "고배속에서는 tempoComp 도 1 로 수렴시키자"는 안을 검토했다가 **기각**했다
// (교차검증 codex, 실측 재확인). 근거 둘:
//  ① tempoComp 는 편차를 "만드는" 게 아니라 "줄이는" 보정이다 — 이 모델은 짧은 입력을
//     7.0 syl/s, 긴 입력을 5.9 syl/s 로 읽는다(실측 2026-07-24 chunktempo_probe, +20%).
//     0.88 을 걷어내면 짧은 문장이 오히려 20% 빨라져 문장 간 템포 차가 커진다.
//  ② 짧은 문장을 12% 빨리 소비하면 그만큼 합성 파이프라인 여유(avgRtf×rate<1)가 깎인다 —
//     사용자 기기는 2.5×에서 이미 경계다.
// 문장 "안"에서 앞이 느리고 뒤가 빨라지던 진짜 원인은 청크 길이 편차였고, 그건 chunkKo 의
// 균등 분배로 잡았다(재생 속도를 건드리지 않으므로 ②와 충돌하지 않는다).

/** 무음 압축이 가져가도 되는 최대 몫 — 이보다 크면 필요한 재생속도가 expo-audio 하한(0.5)
 *  아래로 내려가 클램프에 걸리고, 그 순간 "모델 × 압축 × 재생속도 = 설정 배속" 계약이 깨져
 *  **설정보다 빠르게** 재생된다(교차검증 codex 2026-07-29). 압축 단계에서 이 예산을 넘으면
 *  압축을 포기하는 쪽이 맞다 — 실측 압축비는 f≈1.1~1.3 이라 평소엔 닿지 않는다. */
export function trimFactorBudget(rate?: number): number {
  const r = Number.isFinite(rate as number) ? (rate as number) : 1;
  if (r <= 1) return 1;
  return Math.max(1, r / (sherpaModelSpeed(r) * PLAYBACK_MIN));
}

// 재생속도가 분담할 배수(전체 ÷ 모델 몫 ÷ 무음압축 몫). trimFactor = 압축으로 이미 번
// 배속(원본길이÷압축길이, 미압축=1). 곱 불변식: 모델 × trimFactor × 재생속도 = 설정 배속.
export function sherpaPlaybackRate(rate?: number, trimFactor: number = 1): number {
  const r = Number.isFinite(rate as number) ? (rate as number) : 1.0;
  if (r <= 1) return 1;
  const f = Number.isFinite(trimFactor) && trimFactor >= 1 ? trimFactor : 1;
  // 하한 0.5: 쉼이 극단적으로 많은 문장에서 압축만으로 목표 배속을 넘어선 경우 되레 늦춰
  // 설정 배속을 정확히 지킨다(현실적으론 f<3 이라 거의 항상 >1).
  return Math.max(PLAYBACK_MIN, Math.min(PLAYBACK_HARD_MAX, r / (sherpaModelSpeed(r) * f)));
}
