// 디자인 결정론 게이트(design-master D5 ① 의 RN 판) — 모든 읽기 테마에서 글자가 읽히는가.
// WCAG 2.x 상대 휘도 대비. 본문·보조·버튼·링크 ≥4.5, 흐린 이웃 자막(faint) ≥3.0.
jest.mock('../store/settings', () => ({ useSettings: jest.fn() }));
import { PALETTES } from '../lib/theme';

function lum(hex: string): number {
  const h = hex.replace('#', '');
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const l = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
}
export function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

const STRONG: Array<[keyof (typeof PALETTES)['light'], keyof (typeof PALETTES)['light']]> = [
  ['text', 'bg'],
  ['text', 'surface'],
  ['text', 'elevated'],
  ['subtext', 'bg'],
  ['subtext', 'surface'],
  ['subtext', 'elevated'],
  ['onPrimary', 'primary'],
  ['onPrimarySoft', 'primarySoft'],
  ['highlightText', 'highlight'],
  ['primary', 'bg'],
  ['primary', 'surface'],
  ['danger', 'surface'],
];

describe('테마 글자 대비', () => {
  for (const [name, p] of Object.entries(PALETTES)) {
    test.each(STRONG)(`${name}: %s / %s ≥ 4.5`, (fg, bg) => {
      expect(contrast(p[fg] as string, p[bg] as string)).toBeGreaterThanOrEqual(4.5);
    });
    test(`${name}: 흐린 이웃 자막 faint/bg ≥ 3.0`, () => {
      expect(contrast(p.faint, p.bg)).toBeGreaterThanOrEqual(3.0);
    });
  }

  test('반례: 옛 라이트 primary(#6366f1) 위 흰 글자는 4.5 미만이었다', () => {
    expect(contrast('#ffffff', '#6366f1')).toBeLessThan(4.5);
  });

  test('OLED 블랙은 바탕이 완전 검정이다(배터리 축)', () => {
    expect(PALETTES.black.bg).toBe('#000000');
  });
});
