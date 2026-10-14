import { Alert, Linking, Platform } from 'react-native';
import {
  cacheDirectory,
  downloadAsync,
  getContentUriAsync,
} from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { APP_VERSION, RELEASE_REPO } from './config';
import { compareVersions } from './version';

// 앱 실행 시 GitHub 최신 릴리스를 확인 → 새 버전이면 안내 → APK 다운로드 → 안드로이드 설치창 오픈.
// 사이드로드 앱 특성상 '무음 강제설치'는 불가(보안) — 사용자가 설치창에서 한 번 탭한다.
// iwmemo(appUpdate.ts)와 동등 동작을, 커스텀 네이티브 모듈 없이 Expo 표준 모듈로 구현.

const GITHUB_API_URL = `https://api.github.com/repos/${RELEASE_REPO}/releases/latest`;

let updateInProgress = false;

async function startUpdate(apkUrl: string, version: string): Promise<void> {
  if (updateInProgress) return;
  updateInProgress = true;
  try {
    // 1) 캐시로 다운로드 → content:// URI → 설치 인텐트
    const target = `${cacheDirectory}SoriBook-${version}.apk`;
    const { uri } = await downloadAsync(apkUrl, target);
    const contentUri = await getContentUriAsync(uri);
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: contentUri,
      flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
      type: 'application/vnd.android.package-archive',
    });
  } catch (e) {
    if (__DEV__) console.warn('APK 설치 인텐트 실패, 브라우저 폴백:', e);
    // 2) 폴백: 브라우저로 다운로드(사용자가 알림에서 설치)
    try {
      await Linking.openURL(apkUrl);
    } catch {
      /* 무시 */
    }
  } finally {
    setTimeout(() => {
      updateInProgress = false;
    }, 5000);
  }
}

// manual = 설정 화면의 「업데이트 확인」(v1.32.0) — 결과를 항상 알려 준다. 자동(기동 시)은 조용히.
export async function checkForUpdate(manual = false): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(GITHUB_API_URL, {
      headers: { Accept: 'application/vnd.github.v3+json' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) {
      if (manual) Alert.alert('업데이트 확인', '지금은 확인할 수 없어요. 잠시 뒤 다시 시도해 주세요.');
      return;
    }

    const release = await res.json();
    const latest = (release.tag_name || '').replace(/^v/, '');
    if (!latest || compareVersions(APP_VERSION, latest) <= 0) {
      if (manual) Alert.alert('업데이트 확인', `최신 버전(v${APP_VERSION})을 쓰고 있어요.`);
      return;
    }

    // 고정명 애셋만 신뢰. ("아무 .apk나" 폴백은 릴리스에 다른 apk가 섞였을 때
    // 엉뚱한 파일이 설치 후보가 되는 경로라 제거 — 릴리스 스크립트가 고정명을 보장한다.)
    const assets = release.assets || [];
    const apk = assets.find(
      (a: any) => a.name === 'SoriBook-latest.apk' && a.browser_download_url,
    );
    if (!apk) return;

    Alert.alert(
      '업데이트 알림',
      `새 버전 v${latest}이 있습니다.\n(현재: v${APP_VERSION})\n\n${release.name || ''}`,
      [
        { text: '나중에', style: 'cancel' },
        { text: '업데이트', onPress: () => startUpdate(apk.browser_download_url, latest) },
      ],
    );
  } catch {
    // 자동 체크 실패는 조용히 무시
    if (manual) Alert.alert('업데이트 확인', '인터넷 연결을 확인한 뒤 다시 시도해 주세요.');
  }
}
