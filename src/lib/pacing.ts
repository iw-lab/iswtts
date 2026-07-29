// 낭독 페이스 자연화(순수 함수) — 문장 사이 쉼을 사람 낭독자처럼 "문맥"에 따라 변주한다.
//
// 왜: 합성 파일에 굽는 기본 문장 간 쉼(TRAIL 320 + LEAD 40 = 360ms)은 모든 문장에서
// 정확히 동일해 메트로놈처럼 규칙적이다. 사람 낭독자는 문단이 바뀔 때 길게, 말줄임 뒤엔
// 여운 있게, 대화문 앞뒤엔 잠깐의 beat 를 두고, 긴 문장 뒤엔 숨을 회복한다(v1.23.0).
//
// 어디서: 재생 단계(player.ts 의 문장 자동진행)에서 다음 문장 발화 전 지연으로만 적용 —
// 합성·캐시를 전혀 건드리지 않아 음질 리스크 0, 파일 캐시도 그대로 유효하다.
// 수동 넘김(다음/이전 버튼·seek)에는 적용하지 않는다(사용자는 즉시 반응을 원한다).

/** 추가 쉼 상한(1× 기준, ms) — 기본 360ms 위에 얹힌다. 지터는 상한 적용 뒤에 더해져
 *  극적 조합(문단+말줄임+대화)에서도 변주가 살아 있다(최종 최대 700+50). 반환값은 배속으로
 *  나눈 뒤라 0.5× 에선 이보다 커질 수 있다(느린 청취일수록 여운도 긴 게 자연스럽다). */
const MAX_EXTRA_MS = 700;
/** 문단 전환: 장면이 바뀌는 호흡. */
const PARAGRAPH_MS = 350;
/** 말줄임(…) 뒤: 여운. */
const ELLIPSIS_MS = 250;
/** 물음/느낌표 뒤: 살짝 띄운다. */
const EXCLAIM_MS = 120;
/** 대화문 경계(닫는 인용부호로 끝나거나 여는 인용부호로 시작): 화자 전환의 beat. */
const DIALOGUE_MS = 150;
/** 긴 문장 뒤 숨 회복(글자 수 임계별). */
const LONG_SENT_MS = 150;
const MID_SENT_MS = 80;
/** 문장별 미세 변주 폭(±ms) — 결정적(텍스트 해시)이라 같은 문장 쌍은 항상 같은 쉼. */
const JITTER_MS = 50;
/** 루바토(완급 변주)로 느긋하게 읽은 문장 뒤: 사람은 느리게 읽은 직후 숨을 한 번 더
 *  고른다 — 완급(rate.ts sherpaRubato)과 쉼을 하나의 낭독 리듬으로 잇는다(v1.25.0,
 *  교차검증 제안 채택). 발동 여부는 호출부(player.ts)가 이전 문장으로 판정해 전달. */
const RUBATO_REST_MS = 60;

