import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import {
  cacheDirectory,
  writeAsStringAsync,
  deleteAsync,
  EncodingType,
} from 'expo-file-system/legacy';
import type { TtsEngine, SpeakParams, SpeakHandlers, EngineVoice } from '../TtsEngine';
import {
  WSS_URL,
  WSS_HEADERS,
  SEC_MS_GEC_VERSION,
  TICKS_PER_MS,
  generateSecMsGec,
  connectId,
  muidCookie,
  buildSsml,
  speechConfigMessage,
  ssmlMessage,
  unescapeXml,
  bytesToBase64,
} from './protocol';
import { EDGE_VOICES, defaultEdgeVoice, resolveEdgeVoice } from './voices';
import { edgeSsmlRatePct, edgePlaybackRate } from './rate';
import { disposePlayer } from '../disposePlayer';
import { subtitlesVisible, onVisibilityChange } from '../../lib/visibility';
import { synthWaitIsNormal, SYNTH_GRACE_MS } from '../../lib/playbackWatchdog';

type Word = { text: string; offsetMs: number };
type Boundary = { ms: number; charIndex: number; charLen: number };
type Synth = { uri: string; boundaries: Boundary[] };
type SynthState = { cancelled: boolean; ws: WebSocket | null; uri: string | null };
// player: 합성 완료 시 미리 생성·prepare·배속 적용해 둔 재생기(프리로드) — 문장 전환이 play()
// 한 번으로 끝나 시작 지연이 사라진다. disposed: cancel 이후 뒤늦은 프리로드 생성 차단.
type CacheEntry = {
  promise: Promise<Synth>;
  cancel: () => void;
  player?: AudioPlayer;
  disposed?: boolean;
};

// 프리로드된(아직 재생 전) 플레이어 해제 — 여러 경합 지점에서 부르므로 멱등.
function releasePreload(entry: CacheEntry): void {
  const p = entry.player;
  if (!p) return;
  entry.player = undefined;
  disposePlayer(p);
}

const CONNECT_TIMEOUT_MS = 8000;
// 연결 후 합성 전체(오디오 수신 완료까지)의 상한. 기존엔 연결 타이머가 끝까지 살아 있어
// 8초 넘는 정상 합성(긴 문장·느린 망)도 "연결 시간 초과"로 오탐 종료됐다 → 단계별 타이머로 분리.
const SYNTH_TIMEOUT_MS = 25000;
// 재생 중 유닛 1 + 선행 합성 3(prefetchUnits) — 배속에서 파이프라인이 마르지 않는 깊이.
// 오프라인(sherpa)과 달리 얕게 두는 이유: Edge 는 문장마다 독립 WebSocket 연결이라(직렬 체인이
// 아님) 깊게 미리 만들면 그만큼 동시 연결이 열려 서버 부하·연결 낭비가 된다. 병목도 CPU 가
// 아니라 망 지연이라 얕은 버퍼로 충분하다.
const MAX_CACHE = 4;
// 네이티브 상태 이벤트 주기(ms). v1.32.0: 80 → 250(배터리).
// 80ms 는 PiP(작은 창) 시절 값이다 — PiP 에선 JS 타이머가 얼어 이 이벤트만이 자막을 움직였다.
// PiP 는 v1.20.2 에 폐지됐고, 지금 화면이 켜져 있을 땐 엔진의 60ms JS 폴링이 하이라이트를
// 몰며, 화면이 꺼지면 하이라이트를 아예 안 그린다. 이 이벤트가 꼭 해야 하는 일은 완료
// (didJustFinish)·오류 통지인데, 그건 주기와 무관한 상태 변화 리스너로 즉시 온다
// (expo-audio BaseAudioPlayer.onPlaybackStateChanged). 그런데 주기 루프는 이벤트마다
// 네이티브→JS 브리지를 깨운다 — 화면이 꺼진 몇 시간 동안 초당 12.5회의 헛깨움이었다.
const STATUS_UPDATE_MS = 250;
// 워치독 프로브 상수(근거는 SherpaTtsEngine 의 동명 상수 주석).
const END_EPSILON_S = 0.25;
const END_RATIO = 0.9;
const START_GRACE_MS = 8_000;
// 실제 디코더 버퍼링을 "정상 준비 중"으로 봐 주는 상한(ms). 시작 유예(START_GRACE_MS)와
// 분리한다 — 저사양 기기의 버퍼링이 8초를 넘길 수 있는데, 그걸 시작 실패로 묶으면 정상
// 재생을 끊는다(교차검증 codex CRITICAL 2026-07-29).
const BUFFER_GRACE_MS = 30_000;

