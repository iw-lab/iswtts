import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Switch,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePalette, radius } from '../lib/theme';
import Icon, { type IconName } from './Icon';

// 화면 공통 부품(v1.32.0 전면 개편). 색은 전부 팔레트 토큰 — hex 직접 사용 금지(themeContrast 게이트).

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const p = usePalette();
  return <View style={[styles.card, { backgroundColor: p.card, borderColor: p.border }, style]}>{children}</View>;
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  const p = usePalette();
  return <Text style={[styles.section, { color: p.subtext }]}>{children}</Text>;
}

export function Hint({ children }: { children: React.ReactNode }) {
  const p = usePalette();
  return <Text style={[styles.hint, { color: p.subtext }]}>{children}</Text>;
}

export function Divider() {
  const p = usePalette();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: p.border, marginVertical: 4 }} />;
}

export function SwitchRow({
  label,
  hint,
  value,
  onChange,
  icon,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  icon?: IconName;
}) {
  const p = usePalette();
  return (
    <Pressable
      onPress={() => onChange(!value)}
      style={styles.row}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
    >
      {icon && (
        <View style={[styles.rowIcon, { backgroundColor: p.primarySoft }]}>
          <Icon name={icon} size={18} color={p.onPrimarySoft} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, { color: p.text }]}>{label}</Text>
        {!!hint && <Text style={[styles.rowHint, { color: p.subtext }]}>{hint}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: p.border, true: p.primary }}
        thumbColor={p.surface}
        importantForAccessibility="no"
      />
    </Pressable>
  );
}

export function StepperRow({
  label,
  value,
  onDec,
  onInc,
  decDisabled,
  incDisabled,
}: {
  label: string;
  value: string;
  onDec: () => void;
  onInc: () => void;
  decDisabled?: boolean;
  incDisabled?: boolean;
}) {
  const p = usePalette();
  const btn = (txt: string, onPress: () => void, disabled: boolean | undefined, a11y: string) => (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[styles.stepBtn, { borderColor: p.border, backgroundColor: p.surface, opacity: disabled ? 0.4 : 1 }]}
      accessibilityRole="button"
      accessibilityLabel={`${label} ${a11y}, 현재 ${value}`}
    >
      <Text style={[styles.stepTxt, { color: p.text }]}>{txt}</Text>
    </TouchableOpacity>
  );
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: p.text, flex: 1 }]}>{label}</Text>
      {btn('−', onDec, decDisabled, '줄이기')}
      <Text style={[styles.stepVal, { color: p.text }]}>{value}</Text>
      {btn('＋', onInc, incDisabled, '늘리기')}
    </View>
  );
}

export function Chip({
  label,
  active,
  onPress,
  icon,
  style,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}) {
  const p = usePalette();
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      style={[
        styles.chip,
        {
          backgroundColor: active ? p.primary : p.surface,
          borderColor: active ? p.primary : p.border,
        },
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!active }}
    >
      {icon && <Icon name={icon} size={16} color={active ? p.onPrimary : p.text} />}
      <Text style={[styles.chipTxt, { color: active ? p.onPrimary : p.text }]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

export function IconButton({
  name,
  onPress,
  label,
  size = 22,
  color,
  style,
}: {
  name: IconName;
  onPress: () => void;
  label: string;
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const p = usePalette();
  return (
    <TouchableOpacity
      onPress={onPress}
      hitSlop={10}
      style={[styles.iconBtn, style]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon name={name} size={size} color={color ?? p.text} />
    </TouchableOpacity>
  );
}

export function PrimaryButton({
  label,
  onPress,
  icon,
  disabled,
  style,
  tone = 'primary',
}: {
  label: string;
  onPress: () => void;
  icon?: IconName;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  tone?: 'primary' | 'soft' | 'danger';
}) {
  const p = usePalette();
  const bg = tone === 'primary' ? p.primary : tone === 'soft' ? p.primarySoft : p.surface;
  const fg = tone === 'primary' ? p.onPrimary : tone === 'soft' ? p.onPrimarySoft : p.danger;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
      style={[
        styles.primary,
        { backgroundColor: bg, opacity: disabled ? 0.5 : 1, borderColor: tone === 'danger' ? p.border : bg },
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
    >
      {icon && <Icon name={icon} size={18} color={fg} />}
      <Text style={[styles.primaryTxt, { color: fg }]}>{label}</Text>
    </TouchableOpacity>
  );
}

/** 바텀 시트(모달). 바깥 탭·뒤로 가기로 닫힌다. */
export function Sheet({
  visible,
  onClose,
  title,
  children,
  tall,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  tall?: boolean;
}) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.sheetWrap}>
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: p.scrim }]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="닫기"
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: p.elevated,
              paddingBottom: insets.bottom + 16,
              maxHeight: tall ? '88%' : '75%',
              height: tall ? '88%' : undefined,
            },
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: p.border }]} />
          <View style={styles.sheetHead}>
            <Text style={[styles.sheetTitle, { color: p.text }]}>{title}</Text>
            <IconButton name="close" onPress={onClose} label="닫기" color={p.subtext} />
          </View>
          {/* 짧은 시트는 내용이 넘치면 스크롤(큰 글꼴 설정에서 선택 행이 화면 밖으로 밀리지 않게 —
              교차검증 codex). 긴 시트(tall)는 안에 자기 목록(FlatList)이 스크롤을 맡는다. */}
          {tall ? children : <ScrollView keyboardShouldPersistTaps="handled" bounces={false}>{children}</ScrollView>}
        </View>
      </View>
    </Modal>
  );
}

/** 시트 안의 선택 행(아이콘 + 글 + 선택 표시). */
export function SheetRow({
  label,
  hint,
  icon,
  onPress,
  selected,
  danger,
}: {
  label: string;
  hint?: string;
  icon?: IconName;
  onPress: () => void;
  selected?: boolean;
  danger?: boolean;
}) {
  const p = usePalette();
  const color = danger ? p.danger : p.text;
  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles.sheetRow}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!selected }}
    >
      {icon && <Icon name={icon} size={20} color={danger ? p.danger : p.subtext} />}
      <View style={{ flex: 1 }}>
        <Text style={[styles.sheetRowTxt, { color, fontWeight: selected ? '800' : '600' }]}>{label}</Text>
        {!!hint && <Text style={[styles.rowHint, { color: p.subtext }]}>{hint}</Text>}
      </View>
      {selected && <Icon name="check" size={20} color={p.primary} />}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, paddingHorizontal: 16, paddingVertical: 6 },
  section: { fontSize: 13, fontWeight: '800', marginTop: 26, marginBottom: 8, marginLeft: 4, letterSpacing: 0.3 },
  hint: { fontSize: 12.5, lineHeight: 19, marginTop: 4, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, minHeight: 52 },
  rowIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { fontSize: 16, fontWeight: '700' },
  rowHint: { fontSize: 12.5, lineHeight: 18, marginTop: 3 },
  stepBtn: { borderWidth: 1, borderRadius: radius.sm, width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  stepTxt: { fontSize: 20, fontWeight: '700' },
  stepVal: { fontSize: 16, fontWeight: '800', minWidth: 58, textAlign: 'center', fontVariant: ['tabular-nums'] },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    height: 40,
  },
  chipTxt: { fontSize: 14, fontWeight: '700' },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: 18,
    minHeight: 52,
  },
  primaryTxt: { fontSize: 16, fontWeight: '800' },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 18, paddingTop: 8 },
  grabber: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 6 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  sheetTitle: { fontSize: 19, fontWeight: '800' },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, minHeight: 54 },
  sheetRowTxt: { fontSize: 16 },
});
