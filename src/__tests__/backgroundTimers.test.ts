import fs from 'fs';
import path from 'path';

// 🔴 백그라운드에서 JS 타이머는 죽는다 — 재생 진행을 타이머에 걸지 말 것.
//
// React Native 는 액티비티가 pause 되면 JS 타이머를 모는 choreographer 프레임 콜백을
// 떼어낸다(logcat `ReactHost{0}.onHostPause()`). 화면 끄기·홈·다른 앱 전환이 전부 pause 다.
// 그래서 setTimeout/setInterval 안에 있는 코드는 **앱이 화면에서 사라진 순간부터 실행되지
// 않는다**. 네이티브 콜백(playbackStatusUpdate)과 Promise 는 정상 동작한다.
//
// 이 함정에 이 코드베이스는 두 번 빠졌다:
//   v1.23.0 문장 간 쉼을 setTimeout 으로 → 화면 끄면 다음 문장이 안 옴 (gapPlayer.ts 로 해결)
//   v1.29.0 까지 재생 시작을 setTimeout(…,24ms) 으로 → 캐시 미스 문장의 play() 가 영영 안 옴
//           (실기기 실측 2026-07-29: dumpsys audio 에 플레이어가 `state:idle` 로 남음)
// 두 번째가 사용자가 몇 달간 겪은 "화면 끄면 낭독 중지"의 진범이었다. 세 번째가 없도록 잠근다.

const SRC = path.join(__dirname, '..');
const PLAYBACK_FILES = [
  'tts/sherpa/SherpaTtsEngine.ts',
  'tts/edge/EdgeTtsEngine.ts',
  'store/player.ts',
  'lib/gapPlayer.ts',
  'lib/mediaSession.ts',
];

/** 코드에서 주석·문자열을 걷어낸다(주석 속 `player.play()` 설명이 오탐이 되지 않게). */
function stripCommentsAndStrings(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

/** setTimeout/setInterval 콜백 본문을 괄호 균형으로 잘라 낸다. */
function timerBodies(code: string): string[] {
  const out: string[] = [];
  const re = /\bset(?:Timeout|Interval)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < code.length && depth > 0) {
      const c = code[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      i++;
    }
    out.push(code.slice(re.lastIndex, i - 1));
  }
  return out;
}

describe('백그라운드 안전성: 재생 진행을 JS 타이머에 걸지 않는다', () => {
  for (const rel of PLAYBACK_FILES) {
    const file = path.join(SRC, rel);
    if (!fs.existsSync(file)) continue;

    test(`${rel} — 타이머 콜백 안에서 재생을 시작하지 않는다`, () => {
      const code = stripCommentsAndStrings(fs.readFileSync(file, 'utf8'));
      const offenders = timerBodies(code).filter((b) => /\.play\s*\(/.test(b));
      // 실패 시 어느 콜백인지 바로 보이도록 본문 앞부분을 함께 띄운다.
      expect(offenders.map((b) => b.slice(0, 160).trim())).toEqual([]);
    });
  }

  test('폐지된 재생 지연 상수가 되살아나지 않았다', () => {
    const code = fs.readFileSync(path.join(SRC, 'tts/sherpa/SherpaTtsEngine.ts'), 'utf8');
    const live = stripCommentsAndStrings(code);
    expect(live).not.toMatch(/PLAY_DEFER_MS/);
  });

  // 문장 간 쉼도 같은 이유로 오디오여야 한다(v1.23.0 회귀의 교훈).
  test('문장 간 쉼은 타이머가 아니라 무음 오디오로 잰다', () => {
    const gap = fs.readFileSync(path.join(SRC, 'lib/gapPlayer.ts'), 'utf8');
    expect(stripCommentsAndStrings(gap)).not.toMatch(/\bsetTimeout\b/);
  });
});