// Edge(Read Aloud) 온라인 신경망 엔진. 문장 하나 = WebSocket 요청 하나(오디오+단어타이밍) →
// 파일로 받아 expo-audio 로 재생, 재생위치를 폴링해 기존 onBoundary 콜백으로 단어 하이라이트.
//
// 문장 간 딜레이 제거: prefetch(다음문장)로 재생 중 미리 합성해 캐시 → 넘어갈 때 즉시 재생.
// synthesize 는 로컬 ws 만 쓰므로(인스턴스 필드 미사용) 재생 중 다른 문장 합성이 동시에 돌 수 있다.
// playGen: speak/stop 마다 증가해, 지연된 재생 시작이 자기 세대가 아니면 무시(오디오 중첩 방지).
export class EdgeTtsEngine implements TtsEngine {
  readonly id = 'edge';
  readonly offline = false;
  // 온라인은 문장마다 WebSocket — 얕게(MAX_CACHE 보다 작게). 깊게 잡으면 동시 연결만 낭비.
  readonly prefetchUnits = 3;

  private playGen = 0;
  // 재생 전용 필드(현재 울리는 문장 하나)
  private player: AudioPlayer | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;
  private statusSub: { remove: () => void } | null = null;
  // 화면 켜짐/꺼짐 구독 해제자 — teardown 에서 반드시 끊는다(누수 시 발화마다 구독이 쌓인다).
  private visSub: (() => void) | null = null;
  private currentUri: string | null = null;
  // 현재 재생 중 오디오가 어떤 SSML 배속으로 합성됐는지 — setRate 라이브 적용 가능 판정용.
  private currentSsmlPct: string | null = null;
  // 현재 speak가 재생을 기다리는 중인 합성(아직 재생 전). teardown 시 취소해 낭비되는 WS를 끊는다.
  private pendingSynth: CacheEntry | null = null;
  // 선행 합성 캐시(key=voice|rate|lang|text)
  private cache = new Map<string, CacheEntry>();
  // 이번 발화의 재생 시작 시도 시각 — busy() 의 "준비 중" 판정 상한 기준점.
  private playStartedAt = 0;
  // 지금 기다리는 합성을 요청한 시각 — 합성 대기 상한(SYNTH_GRACE_MS) 기준점.
  private pendingSynthAt = 0;

  // ── 워치독 프로브(playbackWatchdog.ts) — sherpa 와 동일 계약 ────────
  /** 현재 재생 위치(ms). 상태 이벤트가 끊겨도 네이티브에서 직접 읽는다. */
  progressMs(): number | null {
    if (!this.player) return null;
    try {
      return Math.round((this.player.currentTime || 0) * 1000);
    } catch {
      return null;
    }
  }

