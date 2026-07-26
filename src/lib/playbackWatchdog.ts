// 화면 꺼짐 낭독의 최후 안전망(v1.28.0 — 사용자 보고 2026-07-26 "화면을 껐을 때 소리가
// 안 나는 경우가 있다").
//
// 문제의 구조: 화면이 꺼지면 배터리를 위해 60ms 폴링 타이머를 끈다(visibility.ts). 그때부터
// 낭독을 다음 단위로 전진시키는 동력은 **네이티브 오디오의 didJustFinish 이벤트 하나뿐**이다
// — 재생 엔진(sherpa/Edge)과 문장 사이 쉼(gapPlayer) 세 곳 전부. 그 이벤트가 한 번이라도
// 유실되거나(플레이어가 조용히 죽음·OS 가 세션을 회수) 늦게 오면 낭독은 그 자리에서 영구히
// 멈춘다. 복구 경로가 없어 사용자는 앱을 열어 다시 재생해야 한다.
//
// 해법: mediaSession 의 앵커 플레이어(무음 루프)는 재생 내내 돌고 그 상태 이벤트는 화면
// 꺼짐에서도 도착한다 — 애초에 프로세스 동결을 막으려고 두는 것이다. 그 이벤트를 시계 삼아
// "재생 위치가 전진하고 있는가"를 감시하고, 멈춰 있으면 호출부가 복구하게 한다.
//
// 오발동 방지: 합성 대기(캐시 미스 시 수 초~수십 초)는 정상적인 "준비 중"이므로 정체로 세지
// 않는다 — 엔진의 busy() 가 그 구간을 알려준다. 임계(STALL_MS)는 문장 사이 쉼의 최대치
// (gapPlayer GAP_MAX_MS 1.5초)보다 한참 길게 잡아, 정상 낭독에서는 절대 발동하지 않는다.

/** 이만큼 재생 위치가 전진하지 않고 합성 중도 아니면 정체로 본다. */
const STALL_MS = 12_000;

type Probe = { progressMs: () => number | null; busy: () => boolean };

let probe: Probe | null = null;
let onStall: (() => void) | null = null;
let lastPos: number | null = null;
let lastChange = 0;

/** 재생 시작 시 무장. 이후 tickWatchdog 이 정체를 감시한다. */
export function armWatchdog(p: Probe, cb: () => void): void {
  probe = p;
  onStall = cb;
  lastPos = null;
  lastChange = Date.now();
}

/** 일시정지·정지 시 해제(정지 상태를 정체로 오인하지 않게). */
export function disarmWatchdog(): void {
  probe = null;
  onStall = null;
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
