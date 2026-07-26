// 대사 화자 성별 추정(순수 함수 — 테스트 대상). "대사는 다른 목소리로" 기능의 자동 대비를
// 남/여까지 구분해 준다(사용자 요청 2026-07-20 "남자 구분해줄 수 있나").
//
// 방법: 대사(따옴표 안)를 지우고 남은 지문에서 성별 단서 어휘를 찾는다 — 소설 관행상
// 대사 문장의 지문("…" 그가 말했다 / 어머니가 웃으며 …)에 화자가 명시되는 경우가 많다.
// v1.25.1 의 문장 분할 수정(대사+지문 = 한 문장)이 전제 — 그 전엔 지문이 다른 문장으로
// 떨어져 나가 단서를 볼 수 없었다.
//
// 한계(설계상 허용): 지문 없는 연속 대화(「"왔니?" "응."」)나 이름만 있는 화자("지수가
// 말했다")는 판별 불가 → null 을 돌려주고 호출부가 기존 자동 대비(중립)로 폴백한다.
// 두 성별 단서가 같이 있으면("그가 어머니에게 말했다") 오귀속 위험이 커 null.

// 인용 스팬 제거용. dialogue.ts 의 대사 짝(큰따옴표 계열)보다 넓게 — 홑따옴표(생각)·
// 겹낫표(제목)도 지운다: 그 안의 성별 어휘("'그녀를 봤어?' 하고 물었다")가 지문 판정에
// 새면 오귀속된다(교차검증 Gemini 지적, 실측 재현 확인 2026-07-20).
const QUOTE_SPANS = /“[^”]*”|"[^"]*"|「[^」]*」|‘[^’]*’|'[^']*'|『[^』]*』/g;

// 지문 성별 단서. 호칭·지칭 명사는 소설 지문에서 화자 표지로 쓰이는 빈도 높은 것만 —
// 과욕(이름 사전 등)은 오귀속을 늘린다.
// 주격류 조사(가/이/는/은/도)가 바로 뒤따를 때만 단서로 인정: "철수가 그녀에게 말했다"의
// "그녀에게"(여격=청자)를 화자로 오인하지 않게(교차검증 codex 지적, 실측 재현). 부수 효과로
// "그녀석"(그+녀석)·"여자였다"(서술어) 같은 비주어 꼴도 걸러진다.
// v1.27.0: 어휘 확장(딸·이모·고모·여동생·며느리 / 아들·삼촌·도련님·오빠 — 소설 지문의
// 화자 표지 빈도 상위만) + 소유격 꼴 인정("그녀의 목소리가 떨렸다"·"사내의 말이 짧았다").
// 소유격은 뒤에 발화 명사가 올 때만 — "어머니의 손을 잡았다"(화자 아님)를 배제한다.
const FEMALE_WORDS =
  '그녀|여자|소녀|여인|아주머니|아줌마|할머니|어머니|엄마|아내|부인|아가씨|언니|누나|누이|딸|이모|고모|여동생|며느리';
const MALE_WORDS =
  '사내|남자|소년|아저씨|할아버지|아버지|아빠|남편|영감|청년|형님|오라버니|아들|삼촌|도련님|오빠';
