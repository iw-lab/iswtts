// 배터리 최적화 예외 화면 열기의 폴백 사슬(v1.29.0).
//
// 왜 테스트가 필요한가(교차검증 code-reviewer 2026-07-29): 이번 릴리스에서 가장 분기가 많은
// 로직인데 테스트가 없었다. 그리고 이 코드가 고치려는 버그가 정확히 "조용한 실패"다 —
// expo-intent-launcher 는 모듈 전역 대기 슬롯 하나를 쓰고, 앞선 인텐트가 결과 콜백을 못
// 받으면 이후 호출을 전부 즉시 거절한다. v1.28.0 은 그 거절을 catch {} 로 삼켜 사용자에게
// "눌러도 아무 반응 없음"이 됐다(사용자 보고 2026-07-29). 폴백이 조용히 끊기면 같은 증상이
// 재발하므로, 각 단계가 실제로 다음 단계를 부르는지 잠가 둔다.

// jest.mock 팩토리는 스코프 밖 변수를 못 본다 — `mock` 접두어만 예외.
const mockStartActivity = jest.fn();
const mockSendIntent = jest.fn();
const mockOpenSettings = jest.fn();
const mockAlert = jest.fn();

jest.mock('expo-intent-launcher', () => ({
  startActivityAsync: (...a: unknown[]) => mockStartActivity(...a),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
}));
jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
  Alert: { alert: (...a: unknown[]) => mockAlert(...a) },
  Linking: {
    sendIntent: (...a: unknown[]) => mockSendIntent(...a),
    openSettings: (...a: unknown[]) => mockOpenSettings(...a),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { openBatteryOptRequest, openBatteryOptWithGuide } = require('../lib/batteryOpt');

// 성공 시 startActivityAsync 는 사용자가 설정 화면에서 돌아올 때까지 **미결**이다 —
// 그 대기를 실제로 흉내 내야 "성공을 실패로 오판하지 않는가"를 검증할 수 있다.
const neverSettles = () => new Promise(() => {});

describe('배터리 최적화 예외 화면 열기', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  /** 400ms 유예를 건너뛰며 결과를 받는다(실시간 대기 없이). */
  async function run(fn: () => Promise<unknown>) {
    const p = fn();
    await Promise.resolve();
    jest.advanceTimersByTime(500);
    await Promise.resolve();
    return p;
  }

  test('1순위 다이얼로그가 열리면 그대로 끝 — 폴백을 부르지 않는다', async () => {
    mockStartActivity.mockImplementation(neverSettles);
    await expect(run(openBatteryOptRequest)).resolves.toBe('dialog');
    expect(mockStartActivity).toHaveBeenCalledWith(
      'android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
      { data: 'package:com.iwtts.app' },
    );
    expect(mockSendIntent).not.toHaveBeenCalled();
    expect(mockOpenSettings).not.toHaveBeenCalled();
  });

  test('1순위가 거절되면(대기 슬롯 점유 등) 배터리 목록 화면으로 물러선다', async () => {
    mockStartActivity.mockRejectedValue(new Error('ActivityAlreadyStartedException'));
    mockSendIntent.mockResolvedValue(undefined);
    await expect(run(openBatteryOptRequest)).resolves.toBe('list');
    expect(mockSendIntent).toHaveBeenCalledWith('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS');
    expect(mockOpenSettings).not.toHaveBeenCalled();
  });

  test('목록 화면도 막히면 앱 정보 화면까지 물러선다', async () => {
    mockStartActivity.mockRejectedValue(new Error('x'));
    mockSendIntent.mockRejectedValue(new Error('no activity'));
    mockOpenSettings.mockResolvedValue(undefined);
    await expect(run(openBatteryOptRequest)).resolves.toBe('appInfo');
    expect(mockOpenSettings).toHaveBeenCalled();
  });

  test('전부 실패해도 던지지 않고 none 을 돌려준다 — 호출부가 안내할 수 있게', async () => {
    mockStartActivity.mockRejectedValue(new Error('x'));
    mockSendIntent.mockRejectedValue(new Error('x'));
    mockOpenSettings.mockRejectedValue(new Error('x'));
    await expect(run(openBatteryOptRequest)).resolves.toBe('none');
  });

  test('폴백으로 열렸으면 무엇을 눌러야 하는지 안내한다(조용한 실패 금지)', async () => {
    mockStartActivity.mockRejectedValue(new Error('x'));
    mockSendIntent.mockResolvedValue(undefined);
    await run(openBatteryOptWithGuide);
    expect(mockAlert).toHaveBeenCalled();
  });

  // 교차검증 codex 2026-07-29: 유예(400ms)를 넘겨 도착하는 거절이 실재한다(일부 기기의
  // ActivityNotFound). 그때 아무것도 안 하면 사용자는 다시 "눌러도 반응 없음"을 겪는다 —
  // 이 코드가 애초에 고치려던 그 증상이다.
  test('유예를 넘겨 실패가 도착해도 폴백을 태운다', async () => {
    let reject!: (e: Error) => void;
    mockStartActivity.mockImplementation(() => new Promise((_r, rj) => { reject = rj; }));
    mockSendIntent.mockResolvedValue(undefined);
    await expect(run(openBatteryOptRequest)).resolves.toBe('dialog'); // 유예 안엔 실패가 없었다
    expect(mockSendIntent).not.toHaveBeenCalled();
    reject(new Error('ActivityNotFoundException')); // 뒤늦게 도착한 실패
    await Promise.resolve();
    await Promise.resolve();
    expect(mockSendIntent).toHaveBeenCalledWith('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS');
  });

  test('시스템 다이얼로그가 직접 뜬 경우엔 안내를 겹치지 않는다', async () => {
    mockStartActivity.mockImplementation(neverSettles);
    await run(openBatteryOptWithGuide);
    expect(mockAlert).not.toHaveBeenCalled();
  });
});
