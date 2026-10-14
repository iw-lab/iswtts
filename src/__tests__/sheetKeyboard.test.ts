// 🔒 키보드가 시트를 덮지 않는다(v1.32.0 에뮬 실측 2026-10-14).
// 안드로이드 모달 창은 edge-to-edge 강제(SDK 57·targetSdk 36)라 키보드가 떠도 창이 줄지 않는다 —
// adjustResize·KeyboardAvoidingView(behavior 없음)로는 「서재에 추가하고 듣기」·이름 바꾸기 칸이
// 키보드 밑에 깔렸다. 그래서 ① 모달은 Sheet 하나로만 띄우고 ② Sheet 가 키보드 높이만큼 직접
// 올라서며 ③ 시트 안에서 KeyboardAvoidingView 를 겹쳐 쓰지 않는다(두 번 올라간다).
// 렌더 시험 도구(testing-library)가 없어 소스 계약으로 잠근다.
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (n === '__tests__' || n === 'node_modules') return [];
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}
const all = files(SRC).map((p) => ({ p: p.slice(SRC.length + 1), s: readFileSync(p, 'utf8') }));
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

test('<Modal> 은 components/ui.tsx(Sheet) 에서만 쓴다', () => {
  const bad = all.filter((f) => f.p !== join('components', 'ui.tsx') && /<Modal\b/.test(code(f.s))).map((f) => f.p);
  expect(bad).toEqual([]);
});

test('Sheet 는 키보드 높이만큼 바닥 여백을 올린다', () => {
  const ui = code(all.find((f) => f.p === join('components', 'ui.tsx'))!.s);
  const sheet = ui.slice(ui.indexOf('export function Sheet('));
  expect(sheet).toMatch(/useKeyboardHeight\(visible\)/);
  expect(sheet).toMatch(/paddingBottom:\s*padBottom/);
  expect(ui).toMatch(/Keyboard\.addListener\('keyboardDidShow'/);
  expect(ui).toMatch(/Keyboard\.addListener\('keyboardDidHide'/);
});

test('시트를 쓰는 화면은 KeyboardAvoidingView 를 겹쳐 쓰지 않는다', () => {
  const bad = all.filter((f) => /<Sheet\b/.test(code(f.s)) && /<KeyboardAvoidingView\b/.test(code(f.s))).map((f) => f.p);
  expect(bad).toEqual([]);
});
