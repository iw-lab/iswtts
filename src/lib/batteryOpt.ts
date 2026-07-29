import { Platform, Alert, Linking } from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';
import AsyncStorage from '@react-native-async-storage/async-storage';

// 백그라운드(화면 꺼짐) 낭독을 도즈/OEM 배터리 관리로부터 지킨다.
//
// 배경(2026-07-16 사용자 "화면 꺼지고 시간 지나면 멈춰버려"): mediaPlayback 포그라운드
// 서비스만으로는 공격적인 배터리 관리 기기(삼성·샤오미 등)에서 백그라운드 앱을 수 분 뒤
// 재우는 걸 못 막는 경우가 있다. 예전엔 홈 진입 시 뜨던 작은 창(PiP)이 앱을 "보이는 창"으로
// 붙잡아 그 강제 절전을 우연히 막고 있었는데, 작은 창을 폐지하며 그 보호가 사라졌다.
// 표준 해법 = 앱을 배터리 최적화 예외로 등록(ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).
// 특히 오프라인(sherpa) 엔진은 합성이 앱 자체 CPU를 쓰므로 백그라운드 CPU가 조여지면 멈춘다.

const PKG = 'com.iwtts.app';
const PROMPTED_KEY = 'iwtts-bgreliability-prompted';
// 이 앱만 대상으로 하는 예외 등록 다이얼로그(권한 REQUEST_IGNORE_BATTERY_OPTIMIZATIONS 필요 —
// 매니페스트에 선언돼 있다). data 가 "package:<앱패키지>" 여야 리스트 전체가 아닌 이 앱 창이 뜬다.
const ACTION_REQUEST = 'android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS';
// 전체 앱 목록 화면. data·별도 권한이 필요 없어 위 다이얼로그가 실패해도 거의 항상 열린다.
const ACTION_LIST = 'android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS';

/** 어느 경로로 열렸는지(호출부 안내 문구 분기용). 'none' = 전부 실패. */
export type BatteryOptResult = 'dialog' | 'list' | 'appInfo' | 'none';

// ⚠️ expo-intent-launcher 의 startActivityAsync 는 모듈 전역 pendingPromise 를 하나만 두고,
// 그 값이 남아 있으면 다음 호출을 즉시 ActivityAlreadyStartedException 으로 거절한다
// (IntentLauncherModule.kt 실측). pendingPromise 는 OnActivityResult 에서만 지워지므로,
// 결과 콜백을 못 받은 인텐트가 한 번이라도 있으면(액티비티 재생성·앱 업데이트 설치 인텐트 등)
// 그 뒤로는 이 버튼이 영구히 죽는다. v1.28.0 까지는 그 거절을 catch {} 로 통째로 삼켜
// "눌러도 아무 반응 없음"이 됐다(사용자 보고 2026-07-29). 그래서 ① 실패를 삼키지 않고
// ② IntentLauncher 를 안 쓰는 경로(RN Linking — startActivityForResult 가 아니라서
// pendingPromise 와 무관)로 두 단계 폴백한다.
// 유예를 넘겨 도착한 실패도 폴백을 태운다(교차검증 codex 2026-07-29): 400ms 안에 거절이
// 안 오면 성공으로 보고 반환하는데, 일부 기기는 그보다 늦게 ActivityNotFound 로 거절한다.
// 그때 아무것도 안 하면 사용자는 다시 "눌러도 반응 없음"을 겪는다 — 원래 고치려던 그 증상이다.
async function tryIntentLauncher(onLateFailure: () => void): Promise<boolean> {
  try {
    // 성공하면 이 Promise 는 사용자가 설정 화면에서 돌아올 때까지 미결이다 — 그대로 await 하면
    // 폴백 판정이 그만큼 늦는다. 실패는 대개 즉시 거절되므로 짧은 유예와 경주시킨다.
    const started = IntentLauncher.startActivityAsync(ACTION_REQUEST, { data: `package:${PKG}` });
    let failed = false;
    let decided = false;
    started.catch(() => {
      failed = true;
      if (decided) onLateFailure(); // 유예 뒤에 온 실패 — 지금이라도 폴백
    });
    await Promise.race([
      started.catch(() => undefined),
      new Promise((r) => setTimeout(r, 400)),
    ]);
    decided = true;
    return !failed;
  } catch {
    return false;
  }
}

