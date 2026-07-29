// 432Hz 배경음 불변식(v1.29.0): **낭독이 꺼지면 배경음도 반드시 꺼진다.**
//
// 왜 잠가 두는가(사용자 보고 2026-07-29 "낭독이 끝나면 432Hz도 꺼져야 되는데 안 꺼져서
// 배터리 엄청 먹음", 교차검증 code-reviewer 2026-07-29 "이 안전망에 회귀 테스트가 없다"):
// 배경음은 무한 루프라 한 번 새어 나가면 몇 시간이고 돈다. 게다가 v1.29.0 에서 재생 중
// 웨이크락을 잡게 했으므로(patches/expo-audio), 새어 나간 루프는 이제 CPU 까지 붙잡는다 —
// 누수의 대가가 전보다 커졌다. 정지 경로를 새로 만들 때 이 불변식이 깨지면 여기서 잡힌다.

const mockStopBgSound = jest.fn();
const mockStartBgSound = jest.fn();

jest.mock('../lib/bgSound', () => ({
  startBgSound: (...a: unknown[]) => mockStartBgSound(...a),
  stopBgSound: (...a: unknown[]) => mockStopBgSound(...a),
  setBgVolume: jest.fn(),
  isBgPlaying: () => false,
}));

// 스토어 모듈이 끌고 오는 네이티브 의존(엔진·오디오 세션)은 이 테스트의 관심사가 아니다.
jest.mock('../tts', () => ({
  getEngine: () => ({ speak: jest.fn(), stop: jest.fn() }),
  systemEngine: { speak: jest.fn(), stop: jest.fn() },
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-audio', () => ({
  createAudioPlayer: () => ({ play: jest.fn(), pause: jest.fn(), remove: jest.fn(), addListener: () => ({ remove: jest.fn() }) }),
  setAudioModeAsync: jest.fn(),
}));
jest.mock('../lib/gapPlayer', () => ({ playGap: jest.fn(() => jest.fn()), GAP_MIN_MS: 60 }));
jest.mock('../lib/mediaSession', () => ({
  startMediaSession: jest.fn(),
  stopMediaSession: jest.fn(),
  setRemoteHandlers: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { usePlayer } = require('../store/player');

describe('배경음 불변식', () => {
  beforeEach(() => jest.clearAllMocks());

  test('playing 이 true → false 로 떨어지면 배경음을 끈다', () => {
    usePlayer.setState({ playing: true });
    expect(mockStopBgSound).not.toHaveBeenCalled();
    usePlayer.setState({ playing: false });
    expect(mockStopBgSound).toHaveBeenCalled();
  });

  test('재생 중 다른 상태만 바뀌는 것으로는 끄지 않는다(문장 전환 등)', () => {
    usePlayer.setState({ playing: true });
    jest.clearAllMocks();
    usePlayer.setState({ index: 3 });
    usePlayer.setState({ wordStart: 10, wordLen: 2 });
    expect(mockStopBgSound).not.toHaveBeenCalled();
  });

  test('이미 꺼진 상태에서 다시 false 를 써도 중복 호출하지 않는다', () => {
    usePlayer.setState({ playing: true });
    usePlayer.setState({ playing: false });
    jest.clearAllMocks();
    usePlayer.setState({ playing: false });
    expect(mockStopBgSound).not.toHaveBeenCalled();
  });
});