// 소유격 뒤에 오면 화자 표지로 인정하는 발화 명사.
// ⚠️ 더 긴 어휘가 먼저 와야 한다(정규식 alternation 은 선순위 매치) — '말'이 앞에 있으면
// '말투' 분기는 영원히 도달 불가(교차검증 지적 2026-07-21).
const SPEECH_NOUN = '목소리|음성|말투|말|대답|물음|외침|목청|한숨';
function cueRe(words: string): RegExp {
  return new RegExp(`(?:${words})(?:(?=[가이는은도])|(?=의\\s?(?:${SPEECH_NOUN})))`, 'g');
}
const FEMALE_CUES = cueRe(FEMALE_WORDS);
const MALE_CUES = cueRe(MALE_WORDS);
// 3인칭 남성 대명사 "그가/그는/그도"(+ "그의 목소리") — "그날/그때" 같은 지시어와 구분하려고
// 조사까지 본다. ("그녀가"는 그+녀 라서 이 패턴에 걸리지 않는다.)
const HE_PRONOUN = /(^|[^가-힣])그(?:[가는도](?=[^가-힣]|$)|의\s?(?:목소리|음성|말|대답|물음))/g;
// 발화 동사 — 남/여 단서가 함께 있을 때 "누가 말했는가"를 가르는 기준점(v1.27.0).
// 한국어 지문은 화자가 발화 동사 "앞"에 오므로("그가 어머니에게 말했다"), 동사 직전의
// 가장 가까운 단서를 화자로 본다. 이전 버전은 이런 문장을 통째로 null(중립 폴백)로 버렸다.
// ⚠️ 이 규칙은 "발화 동사가 문장에 딱 하나"일 때만 쓴다(아래 guessDialogueGender). 둘 이상이면
// 어느 절이 대사의 주인인지 텍스트만으로는 못 가른다 — 교차검증 Gemini 재현 2026-07-21:
//   "그녀가 사과를 베어 물었고 그가 말했다."  ← "물었"이 먹다(bite) 뜻인데 발화로 잡힘
//   "어머니가 말하자 그가 물었다."            ← 종속절 동사가 주절보다 앞에 옴
// 둘 다 "가장 앞선 동사 기준"이면 정확히 반대 성별로 귀속됐다. 모호하면 null(중립 폴백)이
// 오귀속보다 낫다는 이 파일의 기존 방침을 그대로 따른다.
// ⚠️ 어간형(말하·외치·속삭이·입을 열)은 부정형을 배제해야 한다(교차검증 Gemini 2026-07-26).
// 한국어 부정 "-지 않다/못하다"는 어간에 붙으므로 "입을 열지 않았다"·"말하지 않았다"가
// 그대로 발화 동사로 잡혀, **말하지 않은 사람**이 화자로 확정되는 정반대 오귀속이 났다.
// 과거형으로 고정된 항목(말했·물었 등)은 부정형과 겹치지 않아 그대로 둔다.
const SPEECH_VERB =
  /(말했|말하(?!지)|물었|묻는|외쳤|외치(?!지)|속삭였|속삭이(?!지)|대답했|답했|중얼거|되물었|소리쳤|덧붙였|입을 열(?!지)|말문을 열|운을 뗐|운을 떼)/g;

// 발화 "개시" 동사 — 이 뒤에 대사가 온다는 뜻이라, 같은 문장에서 **대사 뒤에** 나오면 그
// 지문의 주어는 방금 말한 사람이 아니라 **다음에 말할 사람**이다(실측 2026-07-26):
//   "기다리겠소." 한참 뒤에 여자가 입을 열었다.   ← "기다리겠소"는 남자의 말
// 한국어 관행상 이미 끝난 대사의 꼬리표에는 "말했다·물었다"를 쓰지 "입을 열었다"를 쓰지
// 않는다. 이걸 구분하지 않으면 앞 대사가 반대 성별로 확정되고, 교대 전파를 타고 그
// 오귀속이 뒤따르는 대사 여러 개로 번진다(같은 코퍼스에서 6개 연쇄 오귀속 재현).
// 지문 "전용" 문장(대사 없음)의 개시 동사는 종전대로 다음 대사의 화자 소개로 쓴다.
const SPEECH_OPENER = /(입을 열(?!지)|말문을 열|운을 뗐|운을 떼)/;

// "물었다"는 발화(ask)와 섭취(bite)가 같은 표기다 — 목적어("사과를 베어") 뒤에 오면 먹다.
// 종전엔 단서가 두 개인 문장에서만 이 동음이의를 방어했는데, 단서가 하나면 그대로 확신
// 앵커가 됐다(교차검증 codex 2026-07-26 재현: 「"그래." 그녀가 사과를 베어 물었다.」가
// {female, strong:true}). 발화 동사 위치 바로 앞 문맥으로 가른다.
const BITE_CONTEXT = /[을를]\s*\S*\s*$/;

