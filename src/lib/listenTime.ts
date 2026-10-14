// 남은 낭독 시간 추정(v1.32.0) — 서재 카드·플레이어 진행 바에 「남은 약 2시간 10분」.
// 근거: Supertonic 3 한국어 1× 낭독은 공백 제외 약 5.2자/초(유성 6.3음절/초 실측 — yt-video-builder
// TARGET_RATE — 에 문장 사이 쉼·쉼표 쉼을 더한 값). 엔진마다 조금 다르지만 표시는 「약」이라
// 분 단위 반올림이면 충분하다. 배속은 그대로 나눈다(쉼도 배속에 비례해 줄어든다 — pacing.ts).
export const CHARS_PER_SEC_1X = 5.2;

export function remainingSec(charsLeft: number, rate: number): number {
  const r = Number.isFinite(rate) && rate > 0 ? rate : 1;
  return Math.max(0, charsLeft / CHARS_PER_SEC_1X / r);
}

/** 120 → "2분", 7800 → "2시간 10분", 30 → "1분 미만" */
export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 60) return '1분 미만';
  const m = Math.round(sec / 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h <= 0) return `${m}분`;
  return mm ? `${h}시간 ${mm}분` : `${h}시간`;
}

/** 문장 배열의 누적 글자 수(공백 제외) — 접두합. prefix[i] = 0..i-1 문장 합. */
export function charPrefix(sentences: string[]): Int32Array {
  const p = new Int32Array(sentences.length + 1);
  for (let i = 0; i < sentences.length; i++) p[i + 1] = p[i] + sentences[i].replace(/\s/g, '').length;
  return p;
}
