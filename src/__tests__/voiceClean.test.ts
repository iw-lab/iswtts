// v1.33.0 목소리 깨짐 방지 — voiceClean.ts. 정본(유튜브 tts_burst_tame.py bt3)과의 수치 일치는 실제 낭독 8개로
// 따로 쟀다(차이 −57~−100dB · 길이 같음). 여기서는 «하는 일»을 합성 신호로 고정한다.
import { tame, deess, cleanVoice, presetOf, VOICE_PRESETS, highpass } from '../tts/sherpa/voiceClean';

const SR = 44100;
const tone = (hz: number, sec: number, amp: number) => Array.from({ length: Math.round(SR * sec) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR));
const rms = (a: ArrayLike<number>, from = 0, to = a.length) => { let s = 0; for (let i = from; i < to; i++) s += a[i] * a[i]; return Math.sqrt(s / Math.max(1, to - from)); };
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;

describe('voiceClean', () => {
  test('프리셋 두 개 — 6.25 여자(sid 0)·삼국지 남자(sid 5), 합성 sid 는 parseInt 로 읽힌다', () => {
    expect(VOICE_PRESETS.map((p) => p.id)).toEqual(['0:w625', '5:samguk']);
    expect(Number.parseInt('0:w625', 10)).toBe(0);
    expect(Number.parseInt('5:samguk', 10)).toBe(5);
    expect(presetOf('0:w625')?.clean).toBe('deess+tame');
    expect(presetOf('5:samguk')?.clean).toBe('tame');
    expect(presetOf('0')).toBeNull();
  });

  test('일반 화자는 건드리지 않는다', () => {
    expect(cleanVoice(tone(200, 0.5, 0.3), SR, '0')).toBeNull();
    expect(cleanVoice(tone(200, 0.5, 0.3), SR, undefined)).toBeNull();
  });

  test('파열음(짧은 고역 폭발)을 누르고 길이·저역은 그대로', () => {
    const x = tone(180, 1.0, 0.3);
    const at = Math.round(SR * 0.5);
    for (let i = 0; i < 90; i++) x[at + i] += 0.6 * rnd();          // 2ms 고역 폭발(ㄷ·ㅂ 개방 흉내)
    const y = tame(x, SR);
    expect(y.length).toBe(x.length);
    const hx = highpass(x, SR), hy = highpass(y, SR);
    expect(rms(hy, at, at + 90)).toBeLessThan(rms(hx, at, at + 90) * 0.5);   // 폭발 고역 절반 아래로
    expect(Math.abs(rms(y, 0, SR * 0.4) / rms(x, 0, SR * 0.4) - 1)).toBeLessThan(0.01);   // 폭발 없는 곳(모음)은 1% 안
  });

  test('치찰음(길게 이어지는 쉿 소리)을 누르고 모음은 그대로', () => {
    const x = tone(200, 1.2, 0.3);
    const a = Math.round(SR * 0.6), b = Math.round(SR * 0.85);
    for (let i = a; i < b; i++) x[i] = 0.05 * Math.sin((2 * Math.PI * 200 * i) / SR) + 0.35 * rnd();   // ㅅ 흉내(고역이 대부분)
    const y = deess(x, SR);
    expect(y.length).toBe(x.length);
    const hx = highpass(x, SR), hy = highpass(y, SR);
    expect(20 * Math.log10(rms(hy, a, b) / rms(hx, a, b))).toBeLessThan(-3);   // 쉿 소리 3dB 넘게 줄었다
    expect(Math.abs(rms(y, 0, SR * 0.5) / rms(x, 0, SR * 0.5) - 1)).toBeLessThan(0.01);
  });

  test('cleanVoice 프리셋 = 같은 길이 · 6.25 는 치찰까지, 삼국지는 파열만', () => {
    const x = tone(180, 0.8, 0.3);
    for (let i = Math.round(SR * 0.3); i < Math.round(SR * 0.5); i++) x[i] = 0.35 * rnd();
    const w = cleanVoice(x, SR, '0:w625')!, m = cleanVoice(x, SR, '5:samguk')!;
    expect(w.length).toBe(x.length); expect(m.length).toBe(x.length);
    const s = Math.round(SR * 0.3), e = Math.round(SR * 0.5);
    expect(rms(highpass(w, SR), s, e)).toBeLessThan(rms(highpass(m, SR), s, e));   // 여자 프리셋만 쉿 소리를 더 누른다
  });
});
