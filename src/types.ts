export type DocFormat = 'txt' | 'pdf' | 'epub' | 'html' | 'md';

// TTS 엔진 식별자 — settings/tts 레지스트리 공용(중복 선언 방지의 단일 정본).
export type EngineId = 'system' | 'edge' | 'sherpa';

export type Doc = {
  id: string;
  title: string;
  format: DocFormat;
  createdAt: number;
  sentenceCount: number;
  progress: number;      // 0..1 (마지막 읽던 문장 비율)
  lastIndex: number;     // 마지막 읽던 문장 인덱스
  lastOpenedAt?: number; // 마지막으로 들은 시각(v1.32.0 — 서재 "이어 듣기"·최근순 정렬)
  charCount?: number;    // 본문 글자 수(공백 제외, v1.32.0 — 남은 시간 추정). 구문서는 첫 열기 때 채움
  // 본문은 별도 파일(documentDirectory/docs/<id>.json)에 저장 — 목록 로딩을 가볍게.
};

export type DocBody = {
  id: string;
  sentences: string[];
};
