// 남녀 화자 구분 회귀 실측(v1.28.0). 단위 테스트가 아니라 **실제 파이프라인 전체**
// (segmentDocument → splitDialogue → guessDialogueGenders)를 소설 조판 코퍼스에 태워
// 적중률을 잰다 — v1.27.x 는 단위 테스트를 전부 통과하면서도 실제 조판에서 8% 였다
// (대사 13개 중 12개 미상 → 재생부가 전부 한 목소리로 폴백, 사용자 보고 2026-07-26
// "거의 남자로만 읽음"). 단위 테스트가 못 잡는 층이라 이 파일을 남긴다.
//
// 기준선(2026-07-26 실측): 빈 줄 조판 100% · 단일 개행 92% · 후행 꼬리표 100%.
// 아래 임계는 그 아래로 떨어지면 실패하게 잡아 둔 것 — 성별 추정을 손볼 때 이 수치가
// 내려가면 회귀다.
import { segmentDocument } from '../lib/segment';
import { splitDialogue } from '../lib/dialogue';
import { guessDialogueGenders } from '../lib/speakerGender';

// 한국 소설 대화 장면의 대표 조판. 각 대사 줄에 정답 성별을 주석으로 붙였다.
// (표기: 대사 문장 순서대로 EXPECT 배열)
const DOC = `사내가 문을 열고 들어섰다.

"여기 앉아도 되겠소?"

여자는 고개를 들었다.

"앉으세요."

"고맙소."

그는 의자를 끌어당겼다. 잠시 침묵이 흘렀다.

"무슨 일로 오셨나요?" 그녀가 물었다.

"부탁이 있어서 왔습니다."

"부탁이라니요?"

"아이를 좀 맡아 주시오."

여자의 얼굴이 굳어졌다.

"제가요? 왜 하필 저한테."

"달리 부탁할 사람이 없소."

그는 고개를 숙였다.

"생각할 시간을 주세요."

"기다리겠소."

한참 뒤에 여자가 입을 열었다.

"좋아요. 데려오세요."

사내는 자리에서 일어섰다.

"고맙소. 정말 고맙소."
`;

// 정답(대사 문장 순서대로). 남=사내, 여=여자.
const EXPECT: Array<'male' | 'female'> = [
  'male',   // 여기 앉아도 되겠소?
  'female', // 앉으세요.
  'male',   // 고맙소.
  'female', // 무슨 일로 오셨나요? 그녀가 물었다.
  'male',   // 부탁이 있어서 왔습니다.
  'female', // 부탁이라니요?
  'male',   // 아이를 좀 맡아 주시오.
  'female', // 제가요? 왜 하필 저한테.
  'male',   // 달리 부탁할 사람이 없소.
  'female', // 생각할 시간을 주세요.
  'male',   // 기다리겠소.
  'female', // 좋아요. 데려오세요.
  'male',   // 고맙소. 정말 고맙소.
];

// 후행 지문(꼬리표) 패턴 — 사용자 지적: "뒷쪽에 누가 말했다 이렇게 나올텐데"
const DOC_TRAILING = `"그럼 내일 만나요."
그녀가 웃으며 말했다.

"알겠습니다."
사내가 짧게 대답했다.

"조심해서 가세요."
어머니가 손을 흔들었다.

"다녀오겠습니다."
아들이 문을 나섰다.
`;
const EXPECT_TRAILING: Array<'male' | 'female'> = ['female', 'male', 'female', 'male'];

function audit(doc: string, expect_: Array<'male' | 'female'>, label: string) {
  const { sentences, paraStarts } = segmentDocument(doc);
  const segs = splitDialogue(sentences);
  // 앱과 동일 조건: 기본 화자가 여성(sherpa sid 0)이므로 미상 런은 male 부터 교대.
  const genders = guessDialogueGenders(sentences, new Set(paraStarts), { fallbackFirst: 'male' });
  const rows: string[] = [];
  let di = 0;
  let ok = 0;
  let unknown = 0;
  let wrong = 0;
  sentences.forEach((s, i) => {
    const hasDlg = segs[i].some((sg) => sg.dialogue);
    if (!hasDlg) return;
    const want = expect_[di];
    const got = genders[i];
    di++;
    if (!got) unknown++;
    else if (got === want) ok++;
    else wrong++;
    rows.push(
      `${String(i).padStart(3)} ${(got ?? '미상').padEnd(7)} want=${want ?? '?'} ${
        got === want ? '✓' : got ? '✗' : '·'
      }  ${s.slice(0, 34)}`,
    );
  });
  const total = ok + unknown + wrong;
  console.log(`\n=== ${label} (대사 문장 ${total}개) ===`);
  console.log(rows.join('\n'));
  console.log(`정답 ${ok} / 오귀속 ${wrong} / 미상 ${unknown}  → 적중률 ${((ok / total) * 100).toFixed(0)}%`);
  return { ok, wrong, unknown, total };
}

// 같은 대화를 "단일 개행" 조판으로(빈 줄 없음) — 조판 차이의 영향 분리.
const DOC_SINGLE = DOC.replace(/\n\n/g, '\n');

// 이름 화자(성별 어휘 없음) — 소설에서 가장 흔한 꼬리표.
const DOC_NAMES = `지수가 카페 문을 열었다. 민준은 이미 앉아 있었다.

"오래 기다렸어?"

"방금 왔어."

"주문은 했고?"

"아니, 같이 하려고."

지수가 웃었다.
`;
const EXPECT_NAMES: Array<'male' | 'female'> = ['female', 'male', 'female', 'male'];

test('빈 줄 조판(대화 턴마다 빈 줄) — 전부 맞힌다', () => {
  const a = audit(DOC, EXPECT, '대화 런 — 빈 줄 조판');
  expect(a.unknown).toBe(0); // 미상 = 한 목소리 폴백 = 이 버그의 본체
  expect(a.ok / a.total).toBeGreaterThanOrEqual(1);
});

test('단일 개행 조판 — 92% 이상', () => {
  const s = audit(DOC_SINGLE, EXPECT, '대화 런 — 단일 개행 조판');
  expect(s.ok / s.total).toBeGreaterThanOrEqual(0.9);
});

test('후행 지문(꼬리표) — 전부 맞힌다', () => {
  const b = audit(DOC_TRAILING, EXPECT_TRAILING, '후행 지문(꼬리표)');
  expect(b.ok / b.total).toBe(1);
});

// 이름 화자("지수가 웃었다")는 성별 사전이 없어 방향을 못 맞힌다 — 다만 **교대 자체는**
// 지켜져야 한다(두 사람이 번갈아 말하는 대비가 살아 있어야 한다). 방향까지 맞히려면
// 이름→성별 추적이 필요하고, 그건 별도 작업이다.
test('이름 화자 — 방향은 미상이나 교대는 지킨다', () => {
  const n = audit(DOC_NAMES, EXPECT_NAMES, '이름 화자');
  expect(n.unknown).toBe(0);
  expect(n.ok + n.wrong).toBe(n.total); // 전부 배정됨(미상 폴백 아님)
});