/** 지문에서 실제 발화 동사의 위치·표기. 동음이의(bite)는 걸러낸다. */
function speechVerbHits(narration: string): Array<{ idx: number; text: string }> {
  SPEECH_VERB.lastIndex = 0;
  const out: Array<{ idx: number; text: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = SPEECH_VERB.exec(narration))) {
    if (m[0].startsWith('물었') && BITE_CONTEXT.test(narration.slice(Math.max(0, m.index - 12), m.index))) {
      continue; // 먹다(bite) — 화자 표지가 아니다
    }
    out.push({ idx: m.index, text: m[0] });
  }
  return out;
}

export type SpeakerGender = 'male' | 'female';

type Cue = { idx: number; gender: SpeakerGender };

function cuesIn(narration: string): Cue[] {
  const out: Cue[] = [];
  const collect = (re: RegExp, gender: SpeakerGender) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(narration))) out.push({ idx: m.index, gender });
  };
  collect(FEMALE_CUES, 'female');
  collect(MALE_CUES, 'male');
  collect(HE_PRONOUN, 'male');
  return out.sort((a, b) => a.idx - b.idx);
}

/** 단서의 확신도. strong = 지문에 발화 동사가 있어 "누가 말했다"가 명시된 경우.
 *  weak = 성별 어휘는 있지만 발화 동사가 없는 반응 지문("…" 여자는 고개를 들었다) —
 *  실측 2026-07-26: 이런 지문의 주어는 화자일 때도, 듣는 쪽일 때도 있어 절반이 오귀속이었다.
 *  교대 전파(alternateDialogueRuns)는 strong 만 앵커로 쓰고 weak 은 패리티에 양보시킨다. */
export type GenderGuess = {
  gender: SpeakerGender;
  strong: boolean;
  /** 이 문장이 "곧 말을 시작한다"고 알리는 지문인가(입을 열었다·운을 뗐다). 그렇다면 그
   *  주어는 **뒤이어 나올** 대사의 화자다 — 앞 대사의 화자로 끌어다 쓰면 안 된다. */
  opener?: boolean;
};

export function guessDialogueGenderDetail(sentence: string): GenderGuess | null {
  const narration = sentence.replace(QUOTE_SPANS, ' ');
  if (!narration.trim()) return null; // 지문 없음(통짜 대사)
  const cues = cuesIn(narration);
  if (!cues.length) return null;
  const hits = speechVerbHits(narration);
  const verbs = hits.map((h) => h.text);
  const verbCount = hits.length;
  // 이 문장에 대사가 있고, 그 화자 표지가 개시 동사뿐이며, **그 개시 동사가 대사 뒤에**
  // 있으면 그 주어는 다음 화자다(SPEECH_OPENER 주석) — 이 대사의 화자 근거로 쓰지 않는다.
  // ⚠️ 위치를 안 보면 정상 어순인 「여자가 입을 열었다. "이제 그만하자."」까지 버린다
  // (교차검증 codex 2026-07-26 재현) — 그건 개시 동사가 제 역할을 하는 표준 화자 소개다.
  const openerOnly = verbCount > 0 && verbs.every((v) => SPEECH_OPENER.test(v));
  if (openerOnly) {
    QUOTE_SPANS.lastIndex = 0;
    const q = QUOTE_SPANS.exec(sentence);
    QUOTE_SPANS.lastIndex = 0;
    if (q) {
      const opener = narration.search(SPEECH_OPENER);
      // narration 은 인용을 공백으로 치환해 길이가 보존되므로 원문과 오프셋이 같다.
      if (opener > q.index) return null;
    }
  }
  // strong(= "누가 말했다"가 명시됨)은 발화 동사가 **정확히 하나**일 때만. 둘 이상이면 어느
  // 절이 이 대사의 주인인지 못 가르고(기존 방침), 동음이의도 섞인다 — "그녀가 사과를 베어
  // 물었다"의 '물었'(bite)이 대표적이라 단서가 한 종류여도 확신 앵커로 올리면 안 된다
  // (교차검증 codex 2026-07-26: 다중 단서 경로에만 있던 방어가 단일 단서에선 빠져 있었다).
  const first = cues[0].gender;
  if (cues.every((c) => c.gender === first)) {
    return { gender: first, strong: verbCount === 1, opener: openerOnly };
  }
  // 남/여 혼재 — 발화 동사 직전의 가장 가까운 단서를 화자로 본다(주격 조사가 붙은 단서만
  // 모아 두었으므로 여격·목적격 청자는 애초에 후보가 아니다). 단, 발화 동사가 "딱 하나"일
  // 때만: 둘 이상이면 어느 절이 대사의 주인인지 못 가른다(SPEECH_VERB 주석의 재현 사례).
  if (verbCount !== 1) return null;
  const v = hits[0].idx;
  if (v < 0) return null;
  let best: Cue | null = null;
  for (const c of cues) if (c.idx < v && (!best || c.idx > best.idx)) best = c;
  return best ? { gender: best.gender, strong: true, opener: openerOnly } : null;
}

