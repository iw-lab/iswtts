// 화면 꺼짐 낭독의 최후 안전망(v1.28.0 — 사용자 보고 2026-07-26 "화면을 껐을 때 소리가
// 안 나는 경우가 있다").
//
// 문제의 구조: 화면이 꺼지면 배터리를 위해 60ms 폴링 타이머를 끈다(visibility.ts). 그때부터
// 낭독을 다음 단위로 전진시키는 동력은 **네이티브 오디오의 didJustFinish 이벤트 하나뿐**이다
// — 재생 엔진(sherpa/Edge)과 문장 사이 쉼(gapPlayer) 세 곳 전부. 그 이벤트가 한 번이라도
// 유실되거나(플레이어가 조용히 죽음·OS 가 세션을 회수) 늦게 오면 낭독은 그 자리에서 영구히
// 멈춘다. 복구 경로가 없어 사용자는 앱을 열어 다시 재생해야 한다.
//
// 해법: "재생 위치가 전진하고 있는가"를 주기적으로 확인하고, 멈춰 있으면 호출부가 복구하게
// 한다. 시계는 둘 — 자체 setInterval(주) + mediaSession 앵커의 상태 이벤트(보조). 둘로 둔
// 이유는 armWatchdog 주석 참조(v1.28.0 은 앵커 이벤트 하나만 썼고, 그 이벤트가 끊기는 상황이
// 곧 낭독이 죽는 상황이라 안전망이 함께 눈이 멀었다).
//
// 오발동 방지: 합성 대기(캐시 미스 시 수 초~수십 초)는 정상적인 "준비 중"이므로 정체로 세지
// 않는다 — 엔진의 busy() 가 그 구간을 알려준다. 임계(STALL_MS)는 문장 사이 쉼의 최대치
// (gapPlayer GAP_MAX_MS 1.5초)보다 한참 길게 잡아, 정상 낭독에서는 절대 발동하지 않는다.

/** 이만큼 재생 위치가 전진하지 않고 합성 중도 아니면 정체로 본다.
 *  문장 사이 쉼의 최대치(gapPlayer 1.5초)와 합성 대기(busy() 로 제외)를 빼고도 남는 여유라
 *  정상 낭독에서는 발동하지 않는다. v1.29.0: 12초 → 6초(사용자가 "멈췄다"고 느끼기 전에
 *  되살리는 쪽이 낫다 — 오발동해도 finishedButIdle 판정이 재발화 대신 전진으로 처리한다). */
const STALL_MS = 6_000;
/** 자체 시계 눈금(ms). 앵커 이벤트와 무관하게 도는 두 번째 시계 — 아래 주석 참조. */
const TICK_MS = 1_000;

type Probe = { progressMs: () => number | null; busy: () => boolean };

/** 한 발화의 합성을 "정상적인 준비 중"으로 봐 주는 상한(ms).
 *  두 엔진(sherpa·Edge)이 같은 값을 각자 들고 있다가 조용히 어긋나지 않게 여기 한 곳에 둔다
 *  (교차검증 code-reviewer 2026-07-29: 주석은 "Edge 는 더 넉넉히"라면서 값은 같았다).
 *  45초는 "느린 기기의 정상 합성"이 아니라 "체인이 죽었다"만 걸러내는 값 — 정상 자동진행은
 *  선행합성 캐시 히트라 0 에 수렴하고, 최악의 즉석 합성도 실측 수 초 수준이다. 네트워크를
 *  타는 Edge 도 45초를 넘기면 정상 대기가 아니라 고장으로 보는 게 맞다. */
export const SYNTH_GRACE_MS = 45_000;

