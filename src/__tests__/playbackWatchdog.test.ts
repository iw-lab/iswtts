import {
  armWatchdog,
  disarmWatchdog,
  noteProgress,
  tickWatchdog,
  synthWaitIsNormal,
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
    advance(5_000);
    tickWatchdog();
    expect(onStall).not.toHaveBeenCalled(); // 임계(6초) 전
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
    advance(7_000);
    tickWatchdog();
    expect(onStall).toHaveBeenCalledTimes(1);
  });

  test('복구 후에는 시계가 리셋돼 연속 발동하지 않는다', () => {
    const onStall = jest.fn();
    armWatchdog({ progressMs: () => 0, busy: () => false }, onStall);
    tickWatchdog(); // 첫 관측 = 기준점
    advance(7_000);
    tickWatchdog();
    tickWatchdog();
    tickWatchdog();
    expect(onStall).toHaveBeenCalledTimes(1);
    advance(7_000);
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
    for (let i = 0; i < 7; i++) {
      advance(1000);
      tickWatchdog();
    }
    expect(onStall).toHaveBeenCalledTimes(1);
  });

  test('noteProgress 는 시계를 되돌린다(문장 전환 등 외부 진행)', () => {
    const onStall = jest.fn();
    armWatchdog({ progressMs: () => 0, busy: () => false }, onStall);
    advance(5_000);
    noteProgress();
    advance(5_000);
    tickWatchdog();
    expect(onStall).not.toHaveBeenCalled();
  });
});

// v1.29.0: 안전망의 두 가지 구조적 결함(사용자 보고 2026-07-29 "화면 끄면 낭독은 멈추는데
// 배경음은 계속 남" — 워치독이 켜져 있는데도 아무 일도 일어나지 않았다)에 대한 회귀 고정.
describe('워치독 구조 불변식', () => {
  // 실제 1초 타이머가 백그라운드에 남지 않게 페이크 타이머로 감싼다(교차검증 code-reviewer
  // 2026-07-29: 지금은 assertion 이 동기라 무해하지만, 이 블록에 비동기 대기가 섞이면
  // 진짜 타이머가 발화해 flake 가 된다).
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    disarmWatchdog();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('무장하면 앵커와 무관한 자체 시계를 돌린다 — 앵커 이벤트가 끊겨도 감시가 산다', () => {
    const setSpy = jest.spyOn(global, 'setInterval');
    const clearSpy = jest.spyOn(global, 'clearInterval');
    armWatchdog({ progressMs: () => 0, busy: () => false }, jest.fn());
    expect(setSpy).toHaveBeenCalledTimes(1);
    disarmWatchdog();
    expect(clearSpy).toHaveBeenCalledTimes(1);
  });

  test('두 번 무장해도 시계는 하나만 남는다(문장마다 재무장 — 타이머 누적 금지)', () => {
    const setSpy = jest.spyOn(global, 'setInterval');
    const clearSpy = jest.spyOn(global, 'clearInterval');
    const probe = { progressMs: () => 0, busy: () => false };
    armWatchdog(probe, jest.fn());
    armWatchdog(probe, jest.fn());
    armWatchdog(probe, jest.fn());
    expect(setSpy).toHaveBeenCalledTimes(3);
    expect(clearSpy).toHaveBeenCalledTimes(2); // 재무장마다 직전 시계를 반드시 정리
  });

  test('합성 대기는 상한을 넘으면 "정상"이 아니다 — busy() 무한 true 가 안전망을 죽인다', () => {
    const t0 = 1_000_000;
    expect(synthWaitIsNormal(t0, 45_000, t0)).toBe(true);
    expect(synthWaitIsNormal(t0, 45_000, t0 + 44_999)).toBe(true);
    expect(synthWaitIsNormal(t0, 45_000, t0 + 45_001)).toBe(false);
    // 요청 시각을 모르면(0) 정상으로 봐 주지 않는다 — 모르는 상태로 영영 대기하지 않게.
    expect(synthWaitIsNormal(0, 45_000, t0)).toBe(false);
  });
});
