describe('guessDialogueGender — 대사 화자 성별 추정(v1.25.1)', () => {
  const { guessDialogueGender, SHERPA_FEMALE_SIDS, SHERPA_MALE_SIDS } = require('../lib/speakerGender');
  test('지문의 남성 단서', () => {
    expect(guessDialogueGender('"가자." 그가 말했다.')).toBe('male');
    expect(guessDialogueGender('"멈춰!" 사내가 소리쳤다.')).toBe('male');
    expect(guessDialogueGender('"밥 먹었니?" 아버지가 물었다.')).toBe('male');
    expect(guessDialogueGender('“알겠습니다.” 청년이 고개를 숙였다.')).toBe('male');
  });
  test('지문의 여성 단서', () => {
    expect(guessDialogueGender('"싫어." 그녀가 속삭였다.')).toBe('female');
    expect(guessDialogueGender('"어서 오렴." 어머니가 웃었다.')).toBe('female');
    expect(guessDialogueGender('"조심하거라." 할머니는 손을 흔들었다.')).toBe('female');
  });
  test('판별 불가 → null(중립 대비 폴백)', () => {
    expect(guessDialogueGender('"왔니?" "응."')).toBeNull(); // 지문 없음
    expect(guessDialogueGender('"응." 지수가 답했다.')).toBeNull(); // 이름만
    // 주격 조사 제약 도입(codex 반영) 후 "어머니에게"(청자)는 단서에서 제외돼 화자(그가)만
    // 남는다 — 구 스펙(양쪽 단서 → null)보다 정확해진 케이스.
    expect(guessDialogueGender('"그래." 그가 어머니에게 말했다.')).toBe('male');
    // v1.27.0: 두 주어가 있어도 "발화 동사 직전의 가장 가까운 단서"가 화자다 —
    // "그가 말하자 그녀가 웃었다"에서 대사를 한 사람은 그. (구 스펙은 null=중립 폴백)
    expect(guessDialogueGender('"그래." 그가 말하자 그녀가 웃었다.')).toBe('male');
    // 발화 동사가 없으면 여전히 판별 불가(넘겨짚지 않는다).
    expect(guessDialogueGender('"그래." 그가 일어서자 그녀가 웃었다.')).toBeNull();
  });
  test('함정: 대사 안의 단서·지시어 "그날"은 무시', () => {
    expect(guessDialogueGender('"그녀가 왔다고?" 라고 외치는 소리가 들렸다.')).toBeNull();
    expect(guessDialogueGender('"좋아." 그날따라 목소리가 낮았다.')).toBeNull();
  });
  test('sid 성별 상수: 겹침 없이 0~9 전부, 실측 구획(0~4 여/5~9 남)', () => {
    const all = [...SHERPA_FEMALE_SIDS, ...SHERPA_MALE_SIDS].sort();
    expect(all).toEqual(['0','1','2','3','4','5','6','7','8','9']);
    expect(SHERPA_FEMALE_SIDS.every((s: string) => Number(s) <= 4)).toBe(true);
    expect(SHERPA_MALE_SIDS.every((s: string) => Number(s) >= 5)).toBe(true);
  });
});

describe('따옴표 누출 방지(교차검증 Gemini CONFIRMED)', () => {
  const { guessDialogueGender } = require('../lib/speakerGender');
  test('홑따옴표(생각)·겹낫표(제목) 안의 단서는 무시', () => {
    expect(guessDialogueGender("'그녀를 봤어?' 하고 물었다.")).toBeNull();
    expect(guessDialogueGender('『그녀의 정원』을 읽으며 사내가 말했다.')).toBe('male');
  });
});

describe('주격 조사 제약(교차검증 codex CONFIRMED)', () => {
  const { guessDialogueGender } = require('../lib/speakerGender');
  test('여격(청자)·서술어 꼴은 화자 단서 아님', () => {
    expect(guessDialogueGender('"안녕." 철수가 그녀에게 말했다.')).toBeNull();
    expect(guessDialogueGender('"좋아." 그날따라 여자였다.')).toBeNull();
  });
  // v1.27.0 스펙 변경: 관형(소유격)이라도 "뒤에 발화 명사가 오면" 화자 표지로 인정한다 —
  // "어머니의 목소리가 들렸다"의 화자는 어머니다(구 스펙은 통째로 버려 중립 폴백).
  // 발화 명사가 아니면 종전대로 단서 아님("어머니의 손을 잡았다" = 화자 아님).
  test('소유격 + 발화 명사는 화자 표지(v1.27.0)', () => {
    expect(guessDialogueGender('"응." 어머니의 목소리가 들렸다.')).toBe('female');
    expect(guessDialogueGender('"가자." 사내의 말이 짧았다.')).toBe('male');
    expect(guessDialogueGender('"응." 그는 어머니의 손을 잡았다.')).toBe('male');
  });
  test('주격 단서는 계속 인식', () => {
    expect(guessDialogueGender('"안녕." 그녀가 손을 흔들었다.')).toBe('female');
    expect(guessDialogueGender('"가자." 사내는 앞장섰다.')).toBe('male');
  });
});

