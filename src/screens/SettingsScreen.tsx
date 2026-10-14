import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Speech from 'expo-speech';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { usePalette, radius, THEME_LABELS } from '../lib/theme';
import Icon from '../components/Icon';
import { Card, Chip, Divider, Hint, IconButton, PrimaryButton, SectionTitle, StepperRow, SwitchRow } from '../components/ui';
import { checkForUpdate } from '../lib/appUpdate';
import { useSettings } from '../store/settings';
import { usePlayer, resetEngineCircuit } from '../store/player';
import { getEngine, systemEngine, edgeEngine, sherpaEngine } from '../tts';
import { EDGE_VOICES } from '../tts/edge/voices';
import {
  isSherpaModelReady,
  isSherpaDownloadActive,
  downloadSherpaModel,
  cancelSherpaDownload,
  deleteSherpaModel,
  SHERPA_MODEL_MB,
} from '../lib/sherpaModel';
import { sherpaStats, type SherpaStats } from '../tts/sherpa/stats';
import { subtitlesVisible } from '../lib/visibility';
import { openBatteryOptWithGuide } from '../lib/batteryOpt';
import { startBgSound, stopBgSound, setBgVolume } from '../lib/bgSound';
import { APP_VERSION } from '../lib/config';
import { stepRateValue, RATE_MAX } from '../lib/rateSteps';
import type { RootStackParamList } from '../../App';
import type { EngineVoice } from '../tts/TtsEngine';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

const LANGS = [
  { code: 'ko-KR', label: '한국어' },
  { code: 'en-US', label: 'English' },
  { code: 'ja-JP', label: '日本語' },
  { code: 'zh-CN', label: '中文' },
];

