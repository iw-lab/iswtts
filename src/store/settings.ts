import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { EngineId } from '../types';

export type { EngineId };

// 읽기 테마(v1.32.0) — system=기기 설정 따름, black=OLED 완전 검정(배터리 절약).
export type ThemeMode = 'system' | 'light' | 'sepia' | 'dark' | 'black';

export type SettingsState = {
  engineId: EngineId;   // 'system'=온디바이스 시스템 TTS(기본·오프라인), 'edge'=Edge 온라인 신경망
  rate: number;         // 재생 속도 (0.5 .. 10.0). Android setSpeechRate는 피치 보존.
  pitch: number;        // 음높이 (0.5 .. 2.0). 1.0 유지가 배속 시 가장 또렷.
  language: string;     // BCP-47
  voiceId?: string;       // 시스템 엔진 선택 음성(엔진 식별자)
  edgeVoiceId?: string;   // Edge 엔진 선택 음성(예: ko-KR-SunHiNeural). 엔진마다 식별자 체계가 달라 분리.
  sherpaVoiceId?: string; // sherpa(오프라인 신경망) 화자 sid('0'~'9')
  // 대사(따옴표 발화)를 다른 목소리로 낭독(멀티보이스). 대사 음성 미지정 시 자동 대비 음성.
  dialogueVoice: boolean;
  dialogueVoiceId?: string;       // 시스템 엔진 대사 음성(미지정 = 같은 음성 + 피치 대비)
  edgeDialogueVoiceId?: string;   // Edge 대사 음성(미지정 = 자동 대비: 여↔남)
  sherpaDialogueVoiceId?: string; // sherpa 대사 화자 sid(미지정 = 기본 화자 + 1)
  fontScale: number;    // 자막 글자 배율 (0.8 .. 1.8)
  bgSound: boolean;     // 낭독 뒤 432Hz 배경 앰비언트 재생 여부(기본 꺼짐)
  breathSound: boolean; // 긴 문장 앞 숨소리(오프라인 고품질 음성 전용, 기본 꺼짐)
  rubato: boolean;      // 낭독 완급 변주(오프라인 고품질 음성 전용, 기본 켜짐 — rate.ts sherpaRubato)
  bgVolume: number;     // 배경음 볼륨 (0 .. 0.6) — 낭독을 가리지 않게 낮게
  themeMode: ThemeMode; // 읽기 테마(v1.32.0)
  // 재생 중 화면 항상 켜두기(v1.32.0, 기본 꺼짐). v1.31 까지는 재생 중이면 무조건 화면을
  // 켜 뒀다 — 플레이어 화면을 띄워 두고 들으면 화면이 몇 시간이고 안 꺼져 배터리의 최대
  // 소모원이 됐다(사용자 보고 2026-10-14 "배터리가 너무 많이 달아"). 화면이 꺼져도 낭독은
  // 이어지므로(v1.30.0) 기본은 기기 화면 꺼짐 시간을 따른다.
  keepAwake: boolean;
  // 음성 안정화(v1.32.0, 기본 켜짐): 문장별 고정 시드(같은 문장 = 같은 목소리) + 문장 음량
  // 고르기 + 말끝 결함 감지 시 1회 재합성. 근거·실측은 tts/sherpa/voiceStable.ts.
  voiceStable: boolean;
  sleepMinutes: number; // 마지막으로 고른 취침 타이머(분) — 다음에 기본값으로 제안
  set: (patch: Partial<SettingsState>) => void;
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      engineId: 'system',
      rate: 1.0,
      pitch: 1.0,
      language: 'ko-KR',
      voiceId: undefined,
      edgeVoiceId: undefined,
      sherpaVoiceId: undefined,
      dialogueVoice: false,
      dialogueVoiceId: undefined,
      edgeDialogueVoiceId: undefined,
      sherpaDialogueVoiceId: undefined,
      fontScale: 1.0,
      bgSound: false,
      breathSound: false,
      rubato: true,
      bgVolume: 0.2,
      themeMode: 'system',
      keepAwake: false,
      voiceStable: true,
      sleepMinutes: 30,
      // 스토어 레벨 방어 클램프 — 어떤 호출부에서도 범위를 벗어난 값이 엔진까지 흐르지 않게.
      set: (patch) => {
        const next: Partial<SettingsState> = { ...patch };
        if (next.rate != null) next.rate = clamp(next.rate, 0.5, 10);
        if (next.pitch != null) next.pitch = clamp(next.pitch, 0.5, 2);
        if (next.fontScale != null) next.fontScale = clamp(next.fontScale, 0.8, 1.8);
        if (next.bgVolume != null) next.bgVolume = clamp(next.bgVolume, 0, 0.6);
        set(next);
      },
    }),
    {
      name: 'iwtts-settings',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        engineId: s.engineId,
        rate: s.rate,
        pitch: s.pitch,
        language: s.language,
        voiceId: s.voiceId,
        edgeVoiceId: s.edgeVoiceId,
        sherpaVoiceId: s.sherpaVoiceId,
        dialogueVoice: s.dialogueVoice,
        dialogueVoiceId: s.dialogueVoiceId,
        edgeDialogueVoiceId: s.edgeDialogueVoiceId,
        sherpaDialogueVoiceId: s.sherpaDialogueVoiceId,
        fontScale: s.fontScale,
        bgSound: s.bgSound,
        breathSound: s.breathSound,
        rubato: s.rubato,
        bgVolume: s.bgVolume,
        themeMode: s.themeMode,
        keepAwake: s.keepAwake,
        voiceStable: s.voiceStable,
        sleepMinutes: s.sleepMinutes,
      }),
    },
  ),
);
