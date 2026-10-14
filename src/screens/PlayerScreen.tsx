import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  FlatList,
  TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { usePalette, radius, type Palette } from '../lib/theme';
import { splitHighlight } from '../lib/highlight';
import { clamp01, indexToPct, pctToIndex } from '../lib/scrub';
import {
  autoScrollTarget,
  hideNeighbors,
  lineScrollTarget,
  shouldScroll,
  subtitleShrink,
  type SubtitleLine,
} from '../lib/subtitleLayout';
import { RATE_MIN, RATE_MAX, stepRateValue } from '../lib/rateSteps';
import { charPrefix, remainingSec, formatDuration } from '../lib/listenTime';
import { SLEEP_PRESETS, sleepMinutesLeft } from '../lib/sleepTimer';
import { buildToc, currentTocPos, findSentences } from '../lib/toc';
import { subtitlesVisible } from '../lib/visibility';
import { usePlayer } from '../store/player';
import { useLibrary } from '../store/library';
import { useSettings } from '../store/settings';
import Icon from '../components/Icon';
import { Chip, IconButton, Sheet, SheetRow } from '../components/ui';
import type { RootStackParamList } from '../../App';

type Props = NativeStackScreenProps<RootStackParamList, 'Player'>;

// ── 자막(현재 문장 + 이웃) ──────────────────────────────────────────────
// v1.32.0: 화면 전체가 아니라 이 부품만 단어 하이라이트를 구독한다. 예전엔 PlayerScreen 이
// 스토어 전체(usePlayer())를 구독해, 단어가 넘어갈 때마다(초당 수 회) 진행 바·버튼·배속까지
// 통째로 다시 그렸다 — 화면이 켜져 있는 동안의 헛연산(배터리 점검 2026-10-14).
const Subtitle = memo(function Subtitle({ p, fontScale }: { p: Palette; fontScale: number }) {
  const sentences = usePlayer((s) => s.sentences);
  const index = usePlayer((s) => s.index);
  const wordStart = usePlayer((s) => s.wordStart);
  const wordLen = usePlayer((s) => s.wordLen);
  const cur = sentences[index] || '';
  const prev = index > 0 ? sentences[index - 1] : '';
  const nextS = index < sentences.length - 1 ? sentences[index + 1] : '';

  // 긴 문장(대사 한 덩어리 등)은 글자를 단계적으로 줄여 되도록 스크롤 없이 담는다
  // (subtitleLayout.ts — 그래도 넘치면 아래 자동 스크롤이 하이라이트를 따라간다).
  const bigSize = Math.round(26 * fontScale * subtitleShrink(cur.length));
  const bigLineH = Math.round(bigSize * 1.54);
  const roomy = hideNeighbors(cur.length);
  const smallSize = Math.round(16 * fontScale);
  const { before, word, after } = splitHighlight(cur, wordStart, wordLen);

  // ── 자막 자동 스크롤: 한 화면을 넘는 문장에서 하이라이트를 따라간다 ─────────
  const stageRef = useRef<ScrollView>(null);
  const [viewH, setViewH] = useState(0);
  const [contentH, setContentH] = useState(0);
  const scrollY = useRef(0);
  // 줄 정보는 ref 에 담는다 — state 로 두면 onTextLayout → 리렌더 → 재측정 루프가 된다.
  const linesRef = useRef<SubtitleLine[]>([]);
  // 손으로 스크롤한 동안에는 자동 추적을 멈춘다(읽던 위치를 뺏지 않게) — 문장이 바뀌면 해제.
  const userScrolled = useRef(false);

  useEffect(() => {
    scrollY.current = 0;
    userScrolled.current = false;
    // 이전 문장의 줄 정보를 비운다 — 새 문장의 onTextLayout 이 도착하기 전까지 그걸 쓰면
    // 엉뚱한 줄로 스크롤한다.
    linesRef.current = [];
    stageRef.current?.scrollTo({ y: 0, animated: false });
  }, [index]);

  useEffect(() => {
    if (userScrolled.current) return;
    const target =
      lineScrollTarget({ lines: linesRef.current, charIndex: wordStart, textLen: cur.length, contentH, viewH }) ??
      autoScrollTarget({ charIndex: wordStart, charLen: wordLen, textLen: cur.length, contentH, viewH });
    if (!shouldScroll(scrollY.current, target, viewH)) return;
    scrollY.current = target;
    stageRef.current?.scrollTo({ y: target, animated: true });
  }, [wordStart, wordLen, cur.length, contentH, viewH]);

  return (
    <View style={styles.stage}>
      {!!prev && !roomy && (
        <Text style={[styles.neighbor, { color: p.faint, fontSize: smallSize }]} numberOfLines={2}>
          {prev}
        </Text>
      )}
      {/* 현재 문장: 남는 공간 안에서만 자란다(flexShrink) — 넘치면 스크롤(사용자 보고 2026-07-24). */}
      <ScrollView
        ref={stageRef}
        style={styles.currentScroll}
        contentContainerStyle={styles.currentScrollContent}
        showsVerticalScrollIndicator={false}
        onLayout={(e) => setViewH(e.nativeEvent.layout.height)}
        onContentSizeChange={(_w, h) => setContentH(h)}
        onScrollBeginDrag={() => {
          userScrolled.current = true;
        }}
      >
        <Text
          style={[styles.current, { fontSize: bigSize, lineHeight: bigLineH, color: p.text }]}
          onTextLayout={(e) => {
            linesRef.current = e.nativeEvent.lines as SubtitleLine[];
          }}
        >
          {before}
          {!!word && (
            // ⚠️ fontWeight 를 문장('700')과 다르게 주지 말 것 — 굵기가 다르면 글자 폭이 변해
            // 하이라이트가 옮겨 다닐 때마다 줄바꿈이 재계산되는 "배치 흔들림"이 된다(2026-07-23).
            <Text style={{ color: p.highlightText, backgroundColor: p.highlight }}>{word}</Text>
          )}
          {after}
        </Text>
      </ScrollView>
      {!!nextS && !roomy && (
        <Text style={[styles.neighbor, { color: p.faint, fontSize: smallSize }]} numberOfLines={2}>
          {nextS}
        </Text>
      )}
    </View>
  );
});

