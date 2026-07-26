import {
  armWatchdog,
  disarmWatchdog,
  noteProgress,
  tickWatchdog,
} from '../lib/playbackWatchdog';

// 화면 꺼짐 낭독 정체 감시(v1.28.0). 시간은 Date.now 를 밀어 시뮬레이션한다.
describe('재생 정체 워치독', () => {
  let now = 1_000_000;
  const realNow = Date.now;
  beforeEach(() => {
    now = 1_000_000;
    (Date.now as unknown as jest.Mock) = jest.fn(() => now);
  });
  afterEach(() => {
    Date.now = realNow;
    disarmWatchdog();
  });
  const advance = (ms: number) => {
    now += ms;
  };

  test('재생 위치가 전진하면 정체로 보지 않는다', () => {
    let pos = 0;
    const onStall = jest.fn();
    armWatchdog({ progressMs: () => pos, busy: () => false }, onStall);
    for (let i = 0; i < 40; i++) {
      advance(1000);
      pos += 1000;
      tickWatchdog();
    }
    expect(onStall).not.toHaveBeenCalled();
  });

  test('위치가 멈춘 채 임계를 넘으면 복구를 호출한다', () => {
    const onStall = jest.fn();
    armWatchdog({ progressMs: () => 5000, busy: () => false }, onStall);
    tickWatchdog(); // 첫 관측 = 기준점
    advance(11_000);
    tickWatchdog();
    expect(onStall).not.toHaveBeenCalled(); // 임계(12초) 전
    advance(2_000);
    tickWatchdog();
    expect(onStall).toHaveBeenCalledTimes(1);
  });

  test('합성 대기(busy) 중에는 정체로 세지 않는다 — 느린 기기 오발동 방지', () => {
    const onStall = jest.fn();
    armWatchdog({ progressMs: () => null, busy: () => true }, onStall);
    for (let i = 0; i < 60; i++) {
      advance(1000);
      tickWatchdog();
    }
    expect(onStall).not.toHaveBeenCalled();
  });

  test('재생기가 없고 준비 중도 아니면(쉼 콜백 유실) 복구한다', () => {
    const onStall = jest.fn();
    armWatchdog({ progressMs: () => null, busy: () => false }, onStall);
    advance(13_000);
    tickWatchdog();
    expect(onStall).toHaveBeenCalledTimes(1);
  });

  test('복구 후에는 시계가 리셋돼 연속 발동하지 않는다', () => {
    const onStall = jest.fn();
    armWatchdog({ progressMs: () => 0, busy: () => false }, onStall);
    tickWatchdog(); // 첫 관측 = 기준점
    advance(13_000);
    tickWatchdog();
    tickWatchdog();
    tickWatchdog();
    expect(onStall).toHaveBeenCalledTimes(1);
    advance(13_000);
    tickWatchdog();
    expect(onStall).toHaveBeenCalledTimes(2);
  });

  test('해제하면 감시하지 않는다(일시정지 중 오발동 방지)', () => {
    const onStall = jest.fn();
    armWatchdog({ progressMs: () => 0, busy: () => false }, onStall);
    disarmWatchdog();
    advance(60_000);
    tickWatchdog();
    expect(onStall).not.toHaveBeenCalled();
  });

  // 교차검증 codex CRITICAL 2026-07-26: busy() 가 무한정 true 면 워치독이 매 틱 시계를
  // 되돌려 복구가 영영 호출되지 않는다("시작 자체 실패"가 정확히 그 상태였다). 엔진 쪽
  // START_GRACE_MS 상한이 이 시나리오를 끊는다 — 여기서는 계약(상한이 지나면 busy=false)이
  // 지켜질 때 워치독이 실제로 복구를 부르는지 확인한다.
  test('준비 중이 끝나면(busy=false 전환) 정체를 잡는다 — 무한 대기 방지', () => {
    const onStall = jest.fn();
    let busy = true;
    armWatchdog({ progressMs: () => 0, busy: () => busy }, onStall);
    for (let i = 0; i < 8; i++) {
      advance(1000);
      tickWatchdog();
    }
    expect(onStall).not.toHaveBeenCalled(); // 준비 중에는 안 건드린다
    busy = false; // 엔진의 시작 유예가 끝났다
    for (let i = 0; i < 13; i++) {
      advance(1000);
      tickWatchdog();
    }
    expect(onStall).toHaveBeenCalledTimes(1);
  });

  test('noteProgress 는 시계를 되돌린다(문장 전환 등 외부 진행)', () => {
    const onStall = jest.fn();
    armWatchdog({ progressMs: () => 0, busy: () => false }, onStall);
    advance(11_000);
    noteProgress();
    advance(11_000);
    tickWatchdog();
    expect(onStall).not.toHaveBeenCalled();
  });
});
