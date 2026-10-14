import { synthSeed, levelUtterance, speechLevelDb, LEVEL_TARGET_DB } from '../tts/sherpa/voiceStable';

const SR = 44100;
// 말소리 흉내: 220Hz 사인 0.6초를 진폭 amp 로 + 앞뒤 무음 0.2초.
function utter(amp: number, ms = 600): number[] {
  const pad = new Array(Math.round(SR * 0.2)).fill(0);
  const n = Math.round((SR * ms) / 1000);
  const body = Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * 220 * i) / SR));
  return [...pad, ...body, ...pad];
}

describe('synthSeed — 같은 문장 = 같은 시드', () => {
  test('결정론 · 범위(int32 양수)', () => {
    const a = synthSeed('그는 끝내 한 마디를 터뜨렸다.', '6');
    expect(synthSeed('그는 끝내 한 마디를 터뜨렸다.', '6')).toBe(a);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(2147483647);
  });
  test('화자나 글자가 다르면 시드도 다르다', () => {
    const a = synthSeed('예.', '0');
    expect(synthSeed('예.', '6')).not.toBe(a);
    expect(synthSeed('예!', '0')).not.toBe(a);
  });
});

describe('levelUtterance — 문장 음량 고르기', () => {
  test('작은 문장은 목표 쪽으로 올린다(길이 불변)', () => {
    const x = utter(0.02); // ≈ −37dBFS
    const before = speechLevelDb(x, SR)!;
    const n = x.length;
    const { gainDb } = levelUtterance(x, SR);
    expect(x.length).toBe(n);
    expect(gainDb).toBeGreaterThan(0);
    expect(Math.abs(speechLevelDb(x, SR)! - LEVEL_TARGET_DB)).toBeLessThan(Math.abs(before - LEVEL_TARGET_DB));
  });
  test('큰 문장은 내린다', () => {
    const x = utter(0.5);
    expect(levelUtterance(x, SR).gainDb).toBeLessThan(0);
  });
  test('목표 근처 문장은 건드리지 않는다', () => {
    const amp = 10 ** (LEVEL_TARGET_DB / 20) * Math.SQRT2; // 사인 RMS = amp/√2
    const x = utter(amp);
    const copy = x.slice();
    expect(levelUtterance(x, SR).gainDb).toBe(0);
    expect(x).toEqual(copy);
  });
  test('첨두가 큰 문장은 올려도 0.95 를 넘지 않는다(클리핑 금지)', () => {
    // 평균은 작은데 첨두 하나가 큰 문장(파열음 하나) — 이득이 첨두에 막혀야 한다.
    const x = utter(0.02);
    x[Math.round(SR * 0.4)] = 0.9;
    levelUtterance(x, SR);
    expect(Math.max(...x.map(Math.abs))).toBeLessThanOrEqual(0.95 + 1e-9);
  });
  test('무음은 그대로', () => {
    const x = new Array(SR).fill(0);
    expect(levelUtterance(x, SR).gainDb).toBe(0);
  });
  test('보정 폭은 ±6dB 로 묶인다', () => {
    const x = utter(0.0005); // ≈ −69dBFS — 측정 실패·퇴화 입력
    expect(levelUtterance(x, SR).gainDb).toBeLessThanOrEqual(6 + 1e-9);
  });
});
