import { PDF_JOIN_SRC } from '../lib/pdfJoin';
import glyphPages from './fixtures/pdf-glyph-items.json';

// WebView 에 들어가는 것과 같은 소스 문자열을 실행한다.
type Item = { str: string; hasEOL?: boolean; transform: number[]; width: number; height?: number };
const joinPdfItems = new Function(`${PDF_JOIN_SRC}; return joinPdfItems;`)() as (items: Item[]) => string;
const at = (str: string, x: number, width: number, y = 700, fs = 10): Item => ({ str, transform: [fs, 0, 0, fs, x, y], width });

describe('PDF 조각 잇기', () => {
  test('글자마다 조각난 실제 PDF(크롬 인쇄, pdf.js 4.6.82 출력) — 띄어쓰기는 원문 그대로', () => {
    // 에뮬 실측(2026-10-14): 옛 잇기는 「제 1 장 시 험 문 서」「소 리 책 PDF 가 져 오 기」였다.
    const text = joinPdfItems(glyphPages[0] as Item[]);
    expect(text).toContain('제1장 시험 문서');
    expect(text).toContain('소리책 PDF 가져오기 시험입니다.');
    expect(text).not.toMatch(/[가-힣] [가-힣] [가-힣] [가-힣]/);
  });
  test('띄어쓰기는 pdf.js 판정을 따르고, 공백 없는 큰 틈(0.6em 초과)만 띄운다', () => {
    expect(joinPdfItems([at('소', 0, 10), at('리', 10, 10), at('책', 20.5, 10)])).toBe('소리책');
    // 0.2em 자간 — pdf.js 가 공백으로 안 본 틈에 가짜 공백을 넣지 않는다(교차검증 codex 반례)
    expect(joinPdfItems([at('A', 0, 6), at('B', 8, 6)])).toBe('AB');
    expect(joinPdfItems([at('Hello', 0, 30), at('world', 37, 30)])).toBe('Hello world');
  });
  test('너비 0 조각(결합 부호)은 실제 0 — 뒤에 가짜 공백 없음', () => {
    expect(joinPdfItems([at('e', 0, 6), at('\u0301', 6, 0), at('x', 6, 6)])).toBe('e\u0301x');
  });
  test('회전 글자도 진행 방향으로 잰다(180°)', () => {
    const r = (str: string, x: number, width: number): Item => ({ str, transform: [-10, 0, 0, -10, x, 50], width });
    expect(joinPdfItems([r('hello', 100, 25), r('world', 65, 25)])).toBe('hello world');
    expect(joinPdfItems([r('가', 100, 10), r('나', 90, 10)])).toBe('가나');
  });
  test('공백 조각·줄바꿈·줄 이동', () => {
    expect(joinPdfItems([at('가', 0, 10), at(' ', 10, 3), at('나', 13, 10)])).toBe('가 나');
    expect(joinPdfItems([{ ...at('첫 줄', 0, 30), hasEOL: true }, at('둘째', 0, 20)])).toBe('첫 줄\n둘째');
    expect(joinPdfItems([at('위', 0, 10, 700), at('아래', 0, 20, 680)])).toBe('위\n아래');
  });
  test('너비를 모르는 조각 뒤에서는 옛 동작(띄움)', () => {
    expect(joinPdfItems([{ str: '가', transform: [10, 0, 0, 10, 0, 700] } as Item, at('나', 10, 10)])).toBe('가 나');
  });
});

test('🔒 숨은 WebView 는 이 잇기 함수를 쓴다(옛 「조각마다 공백」 루프로 되돌리지 않기)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../components/PdfExtractor.tsx'), 'utf8');
  expect(src).toMatch(/\$\{PDF_JOIN_SRC\}/);
  expect(src).toMatch(/joinPdfItems\(tc\.items\)/);
  expect(src).not.toMatch(/line \+= s \+ \(it\.hasEOL/);
});