describe('guessDialogueGenders — 2패스 인접 문장 단서(v1.25.3)', () => {
  const { guessDialogueGenders } = require('../lib/speakerGender');
  test('화자 소개(앞 지문) → 이어지는 통짜 대사에 전파', () => {
    const g = guessDialogueGenders(['사내가 입을 열었다.', '"오랜만이군."']);
    expect(g[1]).toBe('male');
  });
  test('꼬리표 후행(다음 지문) 전파', () => {
    const g = guessDialogueGenders(['"어서 오렴."', '어머니는 문을 열어 주었다.']);
    expect(g[0]).toBe('female');
  });
  test('연속 대화 구간은 앵커에서 교대 전파(v1.27.1 — 구 "확장 금지"의 완화)', () => {
    const g = guessDialogueGenders(['사내가 물었다.', '"왔나?"', '"네."', '"앉게."']);
    expect(g[1]).toBe('male'); // 소개 직후(앵커)
    expect(g[2]).toBe('female'); // 교대: 상대 화자 = 반대 성별(대비 확보)
    expect(g[3]).toBe('male'); // 다시 첫 화자
  });
  test('자기 문장 단서가 항상 우선', () => {
    const g = guessDialogueGenders(['사내가 말했다.', '"그래." 그녀가 답했다.']);
    expect(g[1]).toBe('female');
  });
});

describe('탐색 창 2문장(v1.27.0)', () => {
  const { guessDialogueGenders } = require('../lib/speakerGender');
  test('화자 소개와 대사 사이에 지문이 한 줄 더 껴도 이어받는다', () => {
    const s = ['사내가 문을 열었다.', '잠시 망설였다.', '"누구요?"'];
    expect(guessDialogueGenders(s)[2]).toBe('male');
  });
  test('창 밖(3문장 이상 떨어짐)이면 넘겨짚지 않는다', () => {
    const s = ['사내가 문을 열었다.', '잠시 망설였다.', '바람이 불었다.', '"누구요?"'];
    expect(guessDialogueGenders(s)[3]).toBeNull();
  });
  test('중간에 다른 대사가 끼면 지문 전파는 중단, 대신 교대 전파가 채운다(v1.27.1)', () => {
    const s = ['사내가 문을 열었다.', '"거기 누구요?"', '"저예요."'];
    expect(guessDialogueGenders(s)[2]).toBe('female'); // 앵커(male)의 교대
  });
});

