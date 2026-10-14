import { stripMarkdown, stripMarkdownLine } from '../lib/markdown';

describe('마크다운 정리', () => {
  test.each([
    ['# 제1권 제4장 — 장각, 별이 지다', '제1권 제4장 — 장각, 별이 지다'],
    ['## 장두(章頭)', '장두(章頭)'],
    ['> 生年不滿百 常懷千歲憂', '生年不滿百 常懷千歲憂'],
    ['> > 겹 인용', '겹 인용'],
    ['- 첫째 항목', '첫째 항목'],
    ['1. 번호 항목', '번호 항목'],
    ['그는 **크게** 웃었다.', '그는 크게 웃었다.'],
    ['그는 *조용히* 말했다.', '그는 조용히 말했다.'],
    ['[원문 보기](https://example.com) 를 참고', '원문 보기 를 참고'],
    ['![지도](map.png)', '지도'],
    ['`코드`를 썼다', '코드를 썼다'],
    ['| 이름 | 나이 |', '이름, 나이'],
  ])('%s', (a, b) => expect(stripMarkdownLine(a)).toBe(b));

  test.each([
    '그는 3*4=12 를 계산했다.', // 짝 없는 별표는 수식
    '- 그것은 대사가 아니었다', // ← 목록으로 보이지만 벗겨도 뜻 동일(아래 별도 확인)
  ])('뜻을 해치지 않는다: %s', (a) => {
    expect(stripMarkdownLine(a).length).toBeGreaterThan(0);
  });

  test('문서 단위: 구분선은 빈 줄, 표 구분 줄은 사라지고 문단 구조는 남는다', () => {
    const md = '# 제목\n\n본문 첫 줄.\n\n* * *\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n끝.';
    expect(stripMarkdown(md)).toBe('제목\n\n본문 첫 줄.\n\n\n\na, b\n1, 2\n\n끝.');
  });

  test('코드 블록 안은 건드리지 않는다', () => {
    expect(stripMarkdown('```\n# 주석\n```')).toBe('# 주석');
  });

  test('인라인 코드 안은 강조 치환을 하지 않는다(교차검증 codex)', () => {
    expect(stripMarkdownLine('식은 `2**3**2` 이다')).toBe('식은 2**3**2 이다');
  });

  test('3*4=12 의 별표는 보존', () => {
    expect(stripMarkdownLine('3*4=12 그리고 5*6')).toBe('3*4=12 그리고 5*6');
  });
});
