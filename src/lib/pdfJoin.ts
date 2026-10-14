// pdf.js 텍스트 조각 → 한 페이지 글(v1.32.1). 숨은 WebView(components/PdfExtractor.tsx) 안에서 돌기
// 때문에 **소스 문자열**로 둔다 — Hermes 는 함수 toString() 이 소스를 주지 않는다. 시험
// (__tests__/pdfJoin.test.ts)은 같은 문자열을 new Function 으로 실행한다.
//
// ⚠️ 예전(v1.0~v1.32.0)엔 조각마다 무조건 공백을 붙였다. 글자 하나하나가 조각인 PDF(크롬 인쇄·한글
// 내보내기 등)에서 「소 리 책 PDF 가 져 오 기」가 됐고 낭독이 한 글자씩 끊겼다(에뮬 실측 2026-10-14).
// 띄어쓰기는 pdf.js 가 이미 글꼴 크기 기준으로 넣어 준다(4.6.82 evaluator: 간격 0.102~0.6em 은 조각 안에
// 「 」, 더 크면 「 」 조각을 따로 — 0.102em 미만은 자간). 그래서 조각은 **그대로 잇고**, pdf.js 가 공백을
// 안 넣은 0.6em 넘는 틈(단 사이 등)에서만 안전망으로 띄운다. 간격·줄 판정은 글자 진행 방향(transform
// 의 a,b)으로 잰다 — 회전 글자에서 x 축으로 재면 틀린다(교차검증 codex·grok). 너비 0 은 실제 0(결합
// 부호 등)으로, 너비 누락만 「모름 → 옛 동작(띄움)」으로 본다.
export const PDF_JOIN_SRC = String.raw`function joinPdfItems(items){
  var out = [], line = '', prev = null;
  for (var i = 0; i < items.length; i++){
    var it = items[i] || {}, s = it.str || '', tr = it.transform || [1, 0, 0, 1, 0, 0];
    var x = tr[4] || 0, y = tr[5] || 0;
    var fs = Math.hypot(tr[2] || 0, tr[3] || 0) || it.height || 10;
    var len = Math.hypot(tr[0] || 0, tr[1] || 0);
    var dx = len ? tr[0] / len : 1, dy = len ? tr[1] / len : 0;
    // 진행 방향에 수직으로 2 넘게 떨어지면 다른 줄
    if (prev && Math.abs((x - prev.x) * -prev.dy + (y - prev.y) * prev.dx) > 2){ out.push(line); line = ''; prev = null; }
    if (s){
      if (prev && line && !/\s$/.test(line) && !/^\s/.test(s)){
        var gap = isNaN(prev.ex) ? Infinity : (x - prev.ex) * prev.dx + (y - prev.ey) * prev.dy;
        if (gap > fs * 0.6) line += ' ';
      }
      line += s;
      var w = typeof it.width === 'number' ? it.width : NaN;
      prev = { x: x, y: y, dx: dx, dy: dy, ex: x + dx * w, ey: y + dy * w };
    }
    if (it.hasEOL){ line += '\n'; prev = null; }
  }
  if (line) out.push(line);
  return out.join('\n');
}`;