export default function PlayerScreen({ route, navigation }: Props) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { docId, autoplay } = route.params;

  const sentences = usePlayer((s) => s.sentences);
  const paraStarts = usePlayer((s) => s.paraStarts);
  const index = usePlayer((s) => s.index);
  const playing = usePlayer((s) => s.playing);
  const notice = usePlayer((s) => s.notice);
  const sleepAt = usePlayer((s) => s.sleepAt);
  const sleepEndOfPara = usePlayer((s) => s.sleepEndOfPara);
  const fontScale = useSettings((s) => s.fontScale);
  const rate = useSettings((s) => s.rate);
  const keepAwake = useSettings((s) => s.keepAwake);
  const lastSleep = useSettings((s) => s.sleepMinutes);
  const setSettings = useSettings((s) => s.set);
  const title = useLibrary((s) => s.docs.find((d) => d.id === docId)?.title ?? '읽기');
  const [loading, setLoading] = useState(true);
  // 진행 바 스크럽 상태: 드래그 중인 목표 위치(0..1). null = 드래그 아님(실제 진행률 표시).
  const [scrub, setScrub] = useState<number | null>(null);
  const [trackW, setTrackW] = useState(0);
  const [sheet, setSheet] = useState<null | 'sleep' | 'contents'>(null);

  // 문서 로드
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const lib = useLibrary.getState();
        const doc = lib.docs.find((d) => d.id === docId);
        const { sentences: ss, paraStarts: ps } = await lib.loadDoc(docId);
        if (!alive) return;
        usePlayer.getState().load({
          docId,
          title: doc?.title || '읽기',
          sentences: ss,
          paraStarts: ps,
          startIndex: doc?.lastIndex ?? 0,
        });
        if (autoplay) usePlayer.getState().play(); // 서재의 「이어 듣기」
        if (alive) setLoading(false);
      } catch (e: any) {
        // 이미 화면을 떠났으면 다른 화면 위에 경고를 띄우거나 엉뚱한 화면을 닫지 않는다(교차검증
        // codex·grok). 실패면 로딩 화면을 유지한 채 돌아간다 — 지난 문서의 상태로 본문을 그리지 않게.
        if (!alive) return;
        Alert.alert('열기 실패', String(e?.message || e));
        navigation.goBack();
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  // 화면을 벗어나면 정지
  useEffect(() => {
    return () => {
      usePlayer.getState().pause();
    };
  }, []);

  // 재생 중 화면 켜두기 — v1.32.0 부터 **설정에서 켠 경우에만**(기본 꺼짐). 예전엔 재생 중이면
  // 무조건 켜 둬, 플레이어를 띄워 두고 들으면 화면이 몇 시간이고 안 꺼졌다 — 에뮬 실측:
  // 화면 꺼짐 30초 설정에서 재생 165초 뒤에도 mWakefulness=Awake. 화면이 꺼져도 낭독은
  // 이어진다(v1.30.0). 언마운트 시 해제는 그대로(안 하면 화면을 나가도 깨어 있다).
  useEffect(() => {
    // activate 는 비동기다 — 그 사이 재생이 멈추거나 화면을 나가면, 늦게 끝난 activate 가 켜두기를
    // 되살리지 않게 끝난 뒤 한 번 더 확인해 끈다(교차검증 grok·meta 합의).
    let stale = false;
    if (playing && keepAwake) {
      activateKeepAwakeAsync('iwtts')
        .then(() => {
          if (stale) deactivateKeepAwake('iwtts');
        })
        .catch(() => { /* 미지원 기기 무시 */ });
    } else deactivateKeepAwake('iwtts');
    return () => {
      stale = true;
    };
  }, [playing, keepAwake]);
  useEffect(() => {
    return () => {
      deactivateKeepAwake('iwtts');
    };
  }, []);

  // 재생 실패·폴백 알림 배너 — 5초 뒤 자동 소멸.
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => usePlayer.getState().setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  // 취침 타이머 남은 분 — 화면이 보일 때만 15초마다 다시 센다(멈추는 판정 자체는 스토어가
  // 문장 경계에서 벽시계로 한다 — 이 표시용 타이머가 얼어도 타이머는 정확하다).
  const [, setTick] = useState(0);
  useEffect(() => {
    if (sleepAt === null) return;
    const id = setInterval(() => {
      if (subtitlesVisible()) setTick((t) => t + 1);
    }, 15_000);
    return () => clearInterval(id);
  }, [sleepAt]);
  const sleepLeft = sleepMinutesLeft(sleepAt);

  // 남은 시간(문장 글자 접두합 — 문서당 1회 계산).
  const prefix = useMemo(() => charPrefix(sentences), [sentences]);
  const charsLeft = sentences.length ? prefix[sentences.length] - prefix[index] : 0;
  const leftLabel = sentences.length ? `남은 약 ${formatDuration(remainingSec(charsLeft, rate))}` : '';

  // 목차(문서당 1회).
  const toc = useMemo(() => buildToc(sentences, paraStarts), [sentences, paraStarts]);
  const tocPos = currentTocPos(toc, index);
  const chapter = tocPos >= 0 ? toc[tocPos].title : '';

  // ── 진행 바 시킹: 탭/드래그로 문장 위치 이동 ─────────
  // 표시와 시킹은 반드시 같은 위치 공식(lib/scrub.ts) — 다르면 놓는 순간 바가 튄다.
  const pctFromX = (x: number) => (trackW > 0 ? clamp01(x / trackW) : 0);
  const onScrubEnd = (pct: number) => {
    setScrub(null);
    if (sentences.length) usePlayer.getState().seek(pctToIndex(pct, sentences.length));
  };
  const progressPct = indexToPct(index, sentences.length);
  const fillPct = scrub ?? progressPct;
  // 재생 중 배속 +/- (양방향, 순환 없음 — 끝에서 멈춘다). 예전 단일 순환 버튼은 10× 다음이
  // 0.5× 로 급락(랩)해 직렬 큐를 막았다(실측 2026-07-16).
  const stepRate = (dir: 1 | -1) => {
    const next = stepRateValue(rate, dir);
    if (next === rate) return;
    setSettings({ rate: next });
    usePlayer.getState().applyRate(next);
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: p.bg }]}>
        <ActivityIndicator color={p.primary} size="large" />
      </View>
    );
  }

  const sleepLabel =
    sleepLeft !== null ? `${sleepLeft}분 뒤 멈춤` : sleepEndOfPara ? '문단 끝에서 멈춤' : '취침 타이머';

  return (
    <View style={[styles.root, { backgroundColor: p.bg }]}>
      {/* 상단 바 */}
      <View style={[styles.topbar, { paddingTop: insets.top + 4 }]}>
        <IconButton name="back" onPress={() => navigation.goBack()} label="목록으로 돌아가기" />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={[styles.title, { color: p.text }]} numberOfLines={1}>
            {title}
          </Text>
          {!!chapter && chapter !== title && (
            <Text style={[styles.chapter, { color: p.subtext }]} numberOfLines={1}>
              {chapter}
            </Text>
          )}
        </View>
        <IconButton name="list" onPress={() => setSheet('contents')} label="목차와 찾기" />
      </View>

      <Subtitle p={p} fontScale={fontScale} />

      {/* 재생 실패·폴백·타이머 알림 배너 */}
      {!!notice && (
        <View style={[styles.notice, { backgroundColor: p.primarySoft }]}>
          <Text style={[styles.noticeText, { color: p.onPrimarySoft }]}>{notice}</Text>
        </View>
      )}

      {/* 진행 바 — 탭/드래그로 원하는 위치(문장)로 이동. 드래그 중엔 목표 %·문장 번호 표시. */}
      {scrub != null && (
        <View style={styles.scrubBadgeRow} pointerEvents="none">
          <View style={[styles.scrubBadge, { backgroundColor: p.primary }]}>
            <Text style={[styles.scrubBadgeText, { color: p.onPrimary }]}>
              {Math.round(scrub * 100)}% · {pctToIndex(scrub, sentences.length) + 1}번째 문장
            </Text>
          </View>
        </View>
      )}
      <View
        style={styles.trackTouch}
        onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(e) => setScrub(pctFromX(e.nativeEvent.locationX))}
        onResponderMove={(e) => setScrub(pctFromX(e.nativeEvent.locationX))}
        onResponderRelease={(e) => onScrubEnd(pctFromX(e.nativeEvent.locationX))}
        onResponderTerminate={() => setScrub(null)}
        accessibilityRole="adjustable"
        accessibilityLabel="진행 위치. 좌우로 끌거나 탭해서 이동"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(progressPct * 100), text: `${Math.round(progressPct * 100)}%` }}
        // TalkBack 의 위·아래 쓸기(증가·감소)로도 움직이게 — 1% 단위(교차검증 codex).
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          if (!sentences.length) return;
          const step = Math.max(1, Math.round(sentences.length / 100));
          const to = e.nativeEvent.actionName === 'increment' ? index + step : index - step;
          usePlayer.getState().seek(Math.max(0, Math.min(sentences.length - 1, to)));
        }}
      >
        <View style={[styles.track, { backgroundColor: p.border }]} pointerEvents="none">
          <View style={[styles.fill, { backgroundColor: p.primary, width: `${fillPct * 100}%` }]} />
        </View>
        <View style={[styles.thumb, { backgroundColor: p.primary, left: `${fillPct * 100}%` }]} pointerEvents="none" />
      </View>
      <View style={styles.metaRow}>
        <Text style={[styles.meta, { color: p.subtext }]}>
          {sentences.length ? index + 1 : 0} / {sentences.length} · {Math.round(progressPct * 100)}%
        </Text>
        <Text style={[styles.meta, { color: p.subtext }]}>{leftLabel}</Text>
      </View>

      {/* 빠른 조절: 배속 · 취침 타이머 · 화면 켜두기 */}
      <View style={styles.quickRow}>
        <View style={[styles.rateBox, { borderColor: p.border, backgroundColor: p.surface }]}>
          <TouchableOpacity
            onPress={() => stepRate(-1)}
            disabled={rate <= RATE_MIN + 0.001}
            hitSlop={8}
            style={[styles.rateBtn, { opacity: rate <= RATE_MIN + 0.001 ? 0.35 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel="배속 낮추기"
          >
            <Text style={[styles.rateBtnTxt, { color: p.text }]}>−</Text>
          </TouchableOpacity>
          <Text style={[styles.rateValue, { color: p.text }]} accessibilityLabel={`배속 ${rate}배`}>
            {rate}×
          </Text>
          <TouchableOpacity
            onPress={() => stepRate(1)}
            disabled={rate >= RATE_MAX - 0.001}
            hitSlop={8}
            style={[styles.rateBtn, { opacity: rate >= RATE_MAX - 0.001 ? 0.35 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel="배속 높이기"
          >
            <Text style={[styles.rateBtnTxt, { color: p.text }]}>+</Text>
          </TouchableOpacity>
        </View>
        <Chip
          icon="moon"
          label={sleepLabel}
          active={sleepLeft !== null || sleepEndOfPara}
          onPress={() => setSheet('sleep')}
        />
        <TouchableOpacity
          onPress={() => setSettings({ keepAwake: !keepAwake })}
          style={[
            styles.awakeBtn,
            { backgroundColor: keepAwake ? p.primary : p.surface, borderColor: keepAwake ? p.primary : p.border },
          ]}
          accessibilityRole="switch"
          accessibilityLabel="재생 중 화면 켜두기"
          accessibilityState={{ checked: keepAwake }}
        >
          <Icon name="sun" size={20} color={keepAwake ? p.onPrimary : p.subtext} />
        </TouchableOpacity>
      </View>

      {/* 컨트롤 */}
      <View style={[styles.controls, { paddingBottom: insets.bottom + 22 }]}>
        <TouchableOpacity
          onPress={() => usePlayer.getState().prev()}
          hitSlop={10}
          style={[styles.ctrlBtn, { backgroundColor: p.surface, borderColor: p.border }]}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="이전 문장"
        >
          <Icon name="prev" size={24} color={p.text} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => usePlayer.getState().toggle()}
          style={[styles.playBtn, { backgroundColor: p.primary, shadowColor: p.primary }]}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={playing ? '일시정지' : '재생'}
        >
          <Icon name={playing ? 'pause' : 'play'} size={34} color={p.onPrimary} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => usePlayer.getState().next()}
          hitSlop={10}
          style={[styles.ctrlBtn, { backgroundColor: p.surface, borderColor: p.border }]}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="다음 문장"
        >
          <Icon name="next" size={24} color={p.text} />
        </TouchableOpacity>
      </View>

      <SleepSheet
        visible={sheet === 'sleep'}
        onClose={() => setSheet(null)}
        sleepLeft={sleepLeft}
        endOfPara={sleepEndOfPara}
        lastMinutes={lastSleep}
      />
      {sheet === 'contents' && (
        <ContentsSheet
          onClose={() => setSheet(null)}
          sentences={sentences}
          toc={toc}
          tocPos={tocPos}
          index={index}
        />
      )}
    </View>
  );
}

function SleepSheet({
  visible,
  onClose,
  sleepLeft,
  endOfPara,
  lastMinutes,
}: {
  visible: boolean;
  onClose: () => void;
  sleepLeft: number | null;
  endOfPara: boolean;
  lastMinutes: number;
}) {
  const setSleep = usePlayer((s) => s.setSleep);
  const pick = (opt: { minutes?: number; endOfPara?: boolean } | null) => {
    setSleep(opt);
    onClose();
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="취침 타이머">
      <SheetRow
        icon="close"
        label="끄기"
        selected={sleepLeft === null && !endOfPara}
        onPress={() => pick(null)}
      />
      {SLEEP_PRESETS.map((m) => (
        <SheetRow
          key={m}
          icon="clock"
          label={`${m}분 뒤`}
          hint={m === lastMinutes ? '지난번에 고른 시간' : undefined}
          onPress={() => pick({ minutes: m })}
        />
      ))}
      <SheetRow
        icon="book"
        label="이 문단이 끝나면"
        selected={endOfPara}
        onPress={() => pick({ endOfPara: true })}
      />
    </Sheet>
  );
}

function ContentsSheet({
  onClose,
  sentences,
  toc,
  tocPos,
  index,
}: {
  onClose: () => void;
  sentences: string[];
  toc: ReturnType<typeof buildToc>;
  tocPos: number;
  index: number;
}) {
  const p = usePalette();
  const [tab, setTab] = useState<'toc' | 'find'>(toc.length ? 'toc' : 'find');
  const [q, setQ] = useState('');
  const results = useMemo(() => (q.trim().length >= 1 ? findSentences(sentences, q, 200) : []), [sentences, q]);
  const go = (i: number) => {
    usePlayer.getState().seek(i);
    onClose();
  };
  return (
    <Sheet visible onClose={onClose} title="목차와 찾기" tall>
      <View style={styles.tabs}>
        <Chip label={`목차${toc.length ? ` ${toc.length}` : ''}`} active={tab === 'toc'} onPress={() => setTab('toc')} icon="list" />
        <Chip label="찾기" active={tab === 'find'} onPress={() => setTab('find')} icon="search" />
      </View>
      {tab === 'toc' ? (
        toc.length === 0 ? (
          <Text style={[styles.empty, { color: p.subtext }]}>
            이 책에서는 장 제목을 찾지 못했어요. 「찾기」로 낱말을 검색해 이동할 수 있어요.
          </Text>
        ) : (
          <View style={{ flex: 1 }}>
          <FlatList
            data={toc}
            keyExtractor={(e) => String(e.index)}
            initialScrollIndex={Math.max(0, tocPos - 3)}
            getItemLayout={(_d, i) => ({ length: TOC_ROW_H, offset: TOC_ROW_H * i, index: i })}
            renderItem={({ item, index: k }) => {
              const here = k === tocPos;
              return (
                <TouchableOpacity
                  onPress={() => go(item.index)}
                  style={[styles.tocRow, here && { backgroundColor: p.primarySoft }]}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.title}${here ? ', 지금 읽는 곳' : ''}`}
                >
                  <Text
                    style={[styles.tocTxt, { color: here ? p.onPrimarySoft : p.text, fontWeight: here ? '800' : '600' }]}
                    numberOfLines={1}
                  >
                    {item.title}
                  </Text>
                  <Text style={[styles.tocPct, { color: here ? p.onPrimarySoft : p.subtext }]}>
                    {Math.round(indexToPct(item.index, sentences.length) * 100)}%
                  </Text>
                </TouchableOpacity>
              );
            }}
          />
          </View>
        )
      ) : (
        <View style={{ flex: 1 }}>
          <View style={[styles.searchBox, { borderColor: p.border, backgroundColor: p.surface }]}>
            <Icon name="search" size={18} color={p.subtext} />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="낱말로 문장 찾기"
              placeholderTextColor={p.subtext}
              style={[styles.searchInput, { color: p.text }]}
              autoFocus
              returnKeyType="search"
              accessibilityLabel="찾을 낱말"
            />
          </View>
          <FlatList
            data={results}
            keyExtractor={(i) => String(i)}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              q.trim() ? <Text style={[styles.empty, { color: p.subtext }]}>찾는 낱말이 없어요.</Text> : null
            }
            renderItem={({ item }) => (
              <TouchableOpacity
                onPress={() => go(item)}
                style={[styles.findRow, { borderColor: p.border }]}
                accessibilityRole="button"
                accessibilityLabel={`${item + 1}번째 문장으로 이동`}
              >
                <Text style={[styles.findIdx, { color: item === index ? p.primary : p.subtext }]}>
                  {item + 1}
                </Text>
                <Text style={[styles.findTxt, { color: p.text }]} numberOfLines={2}>
                  {sentences[item]}
                </Text>
              </TouchableOpacity>
            )}
          />
        </View>
      )}
    </Sheet>
  );
}

const TOC_ROW_H = 52;

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  topbar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 4, gap: 4 },
  title: { fontSize: 16, fontWeight: '800' },
  chapter: { fontSize: 12.5, fontWeight: '600', marginTop: 1 },
  stage: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24, gap: 22 },
  neighbor: { textAlign: 'center', lineHeight: 24 },
  // 남는 높이 안에서만 차지한다(flexGrow 0 + flexShrink 1) — 내용이 더 크면 스크롤.
  currentScroll: { flexGrow: 0, flexShrink: 1, alignSelf: 'stretch' },
  currentScrollContent: { flexGrow: 1, justifyContent: 'center' },
  current: { textAlign: 'center', fontWeight: '700' },
  notice: { marginHorizontal: 20, marginBottom: 10, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.md },
  noticeText: { fontSize: 13.5, fontWeight: '700', textAlign: 'center', lineHeight: 19 },
  // 터치 영역은 넉넉히(높이 32), 시각적 바는 그 안에 6px — 손가락으로 잡기 쉽게.
  trackTouch: { height: 32, marginHorizontal: 22, justifyContent: 'center' },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  thumb: { position: 'absolute', width: 16, height: 16, borderRadius: 8, marginLeft: -8, top: 8, elevation: 2 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginHorizontal: 22, marginTop: -2 },
  meta: { fontSize: 12.5, fontWeight: '700', fontVariant: ['tabular-nums'] },
  scrubBadgeRow: { alignItems: 'center', marginBottom: 6 },
  scrubBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14 },
  scrubBadgeText: { fontSize: 13, fontWeight: '700' },
  quickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 16,
    paddingHorizontal: 16,
    flexWrap: 'wrap',
  },
  rateBox: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radius.pill, height: 40 },
  rateBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  rateBtnTxt: { fontSize: 22, fontWeight: '700', lineHeight: 26 },
  rateValue: { fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'], minWidth: 44, textAlign: 'center' },
  awakeBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 26, paddingTop: 18 },
  ctrlBtn: { width: 58, height: 58, borderRadius: 29, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  playBtn: {
    width: 82,
    height: 82,
    borderRadius: 41,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  tabs: { flexDirection: 'row', gap: 8, marginVertical: 8 },
  empty: { fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 28, paddingHorizontal: 12 },
  tocRow: {
    height: TOC_ROW_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
  },
  tocTxt: { flex: 1, fontSize: 15.5 },
  tocPct: { fontSize: 12.5, fontWeight: '700', fontVariant: ['tabular-nums'] },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    height: 48,
    marginBottom: 8,
  },
  searchInput: { flex: 1, fontSize: 16 },
  findRow: { flexDirection: 'row', gap: 10, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  findIdx: { fontSize: 12.5, fontWeight: '800', minWidth: 40, fontVariant: ['tabular-nums'], paddingTop: 2 },
  findTxt: { flex: 1, fontSize: 15, lineHeight: 21 },
});