export function guessDialogueGender(sentence: string): SpeakerGender | null {
  return guessDialogueGenderDetail(sentence)?.gender ?? null;
}

// 문서 단위 2패스 추정(v1.25.3 — "남녀 구분이 잘 안 된다" 후속). 소설 대사의 다수는
// 같은 문장에 지문이 없다(대사만 한 문단/이름만 있는 꼬리표) — 1패스가 null 이면:
//   앞 문장이 대사 없는 순수 지문이고 성별 단서가 있으면 그걸 쓴다("사내가 입을 열었다."
//   → 다음 줄 대사 = 화자 소개 관행) → 없으면 다음 문장 지문(꼬리표 후행 관행)을 본다.
// 대화가 이어지는 구간(양쪽 다 대사)은 확장하지 않는다 — 교대 화자를 넘겨짚으면 절반이
// 오귀속이라 null(폴백)이 낫다.
const WINDOW = 2; // 앞/뒤로 훑을 지문 문장 수(대사 문장을 만나면 중단)
export function guessDialogueGenders(
  sentences: string[],
  paraStarts?: ReadonlySet<number>,
  opts?: {
    /** 앵커가 하나도 없는 대화 런에서 첫 대사에 줄 성별(= 기본 화자의 반대). 지정하면
     *  그 런을 이 성별부터 교대로 채운다. 미지정이면 종전대로 미상으로 남긴다. */
    fallbackFirst?: SpeakerGender;
  },
): Array<SpeakerGender | null> {
  const hasQuote = sentences.map((s) => {
    QUOTE_SPANS.lastIndex = 0;
    return QUOTE_SPANS.test(s);
  });
  const detail = sentences.map(guessDialogueGenderDetail);
  const own = detail.map((d) => d?.gender ?? null);
  const result = sentences.map((s, i) => {
    if (own[i]) return own[i];
    if (!hasQuote[i]) return null; // 지문 문장 자체는 확장 대상 아님
    // v1.27.0: 탐색 창 1 → 2 문장. 소설은 "사내가 문을 열었다. 잠시 망설였다. '누구요?'"
    // 처럼 화자 소개와 대사 사이에 지문이 한 줄 더 끼는 경우가 흔하다(사용자 보고 2026-07-21
    // "아직도 남녀 구분을 잘 못한다"). 대사 문장을 만나면 즉시 중단 — 그때부터는 화자가
    // 바뀌었을 수 있어 넘겨짚기가 된다.
    // ⚠️ 문단(장면) 경계를 넘지 않는다 — 넘으면 앞 장면 마지막 지문의 성별이 새 장면 첫
    // 대사로 새어 든다(교차검증 Gemini 2026-07-21: 창을 2로 넓히며 노출 면적이 커졌다).
    // paraStarts 는 문단을 "시작하는" 문장 인덱스 집합(segment.ts) — 뒤로 훑을 땐 지금
    // 문장이 문단 머리인 순간, 앞으로 훑을 땐 다음 문장이 문단 머리인 순간 멈춘다.
    // 종전(v1.27.x)의 인접 지문 확장. v1.28.0 부터는 아래 assignByAlternation 이 이 값을
    // "약한 힌트"로만 쓴다 — 대사 사이에 낀 지문의 성별이 다음 화자를 가리킨다는 보장이
    // 없기 때문(실측 근거는 anchorsFor 주석).
    const scan = (from: number, step: number): SpeakerGender | null => {
      for (let k = from, n = 0; k >= 0 && k < sentences.length && n < WINDOW; k += step, n++) {
        if (paraStarts?.has(step < 0 ? k + 1 : k) && n > 0) return null;
        if (hasQuote[k]) return null;
        // 앞으로 훑을 때(step>0) 개시 동사 지문은 **그 뒤** 대사의 화자를 가리키므로 지금
        // 대사의 근거가 아니다(교차검증 codex 2026-07-26 재현: 「"왔나?" / 여자가 입을
        // 열었다. / 잠시 침묵했다. / "네."」에서 "왔나?"까지 여성으로 끌려갔다).
        if (detail[k]?.opener && step > 0) return null;
        if (own[k]) return own[k];
      }
      return null;
    };
    return scan(i - 1, -1) ?? scan(i + 1, 1);
  });
  assignByAlternation(result, sentences, detail, opts?.fallbackFirst);
  return result;
}