/**
 * 엔진의 busy() 가 "합성 대기 중"을 정상으로 인정할지 판정하는 공용 술어.
 *
 * ⚠️ 이 상한이 이 안전망의 생사를 가른다. busy() 가 상한 없이 "합성 대기 중이면 true" 만
 * 돌려주면, 네이티브 합성 체인이 한 번 막힌 순간부터 워치독은 매 틱 시계를 되돌려 복구를
 * 영영 부르지 않는다 — 안전망이 켜져 있는 채로 죽는다(v1.28.0 실장 결함). 두 엔진이 같은
 * 실수를 각자 하지 않도록 판정을 여기 한 곳에 둔다.
 *
 * @param askedAt 지금 기다리는 합성을 요청한 시각(0 = 알 수 없음 → 정상으로 봐 주지 않는다)
 */
export function synthWaitIsNormal(askedAt: number, graceMs: number, now = Date.now()): boolean {
  return askedAt > 0 && now - askedAt <= graceMs;
}

let probe: Probe | null = null;
let onStall: (() => void) | null = null;
let lastPos: number | null = null;
let lastChange = 0;
let timer: ReturnType<typeof setInterval> | null = null;

/** 재생 시작 시 무장. 이후 tickWatchdog 이 정체를 감시한다. */
export function armWatchdog(p: Probe, cb: () => void): void {
  probe = p;
  onStall = cb;
  lastPos = null;
  lastChange = Date.now();
  // ⚠️ 시계를 둘로 둔다(v1.29.0). v1.28.0 은 앵커 플레이어의 상태 이벤트만을 시계로 썼는데,
  // 그 이벤트는 expo-audio 가 "재생 중일 때만" 주기 발행한다(BaseAudioPlayer.kt
  // startUpdating: `if (playing) sendStatusUpdate()`). 앵커가 멈추거나 이벤트 전달이 끊기는
  // 상황 = 낭독이 죽는 바로 그 상황이라, 안전망이 자신이 감시하려던 고장을 공유했다.
  //
  // ⚠️ 다만 이 자체 타이머가 만능은 아니다 — **JS 타이머는 프로세스가 얼면 같이 언다**.
  // 이 코드베이스의 실측이 그걸 이미 기록해 뒀다(v1.24.0 커밋: 쉼을 setTimeout 으로 걸었더니
  // 화면을 끄면 다음 문장 전환에서 영영 멈춤 — 그때 이미 미디어 포그라운드 서비스는 v1.5.0
  // 부터 돌고 있었다). 즉 FGS 가 있어도 얼었다는 뜻이고, 그건 기기 자체의 절전(웨이크락 없음)
  // 으로만 설명된다. 그 근본 원인은 patches/expo-audio 의 setWakeMode(WAKE_MODE_LOCAL) 가
  // 맡는다. 이 타이머가 커버하는 범위는 **JS 는 도는데 네이티브 이벤트만 안 오는 경우**
  // (플레이어가 조용히 죽음·리스너 유실·세션 회수)로, 앵커 이벤트 단일 의존을 끊는 게 목적이다.
  // (1초 눈금은 앵커가 이미 내는 깨움과 같은 빈도라 배터리 영향이 사실상 없다.)
  if (timer) clearInterval(timer);
  timer = setInterval(tickWatchdog, TICK_MS);
}

/** 일시정지·정지 시 해제(정지 상태를 정체로 오인하지 않게). */
export function disarmWatchdog(): void {
  probe = null;
  onStall = null;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** 진행이 있었음을 외부에서 알림(문장 전환 등) — 임계 시계를 되돌린다. */
export function noteProgress(): void {
  lastChange = Date.now();
}

/** 앵커 플레이어의 상태 이벤트마다 호출(mediaSession). */
export function tickWatchdog(): void {
  if (!probe || !onStall) return;
  const pos = probe.progressMs();
  if (pos !== null && pos !== lastPos) {
    lastPos = pos;
    lastChange = Date.now();
    return;
  }
  if (probe.busy()) {
    // 합성·준비 중 = 정상 진행. 시계만 되돌리고 넘어간다.
    lastChange = Date.now();
    return;
  }
  if (Date.now() - lastChange < STALL_MS) return;
  lastChange = Date.now(); // 복구 시도 간 최소 간격 확보(연속 발동 방지)
  onStall();
}