// 문장 꼬리의 닫는 인용부호·괄호(구두점 판정 시 벗겨낸다).
const TRAIL_QUOTES = /["'”’」』)\]）】]+$/;
const ENDS_DIALOGUE = /["'”’」』]$/;
const STARTS_DIALOGUE = /^["'“‘「『]/;
// 마침표 2개도 말줄임으로 본다(v1.27.0): 합성 정규화가 '..'도 …로 접으므로(normalizeKo ⓪)
// 여기서 3개만 인정하면 '소리는 말줄임인데 여운 쉼은 없는' 불일치가 생긴다(교차검증 지적).
// 말줄임 뒤 잔존 마침표("…….", "….")도 인정(v1.27.2) — 세로쓰기 소설 관행 표기.
// 합성 정규화(normalizeKo ⓪)가 이 꼴을 … 하나로 접으므로 여기서 빼면 '소리는
// 말줄임인데 여운 쉼·루바토는 없는' 불일치가 된다(v1.27.0 '..' 인정과 같은 근거).
const ELLIPSIS_END = /(?:(?:…|⋯|‥)\.?|\.{2,})$/;

/** 문장이 말줄임(꼬리 따옴표류 무시)으로 끝나는가 — 여운 문장 판정.
 *  쉼(sentenceGapMs 말줄임 여운)과 완급(rate.ts sherpaRubato 의 항상-감속)이 같은 판정을
 *  공유해 "말줄임 = 느긋하게 읽고 길게 쉼"이 하나의 낭독 관습으로 묶인다(v1.26.0). */
export function endsWithEllipsis(sentence: string): boolean {
  return ELLIPSIS_END.test(sentence.trim().replace(TRAIL_QUOTES, ''));
}

// djb2 문자열 해시 — 암호학적 품질 불필요, 결정성만 필요(캐시·재현성).
function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h;
}

/** 쉼을 배속으로 나눌 때 쓰는 제수. 배속에 **선형으로** 나누지 않는다(v1.29.0).
 *
 *  사람은 빨리 말할 때 조음(말소리 자체)을 크게 줄이고 쉼은 그만큼 줄이지 않는다 —
 *  빠른 낭독일수록 문장 경계의 쉼이 상대적으로 길게 남아, 그게 "빨라도 문장이 끊겨 들리는"
 *  느낌을 만든다. v1.28.0 까지는 쉼을 배속으로 그대로 나눠(350ms → 3×에서 117ms) 문장
 *  경계가 사실상 사라졌고, 고배속 낭독이 한 덩어리로 밀려나오는 벽처럼 들렸다
 *  (사용자 보고 2026-07-29 "더 사람처럼", 상시 사용 배속 2.5~3.0×).
 *
 *  지수 0.65 = 조음과 쉼의 압축률을 다르게 두는 절충. 2.5× 에서 140ms → 196ms,
 *  3.0× 에서 117ms → 173ms. 1× 는 완전히 종전과 같다(지수 무관).
 *  ⚠️ 이건 실측이 아니라 설계 판단이다 — 사람 낭독의 쉼 스케일링을 이 기기에서 잴 방법이
 *  없다. 대신 폭을 보수적으로 잡고 A/B 샘플로 청감 확인을 받는다. */
const GAP_RATE_EXP = 0.65;
function gapDivisor(rate: number): number {
  return rate <= 1 ? 1 : Math.pow(rate, GAP_RATE_EXP);
}

/**
 * 문장 자동진행 시 다음 문장 발화 전에 둘 "추가" 쉼(ms).
 * - 배속에 따라 축소하되 **선형이 아니다**(gapDivisor 주석), >3×(스마트 스피드)는 0.
 * - 결정적: 같은 (prev, next, 문단 여부, 배속)이면 항상 같은 값.
 */
export function sentenceGapMs(
  prev: string,
  next: string,
  opts: { paragraphBreak: boolean; rate: number; afterRubato?: boolean },
): number {
  const rate = opts.rate > 0 ? opts.rate : 1;
  if (rate > 3) return 0;

  let ms = 0;
  if (opts.paragraphBreak) ms += PARAGRAPH_MS;
  if (opts.afterRubato) ms += RUBATO_REST_MS;

  const tail = prev.trim().replace(TRAIL_QUOTES, '');
  if (ELLIPSIS_END.test(tail)) ms += ELLIPSIS_MS;
  else if (/[!?！？]$/.test(tail)) ms += EXCLAIM_MS;

  if (ENDS_DIALOGUE.test(prev.trim()) || STARTS_DIALOGUE.test(next.trim())) ms += DIALOGUE_MS;

  if (prev.length >= 80) ms += LONG_SENT_MS;
  else if (prev.length >= 50) ms += MID_SENT_MS;

  // 미세 변주: −JITTER..+JITTER. 특징이 하나도 없는 평문 사이도 0~+50ms 로 미세하게 흔들려
  // 메트로놈 규칙성이 사라진다(음수 합은 0 으로 클램프).
  // 상한 클램프 "뒤"에 더하는 이유: 극적 조합(문단+말줄임+대화 = 750)이 상한에서 잘리면
  // 지터까지 흡수돼 정확히 그 전환들만 다시 규칙적이 된다(교차검증 지적 2026-07-18) —
  // 최종 최대 700+50.
  const jitter = (hash(prev + '\u0000' + next) % (JITTER_MS * 2 + 1)) - JITTER_MS;

  return Math.round(Math.max(0, Math.min(MAX_EXTRA_MS, ms) + jitter) / gapDivisor(rate));
}