  /** 정상적인 준비 상태: 합성(WebSocket 왕복) 대기 · 버퍼링 · 재생 시작 직전.
   *  근거는 SherpaTtsEngine.busy 주석과 동일(교차검증 codex 2026-07-26). */
  busy(): boolean {
    // 합성 대기에도 상한 필수 — 상한이 없으면 체인이 막힌 순간 워치독이 통째로 죽는다
    // (SherpaTtsEngine.busy 주석의 같은 결함).
    if (this.pendingSynth) return synthWaitIsNormal(this.pendingSynthAt, SYNTH_GRACE_MS);
    const p = this.player;
    if (!p) return false;
    // 시작 대기에는 상한을 둔다 — 근거는 SherpaTtsEngine.busy 주석(무한 대기 시 워치독 무력화).
    const waited = Date.now() - this.playStartedAt;
    try {
      // 버퍼링 상한은 시작 유예와 별도(근거는 SherpaTtsEngine.busy 주석 — 실제 버퍼링을
      // 정체로 오판하지 않게).
      if (p.isBuffering && waited <= BUFFER_GRACE_MS) return true;
      if (waited > START_GRACE_MS) return false;
      if (!p.playing && (p.currentTime || 0) <= 0) return true;
    } catch {
      /* 네이티브 읽기 실패 — progressMs 쪽 판정에 맡긴다 */
    }
    return false;
  }

  /** 끝까지 재생됐는데 완료 통지만 안 온 상태(TtsEngine.finishedButIdle 주석). */
  finishedButIdle(): boolean {
    const p = this.player;
    if (!p) return false;
    try {
      const dur = p.duration || 0;
      const pos = p.currentTime || 0;
      if (dur <= 0 || pos <= 0 || p.playing) return false;
      return pos >= Math.max(dur * END_RATIO, dur - END_EPSILON_S);
    } catch {
      return false;
    }
  }

  speak(text: string, params: SpeakParams, handlers: SpeakHandlers): void {
    const myGen = ++this.playGen;
    this.teardownPlayback();
    const key = this.keyOf(text, params);
    let entry = this.cache.get(key);
    if (entry) this.cache.delete(key); // 소비: 이 파일의 소유권을 재생 쪽으로 이전
    else entry = this.makeSynth(text, params);
    this.pendingSynth = entry;
    this.pendingSynthAt = Date.now();

    entry.promise.then(
      (synth) => {
        if (this.pendingSynth === entry) this.pendingSynth = null;
        if (myGen !== this.playGen) {
          releasePreload(entry);
          deleteAsync(synth.uri, { idempotent: true }).catch(() => { /* noop */ });
          return;
        }
        const preloaded = entry.player;
        entry.player = undefined; // 소유권을 재생 쪽으로 이전(이후 cancel이 건드리지 않게)
        this.playFile(synth, params, handlers, myGen, preloaded);
      },
      (err) => {
        if (this.pendingSynth === entry) this.pendingSynth = null;
        if (myGen !== this.playGen) return;
        if (String(err?.message) === 'cancelled') return;
        this.teardownPlayback();
        handlers.onError?.(err instanceof Error ? err : new Error(String(err)));
      },
    );
  }

  prefetch(text: string, params: SpeakParams): void {
    if (!cacheDirectory) return;
    const key = this.keyOf(text, params);
    if (this.cache.has(key)) return;
    const base = this.makeSynth(text, params);
    // cancel 확장: 프리로드된 플레이어까지 함께 해제(축출·정지 시 네이티브 자원 누수 방지).
    const entry: CacheEntry = {
      promise: base.promise,
      cancel: () => {
        entry.disposed = true;
        releasePreload(entry);
        base.cancel();
      },
    };
    // 실패한 선행합성은 캐시에서 즉시 제거 — 남겨두면 일시적 네트워크 오류가
    // 소비 시점의 무조건 폴백으로 굳어진다(재시도 기회 박탈). unhandled rejection 방지 겸용.
    entry.promise.catch(() => {
      if (this.cache.get(key) === entry) this.cache.delete(key);
    });
    // 프리로드: 합성이 끝나는 즉시 플레이어 생성(+prepare)·배속 적용까지 마쳐 둔다.
    // 문장 전환 때 하던 이 작업(수십~수백 ms)이 문장 시작의 "머뭇거림"이었다(2026-07-08).
    // 이 .then은 speak의 소비 .then보다 먼저 등록돼 항상 먼저 실행된다(등록 순서 보장).
    entry.promise
      .then((synth) => {
        if (entry.disposed || entry.player) return;
        try {
          const p = createAudioPlayer(synth.uri, { updateInterval: STATUS_UPDATE_MS });
          try { (p as any).shouldCorrectPitch = true; } catch { /* noop */ }
          try { p.setPlaybackRate(edgePlaybackRate(params.rate)); } catch { /* noop */ }
          // 이 콜백은 전부 동기라 disposed 체크(위)와 대입 사이에 cancel이 끼어들 수 없다.
          entry.player = p;
        } catch { /* 프리로드 실패는 무해 — 재생 시점에 새로 만든다 */ }
      })
      .catch(() => { /* 합성 실패는 위 catch가 처리 */ });
    this.cache.set(key, entry);
    this.evict();
  }

