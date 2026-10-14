// 🔒 교훈 잠금(v1.32.0 — memory project_v132_closure_da_not_breath): 「-었다/-였다」의 마지막
// 「다」는 ㄷ 폐쇄 때문에 앞 음절과 70~100ms 무음으로 떨어져 있고, 하강 억양으로 반쯤 무성이다.
// 「쉼 뒤에 홀로 남은 짧은 덩어리 = 날숨」으로 보고 지우는 후처리를 넣으면 동사 끝이 사라진다
// (개발 중 실제로 만들었다가 폐기). 앱의 출고 후처리 경로가 그 덩어리를 보존하는지 고정한다.
import { trimEdgeSilence, gateTailMurmur, LEAD_PAD_MS, EDGE_FADE_MS } from '../tts/sherpa/smartSpeed';
import { levelUtterance } from '../tts/sherpa/voiceStable';

const SR = 44100;
const tone = (ms: number, amp: number, hz: number) =>
  Array.from({ length: Math.round((SR * ms) / 1000) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR));
// 하강 억양의 마지막 음절 흉내: 유성 성분 약하게 + 잡음 섞인 「다」(실측 레벨 피크 −8~−13dB).
function breathyDa(ms: number, amp: number): number[] {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  return Array.from({ length: Math.round((SR * ms) / 1000) }, (_, i) => {
    const env = Math.sin((Math.PI * i) / ((SR * ms) / 1000));
    return env * (amp * 0.5 * Math.sin((2 * Math.PI * 110 * i) / SR) + amp * 0.5 * rnd());
  });
}
const rms = (x: number[], a: number, b: number) => {
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, b - a));
};

test('폐쇄음 뒤 떨어진 마지막 「다」는 출고 후처리에서 살아남는다', () => {
  const lead = new Array(Math.round(SR * 0.4)).fill(0);
  const body = tone(700, 0.3, 120); // 「…있었」
  const closure = new Array(Math.round(SR * 0.09)).fill(0); // ㄷ 폐쇄 90ms
  const da = breathyDa(130, 0.12); // 「다」 130ms, 피크 대비 약 −8dB
  const tail = new Array(Math.round(SR * 0.5)).fill(0);
  const raw = [...lead, ...body, ...closure, ...da, ...tail];
  let y = trimEdgeSilence(raw, SR, LEAD_PAD_MS, undefined, EDGE_FADE_MS);
  y = gateTailMurmur(y, SR);
  levelUtterance(y, SR);
  // 트림 후 위치: 머리 패드 + body + closure 다음이 「다」
  const daStart = Math.round((SR * LEAD_PAD_MS) / 1000) + body.length + closure.length;
  const daEnergy = rms(y, daStart, daStart + da.length);
  const bodyEnergy = rms(y, Math.round((SR * LEAD_PAD_MS) / 1000), daStart - closure.length);
  expect(y.length).toBeGreaterThan(daStart + da.length); // 잘려 나가지 않았다
  expect(daEnergy / bodyEnergy).toBeGreaterThan(0.15); // 소리가 남아 있다(지워지면 ≈0)
});