describe('대화 런 교대 전파(v1.27.1) — "거의 다 남자 목소리" 보고의 해소', () => {
  const { guessDialogueGenders } = require('../lib/speakerGender');
  test('앵커 없는 런은 그대로(무근거 넘겨짚기 금지 유지)', () => {
    const g = guessDialogueGenders(['"왔나?"', '"네."', '"앉게."']);
    expect(g).toEqual([null, null, null]);
  });
  test('자체 단서 앵커가 런 중간에 있어도 양쪽으로 교대', () => {
    const g = guessDialogueGenders(['"먼저 말하지."', '"그래." 그녀가 답했다.', '"고맙군."']);
    expect(g[1]).toBe('female');
    expect(g[0]).toBe('male');
    expect(g[2]).toBe('male');
  });
  // v1.28.0: "패리티 모순이면 런 전체를 미상으로 버린다"는 v1.27 방침을 폐기했다 — 미상은
  // 재생부에서 "기본 화자의 반대 성별" 하나로 폴백되므로, 버리는 것이 곧 한 목소리로
  // 뭉개는 것이었다(이 버그의 본체). 대신 교대 가정만 끄고 가장 가까운 앵커의 성별을
  // 유지한다: 같은 화자가 이어 말하는 장면에서 그 화자를 계속 쓰는 쪽이 실제로 맞다.
  test('같은 화자 연속 발화가 확인되면 교대를 끄고 그 화자를 유지한다', () => {
    const g = guessDialogueGenders([
      '"하나." 사내가 말했다.',
      '"둘." 사내가 말했다.', // 인접 앵커가 같은 성별 = 교대 관행 밖
      '"셋."',
    ]);
    expect(g[0]).toBe('male');
    expect(g[1]).toBe('male');
    expect(g[2]).toBe('male'); // 세던 사람이 계속 센다
  });
  test('꼬리표 후행 앵커(런 끝 지문 단서)에서도 역방향 교대', () => {
    const g = guessDialogueGenders(['"들어가도 될까?"', '"어서 오렴."', '어머니는 문을 열어 주었다.']);
    expect(g[1]).toBe('female'); // 기존 후행 전파
    expect(g[0]).toBe('male'); // 교대
  });
  // v1.28.0: 문단(빈 줄) 경계를 대화 종료 신호로 쓰던 v1.27 가드는 폐기됐다. 실측
  // 2026-07-26 — 대화 턴마다 빈 줄을 넣는 조판(전자책·인터넷 연재에 흔함)에서 그 가드가
  // 모든 대사를 고립시켜 13개 중 12개가 미상 = 전부 한 목소리가 됐다(사용자 보고). 대화가
  // 끊겼다는 실질 신호는 문단이 아니라 "사이에 낀 지문의 길이"다(NARR_GAP_MAX).
  test('빈 줄 문단 경계는 대화를 끊지 않는다(v1.28.0 방침 전환)', () => {
    const s = ['사내가 물었다.', '"왔나?"', '"네."', '"여긴 어디지?"'];
    const g = guessDialogueGenders(s, new Set([3]));
    expect(g[1]).toBe('male');
    expect(g[2]).toBe('female');
    expect(g[3]).toBe('male'); // 교대가 이어진다
  });
  test('긴 지문(NARR_GAP_MAX 초과)이 끼면 대화가 끊겨 패리티가 새지 않는다', () => {
    const s = [
      '"왔나?" 사내가 물었다.',
      '"네."',
      '해가 저물었다.',
      '바람이 불었다.',
      '멀리서 종소리가 들렸다.', // 지문 3문장 = 장면 전환
      '"거기 누구요?"',
    ];
    const g = guessDialogueGenders(s);
    expect(g[0]).toBe('male');
    expect(g[1]).toBe('female');
    expect(g[5]).toBeNull(); // 새 장면 — 근거 없으면 미상(fallbackFirst 미지정 시)
  });
  test('낫표(제목)·홑따옴표(생각)만 있는 지문은 발화 턴으로 세지 않는다', () => {
    // 짧은 지문 한 줄은 대화를 끊지 않지만(위 NARR_GAP_MAX), 그 자체가 "턴"은 아니므로
    // 패리티(홀짝)를 밀지 않는다 — 밀면 이어지는 대사의 성별이 통째로 뒤집힌다.
    const g = guessDialogueGenders(['"왔나?" 사내가 물었다.', '『무림비사』가 놓여 있었다.', '"네."']);
    expect(g[0]).toBe('male');
    expect(g[2]).toBe('female'); // 사내의 물음에 답하는 상대 = 교대
  });
  test('근거 없는 런도 fallbackFirst 를 주면 교대로 채운다(미상 = 한 목소리 방지)', () => {
    const g = guessDialogueGenders(['"왔나?"', '"네."', '"앉게."'], undefined, {
      fallbackFirst: 'male',
    });
    expect(g).toEqual(['male', 'female', 'male']);
  });
});

