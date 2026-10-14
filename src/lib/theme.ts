import { useColorScheme } from 'react-native';
import { useSettings, type ThemeMode } from '../store/settings';

// 디자인 토큰(v1.32.0 전면 개편 — docs/DESIGN-BRIEF.md). 컴포넌트는 hex 를 직접 쓰지 않고
// 이 시맨틱 이름만 쓴다. 글자 대비는 src/__tests__/themeContrast.test.ts 가 테마마다 검사한다
// (본문·보조·버튼 ≥4.5, 흐린 이웃 자막 ≥3.0).
export type Palette = {
  dark: boolean;          // 상태바·내비게이션 테마 결정용
  bg: string;
  surface: string;        // 카드·버튼 바탕
  card: string;
  elevated: string;       // 시트·모달 바탕
  text: string;
  subtext: string;
  faint: string;          // 이전·다음 자막(흐림)
  primary: string;
  primarySoft: string;    // 칩·선택 배경(옅은 브랜드색)
  onPrimary: string;
  onPrimarySoft: string;
  highlight: string;      // 현재 읽는 단어 배경
  highlightText: string;
  border: string;
  danger: string;
  success: string;
  scrim: string;          // 모달 뒤 어둡게
};

// 인디고 정석(A안) — 라이트. #6366f1 위 흰 글자는 4.47:1 로 4.5 에 못 미쳐 한 단계 진하게.
const light: Palette = {
  dark: false,
  bg: '#f6f6fa',
  surface: '#ffffff',
  card: '#ffffff',
  elevated: '#ffffff',
  text: '#16161d',
  subtext: '#575769',
  faint: '#8b8b9c',
  primary: '#4f46e5',
  primarySoft: '#e8e9ff',
  onPrimary: '#ffffff',
  onPrimarySoft: '#3730a3',
  // 읽는 단어 하이라이트: 인디고 계열의 은은한 배경(샛노랑 촌스럽다 — 사용자 2026-07-08).
  highlight: '#e0e7ff',
  highlightText: '#312e81',
  border: '#e4e4ee',
  danger: '#d92d33',
  success: '#167c4a',
  scrim: 'rgba(10,10,20,0.45)',
};

// 세피아 종이(B안) — 크림 바탕·잉크 갈색. 오래 읽어도 눈부심이 적다.
const sepia: Palette = {
  dark: false,
  bg: '#f3ead6',
  surface: '#fbf5e7',
  card: '#fbf5e7',
  elevated: '#fdf8ec',
  text: '#33281c',
  subtext: '#5f4e3b',
  faint: '#8d7a62',
  primary: '#8a4f1d',
  primarySoft: '#ecdcbc',
  onPrimary: '#ffffff',
  onPrimarySoft: '#5c3412',
  highlight: '#e8cf9c',
  highlightText: '#33281c',
  border: '#e2d4b8',
  danger: '#b42318',
  success: '#2f6b31',
  scrim: 'rgba(40,28,14,0.40)',
};

// 다크 — 진남 회색. 다크에서도 주황/노랑 대신 인디고(라이트와 동일 방침).
const dark: Palette = {
  dark: true,
  bg: '#0f0f15',
  surface: '#191921',
  card: '#1b1b25',
  elevated: '#20202b',
  text: '#f1f1f6',
  subtext: '#a9a9bc',
  faint: '#76768c',
  primary: '#8f96ff',
  primarySoft: '#26284d',
  onPrimary: '#0d0d1a',
  onPrimarySoft: '#c9ccff',
  highlight: '#3a3fae',
  highlightText: '#f3f4ff',
  border: '#2a2a37',
  danger: '#ff6b6f',
  success: '#4cc38a',
  scrim: 'rgba(0,0,0,0.6)',
};

// OLED 블랙 — 화면 대부분이 #000(AMOLED 는 검정 픽셀이 꺼진다 = 배터리 절약). 글자도 순백 대신
// 살짝 낮춰 발광·번짐을 줄인다.
const black: Palette = {
  dark: true,
  bg: '#000000',
  surface: '#0c0c11',
  card: '#0e0e14',
  elevated: '#14141c',
  text: '#e4e4ec',
  subtext: '#9c9cae',
  faint: '#6a6a7e',
  primary: '#8f96ff',
  primarySoft: '#1a1c3a',
  onPrimary: '#0b0b18',
  onPrimarySoft: '#c9ccff',
  highlight: '#2c3081',
  highlightText: '#f0f1ff',
  border: '#1d1d27',
  danger: '#ff6b6f',
  success: '#4cc38a',
  scrim: 'rgba(0,0,0,0.7)',
};

export const PALETTES: Record<Exclude<ThemeMode, 'system'>, Palette> = { light, sepia, dark, black };

export const THEME_LABELS: Array<{ mode: ThemeMode; label: string }> = [
  { mode: 'system', label: '자동' },
  { mode: 'light', label: '밝게' },
  { mode: 'sepia', label: '종이' },
  { mode: 'dark', label: '어둡게' },
  { mode: 'black', label: '검정(절전)' },
];

export function resolvePalette(mode: ThemeMode, scheme: string | null | undefined): Palette {
  if (mode === 'system') return scheme === 'dark' ? dark : light;
  return PALETTES[mode] ?? light;
}

export function usePalette(): Palette {
  const scheme = useColorScheme();
  const mode = useSettings((s) => s.themeMode);
  return resolvePalette(mode, scheme);
}

// 반경·간격 토큰(화면 간 일관성).
export const radius = { sm: 10, md: 14, lg: 20, pill: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const;
