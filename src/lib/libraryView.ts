import type { Doc } from '../types';

// 서재 화면의 정렬·「이어 듣기」 선택(v1.32.0). 화면에서 떼어 둔 이유 = 업데이트한 사람의 구문서로
// 시험하려고. v1.31 이전 문서에는 lastOpenedAt·charCount 가 없다.

/** 최근에 들은 순(연 적 없는 구문서는 추가 시각). */
export function sortRecent(docs: Doc[]): Doc[] {
  return [...docs].sort((a, b) => (b.lastOpenedAt ?? b.createdAt) - (a.lastOpenedAt ?? a.createdAt));
}

/** 이어 듣기 = 가장 최근 것 중 아직 다 안 들은 책. ⚠️ lastOpenedAt 을 요구하지 않는다 — 요구하면
 *  v1.31 에서 올린 사람은 책을 다시 열기 전까지 카드가 아예 안 뜬다(에뮬 업그레이드 실측
 *  2026-10-14: 65% 읽던 책이 있는데 서재 맨 위가 비었다). 진행률 > 0 이면 연 적이 있는 책이다. */
export function pickResume(sorted: Doc[]): Doc | undefined {
  return sorted.find((d) => d.progress > 0 && d.progress < 1);
}
