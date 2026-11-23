import { sherpaThreads, THREAD1_COST, sherpaSteps, desiredSteps, stepCost, STEPS_SAVER, STEP_BUDGET } from '../tts/sherpa/quality';
import { recordSynth, sherpaStats, resetSherpaStats } from '../tts/sherpa/stats';

beforeEach(() => resetSherpaStats());

test('느긋한 속도일수록 단계를 더 쓴다(이득이 남는 구간에만)', () => {
  expect(desiredSteps(1)).toBe(8);
  expect(desiredSteps(1.5)).toBe(8);
  expect(desiredSteps(1.6)).toBe(6);
  expect(desiredSteps(2)).toBe(6);
  expect(desiredSteps(2.5)).toBe(5);
  expect(desiredSteps(undefined)).toBe(8);
});

test('절전 낭독은 언제나 5단계(v1.33 과 같은 소리·같은 전기)', () => {
  for (const r of [0.5, 1, 1.5, 2, 3]) expect(sherpaSteps(r, { saver: true, baseRtf: 0.01 })).toBe(STEPS_SAVER);
});

test('기기가 못 따라가면 한 칸씩 내린다 — 끊기지 않는 게 먼저', () => {
  expect(sherpaSteps(1, { baseRtf: 0.2 })).toBe(8);   // 0.2 × 1.56 = 0.31
  expect(sherpaSteps(1, { baseRtf: 0.42 })).toBe(8);  // 에뮬 실측값: 0.65
  expect(sherpaSteps(1, { baseRtf: 0.55 })).toBe(6);  // 8단계 0.86 > 0.8 · 6단계 0.65
  expect(sherpaSteps(1, { baseRtf: 0.7 })).toBe(5);   // 6단계도 0.83
  expect(sherpaSteps(1.5, { baseRtf: 0.4 })).toBe(6); // 8단계 0.93 · 6단계 0.71
  expect(sherpaSteps(2, { baseRtf: 0.4 })).toBe(5);   // 6단계 0.95
  expect(sherpaSteps(1, { baseRtf: null })).toBe(8);  // 모르면 원하는 단계로 시작
});

test('고른 단계는 언제나 예산 안(5단계는 예외 — 더 내릴 곳이 없다)', () => {
  for (let base = 0.05; base < 1; base += 0.05) for (const r of [0.7, 1, 1.2, 1.5, 1.8, 2]) {
    const s = sherpaSteps(r, { baseRtf: base });
    if (s > STEPS_SAVER) expect(base * stepCost(s) * Math.max(1, r)).toBeLessThanOrEqual(STEP_BUDGET + 1e-9);
  }
});

test('5단계 환산 RTF 는 쓴 단계와 무관하게 같은 기기면 같은 값', () => {
  recordSynth(1000 * stepCost(8), 5000, 8);
  expect(sherpaStats().baseRtf).toBeCloseTo(0.2, 5);
  recordSynth(1000 * stepCost(5), 5000, 5);
  expect(sherpaStats().baseRtf).toBeCloseTo(0.2, 5);
  // 단계 없는 기록(무음 발화)은 환산값을 건드리지 않는다
  recordSynth(1, 600);
  expect(sherpaStats().baseRtf).toBeCloseTo(0.2, 5);
});

test('표본이 없으면 환산 RTF 는 null', () => {
  expect(sherpaStats().baseRtf).toBeNull();
});

test('스레드: 절전이고 1스레드로도 넉넉할 때만 1', () => {
  expect(sherpaThreads(1, { saver: false, baseRtf: 0.1 })).toBe(2); // 절전 아님
  expect(sherpaThreads(1, { saver: true, baseRtf: null })).toBe(2); // 아직 모름
  expect(sherpaThreads(1, { saver: true, baseRtf: 0.3 })).toBe(1);  // 0.48
  expect(sherpaThreads(1, { saver: true, baseRtf: 0.42 })).toBe(1); // 0.67 — 에뮬 실측값
  expect(sherpaThreads(1, { saver: true, baseRtf: 0.5 })).toBe(2);  // 0.80 — 버겁다
  expect(sherpaThreads(2, { saver: true, baseRtf: 0.3 })).toBe(2);  // 배속이 높으면 2
});

test('1스레드 표본은 2스레드 환산으로 baseRtf 에 들어간다(판정이 스스로를 뒤집지 않게)', () => {
  resetSherpaStats();
  recordSynth(200 * THREAD1_COST, 1000, 5, 1);
  expect(sherpaStats().baseRtf).toBeCloseTo(0.2, 5);
  expect(sherpaStats().lastThreads).toBe(1);
});
