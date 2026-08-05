/**
 * 섹터 자금흐름 대시보드 — 백엔드 (Google Apps Script)
 * ============================================================
 * 배포 방법
 * 1. script.google.com → 새 프로젝트 → 이 파일 내용을 Code.gs에 붙여넣기
 * 2. 프로젝트 설정(⚙️) → 스크립트 속성 → 다음 두 개 추가
 *      NAVER_CLIENT_ID     = 네이버 오픈API "검색" 애플리케이션 Client ID
 *      NAVER_CLIENT_SECRET = 같은 애플리케이션 Client Secret
 *    developers.naver.com → Application 등록 → 사용 API: "검색" 체크
 *    (뉴스 언급량 집계에만 쓰임. 비워두면 뉴스 없이 시세/수급만 동작)
 * 3. 아래 SECRET_KEY 값을 원하는 문자열로 바꾸고, 프론트(app.js 설정 모달)에도 같은 값을 입력
 * 4. 함수 목록에서 setupTrigger 선택 → 실행 (권한 승인 필요, 최초 1회)
 *    → 10분마다 refreshAll() 자동 실행 + 매일 08:00 backfillOutcomes() 실행되는 트리거 등록됨
 * 5. 배포 → 새 배포 → 유형: 웹앱 → 실행: 나 / 액세스 권한: 모든 사용자 → 배포
 *    → 생성된 웹앱 URL을 대시보드 설정(⚙️)에 입력
 *
 * 데이터는 이 스크립트가 자동 생성하는 "StockDashboard_DB" 스프레드시트에 쌓인다.
 * (스프레드시트 ID는 스크립트 속성 DB_SHEET_ID에 저장되어 있음)
 */

const SECRET_KEY = 'stockflow-2026!';
const DROP_THRESHOLD_PCT = -2.5;
const REFRESH_INTERVAL_MIN = 10;

const SECTOR_CONFIG = [
  {
    id: 'bigtech', name: '빅테크', icon: '💻', newsKeyword: '빅테크 주가',
    kr: [],
    us: [
      { symbol: 'AAPL.O', name: '애플' },
      { symbol: 'MSFT.O', name: '마이크로소프트' },
      { symbol: 'GOOGL.O', name: '알파벳' },
      { symbol: 'AMZN.O', name: '아마존' },
      { symbol: 'META.O', name: '메타' },
    ],
  },
  {
    id: 'semi', name: '반도체', icon: '🔧', newsKeyword: '반도체 업황',
    kr: [
      { code: '005930', name: '삼성전자' },
      { code: '000660', name: 'SK하이닉스' },
    ],
    us: [
      { symbol: 'NVDA.O', name: '엔비디아' },
      { symbol: 'TSM', name: 'TSMC' },
      { symbol: 'AMD.O', name: 'AMD' },
    ],
  },
  {
    id: 'software', name: '소프트웨어', icon: '🖥️', newsKeyword: '소프트웨어 업종',
    kr: [
      { code: '035420', name: '네이버' },
      { code: '035720', name: '카카오' },
    ],
    us: [
      { symbol: 'CRM', name: '세일즈포스' },
      { symbol: 'ORCL.K', name: '오라클' },
      { symbol: 'ADBE.O', name: '어도비' },
    ],
  },
  {
    id: 'finance', name: '금융', icon: '🏦', newsKeyword: '금융주 실적',
    kr: [
      { code: '105560', name: 'KB금융' },
      { code: '055550', name: '신한지주' },
      { code: '086790', name: '하나금융지주' },
    ],
    us: [
      { symbol: 'JPM', name: 'JP모건' },
      { symbol: 'BAC', name: '뱅크오브아메리카' },
    ],
  },
  {
    id: 'battery', name: '2차전지·에너지', icon: '🔋', newsKeyword: '2차전지 업황',
    kr: [
      { code: '373220', name: 'LG에너지솔루션' },
      { code: '006400', name: '삼성SDI' },
    ],
    us: [
      { symbol: 'TSLA.O', name: '테슬라' },
      { symbol: 'ENPH.O', name: '엔페이즈' },
    ],
  },
  {
    id: 'health', name: '헬스케어·바이오', icon: '🧬', newsKeyword: '제약 바이오 주가',
    kr: [
      { code: '207940', name: '삼성바이오로직스' },
      { code: '068270', name: '셀트리온' },
    ],
    us: [
      { symbol: 'LLY', name: '일라이릴리' },
      { symbol: 'UNH', name: '유나이티드헬스' },
    ],
  },
];

