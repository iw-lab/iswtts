// 마크다운 → 읽을 글(v1.32.0). v1.31 까지 .md 는 txt 와 똑같이 원문 그대로 들어가, 자막에
// 「# 제1권 제4장」「> 인용」「**강조**」가 기호째 떴고 낭독도 그 기호를 지나갔다(에뮬 실측
// 2026-10-14). 표·코드 블록은 소설 원고에 드물어 간단 처리만 한다.

/** 문서 전체(줄 구조 유지)를 정리. 빈 줄·문단 구조는 보존한다(문장 분할·문단 호흡이 쓴다). */
export function stripMarkdown(src: string): string {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let fence = false;
  for (const raw of lines) {
    if (/^\s*(```|~~~)/.test(raw)) {
      fence = !fence;
      continue;
    }
    if (fence) {
      out.push(raw);
      continue;
    }
    // 구분선(---, ***, * * *) → 문단 경계
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(raw)) {
      out.push('');
      continue;
    }
    // 표 구분 줄(|---|:---:|)
    if (/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(raw)) continue;
    out.push(stripMarkdownLine(raw));
  }
  return out.join('\n');
}

/** 한 줄(또는 이미 나뉜 문장 하나)의 마크다운 기호를 벗긴다. */
export function stripMarkdownLine(line: string): string {
  // 인라인 코드(`…`)는 먼저 떼어 두고 나머지만 치환한다 — 안 그러면 `2**3**2` 같은 식의
  // 별표가 굵게 표시로 읽혀 지워진다(교차검증 codex). 코드 구간은 백틱만 벗겨 되붙인다.
  const parts = line.split(/(`[^`]+`)/);
  if (parts.length > 1) {
    const lead = stripBlockMarkers(parts[0]);
    return [lead, ...parts.slice(1)]
      .map((t, i) => (i % 2 === 1 ? t.slice(1, -1) : stripInline(t)))
      .join('');
  }
  return stripInline(stripBlockMarkers(line));
}

// 줄 머리 표지(제목·인용·목록) — 첫 조각에만 의미가 있다.
function stripBlockMarkers(line: string): string {
  let s = line;
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/^\s{0,3}#{1,6}\s+/, ''); // 제목
  s = s.replace(/\s+#+\s*$/, ''); // 닫는 # (## 제목 ##)
  s = s.replace(/^(\s{0,3}>\s?)+/, ''); // 인용
  s = s.replace(/^\s*(?:[-*+]|\d{1,3}[.)])\s+(?=\S)/, ''); // 목록 표지
  return s;
}

// 줄 안의 강조·링크·그림·표 — 코드 구간 밖에서만.
function stripInline(line: string): string {
  let s = line;
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1'); // 그림 → 대체 글
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'); // 링크 → 글
  s = s.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2'); // 굵게
  s = s.replace(/(^|[^*\w])\*(?=\S)([^*\n]*?\S)\*(?!\*)/g, '$1$2'); // 기울임 *x*
  s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1'); // 취소선
  if (/^\s*\|.*\|\s*$/.test(s)) s = s.replace(/^\s*\|\s*|\s*\|\s*$/g, '').replace(/\s*\|\s*/g, ', '); // 표 행
  return s;
}
