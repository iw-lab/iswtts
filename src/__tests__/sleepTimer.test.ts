import { sleepDue, sleepMinutesLeft } from '../lib/sleepTimer';
import { remainingSec, formatDuration, charPrefix } from '../lib/listenTime';

describe('취침 타이머', () => {
  const base = { sleepAt: null as number | null, sleepEndOfPara: false, paraStarts: new Set<number>([0, 5]) };
  test('타이머 없으면 멈추지 않는다', () => expect(sleepDue(base, 3, 1000)).toBe(false));
  test('마감 전엔 계속, 지나면 멈춤', () => {
    expect(sleepDue({ ...base, sleepAt: 2000 }, 3, 1999)).toBe(false);
    expect(sleepDue({ ...base, sleepAt: 2000 }, 3, 2000)).toBe(true);
  });
  test('문단 끝: 다음 문장이 새 문단일 때만', () => {
    const st = { ...base, sleepEndOfPara: true };
    expect(sleepDue(st, 4)).toBe(false);
    expect(sleepDue(st, 5)).toBe(true);
  });
  test('남은 분은 올림', () => {
    expect(sleepMinutesLeft(null)).toBeNull();
    expect(sleepMinutesLeft(61_000, 0)).toBe(2);
    expect(sleepMinutesLeft(0, 5_000)).toBe(0);
  });
});

describe('남은 시간 추정', () => {
  test('배속에 반비례', () => {
    expect(remainingSec(5200, 1)).toBeCloseTo(1000);
    expect(remainingSec(5200, 2)).toBeCloseTo(500);
    expect(remainingSec(100, 0)).toBeCloseTo(100 / 5.2); // 잘못된 배속 = 1×
  });
  test('표기', () => {
    expect(formatDuration(30)).toBe('1분 미만');
    expect(formatDuration(120)).toBe('2분');
    expect(formatDuration(7800)).toBe('2시간 10분');
    expect(formatDuration(7200)).toBe('2시간');
  });
  test('접두합은 공백 제외', () => {
    expect(Array.from(charPrefix(['가 나', '다']))).toEqual([0, 2, 3]);
  });
});
