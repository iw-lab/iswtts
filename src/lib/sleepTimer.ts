// 취침 타이머 판정(v1.32.0) — 순수 함수(문장 경계에서 player.ts 가 호출).
// ⚠️ 타이머(setTimeout)로 재지 않는 이유: 화면이 꺼지면 RN 이 JS 타이머를 얼린다(v1.30.0 진범).
// 문장 완료는 네이티브 오디오 이벤트로 도착하므로 그 자리에서 벽시계를 본다.

export const SLEEP_PRESETS = [15, 30, 45, 60, 90] as const;

/** nextIndex = 곧 시작할 문장. 마감이 지났거나(시간) 다음 문장이 새 문단이면(문단 끝) 멈춘다. */
export function sleepDue(
  st: { sleepAt: number | null; sleepEndOfPara: boolean; paraStarts: Set<number> },
  nextIndex: number,
  now = Date.now(),
): boolean {
  if (st.sleepAt !== null && now >= st.sleepAt) return true;
  if (st.sleepEndOfPara && st.paraStarts.has(nextIndex)) return true;
  return false;
}

/** 남은 분(올림). 마감이 없으면 null. */
export function sleepMinutesLeft(sleepAt: number | null, now = Date.now()): number | null {
  if (sleepAt === null) return null;
  return Math.max(0, Math.ceil((sleepAt - now) / 60_000));
}