/* ============================================================
   진입점
   ============================================================ */

function doGet(e) {
  const params = (e && e.parameter) || {};
  if (params.key !== SECRET_KEY) return jsonOut_({ error: 'unauthorized' });

  const action = params.action || 'dashboard';
  try {
    if (action === 'ping') return jsonOut_({ ok: true, time: new Date().toISOString() });
    if (action === 'dashboard') return jsonOut_(getDashboard_());
    if (action === 'refresh') { refreshAll(); return jsonOut_(getDashboard_()); }
    return jsonOut_({ error: 'unknown action: ' + action });
  } catch (err) {
    return jsonOut_({ error: String(err) });
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ============================================================
   트리거 설정 (최초 1회 수동 실행)
   ============================================================ */

function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach((t) => {
    const fn = t.getHandlerFunction();
    if (fn === 'refreshAll' || fn === 'backfillOutcomes') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('refreshAll').timeBased().everyMinutes(REFRESH_INTERVAL_MIN).create();
  ScriptApp.newTrigger('backfillOutcomes').timeBased().everyDays(1).atHour(8).create();
  refreshAll();
}

/* ============================================================
   메인 갱신 로직 — 시세/수급/뉴스 수집 → 시트 저장 → 하락 이벤트 감지
   ============================================================ */

function refreshAll() {
  const ss = getDb_();
  const sectorSheet = getOrCreateSheet_(ss, 'SectorSnapshot', [
    'id', 'name', 'icon', 'netFlow', 'prevNetFlow', 'flowChangePct',
    'avgChangePct', 'newsVolume', 'prevNewsVolume', 'newsChangePct', 'stocksJson', 'updatedAt',
  ]);
  const prevRows = sheetToMap_(sectorSheet, 'id');

  const results = SECTOR_CONFIG.map((sec) => buildSectorSnapshot_(sec, prevRows[sec.id]));

  writeRows_(sectorSheet, results.map((r) => [
    r.id, r.name, r.icon, r.netFlow, r.prevNetFlow, r.flowChangePct, r.avgChangePct,
    r.newsVolume, r.prevNewsVolume, r.newsChangePct, JSON.stringify(r.stocks), new Date().toISOString(),
  ]));

  detectDropEvents_(ss, results);
  logDailySectorPct_(ss, results);
}

function buildSectorSnapshot_(sec, prevRow) {
  const stocks = [];
  let flowSum = 0;
  let changeSum = 0;
  let changeCount = 0;

  sec.kr.forEach((s) => {
    const rt = safeFetch_(() => fetchKrRealtime_(s.code));
    const flow = safeFetch_(() => fetchKrFlow_(s.code));
    const changePct = rt ? rt.changePct : 0;
    const flowAmt = flow ? flow.flowKrw100M : 0;
    stocks.push({ ticker: s.code, name: s.name, market: 'KR', changePct, flow: flowAmt });
    flowSum += flowAmt;
    changeSum += changePct;
    changeCount++;
  });

  sec.us.forEach((s) => {
    const rt = safeFetch_(() => fetchUsRealtime_(s.symbol));
    const changePct = rt ? rt.changePct : 0;
    stocks.push({ ticker: s.symbol.replace(/\.[A-Z]$/, ''), name: s.name, market: 'US', changePct, flow: null });
    changeSum += changePct;
    changeCount++;
  });

  const news = safeFetch_(() => fetchNewsVolume_(sec.newsKeyword)) || { count: 0 };
  const prevNetFlow = prevRow ? Number(prevRow.netFlow) || 0 : 0;
  const prevNewsVolume = prevRow ? Number(prevRow.newsVolume) || 0 : 0;

  const netFlow = flowSum;
  const avgChangePct = changeCount ? +(changeSum / changeCount).toFixed(2) : 0;
  const flowChangePct = prevNetFlow !== 0 ? clampPct_(((netFlow - prevNetFlow) / Math.abs(prevNetFlow)) * 100) : 0;
  const newsChangePct = prevNewsVolume !== 0 ? clampPct_(((news.count - prevNewsVolume) / Math.abs(prevNewsVolume)) * 100) : 0;

  return {
    id: sec.id, name: sec.name, icon: sec.icon,
    netFlow: Math.round(netFlow), prevNetFlow: Math.round(prevNetFlow), flowChangePct,
    avgChangePct, newsVolume: news.count, prevNewsVolume, newsChangePct,
    stocks,
  };
}

function clampPct_(n) {
  if (!isFinite(n)) return 0;
  return Math.max(-300, Math.min(300, +n.toFixed(1)));
}

function safeFetch_(fn) {
  try { return fn(); } catch (e) { return null; }
}

/* ============================================================
   네이버 시세 (KR: 국내 실시간 시세 / US: 해외증시 실시간 시세)
   ============================================================ */

function fetchKrRealtime_(code) {
  const url = 'https://polling.finance.naver.com/api/realtime/domestic/stock/' + code;
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const data = JSON.parse(res.getContentText());
  const item = data.datas && data.datas[0];
  if (!item) return null;
  const ratio = Math.abs(parseFloat(String(item.fluctuationsRatio || '0').replace(/,/g, '')));
  const isDown = item.compareToPreviousPrice && String(item.compareToPreviousPrice.text || '').indexOf('하락') > -1;
  return { changePct: +(isDown ? -ratio : ratio).toFixed(2), price: item.closePrice };
}

function fetchUsRealtime_(symbol) {
  const url = 'https://api.stock.naver.com/stock/' + symbol + '/basic';
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const data = JSON.parse(res.getContentText());
  if (!data || data.code === 'StockConflict') return null;
  const ratio = Math.abs(parseFloat(String(data.fluctuationsRatio || '0').replace(/,/g, '')));
  const isDown = data.compareToPreviousPrice && String(data.compareToPreviousPrice.text || '').indexOf('하락') > -1;
  return { changePct: +(isDown ? -ratio : ratio).toFixed(2), price: data.closePrice };
}

/* 외국인·기관 순매매 거래량(주) × 종가 로 순매매대금(억원)을 추정.
   네이버 "매매동향" 페이지의 최신 거래일 행을 파싱한다. */
function fetchKrFlow_(code) {
  const url = 'https://finance.naver.com/item/frgn.naver?code=' + code + '&page=1';
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' } });
  const html = res.getContentText();
  const rowMatch = html.match(/<tr onMouseOver="mouseOver\(this\)"[\s\S]*?<\/tr>/);
  if (!rowMatch) return null;
  const cells = [];
  const cellRe = /class="tah p1[01][^"]*">\s*([^<]+?)\s*<\/span>/g;
  let m;
  while ((m = cellRe.exec(rowMatch[0])) !== null) cells.push(m[1].trim());
  // [날짜, 종가, 전일비, 등락률, 거래량, 기관순매매량, 외국인순매매량, 외국인보유주수, 외국인보유율]
  if (cells.length < 9) return null;
  const closePrice = toNum_(cells[1]);
  const orgNet = toNum_(cells[5]);
  const frgnNet = toNum_(cells[6]);
  const flowKrw100M = Math.round(((orgNet + frgnNet) * closePrice) / 100000000);
  return { flowKrw100M, orgNet, frgnNet };
}

function toNum_(s) {
  return parseFloat(String(s).replace(/[+,%]/g, '')) || 0;
}

/* ============================================================
   네이버 뉴스 검색 API — 섹터 키워드별 24시간 언급량
   ============================================================ */

function fetchNewsVolume_(keyword) {
  const props = PropertiesService.getScriptProperties();
  const clientId = props.getProperty('NAVER_CLIENT_ID');
  const clientSecret = props.getProperty('NAVER_CLIENT_SECRET');
  if (!clientId || !clientSecret) return { count: 0, items: [] };

  const url = 'https://openapi.naver.com/v1/search/news.json?query=' + encodeURIComponent(keyword) + '&display=100&sort=date';
  const res = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    headers: { 'X-Naver-Client-Id': clientId, 'X-Naver-Client-Secret': clientSecret },
  });
  const data = JSON.parse(res.getContentText());
  const items = data.items || [];
  const now = Date.now();
  const within24h = items.filter((it) => now - new Date(it.pubDate).getTime() <= 24 * 60 * 60 * 1000);
  return {
    count: within24h.length,
    items: within24h.slice(0, 5).map((it) => ({ title: stripTags_(it.title), link: it.link, pubDate: it.pubDate })),
  };
}

