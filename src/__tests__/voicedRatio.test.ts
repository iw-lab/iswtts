import { voicedRatio, gateTailMurmur } from '../tts/sherpa/smartSpeed';

// 꼬리 게이트의 유성 보호(v1.28.0). 이 테스트가 없으면 "말끝을 자르지 않는다"는 보장이
// 코드에 없다 — 기존 smartSpeed 테스트는 1kHz 저해상 신호를 써서 4배 다운샘플 후 유성
// 판정이 항상 0 이 되므로 이 경로를 전혀 검증하지 못했다(교차검증 codex 2026-07-26).
// 실제 합성과 같은 44.1kHz, 실제 화자 F0 대역(남 62~150Hz · 여 170~290Hz)으로 검증한다.

const SR = 44100;

function tone(f0: number, ms: number, amp = 0.3, harmonics = 3): number[] {
  const n = Math.round((SR * ms) / 1000);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (let h = 1; h <= harmonics; h++) v += (amp / h) * Math.sin((2 * Math.PI * f0 * h * i) / SR);
    out[i] = v;
  }
  return out;
}

function noise(ms: number, amp = 0.05, seed = 1): number[] {
  const n = Math.round((SR * ms) / 1000);
  const out = new Array<number>(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff; // 결정론 난수(테스트 재현성)
    out[i] = ((x / 0x7fffffff) * 2 - 1) * amp;
  }
  return out;
}

describe('voicedRatio — 성대 진동 검출', () => {
  // 저주파(남성)에서도 고주파와 대등하게 검출돼야 한다. 구현 초기의 자기상관 정규화는
  // lag 가 클수록 값이 작아져 저음 화자에서 보호가 약해졌다(교차검증 지적).
  test.each([62, 75, 100, 150, 200, 290, 340])('%dHz 유성음을 검출한다', (f0) => {
    expect(voicedRatio(tone(f0, 200), SR)).toBeGreaterThan(0.5);
  });

  test('저주파(62Hz)와 고주파(290Hz)의 검출력이 대등하다 — F0 편향 없음', () => {
    const lo = voicedRatio(tone(62, 200), SR);
    const hi = voicedRatio(tone(290, 200), SR);
    expect(Math.abs(lo - hi)).toBeLessThan(0.25);
  });

  test('잡음(무성 마찰음·날숨)은 유성으로 보지 않는다', () => {
    expect(voicedRatio(noise(200), SR)).toBeLessThanOrEqual(0.1);
  });

  test('잡음이 섞인 저음 유성음도 여전히 검출한다(SNR 여유)', () => {
    const t = tone(75, 200);
    const nz = noise(200, 0.06, 7);
    expect(voicedRatio(t.map((v, i) => v + nz[i]), SR)).toBeGreaterThan(0.5);
  });

  test('무음·초단 입력은 0(경계 안전)', () => {
    expect(voicedRatio(new Array(1000).fill(0), SR)).toBe(0);
    expect(voicedRatio([], SR)).toBe(0);
    expect(voicedRatio(new Array(10).fill(0.5), SR)).toBe(0);
  });
});

describe('gateTailMurmur — 말끝 보호 vs 날숨 제거', () => {
  const strong = () => tone(120, 400, 0.5); // 문장 본체(큰 소리)
  const silence = (ms: number) => new Array(Math.round((SR * ms) / 1000)).fill(0);

  test('말끝 유성음(피크의 약 15%)은 자르지 않는다 — v1.27.3 회귀 방지', () => {
    // 한국어 하강 억양: 마지막 음절이 문장 피크의 30% 아래로 내려가는 것은 정상이다.
    const tail = tone(90, 100, 0.06); // 유성, 100ms
    const x = [...strong(), ...tail, ...silence(300)];
    const out = gateTailMurmur(x.slice(), SR);
    const tailStart = strong().length;
    const before = Math.max(...x.slice(tailStart, tailStart + tail.length).map(Math.abs));
    const after = Math.max(...out.slice(tailStart, tailStart + tail.length).map(Math.abs));
    expect(after).toBeCloseTo(before, 5); // 손대지 않았다
  });

  test('무성 날숨(잡음)은 눕힌다 — 원 표적은 유지', () => {
    const tail = noise(90, 0.05, 3);
    const x = [...strong(), ...tail, ...silence(300)];
    const out = gateTailMurmur(x.slice(), SR);
    const tailStart = strong().length;
    const after = Math.max(...out.slice(tailStart + 2000, tailStart + tail.length).map(Math.abs));
    expect(after).toBeLessThan(0.01);
  });

  test('120ms 를 넘는 꼬리는 대상에서 제외(날숨 실측 범위 밖)', () => {
    const tail = noise(300, 0.05, 5);
    const x = [...strong(), ...tail, ...silence(300)];
    const out = gateTailMurmur(x.slice(), SR);
    const tailStart = strong().length;
    const before = Math.max(...x.slice(tailStart, tailStart + tail.length).map(Math.abs));
    const after = Math.max(...out.slice(tailStart, tailStart + tail.length).map(Math.abs));
    expect(after).toBeCloseTo(before, 5);
  });
});