export default function SettingsScreen({ navigation }: Props) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const s = useSettings();

  // 설정에서 배경음을 켜면 미리듣기로 바로 재생된다. 낭독 중이 아니라면 설정을 나갈 때 멈춘다
  // (낭독이 재생 중이면 그 배경음은 계속 유지). 낭독 중엔 stopMediaSession 이 알아서 정리한다.
  useEffect(() => {
    return () => {
      if (!usePlayer.getState().playing) stopBgSound();
    };
  }, []);
  const [voices, setVoices] = useState<EngineVoice[]>([]);
  const [sherpaVoices, setSherpaVoices] = useState<EngineVoice[]>([]);
  const [previewFail, setPreviewFail] = useState(false);
  // 오프라인 모델 상태: 'checking' | 'none' | 'downloading' | 'ready'
  const [modelState, setModelState] = useState<'checking' | 'none' | 'downloading' | 'ready'>('checking');
  const [dlPercent, setDlPercent] = useState(0);
  const [dlPhase, setDlPhase] = useState<'downloading' | 'extracting'>('downloading');
  const [dlError, setDlError] = useState<string | null>(null);
  // 오프라인 재생 진단(음성 준비 속도·낭독 대기) — 낭독을 한 번이라도 한 뒤에만 표시.
  // "배속에서 리듬이 흔들린다"가 기기 성능 문제인지 코드 문제인지를 추측 대신 숫자로 가른다.
  // stats 는 zustand 가 아니라 모듈 싱글턴이라 값이 바뀌어도 리렌더가 걸리지 않는다 —
  // 재생 중(백그라운드 낭독) 이 화면을 열어 두고 숫자가 움직이는 걸 지켜보는 게 이 기능의
  // 용도이므로 1초 폴링으로 갱신한다(dlPercent 와 같은 패턴).
  const [diag, setDiag] = useState<SherpaStats | null>(null);
  const aliveRef = useRef(true);
  const dlDetach = useRef<(() => void) | null>(null);

  useEffect(() => {
    const tick = () => {
      // 화면이 꺼진 채 이 화면이 마운트돼 있으면 갱신할 이유가 없다(배터리).
      if (!subtitlesVisible()) return;
      const st = sherpaStats();
      setDiag(st.synths > 0 ? st : null);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    systemEngine
      .getVoices()
      .then((v) => {
        if (aliveRef.current) setVoices(v);
      })
      .catch(() => {
        /* 음성 목록 조회 실패 → 빈 목록 안내가 대신 표시됨 */
      });
    sherpaEngine.getVoices().then((v) => {
      if (aliveRef.current) setSherpaVoices(v);
    });
    // 화면을 나갔다 와도 진행 중 다운로드에 다시 합류(싱글턴).
    if (isSherpaDownloadActive()) attachToDownload();
    else
      isSherpaModelReady().then((ready) => {
        if (aliveRef.current && !isSherpaDownloadActive()) setModelState(ready ? 'ready' : 'none');
      });
    return () => {
      aliveRef.current = false;
      dlDetach.current?.(); // 진행률 리스너 해제(다운로드 자체는 계속)
      dlDetach.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 화면을 떠나면 미리듣기 발화도 정지(안 하면 뒤로 간 뒤에도 계속 재생됨).
  // 다운로드는 유지(취소는 명시 버튼으로만) — 나갔다 와도 이어받는다(ensureModel 재개).
  useEffect(() => {
    return () => {
      // 책이 재생 중이면(잠금화면 ▶ 로 서재에서 재개된 경우 등) 공유 엔진을 끊지 않는다 — 미리듣기는
      // 시작할 때 이미 책을 멈추므로, 재생 중이라는 건 미리듣기가 아니라 책이라는 뜻(교차검증 codex).
      if (usePlayer.getState().playing) return;
      Speech.stop();
      edgeEngine.stop();
      sherpaEngine.stop();
    };
  }, []);

  // 진행 중(또는 새) 다운로드에 진행률 리스너를 붙이고 완료/실패를 화면 상태에 반영.
  const attachToDownload = () => {
    setDlError(null);
    setModelState('downloading');
    // 받는 동안 사용자가 다른 엔진을 고르면 완료 시 자동 전환하지 않는다(교차검증 codex).
    const engineAtStart = useSettings.getState().engineId;
    const { promise, detach } = downloadSherpaModel((prog) => {
      if (!aliveRef.current) return;
      setDlPercent(Math.max(0, Math.min(100, Math.round(prog.percent || 0))));
      if (prog.phase) setDlPhase(prog.phase);
    });
    dlDetach.current = detach;
    promise.then(
      () => {
        // 받자마자 곧바로 이 엔진으로 듣게 선택까지 완료(사용자 의도가 명확).
        // 단, 다른 엔진으로 낭독 중이면 문장 중간에 목소리가 조용히 바뀌지 않게 전환 보류.
        resetEngineCircuit('sherpa');
        if (!usePlayer.getState().playing && useSettings.getState().engineId === engineAtStart) {
          useSettings.getState().set({ engineId: 'sherpa' });
        }
        if (aliveRef.current) setModelState('ready');
      },
      (e) => {
        if (!aliveRef.current) return;
        setModelState('none');
        const msg = String((e as Error)?.message || e);
        // 실제 원인을 그대로 보여준다 — 뭉뚱그린 안내("인터넷/저장공간 확인")는 둘 다
        // 멀쩡할 때 사용자가 원인을 좁힐 수 없었다(2026-07-06 실사용 보고).
        setDlError(
          /abort/i.test(msg)
            ? null // 사용자 취소는 오류 아님
            : `다운로드에 실패했습니다 — ${msg.slice(0, 140)}`,
        );
      },
    );
  };

  const startModelDownload = () => {
    if (modelState === 'downloading') return;
    setDlPercent(0);
    setDlPhase('downloading');
    attachToDownload();
  };

  const cancelModelDownload = () => {
    cancelSherpaDownload();
  };

  const confirmDeleteModel = () => {
    Alert.alert('오프라인 음성 삭제', '내려받은 음성 데이터를 삭제할까요? 필요하면 다시 받을 수 있습니다.', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          // 재생 중 삭제 방어: 이 엔진으로 낭독 중일 수 있다 — 재생을 먼저 멈추지 않으면
          // releaseNative 가 재생 중 인스턴스를 파괴해 onDone/onError 없이 영구 고착된다.
          // 지우는 동안 카드를 다시 눌러 삭제 중인 모델을 고르지 못하게(교차검증 codex).
          if (aliveRef.current) setModelState('checking');
          if (usePlayer.getState().playing) usePlayer.getState().pause();
          if (useSettings.getState().engineId === 'sherpa') s.set({ engineId: 'system' });
          await sherpaEngine.releaseNative(); // 파일을 쥔 채 지우지 않게 먼저 해제
          await deleteSherpaModel();
          if (aliveRef.current) setModelState('none');
        },
      },
    ]);
  };

  // expo-speech의 Voice.quality는 현재 'Enhanced' | 'Default'만 반환한다.
  const isHiQuality = (q?: string) => !!q && /enhanced/i.test(q);

  const isEdge = s.engineId === 'edge';
  const isSherpa = s.engineId === 'sherpa';

  // 언어 일치 + 고품질(Enhanced/Network) 우선 정렬 → 배속에서 더 또렷한 음성이 위로.
  const systemLangVoices = voices
    .filter((v) => v.language?.toLowerCase().startsWith(s.language.slice(0, 2).toLowerCase()))
    .sort((a, b) => {
      const qa = isHiQuality(a.quality) ? 0 : 1;
      const qb = isHiQuality(b.quality) ? 0 : 1;
      if (qa !== qb) return qa - qb;
      return a.name.localeCompare(b.name);
    });

  const edgeLangVoices = EDGE_VOICES.filter((v) =>
    v.language.toLowerCase().startsWith(s.language.slice(0, 2).toLowerCase()),
  );

  // sherpa(다국어 단일 모델)는 화자 목록이 언어와 무관 — 필터 없이 전체.
  const langVoices = isSherpa ? sherpaVoices : isEdge ? edgeLangVoices : systemLangVoices;
  const selectedVoiceId = isSherpa ? s.sherpaVoiceId : isEdge ? s.edgeVoiceId : s.voiceId;
  const selectVoice = (id?: string) => {
    s.set(isSherpa ? { sherpaVoiceId: id } : isEdge ? { edgeVoiceId: id } : { voiceId: id });
    // 재생 중이면 옛 화자로 쌓인 선행합성을 버리고 새 화자로 다시 채운다(캐시 키가 통째로
    // 바뀌므로 안 하면 다음 문장마다 즉석 재합성 대기 — 교차검증 지적 2026-07-26).
    usePlayer.getState().refreshVoice();
  };
  // 대사 음성(멀티보이스) — 엔진별 별도 키. 미지정(undefined) = 자동 대비 음성.
  const selectedDialogueVoiceId = isSherpa
    ? s.sherpaDialogueVoiceId
    : isEdge
      ? s.edgeDialogueVoiceId
      : s.dialogueVoiceId;
  const selectDialogueVoice = (id?: string) => {
    s.set(
      isSherpa
        ? { sherpaDialogueVoiceId: id }
        : isEdge
          ? { edgeDialogueVoiceId: id }
          : { dialogueVoiceId: id },
    );
    usePlayer.getState().refreshVoice();
  };

  const sampleText = () =>
    s.language.startsWith('ko')
      ? '안녕하세요. 소리책이 이렇게 읽어드립니다.'
      : s.language.startsWith('ja')
        ? 'こんにちは。ソリブックが読み上げます。'
        : s.language.startsWith('zh')
          ? '你好，这是朗读示例。'
          : 'Hello. This is how SoriBook reads to you.';

  const preview = (voiceId?: string) => {
    // 책 재생 중이면 먼저 정지(엔진 싱글턴 공유 → 미리듣기가 재생을 가로채 좀비 상태 방지).
    if (usePlayer.getState().playing) usePlayer.getState().pause();
    // 모든 엔진 정지 후, 선택 엔진으로 샘플 발화.
    Speech.stop();
    edgeEngine.stop();
    sherpaEngine.stop();
    setPreviewFail(false);
    const engine = getEngine(s.engineId);
    const vId = voiceId ?? (isSherpa ? s.sherpaVoiceId : isEdge ? s.edgeVoiceId : s.voiceId);
    engine.speak(
      sampleText(),
      { rate: s.rate, pitch: s.pitch, language: s.language, voiceId: vId },
      {
        // 실패 시 무음+무피드백이면 사용자가 원인을 알 수 없다 → 안내 텍스트 표시.
        onError: () => setPreviewFail(true),
      },
    );
  };

  const clamp = (v: number, lo: number, hi: number) =>
    Math.round(Math.max(lo, Math.min(hi, v)) * 100) / 100;

  const rateMax = RATE_MAX; // 눈금 단일 진실원(lib/rateSteps.ts) — 하드코딩 이중화 금지
  const setRate = (dir: 1 | -1) => {
    // 눈금(1~2× 는 0.1 간격)은 rateSteps.ts 단일 진실원 — 플레이어 스테퍼와 동일.
    const r = stepRateValue(s.rate, dir);
    s.set({ rate: r });
    usePlayer.getState().applyRate(r); // 재생 중이면 즉시 반영(가능 시 라이브)
  };

  // 배터리 진단: 합성에 쓴 시간 ÷ 만든 오디오 길이 = 낭독 1분을 만들려고 CPU 가 일한 비율.
  const synthShare = diag && diag.audioMs > 0 ? diag.synthMs / diag.audioMs : null;

  const voiceRow = (v: EngineVoice, active: boolean, onSelect: () => void, keyPrefix = '') => {
    const hq = isEdge || isSherpa || isHiQuality(v.quality);
    // 중첩 Touchable 회피: 바깥은 View, 선택/미리듣기를 별도 Touchable로 분리.
    return (
      <View
        key={`${keyPrefix}${v.id}`}
        style={[styles.voiceRow, { borderColor: active ? p.primary : p.border, backgroundColor: active ? p.primarySoft : p.surface }]}
      >
        <TouchableOpacity
          style={{ flex: 1 }}
          onPress={onSelect}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`음성 ${v.name} 선택`}
          accessibilityState={{ selected: active }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ color: active ? p.onPrimarySoft : p.text, fontWeight: active ? '800' : '600', fontSize: 15 }} numberOfLines={1}>
              {v.name}
            </Text>
            {hq && !keyPrefix && (
              <View style={[styles.badge, { backgroundColor: p.primary }]}>
                <Text style={{ color: p.onPrimary, fontSize: 10, fontWeight: '800' }}>고품질</Text>
              </View>
            )}
          </View>
          <Text style={{ color: p.subtext, fontSize: 12 }}>{v.language}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => preview(v.id)}
          hitSlop={10}
          style={[styles.voicePlay, { borderColor: p.border, backgroundColor: p.bg }]}
          accessibilityRole="button"
          accessibilityLabel={`음성 ${v.name} 미리듣기`}
        >
          <Icon name="play" size={16} color={p.primary} />
        </TouchableOpacity>
      </View>
    );
  };

  const engineCard = (
    id: 'system' | 'edge' | 'sherpa',
    title: string,
    desc: string,
    onPress: () => void,
    badge?: string,
    extra?: React.ReactNode,
    disabled?: boolean,
  ) => {
    const active = s.engineId === id;
    return (
      <TouchableOpacity
        onPress={onPress}
        disabled={disabled}
        style={[styles.engine, { borderColor: active ? p.primary : p.border, backgroundColor: active ? p.primarySoft : p.surface }]}
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${desc}`}
        accessibilityState={{ selected: active, disabled: !!disabled }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={[styles.radio, { borderColor: active ? p.primary : p.faint }]}>
            {active && <View style={[styles.radioDot, { backgroundColor: p.primary }]} />}
          </View>
          <Text style={{ color: active ? p.onPrimarySoft : p.text, fontWeight: '800', fontSize: 15.5, flexShrink: 1 }}>{title}</Text>
          {!!badge && (
            <View style={[styles.badge, { backgroundColor: p.primary }]}>
              <Text style={{ color: p.onPrimary, fontSize: 10, fontWeight: '800' }}>{badge}</Text>
            </View>
          )}
        </View>
        <Text style={{ color: p.subtext, fontSize: 12.5, lineHeight: 19, marginTop: 6, marginLeft: 28 }}>{desc}</Text>
        {extra}
      </TouchableOpacity>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <View style={[styles.head, { paddingTop: insets.top + 6 }]}>
        <Text style={[styles.h1, { color: p.text }]}>설정</Text>
        <IconButton name="close" onPress={() => navigation.goBack()} label="설정 닫기" />
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 40 }}>
        {/* ── 화면 ───────────────────────────── */}
        <SectionTitle>화면</SectionTitle>
        <Card>
          <Text style={[styles.label, { color: p.text }]}>테마</Text>
          <View style={styles.chips}>
            {THEME_LABELS.map((t) => (
              <Chip key={t.mode} label={t.label} active={s.themeMode === t.mode} onPress={() => s.set({ themeMode: t.mode })} />
            ))}
          </View>
          <Hint>「검정(절전)」은 바탕을 완전한 검정으로 칠해, 화면이 OLED 인 폰에서 화면 전력을 가장 적게 씁니다.</Hint>
          <Divider />
          <StepperRow
            label="자막 글자 크기"
            value={`${Math.round(s.fontScale * 100)}%`}
            onDec={() => s.set({ fontScale: clamp(s.fontScale - 0.1, 0.8, 1.8) })}
            onInc={() => s.set({ fontScale: clamp(s.fontScale + 0.1, 0.8, 1.8) })}
            decDisabled={s.fontScale <= 0.8}
            incDisabled={s.fontScale >= 1.8}
          />
          <Divider />
          <SwitchRow
            icon="sun"
            label="재생 중 화면 켜두기"
            hint="끄면(권장) 기기의 화면 꺼짐 시간대로 화면이 꺼지고 낭독은 계속됩니다. 켜 두면 배터리를 가장 많이 씁니다."
            value={s.keepAwake}
            onChange={(v) => s.set({ keepAwake: v })}
          />
        </Card>

        {/* ── 음성 엔진 ───────────────────────── */}
        <SectionTitle>음성 엔진</SectionTitle>
        <View style={{ gap: 10 }}>
          {engineCard(
            'sherpa',
            '고품질 오프라인 (신경망)',
            '자연스러운 목소리를 인터넷 없이. 기기 안에서만 음성을 만들어 어떤 문장도 밖으로 전송되지 않습니다. 화자 10명.',
            () => {
              if (modelState === 'ready') {
                resetEngineCircuit('sherpa');
                s.set({ engineId: 'sherpa' });
              } else if (modelState === 'none') {
                startModelDownload();
              }
            },
            '추천',
            <View style={{ marginLeft: 28 }}>
              {modelState === 'none' && (
                <Text style={{ color: p.primary, fontSize: 13, fontWeight: '800', marginTop: 8 }}>
                  ⬇ 눌러서 음성 데이터 받기 ({SHERPA_MODEL_MB}MB · 와이파이 권장 · 받는 동안 앱을 열어두세요)
                </Text>
              )}
              {modelState === 'downloading' && (
                <View style={{ marginTop: 10 }}>
                  <View style={[styles.dlBar, { backgroundColor: p.border }]}>
                    <View style={[styles.dlFill, { backgroundColor: p.primary, width: `${dlPercent}%` }]} />
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
                    <Text style={{ color: p.subtext, fontSize: 12.5 }}>
                      {dlPhase === 'extracting' ? '설치 중' : '다운로드 중'} {dlPercent}%
                    </Text>
                    <TouchableOpacity onPress={cancelModelDownload} hitSlop={10} accessibilityRole="button" accessibilityLabel="다운로드 취소">
                      <Text style={{ color: p.subtext, fontSize: 12.5, fontWeight: '800' }}>취소</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
              {dlError && <Text style={{ color: p.danger, fontSize: 12.5, marginTop: 6 }}>{dlError}</Text>}
              {modelState === 'ready' && (
                <TouchableOpacity
                  onPress={confirmDeleteModel}
                  hitSlop={8}
                  style={{ marginTop: 8, alignSelf: 'flex-start' }}
                  accessibilityRole="button"
                  accessibilityLabel="오프라인 음성 데이터 삭제"
                >
                  <Text style={{ color: p.subtext, fontSize: 12.5, textDecorationLine: 'underline' }}>음성 데이터 삭제</Text>
                </TouchableOpacity>
              )}
            </View>,
            modelState === 'checking',
          )}
          {engineCard(
            'edge',
            '고품질 온라인 (Edge 신경망)',
            '사람 같은 목소리. 무료지만 인터넷이 필요하고, 연결이 안 되면 자동으로 기본 음성으로 읽어줍니다. ※ 읽는 문장이 음성 생성을 위해 Microsoft 서버로 전송됩니다.',
            () => {
              // 사용자가 명시적으로 Edge를 다시 고르면 실패 백오프(서킷)도 초기화해 즉시 재시도.
              resetEngineCircuit('edge');
              s.set({ engineId: 'edge' });
            },
          )}
          {engineCard('system', '기본 (기기 내장)', '인터넷 없이 동작. 기기에 설치된 시스템 음성을 사용합니다.', () =>
            s.set({ engineId: 'system' }),
          )}
        </View>

        {/* ── 낭독 ─────────────────────────── */}
        <SectionTitle>낭독</SectionTitle>
        <Card>
          <StepperRow
            label="속도"
            value={`${s.rate}×`}
            onDec={() => setRate(-1)}
            onInc={() => setRate(1)}
            decDisabled={s.rate <= 0.5}
            incDisabled={s.rate >= rateMax}
          />
          <Hint>
            최대 {rateMax}×. 배속해도 음높이는 유지돼요.
            {isEdge
              ? ' 고품질 온라인은 2×까지 원음 그대로이고, 그 이상은 소리가 점점 거칠어질 수 있습니다.'
              : isSherpa
                ? ' 고품질 오프라인은 3×까지 원음 그대로입니다. 그보다 빠르면 또렷하게 들리도록 조정하면서 음색이 조금 달라질 수 있어요.'
                : ' 아주 빠른 속도의 또렷함은 기기 음성 품질을 따릅니다.'}
          </Hint>
          <Divider />
          <StepperRow
            label="음높이"
            value={s.pitch.toFixed(1)}
            onDec={() => s.set({ pitch: clamp(s.pitch - 0.1, 0.5, 2) })}
            onInc={() => s.set({ pitch: clamp(s.pitch + 0.1, 0.5, 2) })}
            decDisabled={s.pitch <= 0.5}
            incDisabled={s.pitch >= 2}
          />
          {isSherpa && (
            <>
              <Divider />
              <SwitchRow
                icon="voice"
                label="음성 안정화"
                hint="같은 문장은 언제 다시 들어도 같은 목소리로, 문장·화자마다 들쭉날쭉한 음량은 고르게 맞춥니다. (추가 배터리 없음)"
                value={s.voiceStable}
                onChange={(v) => {
                  s.set({ voiceStable: v });
                  usePlayer.getState().refreshVoice(); // 캐시 키가 바뀐다 — 새 설정으로 다시 채운다
                }}
              />
              <Divider />
              <SwitchRow
                label="문장 숨소리"
                hint="사람 낭독자처럼 긴 문장의 절 사이와 문단이 바뀔 때 살짝 숨을 들이쉬어요. (3배속 이하)"
                value={s.breathSound}
                onChange={(v) => s.set({ breathSound: v })}
              />
              <Divider />
              <SwitchRow
                label="낭독 완급 변주"
                hint="일부 문장을 살짝 느긋하게 읽어 완급을 만듭니다. (3배속 이하)"
                value={s.rubato}
                onChange={(v) => s.set({ rubato: v })}
              />
            </>
          )}
          <Divider />
          <SwitchRow
            label="대사는 다른 목소리로"
            hint="따옴표(“…”) 안의 대사를 다른 목소리로 읽어요. 지문의 「그가 말했다」 같은 단서로 남녀도 맞춥니다."
            value={s.dialogueVoice}
            onChange={(v) => s.set({ dialogueVoice: v })}
          />
        </Card>
        <PrimaryButton label="현재 설정으로 미리듣기" icon="play" onPress={() => preview()} style={{ marginTop: 12 }} />
        {previewFail && (
          <Text style={{ color: p.subtext, fontSize: 12.5, marginTop: 8, textAlign: 'center' }}>
            미리듣기에 실패했습니다 —{' '}
            {isEdge
              ? '인터넷 연결을 확인해주세요.'
              : isSherpa
                ? '오프라인 음성 데이터 설치 상태를 확인해주세요.'
                : '기기 TTS 설정을 확인해주세요.'}
          </Text>
        )}

        {/* ── 목소리 ───────────────────────── */}
        <SectionTitle>목소리 {langVoices.length ? `· ${langVoices.length}` : ''}</SectionTitle>
        {langVoices.length === 0 ? (
          <Hint>
            이 언어의 설치된 음성이 없습니다. 기기 설정 → 언어/TTS에서 음성 데이터를 내려받으면 더 자연스러운 목소리를 쓸 수 있습니다.
          </Hint>
        ) : (
          <View style={{ gap: 8 }}>
            <TouchableOpacity
              onPress={() => selectVoice(undefined)}
              style={[styles.voiceRow, { borderColor: !selectedVoiceId ? p.primary : p.border, backgroundColor: !selectedVoiceId ? p.primarySoft : p.surface }]}
              accessibilityRole="button"
              accessibilityLabel="기본 음성"
              accessibilityState={{ selected: !selectedVoiceId }}
            >
              <Text style={{ color: !selectedVoiceId ? p.onPrimarySoft : p.text, fontWeight: '700', fontSize: 15 }}>기본 음성</Text>
            </TouchableOpacity>
            {langVoices.map((v) => voiceRow(v, selectedVoiceId === v.id, () => selectVoice(v.id)))}
          </View>
        )}

        {s.dialogueVoice && langVoices.length > 0 && (
          <>
            <SectionTitle>대사 목소리</SectionTitle>
            <View style={{ gap: 8 }}>
              <TouchableOpacity
                onPress={() => selectDialogueVoice(undefined)}
                style={[
                  styles.voiceRow,
                  { borderColor: !selectedDialogueVoiceId ? p.primary : p.border, backgroundColor: !selectedDialogueVoiceId ? p.primarySoft : p.surface },
                ]}
                accessibilityRole="button"
                accessibilityLabel="대사 음성 자동 선택"
                accessibilityState={{ selected: !selectedDialogueVoiceId }}
              >
                <Text style={{ color: !selectedDialogueVoiceId ? p.onPrimarySoft : p.text, fontWeight: '700', fontSize: 15 }}>
                  자동 (남녀 단서 + 어울리는 대비 음성)
                </Text>
              </TouchableOpacity>
              {langVoices.map((v) => voiceRow(v, selectedDialogueVoiceId === v.id, () => selectDialogueVoice(v.id), 'dlg-'))}
            </View>
          </>
        )}

        {/* ── 배경음 ───────────────────────── */}
        <SectionTitle>배경음</SectionTitle>
        <Card>
          <SwitchRow
            label="낭독 배경음 (432Hz)"
            hint="낭독 뒤에 은은한 저음이 깔려요. (432Hz의 건강 효과가 과학으로 입증된 건 아니지만, 배경음으로 두면 차분해진다는 분이 많아요.)"
            value={s.bgSound}
            onChange={(on) => {
              s.set({ bgSound: on });
              if (on) startBgSound(s.bgVolume); // 켜면 바로 들려준다(미리듣기 겸)
              else stopBgSound();
            }}
          />
          {s.bgSound && (
            <>
              <Divider />
              <StepperRow
                label="배경음 크기"
                value={`${Math.round(s.bgVolume * 100)}%`}
                onDec={() => {
                  const v = clamp(s.bgVolume - 0.05, 0, 0.6);
                  s.set({ bgVolume: v });
                  setBgVolume(v); // 재생 중이면 즉시 반영
                }}
                onInc={() => {
                  const v = clamp(s.bgVolume + 0.05, 0, 0.6);
                  s.set({ bgVolume: v });
                  setBgVolume(v);
                }}
              />
            </>
          )}
        </Card>

        {/* ── 배터리·배경 재생 ─────────────────── */}
        <SectionTitle>배터리 · 배경 재생</SectionTitle>
        <Card>
          <View style={styles.battRow}>
            <View style={[styles.battIcon, { backgroundColor: p.primarySoft }]}>
              <Icon name="battery" size={20} color={p.onPrimarySoft} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { color: p.text, marginTop: 0 }]}>배터리를 아끼는 법</Text>
              <Text style={[styles.battTxt, { color: p.subtext }]}>
                · 화면은 꺼 두세요 — 화면이 가장 큰 소모원이에요(낭독은 계속됩니다){'\n'}· 테마를 「검정(절전)」으로{'\n'}· 잠들 땐 플레이어의 🌙 취침 타이머{'\n'}· 고품질 오프라인은 기기 안에서 목소리를 만들어 CPU 를 씁니다 — 배속이 높을수록 더 써요
              </Text>
            </View>
          </View>
          {isSherpa && diag && (
            <>
              <Divider />
              <Text style={[styles.diag, { color: p.subtext }]}>
                진단 · 음성 준비 속도 {diag.avgRtf.toFixed(2)} (지금 {s.rate}×에서는 {(1 / s.rate).toFixed(2)} 아래여야 안 끊깁니다)
                {synthShare !== null && `\n· 낭독 1분을 만드는 데 CPU ${Math.round(synthShare * 60)}초`}
                {`\n· 다음 문장을 기다린 시간 ${(diag.starvedMs / 1000).toFixed(1)}초 (${diag.starved}회)`}
                {`\n· 재생이 끊긴 시간 ${(diag.stallMs / 1000).toFixed(1)}초`}
                {diag.leveled > 0 && `\n· 음성 안정화: ${diag.leveled}문장 음량 보정(평균 ${diag.levelAbsDb.toFixed(1)}dB)`}
              </Text>
            </>
          )}
          {Platform.OS === 'android' && (
            <>
              <Divider />
              <TouchableOpacity
                onPress={() => {
                  void openBatteryOptWithGuide();
                }}
                style={styles.linkRow}
                accessibilityRole="button"
                accessibilityLabel="배터리 최적화 예외 설정 열기"
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.label, { color: p.text, marginTop: 0 }]}>배터리 최적화 예외</Text>
                  <Text style={[styles.battTxt, { color: p.subtext }]}>
                    화면을 끄면 잠시 뒤 낭독이 멈추는 기기라면 예외로 등록하세요.
                  </Text>
                </View>
                <Text style={{ color: p.primary, fontSize: 15, fontWeight: '800' }}>열기 ›</Text>
              </TouchableOpacity>
            </>
          )}
        </Card>

        {/* ── 언어 ─────────────────────────── */}
        <SectionTitle>읽는 언어</SectionTitle>
        <View style={styles.chips}>
          {LANGS.map((l) => (
            <Chip
              key={l.code}
              label={l.label}
              active={s.language === l.code}
              onPress={() => s.set({ language: l.code, voiceId: undefined, edgeVoiceId: undefined })}
            />
          ))}
        </View>

        {/* ── 정보 ─────────────────────────── */}
        <SectionTitle>정보</SectionTitle>
        <Card>
          <TouchableOpacity
            onPress={() => {
              void checkForUpdate(true);
            }}
            style={styles.linkRow}
            accessibilityRole="button"
            accessibilityLabel="업데이트 확인"
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { color: p.text, marginTop: 0 }]}>업데이트 확인</Text>
              <Text style={[styles.battTxt, { color: p.subtext }]}>지금 버전 v{APP_VERSION}</Text>
            </View>
            <Text style={{ color: p.primary, fontSize: 15, fontWeight: '800' }}>확인 ›</Text>
          </TouchableOpacity>
        </Card>
        <Text style={[styles.version, { color: p.faint }]}>소리책 v{APP_VERSION}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingBottom: 2 },
  h1: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  label: { fontSize: 16, fontWeight: '700', marginTop: 12, marginBottom: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  engine: { borderWidth: 1.5, borderRadius: radius.lg, paddingHorizontal: 16, paddingVertical: 14 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  voiceRow: {
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  voicePlay: { borderWidth: 1, borderRadius: 18, width: 36, height: 36, alignItems: 'center', justifyContent: 'center', paddingLeft: 2 },
  badge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  dlBar: { height: 6, borderRadius: 3, overflow: 'hidden' },
  dlFill: { height: '100%', borderRadius: 3 },
  battRow: { flexDirection: 'row', gap: 12, paddingVertical: 12 },
  battIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  battTxt: { fontSize: 13, lineHeight: 20, marginTop: 4 },
  diag: { fontSize: 12, lineHeight: 18, paddingVertical: 10 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  version: { textAlign: 'center', marginTop: 28, fontSize: 12 },
});