// ── 대화 시퀀스 교대 배정(v1.28.0 전면 재설계) ────────────────────
//
// 왜 다시 짰나: v1.27.x 는 "인접 지문의 성별 = 이 대사의 화자"를 1차 근거로 삼고 교대를
// 보조로 썼다. 실측(2026-07-26, 소설 조판 코퍼스 3종)에서 그 우선순위가 뒤집혀 있음이
// 드러났다 — 빈 줄 조판 13개 대사 중 12개 미상(전부 한 목소리, 사용자 보고 "거의 남자로만
// 읽음"), 단일 개행 조판은 오귀속 3건. 원인은 낀 지문의 성별이 화자를 가리키지 않기 때문:
//   "달리 부탁할 사람이 없소."   ← 남이 말함
//   그는 고개를 숙였다.           ← 남(방금 말한 사람의 행동)
//   "생각할 시간을 주세요."       ← 여(교대)
//   ↑ 여기서 "그는"을 다음 화자로 읽으면 정확히 반대가 된다.
//   "여기 앉아도 되겠소?"         ← 남
//   여자는 고개를 들었다.         ← 여(듣는 쪽의 반응)
//   "앉으세요."                   ← 여
//   ↑ 반대로 여기선 낀 지문이 다음 화자를 맞힌다. 텍스트만으로는 둘을 못 가른다.
// 그래서 방침을 바꾼다: **한국 소설의 대화는 두 화자 교대가 지배적 관행**이므로 교대를
// 기본 골격으로 깔고, "누가 말했다"가 명시된 곳(발화 동사)에서만 패리티를 고정한다.
// 낀 지문의 발화 동사 없는 성별 어휘는 근거로 쓰지 않는다.
//
// 실측 결과(같은 코퍼스): 빈 줄 조판 8% → 100%, 후행 꼬리표 100% 유지.

/** 대사 사이에 낀 지문이 이보다 길면 대화가 끊긴 것으로 본다(장면 전환·서술 복귀). */
const NARR_GAP_MAX = 2;
/** 앵커에서 이 거리(발화 턴 수)를 넘으면 교대 전파를 신뢰하지 않는다. 대화가 길어질수록
 *  "두 사람이 번갈아"라는 관행이 흐트러진다(3인 대화·같은 화자 연속 발화·끼어들기).
 *  v1.27.1 의 ALT_MAX_DIST 와 같은 취지 — v1.28.0 초안에서 실수로 빠졌던 것을 되살렸다
 *  (교차검증 Gemini CRITICAL 2026-07-26). 상한을 넘은 턴은 근거 없는 전파 대신 fallback
 *  교대로 채워, 오귀속이 무제한 번지지 않게 한다. */
