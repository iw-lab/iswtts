// 합성 단계 수(flow-matching num_steps) 선택 — 순수 함수(테스트 대상). v1.34.0
//
// 🔑 「정속에서도 약간 기계음」의 본체는 **단계 수 5**였다(실측 2026-11-23, lab-1123).
// 앱 HQ 팩 · 앱과 같은 시드 · 귀 대용 예측기(UTMOS22 strong · NISQA) — 사람 청취 MOS 로 학습된
// 모델이라 「알아들림」(Whisper CER)이나 무음 잡음 바닥과 달리 **목소리의 자연스러움**을 잰다.
//   단계   UTMOS  NISQA  합성 비용(맥 RTF)
//    3     1.58   3.34   0.089
//    4     2.95   4.86   0.108
//    5     3.37   4.93   0.138   ← v1.33 까지의 값
//    6     3.63   5.06   0.175   (5 대비 30문장 중 27 개선 · 평균 +0.25)
//    8     3.72   5.08   0.223   (29 개선 · +0.35)
//   12     3.73   5.10   0.344   ← 8 에서 포화. 더 올려도 전기만 든다
// 화자 10명 전부 같은 방향(+0.31 ~ +0.49, 화자당 10문장 중 8~10 개선).
// 배속 뒤에도 남는다(Media3 Sonic 을 그대로 통과시킨 뒤): 1.5× +0.28(25/28) · 2.0× +0.12 ·
// 2.5× +0.02(예측기 바닥) — 그래서 느긋한 속도일수록 단계를 더 쓴다.
//
// ⚠️ 과거 기록 「단계를 올려도 이득 0」(v1.19, sherpaModel.ts)은 **무음 구간 잡음 바닥**만 본
// 결론이었다. 그 척도는 말소리의 거칠음을 못 본다 — CER·잡음 바닥에 이어 세 번째 같은 함정이다.
//
// 대가는 CPU(= 배터리)다. 화면 끈 정속 낭독에서 앱 CPU 의 92% 가 합성이고(에뮬 실측, 스레드별
// /proc: 합성 두 스레드 92.1% · JS 3.6% · 재생 2.3%), 합성 비용은 단계 수에 거의 비례한다
// (비용 ≈ 0.4 + 단계). 그래서
//   ① 기기가 감당할 때만 올린다 — 실측 RTF × 배속이 예산을 넘으면 한 칸씩 내린다(캐시가 마르면
//      낭독이 끊긴다. 자연스러움보다 안 끊기는 게 먼저다).
//   ② 「절전 낭독」(설정 · 취침 타이머 동안 자동)이면 5 로 내린다 = v1.33 과 같은 소리·같은 전기.

/** v1.33 까지의 값이자 절전 값. 이 아래로는 내리지 않는다(4 = UTMOS −0.42, 귀에 들린다). */
export const STEPS_SAVER = 5;
const STEPS_FULL = 8;
const STEPS_MID = 6;

/** 단계 수의 합성 비용(5단계 = 1). 실측 RTF 3·4·8·12·20단계의 직선 맞춤: RTF ≈ 0.0265 × (0.4 + 단계). */
export function stepCost(steps: number): number {
  return (0.4 + steps) / (0.4 + STEPS_SAVER);
}

/** 이 배속에서 「여유가 있다면」 쓰고 싶은 단계. 이득이 남는 구간에만 쓴다(위 표). */
export function desiredSteps(rate?: number): number {
  const r = Number.isFinite(rate as number) ? (rate as number) : 1;
  if (r <= 1.5) return STEPS_FULL;
  if (r <= 2.0) return STEPS_MID;
  return STEPS_SAVER;
}

/** 합성이 재생을 넉넉히 앞서는 선. RTF × 배속 ≥ 1 이면 캐시가 마른다 — 문장 길이 편차와 발열
 *  스로틀링 몫을 남겨 0.8 에서 끊는다(player.ts 의 느린 기기 경고는 0.9). baseRtf 가 지수이동평균이라
 *  발열로 느려지면 다음 문장부터 스스로 내려간다. 0.6 이던 초안은 에뮬(5단계 RTF 0.42)에서 정속조차
 *  6단계로 깎여 이득을 반만 줬다 — 정속의 실제 재생은 0.9× 안팎이라 여유는 그보다 더 있다. */
export const STEP_BUDGET = 0.8;

/**
 * 이번 합성에 쓸 단계 수.
 * baseRtf = 이 기기의 「5단계 환산」 합성 RTF(stats.ts — 실제 쓴 단계의 비용으로 나눈 값). 아직
 * 모르면(null) 원하는 단계로 시작하고, 표본이 쌓이면 이 함수가 알아서 내린다.
 */
export function sherpaSteps(rate?: number, opts: { saver?: boolean; baseRtf?: number | null } = {}): number {
  if (opts.saver) return STEPS_SAVER;
  const r = Number.isFinite(rate as number) && (rate as number) > 0 ? (rate as number) : 1;
  let steps = desiredSteps(r);
  const base = opts.baseRtf;
  if (base != null && Number.isFinite(base) && base > 0) {
    // 재생이 소비하는 속도는 설정 배속(≥1 은 재생 스트레치, <1 은 모델이 길게 만든다 → 1 로 본다).
    const consume = Math.max(1, r);
    if (steps === STEPS_FULL && base * stepCost(STEPS_FULL) * consume > STEP_BUDGET) steps = STEPS_MID;
    if (steps === STEPS_MID && base * stepCost(STEPS_MID) * consume > STEP_BUDGET) steps = STEPS_SAVER;
  }
  return steps;
}

/** 1스레드 합성의 벽시계 비용(2스레드 = 1). 실측(lab-1123 threads.py, 앱 HQ 팩 12문장 × 2회):
 *  1스레드 RTF 0.264·0.275 / 2스레드 0.170·0.159 → 1.6배 느리다. 대신 CPU초(= 전기)는
 *  낭독 1초당 0.259·0.269 / 0.329·0.317 → **18~21% 적다**(스레드 동기화·스핀 대기 몫). */
export const THREAD1_COST = 1.6;

/**
 * 합성 스레드 수. 「절전 낭독」이고 1스레드로도 넉넉히 앞설 때만 1(전기 −20%), 아니면 2.
 * 모델을 다시 올려야 바뀌므로(수백 ms) 여유선은 단계(0.8)보다 빡빡하게 0.7. 버거워 되돌리면 엔진이 그 세션에선 다시 안 내린다.
 */
export function sherpaThreads(rate?: number, opts: { saver?: boolean; baseRtf?: number | null } = {}): 1 | 2 {
  if (!opts.saver) return 2;
  const base = opts.baseRtf;
  if (base == null || !Number.isFinite(base) || base <= 0) return 2;
  const r = Number.isFinite(rate as number) && (rate as number) > 0 ? (rate as number) : 1;
  return base * THREAD1_COST * Math.max(1, r) <= 0.7 ? 1 : 2;
}
