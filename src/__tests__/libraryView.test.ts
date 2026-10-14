import { sortRecent, pickResume } from '../lib/libraryView';
import type { Doc } from '../types';

const doc = (id: string, o: Partial<Doc>): Doc =>
  ({ id, title: id, format: 'txt', createdAt: 0, sentenceCount: 10, lastIndex: 0, progress: 0, ...o });

describe('서재 — 이어 듣기', () => {
  test('v1.31 에서 올린 구문서(lastOpenedAt 없음)도 읽던 책이면 이어 듣기에 뜬다', () => {
    // 에뮬 업그레이드 실측(2026-10-14): 65% 읽던 책이 있는데 카드가 비었다.
    const docs = [doc('a', { createdAt: 1, progress: 0.65 }), doc('b', { createdAt: 2, progress: 0 })];
    expect(pickResume(sortRecent(docs))?.id).toBe('a');
  });
  test('최근에 연 책이 먼저 · 다 들은 책·안 연 책은 건너뛴다', () => {
    const docs = [
      doc('old', { createdAt: 5, progress: 0.3 }),
      doc('opened', { createdAt: 1, lastOpenedAt: 100, progress: 0.2 }),
      doc('done', { createdAt: 2, lastOpenedAt: 200, progress: 1 }),
      doc('fresh', { createdAt: 300, progress: 0 }),
    ];
    expect(sortRecent(docs).map((d) => d.id)).toEqual(['fresh', 'done', 'opened', 'old']);
    expect(pickResume(sortRecent(docs))?.id).toBe('opened');
  });
  test('읽던 책이 없으면 카드 없음', () => {
    expect(pickResume([doc('x', { progress: 0 }), doc('y', { progress: 1 })])).toBeUndefined();
  });
});