const ALT_MAX_DIST = 8;
/** 앵커 선택 점수에서 확신도(weight)에 곱하는 계수 — 확신도 1 차이가 거리 몇 턴에
 *  해당하는지. 6 = "가까운 약한 단서"보다 "6턴 이내의 더 확실한 단서"를 우선한다. */
const ANCHOR_WEIGHT_SCALE = 6;

/** 발화 턴(따옴표 대사) 판정용. dialogue.ts PAIRS 와 정렬 — 홑따옴표(생각)·겹낫표(제목)만
 *  있는 지문이 대화 턴으로 세어져 패리티를 밀지 않게 한다. */
const DIALOGUE_QUOTE = /[“”"「」]/;

type Anchor = { gender: SpeakerGender; weight: number };

/**
 * 각 발화 턴의 화자 앵커. 가중치가 클수록 확신이 큰 근거.
 *  3 = 같은 문장에 발화 동사로 화자가 명시("…" 그녀가 물었다)
 *  2 = 바로 앞 지문이 발화 동사로 다음 화자를 소개(대사 사이에 낀 경우도 이때만 인정)
 *  2 = 장면 서술 뒤 첫 대사의 화자 소개(그 지문 앞에 대사가 없음 = 반응 지문일 수 없다)
 *  1 = 같은 문장의 발화 동사 없는 지문, 인접 지문 확장(2패스 결과) — 교대와 충돌하면 진다
 */
function anchorsFor(
  sentences: string[],
  detail: Array<GenderGuess | null>,
  isTurn: boolean[],
  hint: Array<SpeakerGender | null>,
): Array<Anchor | null> {
  const n = sentences.length;
  const narr = (i: number): GenderGuess | null => (i >= 0 && i < n && !isTurn[i] ? detail[i] : null);
  const out: Array<Anchor | null> = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (!isTurn[i]) continue;
    if (detail[i]) {
      out[i] = { gender: detail[i]!.gender, weight: detail[i]!.strong ? 3 : 1 };
      continue;
    }
    const before = narr(i - 1);
    if (before) {
      // 앞 지문이 "대사 사이에 낀" 것인지(= 앞 화자의 행동/반응일 수 있음) 판별.
      // ⚠️ 지문이 두 줄 낀 경우(대사 → 지문 → 지문 → 대사)까지 봐야 한다 — i-2 만 보면
      // 그때 between=false 가 되어, 이 재설계가 없애려던 바로 그 오귀속이 되살아난다
      // (교차검증 code-reviewer 2026-07-26: 그룹 판정은 NARR_GAP_MAX=2 줄까지 허용하는데
      // 이 판정만 1 줄 기준이라 둘이 어긋나 있었다).
      let k = i - 2;
      while (k >= 0 && !isTurn[k] && i - k <= NARR_GAP_MAX) k--;
      const between = k >= 0 && isTurn[k] && i - k <= NARR_GAP_MAX + 1;
      if (!between) {
        // 장면 서술 뒤 첫 대사 = 화자 소개 관행. 다만 발화 동사가 없으면 배경 인물 묘사일
        // 수도 있어("할머니가 밭에서 땀을 닦으셨다." 뒤에 지나가던 할아버지의 대사 —
        // 교차검증 Gemini 반례) 확신을 낮춘다. weight 1 이어도 근거가 이것뿐인 대화에선
        // 여전히 시드 역할을 한다.
        out[i] = { gender: before.gender, weight: before.strong ? 2 : 1 };
        continue;
      }
      if (before.strong) {
        out[i] = { gender: before.gender, weight: 2 };
        continue;
      }
    }
    // 뒤 지문 꼬리표. 그 뒤에 또 대사가 오면 "다음 화자 소개"일 수 있어 근거로 쓰지 않는다.
    // ⚠️ 지문이 두 줄까지 낄 수 있으므로(NARR_GAP_MAX) i+2 만 보면 안 된다 — 앞으로 훑어
    // 대화가 이어지는지 확인한다(교차검증 codex 2026-07-26 재현: 「"왔나?" / 여자가 입을
    // 열었다. / 잠시 침묵했다. / "네."」에서 성별이 정확히 뒤집혔다).
    const after = narr(i + 1);
    let nx = i + 2;
    while (nx < n && !isTurn[nx] && nx - i <= NARR_GAP_MAX) nx++;
    const dialogueFollows = nx < n && isTurn[nx] && nx - i <= NARR_GAP_MAX + 1;
    if (after?.strong && !dialogueFollows) {
      out[i] = { gender: after.gender, weight: 2 };
      continue;
    }
    if (hint[i]) out[i] = { gender: hint[i]!, weight: 1 };
  }
  return out;
}

