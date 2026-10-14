import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { usePalette, radius } from '../lib/theme';
import { useLibrary } from '../store/library';
import { useSettings } from '../store/settings';
import { importDocument } from '../extract';
import { remainingSec, formatDuration } from '../lib/listenTime';
import { sortRecent, pickResume } from '../lib/libraryView';
import Icon from '../components/Icon';
import { IconButton, PrimaryButton, Sheet, SheetRow } from '../components/ui';
import type { RootStackParamList } from '../../App';
import type { Doc } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'Library'>;

const FORMAT_LABEL: Record<string, string> = { txt: 'TXT', pdf: 'PDF', epub: 'EPUB', html: 'HTML', md: 'MD' };

// 붙여넣기 문서 상한 — 가져오기(txt 30MB)보다 훨씬 작게: 입력창이 다루기 버거워지는 크기.
const PASTE_MAX_CHARS = 2_000_000;

function docRemaining(d: Doc, rate: number): string | null {
  if (!d.charCount) return null;
  const left = d.charCount * (1 - Math.min(1, Math.max(0, d.progress)));
  return formatDuration(remainingSec(left, rate));
}

export default function LibraryScreen({ navigation }: Props) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const docs = useLibrary((s) => s.docs);
  const addFromText = useLibrary((s) => s.addFromText);
  const remove = useLibrary((s) => s.remove);
  const rename = useLibrary((s) => s.rename);
  const setProgress = useLibrary((s) => s.setProgress);
  const rate = useSettings((s) => s.rate);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<null | 'add' | 'paste' | { doc: Doc } | { rename: Doc }>(null);
  const [pasteTitle, setPasteTitle] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [newTitle, setNewTitle] = useState('');

  const sorted = useMemo(() => sortRecent(docs), [docs]);
  const resume = pickResume(sorted);

  // 구문서(v1.31 이전) 글자 수를 한 번 채운다 — 없으면 남은 시간이 책을 다시 열 때까지 안 뜬다.
  // 복원(hydration) 전에 돌면 빈 목록이라 아무 일도 안 하므로 복원이 끝난 뒤에 돈다.
  useEffect(() => {
    const run = () => void useLibrary.getState().backfillCharCounts();
    if (useLibrary.persist.hasHydrated()) run();
    return useLibrary.persist.onFinishHydration(run);
  }, []);

  const open = (doc: Doc, autoplay = false) => navigation.navigate('Player', { docId: doc.id, autoplay });

  const onImport = async () => {
    if (busy) return;
    setSheet(null);
    setBusy(true);
    try {
      const res = await importDocument();
      if (!res) return; // 취소
      if (!res.text) {
        Alert.alert('읽을 수 없음', '이 파일에서 텍스트를 찾지 못했습니다. (스캔 PDF는 아직 미지원)');
        return;
      }
      const doc = await addFromText(res);
      if (!doc) {
        Alert.alert('빈 문서', '문장을 추출하지 못했습니다.');
        return;
      }
      open(doc);
    } catch (e: any) {
      Alert.alert('가져오기 실패', String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const onPasteAdd = async () => {
    if (busy) return;
    const text = pasteText.trim();
    if (!text) return;
    if (text.length > PASTE_MAX_CHARS) {
      Alert.alert('너무 길어요', '붙여넣기는 200만 자까지예요. 더 긴 글은 파일로 가져와 주세요.');
      return;
    }
    setBusy(true);
    try {
      const firstLine = text.split('\n').find((l) => l.trim())?.trim() ?? '';
      const title = pasteTitle.trim() || firstLine.slice(0, 30) || '붙여넣은 글';
      const doc = await addFromText({ title, format: 'txt', text });
      if (!doc) {
        Alert.alert('빈 문서', '문장을 찾지 못했습니다.');
        return;
      }
      setPasteText('');
      setPasteTitle('');
      setSheet(null);
      open(doc);
    } catch (e: any) {
      Alert.alert('추가 실패', String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const confirmRemove = (doc: Doc) => {
    setSheet(null);
    Alert.alert(doc.title, '이 문서를 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: () => remove(doc.id) },
    ]);
  };

  const renderItem = ({ item }: { item: Doc }) => {
    const pct = Math.round(item.progress * 100);
    const left = docRemaining(item, rate);
    return (
      <TouchableOpacity
        style={[styles.card, { backgroundColor: p.card, borderColor: p.border }]}
        onPress={() => open(item)}
        onLongPress={() => setSheet({ doc: item })}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`${item.title}, ${pct}퍼센트 읽음${left ? `, 남은 약 ${left}` : ''}`}
        accessibilityHint="누르면 읽기 화면을 엽니다. 길게 누르면 메뉴가 열립니다."
      >
        <View style={[styles.badge, { backgroundColor: p.primarySoft }]}>
          <Text style={[styles.badgeText, { color: p.onPrimarySoft }]}>{FORMAT_LABEL[item.format] || 'DOC'}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: p.text }]} numberOfLines={2}>
            {item.title}
          </Text>
          <Text style={[styles.meta, { color: p.subtext }]}>
            {pct >= 100 ? '다 들었어요' : `${pct}%`}
            {left && pct < 100 ? ` · 남은 약 ${left}` : ''} · {item.sentenceCount.toLocaleString()}문장
          </Text>
          <View style={[styles.track, { backgroundColor: p.border }]}>
            <View style={[styles.fill, { backgroundColor: p.primary, width: `${pct}%` }]} />
          </View>
        </View>
        <IconButton name="more" onPress={() => setSheet({ doc: item })} label={`${item.title} 메뉴`} color={p.subtext} />
      </TouchableOpacity>
    );
  };

  const header = (
    <View>
      {resume && (
        <TouchableOpacity
          onPress={() => open(resume, true)}
          activeOpacity={0.85}
          style={[styles.hero, { backgroundColor: p.primary }]}
          accessibilityRole="button"
          accessibilityLabel={`이어 듣기: ${resume.title}, ${Math.round(resume.progress * 100)}퍼센트`}
        >
          <View style={{ flex: 1 }}>
            <Text style={[styles.heroKicker, { color: p.onPrimary }]}>이어 듣기</Text>
            <Text style={[styles.heroTitle, { color: p.onPrimary }]} numberOfLines={2}>
              {resume.title}
            </Text>
            <Text style={[styles.heroMeta, { color: p.onPrimary }]}>
              {Math.round(resume.progress * 100)}%
              {docRemaining(resume, rate) ? ` · 남은 약 ${docRemaining(resume, rate)}` : ''}
            </Text>
          </View>
          <View style={[styles.heroPlay, { backgroundColor: p.onPrimary }]}>
            <Icon name="play" size={26} color={p.primary} />
          </View>
        </TouchableOpacity>
      )}
      {sorted.length > 0 && <Text style={[styles.section, { color: p.subtext }]}>내 서재 · {sorted.length}</Text>}
    </View>
  );

  const actionDoc = sheet && typeof sheet === 'object' && 'doc' in sheet ? sheet.doc : null;
  const renameDoc = sheet && typeof sheet === 'object' && 'rename' in sheet ? sheet.rename : null;

  return (
    <View style={[styles.root, { backgroundColor: p.bg, paddingTop: insets.top + 6 }]}>
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={[styles.logo, { backgroundColor: p.primary }]}>
            <Icon name="voice" size={20} color={p.onPrimary} />
          </View>
          <Text style={[styles.h1, { color: p.text }]}>소리책</Text>
        </View>
        <IconButton name="settings" onPress={() => navigation.navigate('Settings')} label="설정 열기" />
      </View>

      {docs.length === 0 ? (
        <View style={styles.empty}>
          <View style={[styles.emptyArt, { backgroundColor: p.primarySoft }]}>
            <Icon name="book" size={48} color={p.onPrimarySoft} strokeWidth={1.6} />
          </View>
          <Text style={[styles.emptyTitle, { color: p.text }]}>들을 글을 가져오세요</Text>
          <Text style={[styles.emptyText, { color: p.subtext }]}>
            TXT · PDF · EPUB · MD · HTML 파일이나 복사한 글을{'\n'}자막처럼 한 줄씩 읽어드립니다.
          </Text>
          <View style={{ gap: 10, alignSelf: 'stretch', marginTop: 22 }}>
            <PrimaryButton label="파일 가져오기" icon="file" onPress={onImport} disabled={busy} />
            <PrimaryButton label="글 붙여넣기" icon="paste" tone="soft" onPress={() => setSheet('paste')} />
          </View>
        </View>
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={(d) => d.id}
          renderItem={renderItem}
          ListHeaderComponent={header}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 130 }}
        />
      )}

      {docs.length > 0 && (
        <TouchableOpacity
          style={[styles.fab, { backgroundColor: p.primary, bottom: insets.bottom + 24, opacity: busy ? 0.7 : 1 }]}
          onPress={() => setSheet('add')}
          disabled={busy}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={busy ? '가져오는 중' : '글 추가하기'}
        >
          {busy ? (
            <ActivityIndicator color={p.onPrimary} />
          ) : (
            <>
              <Icon name="plus" size={20} color={p.onPrimary} />
              <Text style={[styles.fabText, { color: p.onPrimary }]}>추가</Text>
            </>
          )}
        </TouchableOpacity>
      )}

      {/* 추가 방법 */}
      <Sheet visible={sheet === 'add'} onClose={() => setSheet(null)} title="글 추가하기">
        <SheetRow icon="file" label="파일 가져오기" hint="TXT · PDF · EPUB · MD · HTML" onPress={onImport} />
        <SheetRow icon="paste" label="글 붙여넣기" hint="복사한 기사·소설·메모를 바로 듣기" onPress={() => setSheet('paste')} />
      </Sheet>

      {/* 붙여넣기 */}
      <Sheet visible={sheet === 'paste'} onClose={() => setSheet(null)} title="글 붙여넣기" tall>
        {/* 키보드 위로 올라서는 건 Sheet 가 맡는다(ui.tsx useKeyboardHeight). */}
        <View style={{ flex: 1, gap: 10 }}>
          <TextInput
            value={pasteTitle}
            onChangeText={setPasteTitle}
            editable={!busy}
            placeholder="제목 (비우면 첫 줄로)"
            placeholderTextColor={p.subtext}
            style={[styles.input, { color: p.text, borderColor: p.border, backgroundColor: p.surface }]}
            accessibilityLabel="제목"
          />
          <TextInput
            value={pasteText}
            onChangeText={setPasteText}
            placeholder="여기에 글을 붙여 넣으세요 (길게 눌러 붙여넣기)"
            placeholderTextColor={p.subtext}
            // 입력 단계에서 상한(교차검증 codex — 거대한 붙여넣기가 상태·렌더를 짓누르지 않게).
            maxLength={PASTE_MAX_CHARS}
            editable={!busy}
            multiline
            textAlignVertical="top"
            style={[styles.input, styles.paste, { color: p.text, borderColor: p.border, backgroundColor: p.surface }]}
            accessibilityLabel="붙여넣을 글"
          />
          <Text style={{ color: p.subtext, fontSize: 12.5 }}>{pasteText.length.toLocaleString()}자</Text>
          <PrimaryButton label="서재에 추가하고 듣기" icon="check" onPress={onPasteAdd} disabled={busy || !pasteText.trim()} />
        </View>
      </Sheet>

      {/* 책 메뉴 */}
      <Sheet visible={!!actionDoc} onClose={() => setSheet(null)} title={actionDoc?.title ?? ''}>
        {actionDoc && (
          <>
            <SheetRow icon="play" label="듣기" onPress={() => { setSheet(null); open(actionDoc, true); }} />
            <SheetRow
              icon="edit"
              label="이름 바꾸기"
              onPress={() => {
                setNewTitle(actionDoc.title);
                setSheet({ rename: actionDoc });
              }}
            />
            <SheetRow
              icon="restart"
              label="처음부터 듣기"
              onPress={() => {
                setProgress(actionDoc.id, 0, actionDoc.sentenceCount);
                setSheet(null);
                open(actionDoc, true);
              }}
            />
            <SheetRow icon="trash" label="삭제" danger onPress={() => confirmRemove(actionDoc)} />
          </>
        )}
      </Sheet>

      {/* 이름 바꾸기 */}
      <Sheet visible={!!renameDoc} onClose={() => setSheet(null)} title="이름 바꾸기">
        {renameDoc && (
          <View style={{ gap: 12, paddingBottom: 8 }}>
            <TextInput
              value={newTitle}
              onChangeText={setNewTitle}
              autoFocus
              selectTextOnFocus
              style={[styles.input, { color: p.text, borderColor: p.border, backgroundColor: p.surface }]}
              accessibilityLabel="새 이름"
              onSubmitEditing={() => {
                rename(renameDoc.id, newTitle);
                setSheet(null);
              }}
            />
            <PrimaryButton
              label="저장"
              icon="check"
              disabled={!newTitle.trim()}
              onPress={() => {
                rename(renameDoc.id, newTitle);
                setSheet(null);
              }}
            />
          </View>
        )}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: 18,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  logo: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  h1: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: radius.lg + 4,
    padding: 20,
    marginBottom: 6,
  },
  heroKicker: { fontSize: 12.5, fontWeight: '800', opacity: 0.9, letterSpacing: 0.4 },
  heroTitle: { fontSize: 20, fontWeight: '800', marginTop: 4, lineHeight: 27 },
  heroMeta: { fontSize: 13, fontWeight: '700', marginTop: 6, opacity: 0.92 },
  heroPlay: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', paddingLeft: 3 },
  section: { fontSize: 13, fontWeight: '800', marginTop: 20, marginBottom: 10, marginLeft: 4, letterSpacing: 0.3 },
  card: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 14,
    paddingLeft: 14,
    paddingRight: 4,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 10,
    alignItems: 'center',
  },
  badge: { borderRadius: 10, width: 46, height: 46, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 11.5, fontWeight: '800' },
  title: { fontSize: 16, fontWeight: '700', lineHeight: 22 },
  meta: { fontSize: 12.5, marginTop: 4, fontWeight: '600' },
  track: { height: 4, borderRadius: 2, marginTop: 9, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyArt: { width: 104, height: 104, borderRadius: 52, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  emptyTitle: { fontSize: 21, fontWeight: '800', marginBottom: 8 },
  emptyText: { fontSize: 14.5, textAlign: 'center', lineHeight: 22 },
  fab: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 28,
    height: 56,
    borderRadius: 28,
    minWidth: 132,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabText: { fontSize: 16, fontWeight: '800' },
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 14, fontSize: 16, minHeight: 50 },
  paste: { flex: 1, paddingTop: 12, minHeight: 180 },
});
