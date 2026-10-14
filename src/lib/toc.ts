// 목차·찾기(v1.32.0) — 책 안에서 장 단위로 건너뛰고, 낱말로 문장을 찾는다. 전부 순수 함수.

export type TocEntry = { index: number; title: string };

// 장 제목으로 보이는 꼴: 「제3장」「제1권 제4장」「3화」「Chapter 2」「프롤로그」 등.
const HEADING_RE =
  /^(?:제\s*[0-9０-９一二三四五六七八九十百]+\s*[권장화부편절회막]|[0-9]{1,3}\s*[장화편회부](?:\s|$|[.:·—-])|(?:chapter|part|book)\s*[0-9ivx]+|(?:프롤로그|에필로그|서장|종장|서문|머리말|맺음말|작가의\s*말|후기|序章|終章))/i;
// 문장 끝 표지가 없는 짧은 문단 첫 줄 = 소제목일 가능성(마크다운에서 # 를 벗긴 제목 등).
const SENTENCE_END_RE = /[.!?。…"'”’」』)\]]\s*$/;
// 글자·숫자가 하나도 없는 줄은 제목이 아니다 — 장면 구분선(「* * *」·「---」, 마크다운 정리 뒤 「* *」).
// 에뮬 실측(2026-10-14): 이 검사가 없어 한 책의 목차 23개 중 21개가 「* *」였고 플레이어 장 표시도
// 「* *」였다. 엔진의 무음 판정(SherpaTtsEngine SPOKEN_HAS_WORD)과 같은 기준.
const HAS_WORD = /[\p{L}\p{N}]/u;
const MAX_TITLE = 40;
const MAX_ENTRIES = 600;

export function buildToc(sentences: string[], paraStarts: Set<number>): TocEntry[] {
  // 상한은 걸러낸 «뒤»에 건다 — 앞쪽 약한 후보가 상한을 채워 뒤의 진짜 장 제목을 못 보는 일이
  // 없게(교차검증 codex: 약한 후보 600개 뒤 'Chapter 2' → 빈 목차).
  const out: TocEntry[] = [];
  for (let i = 0; i < sentences.length; i++) {
    const t = sentences[i].trim();
    if (!t || t.length > MAX_TITLE || !HAS_WORD.test(t)) continue;
    const strong = HEADING_RE.test(t);
    const weak = paraStarts.has(i) && t.length <= 24 && !SENTENCE_END_RE.test(t) && !/^["“「『'‘]/.test(t);
    if (strong || weak) out.push({ index: i, title: t });
  }
  // 소제목 후보가 책 전체의 절반을 넘으면(시·대본처럼 짧은 줄 위주) 강한 표지만 남긴다.
  const kept = out.length > Math.max(20, sentences.length / 4) ? out.filter((e) => HEADING_RE.test(e.title)) : out;
  return kept.slice(0, MAX_ENTRIES);
}

/** 지금 읽는 문장이 속한 목차 항목(없으면 -1). */
export function currentTocPos(toc: TocEntry[], index: number): number {
  let lo = 0;
  let hi = toc.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (toc[mid].index <= index) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** 낱말 찾기 — 공백 무시 부분 일치. 결과는 문장 순서대로 최대 limit 개. */
export function findSentences(sentences: string[], query: string, limit = 200): number[] {
  const q = query.replace(/\s+/g, '').toLowerCase();
  if (!q) return [];
  const out: number[] = [];
  for (let i = 0; i < sentences.length && out.length < limit; i++) {
    if (sentences[i].replace(/\s+/g, '').toLowerCase().includes(q)) out.push(i);
  }
  return out;
}