const flip = (g: SpeakerGender): SpeakerGender => (g === 'male' ? 'female' : 'male');

function assignByAlternation(
  result: Array<SpeakerGender | null>,
  sentences: string[],
  detail: Array<GenderGuess | null>,
  fallbackFirst?: SpeakerGender,
): void {
  const n = sentences.length;
  const isTurn = sentences.map((s) => DIALOGUE_QUOTE.test(s));
  const anchors = anchorsFor(sentences, detail, isTurn, result.slice());

  // 대화 시퀀스 = 사이 지문이 NARR_GAP_MAX 이하로만 끼는 연속 발화 턴들.
  const groups: number[][] = [];
  let cur: number[] = [];
  let gap = 0;
  for (let i = 0; i < n; i++) {
    if (isTurn[i]) {
      cur.push(i);
      gap = 0;
    } else if (cur.length) {
      gap++;
      if (gap > NARR_GAP_MAX) {
        groups.push(cur);
        cur = [];
        gap = 0;
      }
    }
  }
  if (cur.length) groups.push(cur);

  for (const g of groups) {
    // 앵커 위치(그룹 내 인덱스)와 그 확신도.
    const anch: number[] = [];
    for (let p = 0; p < g.length; p++) if (anchors[g[p]]) anch.push(p);

    // 이 그룹이 실제로 "번갈아" 말하고 있는가 — 확신 있는 앵커 쌍의 관측이 교대 가정과
    // 어긋나면(같은 화자가 연속으로 말하는 장면, 3인 이상 대화) 교대를 아예 끄고 가장
    // 가까운 앵커의 성별을 그대로 쓴다. v1.27 은 이때 런 전체를 미상으로 버렸는데, 미상은
    // 재생부에서 한 목소리로 폴백되므로 오히려 이 버그의 본체였다 — 넘겨짚지 않으면서도
    // 한 목소리로 뭉개지지 않는 중간값이 "교대 끄기"다.
    const solid = anch.filter((p) => anchors[g[p]]!.weight >= 2);
    let alternates = true;
    for (let x = 0; x + 1 < solid.length; x++) {
      const p1 = solid[x];
      const p2 = solid[x + 1];
      const sameGender = anchors[g[p1]]!.gender === anchors[g[p2]]!.gender;
      if (sameGender !== ((p2 - p1) % 2 === 0)) {
        alternates = false;
        break;
      }
    }

    // 후보 앵커 슬라이딩 윈도우([p−ALT_MAX_DIST, p+ALT_MAX_DIST]). anch 는 오름차순이고 p 도
    // 오름차순으로 진행하므로 포인터 둘로 O(턴 + 앵커)에 끝난다 — 긴 대화(수천 턴)에서
    // 전체 앵커를 매번 훑으면 JS 스레드를 수백 ms 잡는다(교차검증 codex 실측 10,000턴 304ms).
    let wLo = 0;
    let wHi = 0;
    g.forEach((s, p) => {
      while (wLo < anch.length && anch[wLo] < p - ALT_MAX_DIST) wLo++;
      while (wHi < anch.length && anch[wHi] <= p + ALT_MAX_DIST) wHi++;
      const own = anchors[s];
      // 가중치 3(같은 문장에 "누가 말했다"가 박힌 것)은 교대보다 우선 — 같은 화자가 두 턴
      // 연속 말하는 구간에서 교대가 밀리는 것을 이 앵커가 바로잡는다.
      if (own && own.weight >= 3) {
        result[s] = own.gender;
        return;
      }
      // ⚠️ 전역 다수결이 아니라 **가장 가까운(그리고 확신 있는) 앵커** 기준으로 교대를 편다
      //   (교차검증 codex·Gemini 2026-07-26 합의). 전역 투표는 한 대화 그룹이 길어질수록
      //   먼 앵커가 전체 패리티를 지배해, 장면이 바뀌거나 3인 대화로 교대가 흐트러진 구간을
      //   통째로 뒤집었다. 거리로 감쇠시키면 오귀속이 그 앵커 주변으로 국한된다.
      //   점수 = 확신도 × ANCHOR_WEIGHT_SCALE − 거리(즉 확신도 1 차이 ≈ 거리 6 만큼의 값).
      // ⚠️ 후보를 먼저 거리로 거른 뒤 점수를 비교한다(교차검증 codex 2026-07-26 재현):
      // 점수부터 고르고 나중에 거리를 검사하면, 바로 옆에 쓸 만한 앵커가 있어도 멀리 있는
      // 강한 앵커가 점수로 이겨 버리고 → 그 앵커는 거리 초과로 버려져 → 결국 근거 없는
      // fallback 으로 떨어졌다. 거리 상한이 오히려 가까운 근거를 죽이는 역설.
      // 부수 효과: 후보 순회가 O(ALT_MAX_DIST)로 묶여 긴 대화(수천 턴)의 비용도 선형이 된다.
      let best = -1;
      let bestScore = -Infinity;
      for (let x = wLo; x < wHi; x++) {
        const ap = anch[x];
        const a = anchors[g[ap]]!;
        const score = a.weight * ANCHOR_WEIGHT_SCALE - Math.abs(ap - p);
        if (score > bestScore) {
          bestScore = score;
          best = ap;
        }
      }
      if (best < 0) {
        // 앵커가 없거나 너무 멀다 — 근거 없이 성별을 단정하지 않되, "두 사람이 번갈아
        // 말한다"는 사실은 살린다(미상으로 두면 재생부가 한 목소리로 폴백한다).
        if (own) {
          result[s] = own.gender;
        } else if (fallbackFirst) {
          result[s] = alternates ? (p % 2 === 0 ? fallbackFirst : flip(fallbackFirst)) : fallbackFirst;
        }
        return;
      }
      // ⚠️ 기준은 앵커의 "원래 단서 성별"이 아니라 그 앵커에 **최종 배정된 값**이다. 약한
      // 앵커는 더 강한 앵커에 의해 뒤집힐 수 있는데, 그 뒤 턴이 뒤집히기 전 값을 기준으로
      // 세면 배정이 어긋난다(실측 2026-07-26: 대화 끝 대사 1건이 반대 성별로). 턴은 위치
      // 오름차순으로 처리되므로 앞쪽 앵커의 결과는 이미 확정돼 있다.
      const gAnchor = (best < p ? result[g[best]] : null) ?? anchors[g[best]]!.gender;
      result[s] = alternates && (p - best) % 2 !== 0 ? flip(gAnchor) : gAnchor;
    });
  }
}

// Supertonic 3 화자(sid 0~9)의 성별 — F0 자기상관 실측(2026-07-20, sid_gender.py):
// 0~4 = 여(172~253Hz), 5~9 = 남(85~151Hz). Supertone 배포의 voice_styles F1~F5/M1~M5
// 명명과 일치. 배열 순서 = 대사 음성으로 고를 때의 선호 순(음색 대비가 또렷한 순).
export const SHERPA_FEMALE_SIDS = ['1', '3', '2', '4', '0'];
export const SHERPA_MALE_SIDS = ['6', '7', '8', '5', '9'];
