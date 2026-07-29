// 배터리 최적화 예외 화면 열기(v1.30.0).
//
// 이 코드가 고치려는 버그는 "조용한 실패"다. 사용자는 v1.28.0·v1.29.0 연속으로 "설정에서
// 배터리 예외 버튼을 눌러도 반응 없음"을 보고했다. v1.29.0 은 인텐트가 거절만 안 되면
// 성공으로 보고 **아무 안내도 하지 않았는데**, 거절되지 않으면서 화면도 안 뜨는 분기가
// 실재한다 — 대표적으로 이미 예외 등록된 앱(AOSP 는 UI 없이 즉시 RESULT_OK 로 끝낸다).
// 그래서 판정 기준을 "거절 여부"에서 "설정 화면이 실제로 떴는가(AppState 이탈)"로 바꾸고,
// **모든 분기가 눈에 보이는 결과를 남기는지**를 여기서 잠근다.

// jest.mock 팩토리는 스코프 밖 변수를 못 본다 — `mock` 접두어만 예외.
const mockStartActivity = jest.fn();
const mockSendIntent = jest.fn();
const mockOpenSettings = jest.fn();
const mockAlert = jest.fn();
const mockAppState = { value: 'active' as string };
const mockListeners = new Set<(s: string) => void>();

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
  AppState: {
    get currentState() {
      return mockAppState.value;
    },
    addEventListener: (_e: string, cb: (s: string) => void) => {
      mockListeners.add(cb);
      return { remove: () => mockListeners.delete(cb) };
    },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { openBatteryOptRequest, openBatteryOptWithGuide } = require('../lib/batteryOpt');

/** 설정 화면이 실제로 떴다 = 우리 액티비티가 pause 되어 AppState 가 active 를 벗어난다. */
function settingsScreenAppears(): void {
  mockAppState.value = 'background';
  for (const l of [...mockListeners]) l('background');
}

/** 성공 시 startActivityAsync 는 사용자가 돌아올 때까지 **미결**이다 — 그 대기를 흉내 낸다. */
const neverSettles = () => new Promise(() => {});

async function tick(n = 6): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

/**
 * 관측 창 두 개(1200ms + 1500ms)를 건너뛰며 결과를 받는다.
 * @param onFirstWindow 1차 창 안에서 일어나는 일(창이 뜬다 / 인텐트가 거절된다)
 * @param onGrace 1차 창을 넘겨 2차 유예 안에서 일어나는 일(느린 기기)
 */
async function run(
  fn: () => Promise<unknown>,
  onFirstWindow?: () => void,
  onGrace?: () => void,
): Promise<unknown> {
  const p = fn();
  await tick();
  onFirstWindow?.();
  await tick();
  jest.advanceTimersByTime(1300);
  await tick();
  onGrace?.();
  await tick();
  jest.advanceTimersByTime(1600);
  await tick();
  return p;
}

describe('배터리 최적화 예외 화면 열기', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockAppState.value = 'active';
    mockListeners.clear();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test('시스템 창이 실제로 뜨면 그대로 끝 — 폴백을 부르지 않는다', async () => {
    mockStartActivity.mockImplementation(neverSettles);
    await expect(run(openBatteryOptRequest, settingsScreenAppears)).resolves.toBe('dialog');
    expect(mockStartActivity).toHaveBeenCalledWith(
      'android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
      { data: 'package:com.iwtts.app' },
    );
    expect(mockSendIntent).not.toHaveBeenCalled();
    expect(mockOpenSettings).not.toHaveBeenCalled();
  });

  test('창이 늦게 떠도(느린 기기) 다이얼로그로 판정한다 — 안내가 겹치지 않게', async () => {
    mockStartActivity.mockImplementation(neverSettles);
    await expect(run(openBatteryOptRequest, undefined, settingsScreenAppears)).resolves.toBe(
      'dialog',
    );
    expect(mockSendIntent).not.toHaveBeenCalled();
  });

  // ⭐ 이번 릴리스의 핵심 회귀 — 이 분기가 곧 사용자가 겪은 "눌러도 반응 없음"이었다.
  test('거절도 없고 화면도 안 뜨면 "이미 예외 등록"으로 판정한다(조용히 끝내지 않는다)', async () => {
    mockStartActivity.mockImplementation(neverSettles);
    await expect(run(openBatteryOptRequest)).resolves.toBe('alreadyExempt');
  });

  test('그 경우에도 반드시 안내를 띄운다 — 사용자가 빈손으로 남지 않게', async () => {
    mockStartActivity.mockImplementation(neverSettles);
    await run(openBatteryOptWithGuide);
    expect(mockAlert).toHaveBeenCalled();
  });

  test('1순위가 거절되면(대기 슬롯 점유 등) 배터리 목록 화면으로 물러선다', async () => {
    mockStartActivity.mockRejectedValue(new Error('ActivityAlreadyStartedException'));
    mockSendIntent.mockResolvedValue(undefined);
    await expect(run(openBatteryOptRequest)).resolves.toBe('list');
    expect(mockSendIntent).toHaveBeenCalledWith(
      'android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS',
    );
    expect(mockOpenSettings).not.toHaveBeenCalled();
  });

  test('유예를 넘겨 도착한 거절도 폴백을 태운다', async () => {
    let reject!: (e: Error) => void;
    mockStartActivity.mockImplementation(
      () =>
        new Promise((_r, rj) => {
          reject = rj;
        }),
    );
    mockSendIntent.mockResolvedValue(undefined);
    // 1차 창에선 아무 일도 없고, 2차 유예 안에서 뒤늦게 거절이 도착한다.
    await expect(
      run(openBatteryOptRequest, undefined, () => reject(new Error('ActivityNotFoundException'))),
    ).resolves.toBe('list');
    expect(mockSendIntent).toHaveBeenCalled();
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

  test('폴백으로 열렸으면 무엇을 눌러야 하는지 안내한다', async () => {
    mockStartActivity.mockRejectedValue(new Error('x'));
    mockSendIntent.mockResolvedValue(undefined);
    await run(openBatteryOptWithGuide);
    expect(mockAlert).toHaveBeenCalled();
  });

  test('시스템 창이 직접 뜬 경우엔 안내를 겹치지 않는다', async () => {
    mockStartActivity.mockImplementation(neverSettles);
    await run(openBatteryOptWithGuide, settingsScreenAppears);
    expect(mockAlert).not.toHaveBeenCalled();
  });

  // 어떤 경로로 끝나든 사용자에게 보이는 결과가 있어야 한다(이 파일의 존재 이유).
  test('불변식: 창이 뜬 경우를 빼면 openBatteryOptWithGuide 는 항상 안내한다', async () => {
    const cases: Array<() => void> = [
      () => {
        mockStartActivity.mockImplementation(neverSettles); // alreadyExempt
      },
      () => {
        mockStartActivity.mockRejectedValue(new Error('x'));
        mockSendIntent.mockResolvedValue(undefined); // list
      },
      () => {
        mockStartActivity.mockRejectedValue(new Error('x'));
        mockSendIntent.mockRejectedValue(new Error('x'));
        mockOpenSettings.mockResolvedValue(undefined); // appInfo
      },
      () => {
        mockStartActivity.mockRejectedValue(new Error('x'));
        mockSendIntent.mockRejectedValue(new Error('x'));
        mockOpenSettings.mockRejectedValue(new Error('x')); // none
      },
    ];
    for (const setup of cases) {
      jest.clearAllMocks();
      mockAppState.value = 'active';
      setup();
      await run(openBatteryOptWithGuide);
      expect(mockAlert).toHaveBeenCalled();
    }
  });
});