async function trySendIntent(action: string): Promise<boolean> {
  try {
    await Linking.sendIntent(action);
    return true;
  } catch {
    return false;
  }
}

/**
 * 배터리 최적화 예외 등록 화면을 연다. 다이얼로그 → 전체 목록 → 앱 정보 순으로 폴백해
 * "눌러도 아무 일도 안 일어나는" 경우를 없앤다.
 */
export async function openBatteryOptRequest(): Promise<BatteryOptResult> {
  if (Platform.OS !== 'android') return 'none';
  if (await tryIntentLauncher(() => void fallbackChain())) return 'dialog';
  return fallbackChain();
}

/** 1순위(시스템 다이얼로그)가 안 될 때의 물러서기 — 목록 화면 → 앱 정보 화면. */
async function fallbackChain(): Promise<BatteryOptResult> {
  if (await trySendIntent(ACTION_LIST)) return 'list';
  try {
    await Linking.openSettings();
    return 'appInfo';
  } catch {
    return 'none';
  }
}

/** 설정 화면 버튼용 — 어떤 화면이 열렸는지에 맞춰 무엇을 눌러야 하는지 알려준다. */
export async function openBatteryOptWithGuide(): Promise<void> {
  const how = await openBatteryOptRequest();
  if (how === 'dialog') return; // 시스템 다이얼로그가 그 자리에서 "허용"을 묻는다 — 안내 불필요
  if (how === 'list') {
    Alert.alert(
      '배터리 최적화 목록이 열렸어요',
      '위쪽 목록을 "모든 앱"으로 바꾼 뒤 소리책을 찾아 "최적화하지 않음"(기기에 따라 "제한 없음")으로 설정해 주세요.',
    );
    return;
  }
  if (how === 'appInfo') {
    Alert.alert(
      '앱 정보 화면이 열렸어요',
      '배터리 > 제한 없음(또는 최적화하지 않음)으로 바꿔 주세요.',
    );
    return;
  }
  Alert.alert(
    '설정 화면을 열지 못했습니다',
    '기기 설정 > 배터리 > 배터리 사용량 최적화에서 소리책을 "최적화하지 않음"으로 직접 설정해 주세요.',
  );
}

// 첫 재생 시 1회만 안내(거부해도 다시 조르지 않음 — 설정에서 언제든 다시 열 수 있다).
// 시스템 다이얼로그를 갑자기 띄우지 않고 왜 필요한지 먼저 설명한 뒤 사용자가 열도록 한다.
export async function promptBgReliabilityOnce(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    if (await AsyncStorage.getItem(PROMPTED_KEY)) return;
    // ⚠️ 플래그는 Alert 를 실제로 띄운 **뒤에** 저장한다(교차검증 codex 2026-07-29):
    // 먼저 저장하면 Alert 가 실패하거나 그 순간 앱이 죽었을 때 안내를 한 번도 못 본 채로
    // "이미 안내함"이 영구히 남는다.
    Alert.alert(
      '화면을 꺼도 계속 들으려면',
      '일부 기기는 절전 기능이 백그라운드 앱을 멈춰, 화면을 끄면 잠시 뒤 낭독이 끊길 수 있어요. ' +
        '이 앱을 배터리 최적화 예외로 등록하면 화면이 꺼져도 끝까지 이어서 읽어드립니다.\n\n' +
        '(설정 > 배경 재생에서 언제든 다시 열 수 있어요.)',
      [
        { text: '나중에', style: 'cancel' },
        { text: '설정 열기', onPress: () => { void openBatteryOptWithGuide(); } },
      ],
    );
    await AsyncStorage.setItem(PROMPTED_KEY, '1');
  } catch {
    /* 미지원/실패 — 무시(FGS 로만 동작) */
  }
}
