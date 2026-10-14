import { buildToc, currentTocPos, findSentences } from '../lib/toc';

describe('목차', () => {
  const s = [
    '제1권 제4장 — 장각, 별이 지다',
    '중평 원년 오월이었다.',
    '"…스승님."',
    '제5장 낙양의 밤',
    '그는 웃었다.',
    '삼월 하순',
    '노식이 실려 간 날이었다.',
  ];
  const para = new Set([0, 1, 2, 3, 4, 5, 6]);
  test('장 제목·짧은 소제목을 잡고 대사·문장은 뺀다', () => {
    expect(buildToc(s, para).map((e) => e.index)).toEqual([0, 3, 5]);
  });
  test('문단 첫 줄이 아니면 짧아도 소제목으로 안 본다', () => {
    expect(buildToc(s, new Set([0, 3])).map((e) => e.index)).toEqual([0, 3]);
  });
  test('현재 위치의 장', () => {
    const toc = buildToc(s, para);
    expect(currentTocPos(toc, 4)).toBe(1);
    expect(currentTocPos(toc, 0)).toBe(0);
    expect(currentTocPos([], 3)).toBe(-1);
  });
  test('짧은 줄 위주 문서(시)는 강한 표지만', () => {
    const poem = Array.from({ length: 80 }, (_, i) => (i === 40 ? '제2부' : `짧은 시구 ${i}`));
    const toc = buildToc(poem, new Set(poem.map((_, i) => i)));
    expect(toc.map((e) => e.title)).toEqual(['제2부']);
  });
});

test('약한 후보가 많아도 뒤쪽의 진짜 장 제목은 남는다(교차검증 codex)', () => {
  const ss = Array.from({ length: 1000 }, (_, i) => (i === 700 ? 'Chapter 2' : `짧은 줄 ${i}`));
  const toc = buildToc(ss, new Set(ss.map((_, i) => i)));
  expect(toc.map((e) => e.title)).toEqual(['Chapter 2']);
});

describe('찾기', () => {
  const s = ['유비가 말했다.', '관우는 웃었다.', '유 비 는 울었다.'];
  test('공백 무시 부분 일치', () => expect(findSentences(s, '유비')).toEqual([0, 2]));
  test('빈 질의 = 없음', () => expect(findSentences(s, '  ')).toEqual([]));
  test('상한', () => expect(findSentences(s, '다', 2)).toEqual([0, 1]));
});