  stop(): void {
    this.playGen++;
    this.teardownPlayback();
    this.clearCache();
  }

  /** 선행 합성만 비운다(재생은 건드리지 않음) — 화자·배속이 바뀌어 옛 키의 캐시가 전부
   *  미스가 될 때 호출한다. Edge 는 sherpa 와 달리 직렬 체인이 아니라 문장별 독립 연결이라
   *  "미완료만" 구분할 실익이 없다 — 통째로 비우고 다음 prefetch 가 새 키로 다시 채운다.
   *  (교차검증 codex 2026-07-26: 이게 없어 설정에서 Edge 화자를 바꿔도 옛 음성의 선행합성이
   *   그대로 남아 refreshVoice 가 사실상 no-op 이었다.) */
  cancelPending(): void {
    this.clearCache();
  }

  // 재생 중 배속 라이브 변경. 오디오 자체가 SSML 배속을 품고 있어, 새 배속의 SSML 몫이
  // 지금 재생 중인 오디오와 같을 때만(예: 2.0→2.5, 둘 다 "+100%") 스트레치 몫만 바꿔 끼운다.
  // 다르면 false — 호출부가 재발화로 폴백. 단어 경계는 오디오 타임라인 기준이라 영향 없음.
  setRate(rate: number): boolean {
    if (!this.player || this.currentSsmlPct === null) return false;
    if (this.currentSsmlPct !== edgeSsmlRatePct(rate)) return false;
    try {
      this.player.setPlaybackRate(edgePlaybackRate(rate));
      return true;
    } catch {
      return false;
    }
  }

  async getVoices(): Promise<EngineVoice[]> {
    return EDGE_VOICES;
  }

  // 배속 매핑: 재생속도(피치 보정) 우선, 초과분만 SSML — 분담 로직은 rate.ts(순수 함수, 테스트 있음).
  // 단어 타이밍은 SSML 타임라인 기준이라 재생속도를 얹어도 currentTime(미디어 위치)과 그대로 일치한다.

  // ── 캐시/합성 라이프사이클 ─────────────────────────────
  private keyOf(text: string, params: SpeakParams): string {
    const voice = params.voiceId || defaultEdgeVoice(params.language);
    return `${voice}\u0000${edgeSsmlRatePct(params.rate)}\u0000${params.language || 'ko-KR'}\u0000${text}`;
  }

  private makeSynth(text: string, params: SpeakParams): CacheEntry {
    const state: SynthState = { cancelled: false, ws: null, uri: null };
    const cancel = () => {
      state.cancelled = true;
      if (state.ws) {
        try { state.ws.onopen = null; state.ws.onmessage = null; state.ws.onerror = null; state.ws.onclose = null; state.ws.close(); } catch { /* noop */ }
        state.ws = null;
      }
      if (state.uri) { const u = state.uri; state.uri = null; deleteAsync(u, { idempotent: true }).catch(() => { /* noop */ }); }
    };
    return { promise: this.synthesize(text, params, state), cancel };
  }