// 교차검증(codex·Gemini 2026-07-26)이 짚은 반례들 — 교대 가정이 깨지는 실제 조판.
describe('교대 가정이 깨지는 구조(v1.28.0 교차검증 반례)', () => {
  const { guessDialogueGender, guessDialogueGenders } = require('../lib/speakerGender');

  test('부정형 발화 동사는 화자 근거가 아니다 — "말하지 않은 사람"을 화자로 세우지 않는다', () => {
    // 어간형(말하·외치·속삭이·입을 열)에 "-지 않다"가 붙은 꼴. 종전 구현은 그대로 발화
    // 동사로 잡아 **말하지 않은 사람**을 확신 앵커로 세웠다.
    expect(guessDialogueGender('"...!" 여자는 끝내 입을 열지 않았다.')?.strong).not.toBe(true);
    expect(guessDialogueGender('"그만." 그는 더 말하지 않았다.')?.strong).not.toBe(true);
    expect(guessDialogueGender('"제발." 그녀는 외치지 않았다.')?.strong).not.toBe(true);
  });

  test('발화 개시 동사는 앞 대사가 아니라 다음 대사의 화자를 가리킨다', () => {
    // "입을 열었다"는 발화의 시작 — 이미 끝난 대사의 꼬리표로는 쓰지 않는다.
    expect(guessDialogueGender('"기다리겠소." 한참 뒤에 여자가 입을 열었다.')).toBeNull();
    // 지문 전용 문장(대사 없음)이면 종전대로 다음 화자 소개로 유효하다.
    const g = guessDialogueGenders(['사내가 입을 열었다.', '"거기 누구요?"']);
    expect(g[1]).toBe('male');
  });

  test('동음이의 발화 동사("물다"=bite)를 단일 단서 문장에서도 확신하지 않는다', () => {
    const d = guessDialogueGender('"그래." 그녀가 사과를 베어 물었다.');
    expect(d?.strong).not.toBe(true); // 약한 힌트까지는 허용, 확신 앵커는 금지
  });

  test('3인 대화에서 오귀속이 무한정 번지지 않는다(전파 거리 상한)', () => {
    // 확신 앵커에서 ALT_MAX_DIST(8턴)를 넘으면 교대 전파를 신뢰하지 않는다.
    const s = ['"하나." 사내가 말했다.'];
    for (let i = 0; i < 14; i++) s.push(`"대사 ${i}."`);
    const g = guessDialogueGenders(s, undefined, { fallbackFirst: 'female' });
    // 앵커 근처는 앵커 기준 교대
    expect(g[1]).toBe('female');
    expect(g[2]).toBe('male');
    // 멀리 떨어진 턴은 앵커가 아니라 fallback 교대(= 근거 없음을 인정한 배정)
    expect(g[12]).toBe('female');
  });

  test('편지 인용처럼 같은 사람의 연속 인용이 이어져도 배정이 붕괴하지 않는다', () => {
    const g = guessDialogueGenders(
      [
        '그는 편지를 펼쳤다.',
        '"보고 싶은 사람에게."',
        '"잘 지내고 있는지 궁금하다."',
        '"너를 다시 만나길 바라며."',
      ],
      undefined,
      { fallbackFirst: 'female' },
    );
    // 한계 인정: 텍스트만으로 인용과 대화를 못 가르므로 교대가 걸린다. 최소한 배정이
    // 결정론적이고(재생마다 흔들리지 않고) 첫 줄은 화자 소개 지문을 따른다.
    expect(g[1]).toBe('male');
    expect(g.slice(1).every((v: unknown) => v !== null)).toBe(true);
  });
});

describe('발화 동사 다중/동음이의 방어(교차검증 Gemini 재현 2026-07-21)', () => {
  const { guessDialogueGender, guessDialogueGenders } = require('../lib/speakerGender');
  // v1.28.0: 종전엔 "물었"(bite)을 발화 동사로 잘못 세어 동사가 2개가 되고, 그 모호함 덕에
  // null 로 빠졌다("우연히 안 틀린" 상태). 이제 목적어 문맥으로 bite 를 걸러내므로 남는
  // 발화 동사는 "말했다" 하나뿐 — 그 앞의 화자를 정확히 집는다.
  test('"물다(bite)"는 발화 동사가 아니다 — 진짜 화자("~가 말했다")를 집는다', () => {
    expect(guessDialogueGender('"그래." 그녀가 사과를 베어 물었고 그가 말했다.')).toBe('male');
    expect(guessDialogueGender('"그래." 그가 사과를 베어 물었고 그녀가 말했다.')).toBe('female');
  });
  test('종속절+주절에 발화 동사가 둘이면 null', () => {
    expect(guessDialogueGender('"응." 어머니가 말하자 그가 물었다.')).toBeNull();
  });
  test('발화 동사가 하나면 종전대로 최근접 단서 채택', () => {
    expect(guessDialogueGender('"그래." 그가 어머니에게 말했다.')).toBe('male');
  });
  // v1.28.0: 장면 서술 뒤 첫 대사는 "화자 소개" 관행이라 문단이 갈려도 단서를 쓴다
  // (그 지문 앞에 대사가 없으므로 반응 지문일 수 없다 — anchorsFor 주석).
  test('장면 서술 뒤 첫 대사는 문단이 갈려도 그 지문을 화자로 읽는다', () => {
    const s = ['사내가 문을 열었다.', '"누구요?"'];
    expect(guessDialogueGenders(s)[1]).toBe('male');
    expect(guessDialogueGenders(s, new Set([1]))[1]).toBe('male');
  });
});