function stripTags_(s) {
  return String(s).replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

/* ============================================================
   하락 이벤트 자동 감지 (섹터 평균 등락률 <= DROP_THRESHOLD_PCT)
   ============================================================ */

function detectDropEvents_(ss, sectorResults) {
  const sheet = getOrCreateSheet_(ss, 'DropEvents', ['date', 'sectorId', 'sectorName', 'changePct', 'headline', 'tags', 'loggedAt']);
  const today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  const existing = sheet.getDataRange().getValues().slice(1);
  const alreadyLoggedToday = new Set(existing.filter((r) => r[0] === today).map((r) => r[1]));

  sectorResults.forEach((r) => {
    if (r.avgChangePct > DROP_THRESHOLD_PCT) return;
    if (alreadyLoggedToday.has(r.id)) return;
    const secCfg = SECTOR_CONFIG.find((s) => s.id === r.id);
    const news = safeFetch_(() => fetchNewsVolume_(secCfg.newsKeyword));
    const headline = news && news.items && news.items[0] ? news.items[0].title : '(뉴스 헤드라인 수집 실패 — 네이버 API 키 설정 확인)';
    sheet.appendRow([today, r.id, r.name, r.avgChangePct, headline, JSON.stringify(deriveTags_(r)), new Date().toISOString()]);
  });
}

function deriveTags_(r) {
  const tags = [];
  if (r.flowChangePct < 0) tags.push('수급 이탈');
  if (r.newsChangePct > 20) tags.push('뉴스 급증');
  if (tags.length === 0) tags.push('단기 조정');
  return tags;
}

/* ============================================================
   일별 로그 — 하락 이벤트 이후 반등/추가하락 여부(outcome) 계산용
   ============================================================ */

function logDailySectorPct_(ss, sectorResults) {
  const sheet = getOrCreateSheet_(ss, 'SectorDailyLog', ['date', 'sectorId', 'avgChangePct']);
  const today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  const existing = sheet.getDataRange().getValues().slice(1);
  if (existing.some((r) => r[0] === today)) return; // 하루 한 번만 기록
  sectorResults.forEach((r) => sheet.appendRow([today, r.id, r.avgChangePct]));
}

/* 하락 이벤트 발생 후 약 20거래일(28일) 지나면 그 사이 누적 등락률을
   outcome으로 계산해서 "돌아보면 매수 기회였는지" 판정한다.
   backfillOutcomes 트리거(매일 08:00)가 자동으로 호출. */
function backfillOutcomes() {
  const ss = getDb_();
  const eventSheet = getOrCreateSheet_(ss, 'DropEvents', ['date', 'sectorId', 'sectorName', 'changePct', 'headline', 'tags', 'loggedAt']);
  const outcomeSheet = getOrCreateSheet_(ss, 'DropOutcomes', ['date', 'sectorId', 'outcomePct', 'positive', 'computedAt']);
  const logSheet = getOrCreateSheet_(ss, 'SectorDailyLog', ['date', 'sectorId', 'avgChangePct']);

  const events = eventSheet.getDataRange().getValues().slice(1);
  const doneKeys = new Set(outcomeSheet.getDataRange().getValues().slice(1).map((r) => r[0] + '|' + r[1]));
  const logRows = logSheet.getDataRange().getValues().slice(1);

  events.forEach((ev) => {
    const date = ev[0];
    const sectorId = ev[1];
    const key = date + '|' + sectorId;
    if (doneKeys.has(key)) return;

    const eventDate = new Date(date);
    const daysSince = Math.floor((Date.now() - eventDate.getTime()) / (24 * 60 * 60 * 1000));
    if (daysSince < 28) return;

    const sectorLogs = logRows
      .filter((r) => r[1] === sectorId && new Date(r[0]) >= eventDate)
      .sort((a, b) => new Date(a[0]) - new Date(b[0]));
    if (sectorLogs.length < 15) return; // 로그가 아직 부족하면 다음 실행에 재시도

    const cumPct = sectorLogs.slice(0, 20).reduce((sum, r) => sum + Number(r[2] || 0), 0);
    outcomeSheet.appendRow([date, sectorId, +cumPct.toFixed(1), cumPct > 0, new Date().toISOString()]);
  });
}

/* ============================================================
   조회용 조합 — 프론트가 호출하는 최종 JSON
   ============================================================ */

function getDashboard_() {
  const ss = getDb_();
  const sectorSheet = getOrCreateSheet_(ss, 'SectorSnapshot', [
    'id', 'name', 'icon', 'netFlow', 'prevNetFlow', 'flowChangePct',
    'avgChangePct', 'newsVolume', 'prevNewsVolume', 'newsChangePct', 'stocksJson', 'updatedAt',
  ]);
  const rows = sectorSheet.getDataRange().getValues();
  const headers = rows.shift();
  const sectors = rows.map((row) => {
    const o = {};
    headers.forEach((h, i) => (o[h] = row[i]));
    return {
      id: o.id, name: o.name, icon: o.icon,
      netFlow: Number(o.netFlow) || 0,
      flowChangePct: Number(o.flowChangePct) || 0,
      newsVolume: Number(o.newsVolume) || 0,
      newsChangePct: Number(o.newsChangePct) || 0,
      stocks: safeParseJson_(o.stocksJson, []),
    };
  });

  const eventSheet = getOrCreateSheet_(ss, 'DropEvents', ['date', 'sectorId', 'sectorName', 'changePct', 'headline', 'tags', 'loggedAt']);
  const outcomeSheet = getOrCreateSheet_(ss, 'DropOutcomes', ['date', 'sectorId', 'outcomePct', 'positive', 'computedAt']);
  const outcomeMap = {};
  outcomeSheet.getDataRange().getValues().slice(1).forEach((r) => {
    outcomeMap[r[0] + '|' + r[1]] = { pct: r[2], positive: r[3] };
  });

  const events = eventSheet.getDataRange().getValues().slice(1)
    .map((r) => {
      const outcome = outcomeMap[r[0] + '|' + r[1]];
      return {
        date: r[0], sector: r[2], changePct: Number(r[3]), headline: r[4],
        tags: safeParseJson_(r[5], []),
        outcome: outcome ? { days: 20, pct: outcome.pct, positive: outcome.positive } : null,
      };
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 20);

  return { sectors, events, updatedAt: new Date().toISOString() };
}

function safeParseJson_(s, fallback) {
  try { return JSON.parse(s); } catch (e) { return fallback; }
}

/* ============================================================
   시트 유틸
   ============================================================ */

function getDb_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('DB_SHEET_ID');
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) { /* 삭제된 경우 재생성으로 진행 */ }
  }
  const ss = SpreadsheetApp.create('StockDashboard_DB');
  props.setProperty('DB_SHEET_ID', ss.getId());
  return ss;
}

function getOrCreateSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
  }
  return sheet;
}

function sheetToMap_(sheet, keyField) {
  const rows = sheet.getDataRange().getValues();
  const headers = rows.shift();
  const keyIdx = headers.indexOf(keyField);
  const map = {};
  rows.forEach((row) => {
    const o = {};
    headers.forEach((h, i) => (o[h] = row[i]));
    map[row[keyIdx]] = o;
  });
  return map;
}

function writeRows_(sheet, rows) {
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
  if (rows.length) sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
}