  private evict(): void {
    while (this.cache.size > MAX_CACHE) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      const e = this.cache.get(oldest);
      this.cache.delete(oldest);
      e?.cancel();
    }
  }

  private clearCache(): void {
    for (const e of this.cache.values()) e.cancel();
    this.cache.clear();
  }

  private teardownPlayback(): void {
    // 아직 재생 안 된 진행 중 합성이 있으면 취소(WS 즉시 종료, 낭비 방지).
    if (this.pendingSynth) { this.pendingSynth.cancel(); this.pendingSynth = null; }
    if (this.poll) { clearInterval(this.poll); this.poll = null; }
    if (this.visSub) { try { this.visSub(); } catch { /* noop */ } this.visSub = null; }
    if (this.statusSub) { try { this.statusSub.remove(); } catch { /* noop */ } this.statusSub = null; }
    if (this.player) { const p = this.player; this.player = null; disposePlayer(p); }
    this.currentSsmlPct = null;
    if (this.currentUri) { const u = this.currentUri; this.currentUri = null; deleteAsync(u, { idempotent: true }).catch(() => { /* noop */ }); }
  }

  private mapBoundaries(text: string, words: Word[]): Boundary[] {
    let cursor = 0;
    const out: Boundary[] = [];
    for (const w of words) {
      const t = unescapeXml(w.text);
      if (!t) { out.push({ ms: w.offsetMs, charIndex: cursor, charLen: 0 }); continue; }
      const idx = text.indexOf(t, cursor);
      if (idx >= 0) { cursor = idx + t.length; out.push({ ms: w.offsetMs, charIndex: idx, charLen: t.length }); }
      else out.push({ ms: w.offsetMs, charIndex: cursor, charLen: 0 });
    }
    return out;
  }

  // 문장 → (오디오 파일 + 단어 경계). 로컬 ws 로 자기완결(재생과 독립, 동시 실행 가능).
  private async synthesize(text: string, params: SpeakParams, state: SynthState): Promise<Synth> {
    const voiceId = params.voiceId || defaultEdgeVoice(params.language);
    const { voice, pitch } = resolveEdgeVoice(voiceId); // 가상 음성(#child 등)은 기본음성+pitch 변조로 해석
    const ssml = buildSsml(text, voice, params.language || 'ko-KR', edgeSsmlRatePct(params.rate), pitch);
    const reqId = connectId();
    const token = await generateSecMsGec();
    if (state.cancelled) throw new Error('cancelled');

    const audioChunks: Uint8Array[] = [];
    const words: Word[] = [];

    return await new Promise<Synth>((resolve, reject) => {
      const url =
        `${WSS_URL}&ConnectionId=${connectId()}` +
        `&Sec-MS-GEC=${token}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;
      const headers = { ...WSS_HEADERS, Cookie: muidCookie() };
      const ws = new (WebSocket as any)(url, undefined, { headers }) as WebSocket;
      (ws as any).binaryType = 'arraybuffer';
      state.ws = ws;

      let settled = false;
      let timer = setTimeout(() => done(new Error('Edge TTS 연결 시간 초과')), CONNECT_TIMEOUT_MS);
      const done = (err: Error | null, synth?: Synth) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (state.ws === ws) state.ws = null;
        try { ws.onopen = null; ws.onmessage = null; ws.onerror = null; ws.onclose = null; ws.close(); } catch { /* noop */ }
        if (err) reject(err); else resolve(synth as Synth);
      };

      ws.onopen = () => {
        if (state.cancelled) { done(new Error('cancelled')); return; }
        // 연결 성사 → 연결 타이머를 합성 전체 타이머로 교체.
        clearTimeout(timer);
        timer = setTimeout(() => done(new Error('Edge TTS 합성 시간 초과')), SYNTH_TIMEOUT_MS);
        try { ws.send(speechConfigMessage()); ws.send(ssmlMessage(reqId, ssml)); }
        catch (e) { done(e instanceof Error ? e : new Error(String(e))); }
      };
      ws.onerror = () => done(new Error('Edge TTS WebSocket 오류'));
      ws.onclose = () => done(new Error('Edge TTS 연결이 조기 종료됨'));
      ws.onmessage = (ev: any) => {
        if (state.cancelled) { done(new Error('cancelled')); return; }
        const data = ev.data;
        if (typeof data === 'string') {
          const sep = data.indexOf('\r\n\r\n');
          if (sep < 0) return;
          const header = data.slice(0, sep);
          const body = data.slice(sep + 4);
          if (header.includes('Path:audio.metadata')) {
            try {
              const meta = JSON.parse(body);
              for (const m of meta.Metadata || []) {
                if (m.Type === 'WordBoundary' && m.Data) {
                  words.push({ text: String(m.Data.text?.Text ?? ''), offsetMs: (m.Data.Offset ?? 0) / TICKS_PER_MS });
                }
              }
            } catch { /* 메타 파싱 실패는 무시 */ }
          } else if (header.includes('Path:turn.end')) {
            // 정상 종료 확정. finalizeSynth(비동기 파일쓰기)가 도는 동안 서버가 소켓을 닫아도
            // onclose가 "조기 종료" 에러로 먼저 settle해 정상 결과를 버리는 race를 차단한다.
            ws.onclose = null;
            ws.onerror = null;
            this.finalizeSynth(text, audioChunks, words, state).then(
              (synth) => done(null, synth),
              (e) => done(e instanceof Error ? e : new Error(String(e))),
            );
          }
        } else {
          // 바이너리 프레임 파싱 — malformed 프레임이 핸들러 내부에서 uncaught 예외로 새지 않게 가드.
          try {
            const buf: ArrayBuffer = data;
            if (!buf || buf.byteLength < 2) return;
            const view = new DataView(buf);
            const headerLen = view.getUint16(0, false);
            if (2 + headerLen > buf.byteLength) return;
            const headerBytes = new Uint8Array(buf, 2, headerLen);
            let hs = '';
            for (let i = 0; i < headerBytes.length; i++) hs += String.fromCharCode(headerBytes[i]);
            if (!hs.includes('Path:audio')) return;
            const audio = new Uint8Array(buf, 2 + headerLen);
            if (audio.byteLength > 0) audioChunks.push(new Uint8Array(audio));
          } catch (e) {
            done(e instanceof Error ? e : new Error(String(e)));
          }
        }
      };
    });
  }

  private async finalizeSynth(
    text: string,
    audioChunks: Uint8Array[],
    words: Word[],
    state: SynthState,
  ): Promise<Synth> {
    const total = audioChunks.reduce((n, c) => n + c.byteLength, 0);
    if (total === 0) throw new Error('Edge TTS 오디오 수신 실패');
    const merged = new Uint8Array(total);
    let off = 0;
    for (const c of audioChunks) { merged.set(c, off); off += c.byteLength; }
    const dir = cacheDirectory || '';
    const uri = `${dir}edge-${connectId()}.mp3`;
    await writeAsStringAsync(uri, bytesToBase64(merged), { encoding: EncodingType.Base64 });
    if (state.cancelled) { deleteAsync(uri, { idempotent: true }).catch(() => { /* noop */ }); throw new Error('cancelled'); }
    state.uri = uri;
    return { uri, boundaries: this.mapBoundaries(text, words) };
  }

  private playFile(
    synth: Synth,
    params: SpeakParams,
    handlers: SpeakHandlers,
    myGen: number,
    preloaded?: AudioPlayer,
  ): void {
    try {
      this.playStartedAt = Date.now();
      this.currentUri = synth.uri;
      this.currentSsmlPct = edgeSsmlRatePct(params.rate);
      const boundaries = synth.boundaries;
      let bi = 0;

      // 프리로드된 플레이어가 있으면 그대로 재생(생성·prepare 생략 → 문장 시작 즉시).
      const player = preloaded ?? createAudioPlayer(synth.uri, { updateInterval: STATUS_UPDATE_MS });
      this.player = player;
      try { (player as any).shouldCorrectPitch = true; } catch { /* noop */ }
      // 배속은 항상 재적용(프리로드 시점과 설정이 달라졌을 수 있음 — 1 로 되돌리는 경우 포함).
      try { player.setPlaybackRate(edgePlaybackRate(params.rate)); } catch { /* noop */ }

      // 하이라이트 전진 — JS 타이머(포그라운드, 60ms)와 네이티브 상태 이벤트(PiP에서도 도착)
      // 양쪽에서 부른다. bi 단조 증가라 두 경로가 겹쳐도 중복 없음.
      // 화면이 꺼져 있으면 커서만 조용히 밀고 onBoundary(→ 리렌더)는 생략 — 배터리
      // (visibility.ts, sherpa 엔진과 동일 방침 2026-07-14).
      const advance = (ms: number) => {
        const notify = subtitlesVisible();
        while (bi < boundaries.length && boundaries[bi].ms <= ms) {
          if (notify) handlers.onBoundary?.(boundaries[bi].charIndex, boundaries[bi].charLen);
          bi++;
        }
      };

      // 화면 복귀 시 하이라이트를 "지금 읽는 단어"로 즉시 되돌린다. advance() 만으로는 안 된다 —
      // 화면이 꺼진 동안에도 커서(bi)는 전진했으므로 복귀 시엔 이미 현재 위치를 통과해 있어
      // onBoundary 가 한 번도 안 불린다(교차검증 발견 2026-07-14).
      const resync = () => {
        if (bi > 0 && bi <= boundaries.length) {
          const b = boundaries[bi - 1];
          handlers.onBoundary?.(b.charIndex, b.charLen);
        }
      };

      this.statusSub = player.addListener('playbackStatusUpdate', (st: any) => {
        if (myGen !== this.playGen || this.player !== player) return;
        if (st?.error) { this.teardownPlayback(); handlers.onError?.(new Error('Edge TTS 재생 오류')); return; }
        advance((st?.currentTime || 0) * 1000);
        if (st?.didJustFinish) {
          // 화면이 꺼져 있으면 커서만 밀고 통지는 생략(보이지 않는 자막의 몰아치기 리렌더 방지).
          const notify = subtitlesVisible();
          while (bi < boundaries.length) {
            if (notify) handlers.onBoundary?.(boundaries[bi].charIndex, boundaries[bi].charLen);
            bi++;
          }
          this.teardownPlayback();
          handlers.onDone?.();
        }
      });

      // 폴링 타이머는 자막이 보일 때만(화면 꺼짐 = CPU 를 60ms 마다 깨울 이유가 없다).
      const startPoll = () => {
        if (this.poll) return;
        this.poll = setInterval(() => {
          if (myGen !== this.playGen || this.player !== player) return;
          advance((player.currentTime || 0) * 1000);
        }, 60);
      };
      const stopPoll = () => {
        if (!this.poll) return;
        clearInterval(this.poll);
        this.poll = null;
      };
      this.visSub = onVisibilityChange((visible) => {
        if (myGen !== this.playGen || this.player !== player) return;
        if (visible) {
          advance((player.currentTime || 0) * 1000); // 복귀 즉시 위치 맞춤
          resync();
          startPoll();
        } else {
          stopPoll();
        }
      });
      if (subtitlesVisible()) startPoll();

      player.play();
    } catch (e) {
      // createAudioPlayer/리스너/play 실패 시 자원 정리 + 폴백 유도.
      this.teardownPlayback();
      handlers.onError?.(e instanceof Error ? e : new Error(String(e)));
    }
  }
}

export const edgeEngine = new EdgeTtsEngine();
