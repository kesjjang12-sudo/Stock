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
 * 3. 아래 SECRET_KEY 값을 원하는 문자열로 바꾸고, 프론트(설정 모달)에도 같은 값을 입력
 * 4. 함수 목록에서 setupTrigger 선택 → 실행 (권한 승인 필요, 최초 1회)
 * 5. 배포 → 새 배포 → 유형: 웹앱 → 실행: 나 / 액세스 권한: 모든 사용자 → 배포
 *    → 생성된 웹앱 URL을 대시보드 설정(⚙️)에 입력
 *
 * 데이터는 자동 생성되는 "StockDashboard_DB" 스프레드시트에 쌓인다.
 *
 * ── 데이터의 성격 (중요) ────────────────────────────────────
 * · 시세(changePct)   : 실시간(장중 갱신)
 * · 수급(netFlow)     : 네이버가 확정 집계한 **직전 거래일** 기준. 장중 실시간 아님.
 *                       그래서 응답에 flowDate를 같이 내려보내 UI에 표기한다.
 * · 수급 대상         : 국내 상장 종목만. 미국 종목은 외국인/기관 순매매 공개 데이터가
 *                       없어 flow = null 이며 netFlow 합계에 포함되지 않는다.
 * · flowChangePct     : "직전 20거래일 대비 이번 수급이 얼마나 이례적인가"를
 *                       평균 절대 수급규모로 정규화한 값(%). 단순 전/후 비교가 아니다.
 * · newsChangePct     : 최근 24시간 언급량 vs 직전 7일 일평균. 기준선이 쌓이기 전
 *                       (최초 2일)에는 0을 반환하고 newsBaselineReady=false로 표시.
 */

const SECRET_KEY = 'stockflow-2026!';
const DROP_THRESHOLD_PCT = -2.5;
const REFRESH_INTERVAL_MIN = 10;
const NEWS_BASELINE_DAYS = 7;

// 자금과 뉴스의 "평소 대비 편차"가 이만큼(%p) 벌어지면 선제 신호로 본다 (프론트와 동일)
const SIGNAL_THRESHOLD = 40;
// 한 번 실행에서 보낼 수 있는 알림 개수 상한 (연동 직후 도배 방지)
const MAX_ALERTS_PER_RUN = 3;

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
  const action = params.action || 'dashboard';

  // 카카오 콜백은 카카오 서버가 호출하므로 secret을 붙일 수 없다.
  // 대신 authorize 단계에서 발급한 1회용 state로 검증한다.
  if (action === 'kakaoCallback') {
    try { return handleKakaoCallback_(params); }
    catch (err) { return htmlOut_('연결 실패', String(err)); }
  }

  if (params.key !== SECRET_KEY) return jsonOut_({ error: 'unauthorized' });

  try {
    if (action === 'ping') return jsonOut_({ ok: true, time: new Date().toISOString() });
    if (action === 'dashboard') return jsonOut_(getDashboard_());
    if (action === 'refresh') { refreshAll(); return jsonOut_(getDashboard_()); }
    if (action === 'kakaoAuth') return startKakaoAuth_();
    if (action === 'kakaoStatus') return jsonOut_(kakaoStatus_());
    if (action === 'kakaoTest') return jsonOut_(kakaoTest_());
    if (action === 'kakaoOff') return jsonOut_(kakaoDisconnect_());
    return jsonOut_({ error: 'unknown action: ' + action });
  } catch (err) {
    return jsonOut_({ error: String(err) });
  }
}

function htmlOut_(title, message) {
  return HtmlService.createHtmlOutput(
    '<div style="font-family:-apple-system,Segoe UI,Malgun Gothic,sans-serif;padding:40px 24px;text-align:center;color:#191F28">' +
    '<div style="font-size:20px;font-weight:800;margin-bottom:10px">' + title + '</div>' +
    '<div style="font-size:14px;color:#8B95A1;line-height:1.6">' + message + '</div></div>'
  );
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
   메인 갱신
   ============================================================ */

const SECTOR_HEADERS = [
  'id', 'name', 'icon', 'netFlow', 'flowChangePct', 'flowDate',
  'avgChangePct', 'krChangePct', 'usChangePct',
  'newsVolume', 'newsChangePct', 'newsBaselineReady', 'stocksJson', 'updatedAt',
];

function refreshAll() {
  const ss = getDb_();
  const quotes = fetchAllMarketData_();

  const results = SECTOR_CONFIG.map((sec) => buildSectorSnapshot_(ss, sec, quotes));

  const sectorSheet = getOrCreateSheet_(ss, 'SectorSnapshot', SECTOR_HEADERS);
  writeRows_(sectorSheet, results.map((r) => [
    r.id, r.name, r.icon, r.netFlow, r.flowChangePct, r.flowDate,
    r.avgChangePct, r.krChangePct, r.usChangePct,
    r.newsVolume, r.newsChangePct, r.newsBaselineReady,
    JSON.stringify(r.stocks), new Date().toISOString(),
  ]));

  logDailySectorPct_(ss, results);
  detectDropEvents_(ss, results);
  checkAlerts_(ss, results);
}

/* 모든 종목의 시세/수급 요청을 한 번에 병렬 실행한다.
   GAS는 실행시간 6분 제한이 있어 순차 fetch로는 종목이 늘어날수록 위험하다. */
function fetchAllMarketData_() {
  const reqs = [];
  const meta = [];

  SECTOR_CONFIG.forEach((sec) => {
    sec.kr.forEach((s) => {
      reqs.push({ url: 'https://polling.finance.naver.com/api/realtime/domestic/stock/' + s.code, muteHttpExceptions: true });
      meta.push({ kind: 'krQuote', code: s.code });
      reqs.push({ url: 'https://finance.naver.com/item/frgn.naver?code=' + s.code + '&page=1', muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' } });
      meta.push({ kind: 'krFlow', code: s.code });
    });
    sec.us.forEach((s) => {
      reqs.push({ url: 'https://api.stock.naver.com/stock/' + s.symbol + '/basic', muteHttpExceptions: true });
      meta.push({ kind: 'usQuote', code: s.symbol });
    });
  });

  let responses;
  try {
    responses = UrlFetchApp.fetchAll(reqs);
  } catch (err) {
    responses = reqs.map(() => null);
  }

  const out = { krQuote: {}, krFlow: {}, usQuote: {} };
  responses.forEach((res, i) => {
    const m = meta[i];
    if (!res) return;
    try {
      if (m.kind === 'krQuote') out.krQuote[m.code] = parseKrQuote_(res.getContentText());
      else if (m.kind === 'usQuote') out.usQuote[m.code] = parseUsQuote_(res.getContentText());
      else if (m.kind === 'krFlow') out.krFlow[m.code] = parseKrFlowHistory_(res.getContentText());
    } catch (e) { /* 개별 종목 파싱 실패는 무시하고 나머지를 살린다 */ }
  });
  return out;
}

function buildSectorSnapshot_(ss, sec, quotes) {
  const stocks = [];
  const krPcts = [];
  const usPcts = [];

  let netFlow = 0;
  let priorMeanFlow = 0;
  let priorMeanAbsFlow = 0;
  let flowDate = '';

  sec.kr.forEach((s) => {
    const q = quotes.krQuote[s.code];
    const hist = quotes.krFlow[s.code];
    const changePct = q ? q.changePct : 0;
    let flow = null;

    if (hist && hist.length) {
      flow = hist[0].flow;
      netFlow += flow;
      const prior = hist.slice(1);
      if (prior.length) {
        priorMeanFlow += prior.reduce((a, h) => a + h.flow, 0) / prior.length;
        priorMeanAbsFlow += prior.reduce((a, h) => a + Math.abs(h.flow), 0) / prior.length;
      }
      if (!flowDate || hist[0].date > flowDate) flowDate = hist[0].date;
    }

    stocks.push({ ticker: s.code, name: s.name, market: 'KR', changePct, flow });
    krPcts.push(changePct);
  });

  sec.us.forEach((s) => {
    const q = quotes.usQuote[s.symbol];
    const changePct = q ? q.changePct : 0;
    stocks.push({ ticker: s.symbol.replace(/\.[A-Z]$/, ''), name: s.name, market: 'US', changePct, flow: null });
    usPcts.push(changePct);
  });

  // 평소 수급 규모로 정규화한 이례도. 평균이 0 근처여도 폭주하지 않는다.
  const flowChangePct = priorMeanAbsFlow > 0
    ? clampPct_(((netFlow - priorMeanFlow) / priorMeanAbsFlow) * 100)
    : 0;

  const news = fetchNewsVolume_(sec.newsKeyword);
  const newsBase = computeNewsChange_(ss, sec.id, news.count);

  const allPcts = krPcts.concat(usPcts);
  return {
    id: sec.id, name: sec.name, icon: sec.icon,
    netFlow: Math.round(netFlow),
    flowChangePct,
    flowDate,
    avgChangePct: mean_(allPcts),
    krChangePct: mean_(krPcts),
    usChangePct: mean_(usPcts),
    newsVolume: news.count,
    newsChangePct: newsBase.changePct,
    newsBaselineReady: newsBase.ready,
    stocks,
  };
}

function mean_(arr) {
  if (!arr.length) return 0;
  return +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2);
}

function clampPct_(n) {
  if (!isFinite(n)) return 0;
  return Math.max(-300, Math.min(300, +n.toFixed(1)));
}

/* ============================================================
   파싱
   ============================================================ */

function parseKrQuote_(text) {
  const data = JSON.parse(text);
  const item = data.datas && data.datas[0];
  if (!item) return null;
  return { changePct: signedRatio_(item.fluctuationsRatio, item.compareToPreviousPrice), price: item.closePrice };
}

function parseUsQuote_(text) {
  const data = JSON.parse(text);
  if (!data || data.code === 'StockConflict') return null;
  return { changePct: signedRatio_(data.fluctuationsRatio, data.compareToPreviousPrice), price: data.closePrice };
}

/* 네이버는 등락률을 항상 양수로 주고 방향은 compareToPreviousPrice에 담아 보낸다. */
function signedRatio_(ratioStr, compare) {
  const ratio = Math.abs(parseFloat(String(ratioStr || '0').replace(/,/g, '')) || 0);
  const isDown = compare && String(compare.text || '').indexOf('하락') > -1;
  return +(isDown ? -ratio : ratio).toFixed(2);
}

/* 매매동향 페이지는 한 번 요청에 20거래일치를 준다 —
   기준선 계산에 필요한 히스토리를 추가 요청 없이 여기서 다 얻는다.
   반환: [{date, closePrice, orgNet, frgnNet, flow(억원)}] 최신일 우선 */
function parseKrFlowHistory_(html) {
  const rows = html.match(/<tr onMouseOver="mouseOver\(this\)"[\s\S]*?<\/tr>/g) || [];
  const out = [];
  rows.forEach((row) => {
    const cells = [];
    const cellRe = /class="tah p1[01][^"]*">\s*([^<]+?)\s*<\/span>/g;
    let m;
    while ((m = cellRe.exec(row)) !== null) cells.push(m[1].trim());
    // [날짜, 종가, 전일비, 등락률, 거래량, 기관순매매량, 외국인순매매량, 외국인보유주수, 외국인보유율]
    if (cells.length < 9) return;
    const closePrice = toNum_(cells[1]);
    const orgNet = toNum_(cells[5]);
    const frgnNet = toNum_(cells[6]);
    out.push({
      date: cells[0].replace(/\./g, '-'),
      closePrice: closePrice,
      orgNet: orgNet,
      frgnNet: frgnNet,
      flow: Math.round(((orgNet + frgnNet) * closePrice) / 100000000),
    });
  });
  return out;
}

function toNum_(s) {
  return parseFloat(String(s).replace(/[+,%]/g, '')) || 0;
}

/* ============================================================
   뉴스 언급량
   ============================================================ */

function fetchNewsVolume_(keyword) {
  const props = PropertiesService.getScriptProperties();
  const clientId = props.getProperty('NAVER_CLIENT_ID');
  const clientSecret = props.getProperty('NAVER_CLIENT_SECRET');
  if (!clientId || !clientSecret) return { count: 0, items: [] };

  try {
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
  } catch (e) {
    return { count: 0, items: [] };
  }
}

function stripTags_(s) {
  return String(s).replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

/* 24시간 언급량을 직전 N일 일평균과 비교한다.
   기준선이 쌓이기 전에는 억지로 숫자를 만들지 않고 ready=false로 알린다. */
function computeNewsChange_(ss, sectorId, count) {
  const sheet = getOrCreateSheet_(ss, 'NewsDailyLog', ['date', 'sectorId', 'count']);
  const today = todayStr_();
  const rows = sheet.getDataRange().getValues().slice(1);

  upsertDailyRow_(sheet, rows, today, sectorId, 2, count);

  const prior = rows.filter((r) => r[1] === sectorId && r[0] !== today).slice(-NEWS_BASELINE_DAYS);
  if (prior.length < 2) return { changePct: 0, ready: false };

  const avg = prior.reduce((a, r) => a + (Number(r[2]) || 0), 0) / prior.length;
  if (avg <= 0) return { changePct: 0, ready: false };
  return { changePct: clampPct_(((count - avg) / avg) * 100), ready: true };
}

/* ============================================================
   하락 이벤트 감지
   ============================================================ */

function detectDropEvents_(ss, sectorResults) {
  const sheet = getOrCreateSheet_(ss, 'DropEvents', ['date', 'sectorId', 'sectorName', 'changePct', 'headline', 'tags', 'loggedAt']);
  const today = todayStr_();
  const existing = sheet.getDataRange().getValues().slice(1);
  const loggedToday = {};
  existing.forEach((r, i) => { if (r[0] === today) loggedToday[r[1]] = i + 2; });

  sectorResults.forEach((r) => {
    if (r.avgChangePct > DROP_THRESHOLD_PCT) return;
    const secCfg = SECTOR_CONFIG.find((s) => s.id === r.id);
    const rowIdx = loggedToday[r.id];

    if (rowIdx) {
      // 같은 날 더 깊이 빠졌으면 그날의 최저치로 갱신
      const prevPct = Number(sheet.getRange(rowIdx, 4).getValue());
      if (r.avgChangePct < prevPct) sheet.getRange(rowIdx, 4).setValue(r.avgChangePct);
      return;
    }

    const news = fetchNewsVolume_(secCfg.newsKeyword);
    const headline = news.items && news.items[0]
      ? news.items[0].title
      : '(헤드라인 수집 실패 — 네이버 API 키 설정을 확인하세요)';
    sheet.appendRow([today, r.id, r.name, r.avgChangePct, headline, JSON.stringify(deriveTags_(r)), new Date().toISOString()]);
  });
}

function deriveTags_(r) {
  const tags = [];
  if (r.flowChangePct < -30) tags.push('수급 이탈');
  if (r.newsBaselineReady && r.newsChangePct > 50) tags.push('뉴스 급증');
  if (r.krChangePct <= DROP_THRESHOLD_PCT && r.usChangePct > DROP_THRESHOLD_PCT) tags.push('국내 주도');
  if (r.usChangePct <= DROP_THRESHOLD_PCT && r.krChangePct > DROP_THRESHOLD_PCT) tags.push('미국 주도');
  if (tags.length === 0) tags.push('단기 조정');
  return tags;
}

/* ============================================================
   일별 로그 / outcome
   ============================================================ */

/* 하루 한 행을 유지하되 갱신될 때마다 최신값으로 덮어쓴다.
   (예전 구현은 그날 첫 실행값만 남겨서 장 시작 직후의 0%에 가까운 값이 박혔다) */
function logDailySectorPct_(ss, sectorResults) {
  const sheet = getOrCreateSheet_(ss, 'SectorDailyLog', ['date', 'sectorId', 'avgChangePct']);
  const today = todayStr_();
  const rows = sheet.getDataRange().getValues().slice(1);
  sectorResults.forEach((r) => upsertDailyRow_(sheet, rows, today, r.id, 2, r.avgChangePct));
}

function upsertDailyRow_(sheet, rows, date, sectorId, valueColIdx, value) {
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === date && rows[i][1] === sectorId) {
      sheet.getRange(i + 2, valueColIdx + 1).setValue(value);
      rows[i][valueColIdx] = value;
      return;
    }
  }
  sheet.appendRow([date, sectorId, value]);
  rows.push([date, sectorId, value]);
}

function backfillOutcomes() {
  const ss = getDb_();
  const eventSheet = getOrCreateSheet_(ss, 'DropEvents', ['date', 'sectorId', 'sectorName', 'changePct', 'headline', 'tags', 'loggedAt']);
  const outcomeSheet = getOrCreateSheet_(ss, 'DropOutcomes', ['date', 'sectorId', 'outcomePct', 'positive', 'computedAt']);
  const logSheet = getOrCreateSheet_(ss, 'SectorDailyLog', ['date', 'sectorId', 'avgChangePct']);

  const events = eventSheet.getDataRange().getValues().slice(1);
  const doneKeys = {};
  outcomeSheet.getDataRange().getValues().slice(1).forEach((r) => { doneKeys[r[0] + '|' + r[1]] = true; });
  const logRows = logSheet.getDataRange().getValues().slice(1);

  events.forEach((ev) => {
    const date = String(ev[0]);
    const sectorId = ev[1];
    if (doneKeys[date + '|' + sectorId]) return;

    const eventDate = new Date(date);
    const daysSince = Math.floor((Date.now() - eventDate.getTime()) / (24 * 60 * 60 * 1000));
    if (daysSince < 28) return;

    const sectorLogs = logRows
      .filter((r) => r[1] === sectorId && new Date(r[0]) > eventDate)
      .sort((a, b) => new Date(a[0]) - new Date(b[0]))
      .slice(0, 20);
    if (sectorLogs.length < 15) return;

    // 일별 등락률은 복리로 누적해야 실제 수익률에 가깝다
    const cum = sectorLogs.reduce((acc, r) => acc * (1 + (Number(r[2]) || 0) / 100), 1);
    const cumPct = (cum - 1) * 100;
    outcomeSheet.appendRow([date, sectorId, +cumPct.toFixed(1), cumPct > 0, new Date().toISOString()]);
  });
}

/* ============================================================
   조회용 조합
   ============================================================ */

function getDashboard_() {
  const ss = getDb_();
  const sectorSheet = getOrCreateSheet_(ss, 'SectorSnapshot', SECTOR_HEADERS);
  const rows = sectorSheet.getDataRange().getValues();
  const headers = rows.shift();

  const sectors = rows.map((row) => {
    const o = {};
    headers.forEach((h, i) => (o[h] = row[i]));
    return {
      id: o.id, name: o.name, icon: o.icon,
      netFlow: Number(o.netFlow) || 0,
      flowChangePct: Number(o.flowChangePct) || 0,
      flowDate: o.flowDate || '',
      avgChangePct: Number(o.avgChangePct) || 0,
      krChangePct: Number(o.krChangePct) || 0,
      usChangePct: Number(o.usChangePct) || 0,
      newsVolume: Number(o.newsVolume) || 0,
      newsChangePct: Number(o.newsChangePct) || 0,
      newsBaselineReady: o.newsBaselineReady === true || o.newsBaselineReady === 'TRUE',
      stocks: safeParseJson_(o.stocksJson, []),
    };
  });

  const eventSheet = getOrCreateSheet_(ss, 'DropEvents', ['date', 'sectorId', 'sectorName', 'changePct', 'headline', 'tags', 'loggedAt']);
  const outcomeSheet = getOrCreateSheet_(ss, 'DropOutcomes', ['date', 'sectorId', 'outcomePct', 'positive', 'computedAt']);
  const outcomeMap = {};
  outcomeSheet.getDataRange().getValues().slice(1).forEach((r) => {
    outcomeMap[r[0] + '|' + r[1]] = { pct: Number(r[2]), positive: r[3] === true || r[3] === 'TRUE' };
  });

  const events = eventSheet.getDataRange().getValues().slice(1)
    .map((r) => {
      const outcome = outcomeMap[r[0] + '|' + r[1]];
      return {
        date: String(r[0]), sector: r[2], changePct: Number(r[3]), headline: r[4],
        tags: safeParseJson_(r[5], []),
        outcome: outcome ? { days: 20, pct: outcome.pct, positive: outcome.positive } : null,
      };
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 20);

  return { sectors: sectors, events: events, updatedAt: new Date().toISOString() };
}

function safeParseJson_(s, fallback) {
  try { return JSON.parse(s); } catch (e) { return fallback; }
}

/* ============================================================
   카카오톡 "나에게 보내기" 알림
   ============================================================
   준비 (최초 1회):
   1. developers.kakao.com → 애플리케이션 추가하기
   2. [앱 설정 > 앱 키] REST API 키를 복사 →
      GAS 스크립트 속성에 KAKAO_REST_KEY 로 저장
   3. [제품 설정 > 카카오 로그인] 활성화 ON
   4. GAS 함수 목록에서 showKakaoSetup 실행 → 로그에 찍히는 Redirect URI를
      [카카오 로그인 > Redirect URI] 에 그대로 등록
   5. [카카오 로그인 > 동의항목] 에서 "카카오톡 메시지 전송(talk_message)" 사용 설정
   6. 대시보드 ⚙️ 설정 → "카톡 알림 연결" 클릭 → 카카오 로그인 → 끝

   ※ 본인에게 보내는 "나에게 보내기"는 검수(심사) 없이 바로 됩니다.
      다른 사람에게 보내려면 카카오 검수가 필요합니다.
   ============================================================ */

const K_REST = 'KAKAO_REST_KEY';
const K_ACCESS = 'KAKAO_ACCESS_TOKEN';
const K_REFRESH = 'KAKAO_REFRESH_TOKEN';
const K_EXPIRES = 'KAKAO_TOKEN_EXPIRES';
const K_STATE = 'KAKAO_AUTH_STATE';
const K_ALERTS_ON = 'KAKAO_ALERTS_ON';

/* 카카오에 등록해야 하는 Redirect URI를 확인하는 헬퍼. GAS 편집기에서 직접 실행. */
function showKakaoSetup() {
  const uri = redirectUri_();
  Logger.log('카카오 개발자센터 > 카카오 로그인 > Redirect URI 에 아래 주소를 그대로 등록하세요:\n' + uri);
  return uri;
}

function redirectUri_() {
  return ScriptApp.getService().getUrl() + '?action=kakaoCallback';
}

function startKakaoAuth_() {
  const restKey = PropertiesService.getScriptProperties().getProperty(K_REST);
  if (!restKey) {
    return htmlOut_('설정이 필요해요', 'GAS 스크립트 속성에 <b>KAKAO_REST_KEY</b> 를 먼저 저장해주세요.');
  }
  const state = Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperty(K_STATE, state);

  const url = 'https://kauth.kakao.com/oauth/authorize'
    + '?client_id=' + encodeURIComponent(restKey)
    + '&redirect_uri=' + encodeURIComponent(redirectUri_())
    + '&response_type=code'
    + '&scope=talk_message'
    + '&state=' + encodeURIComponent(state);

  // GAS 웹앱은 iframe 안에서 열리므로 최상위 창을 이동시켜야 카카오 로그인이 뜬다
  return HtmlService.createHtmlOutput(
    '<script>window.top.location.href=' + JSON.stringify(url) + ';</script>' +
    '<p style="font-family:sans-serif">카카오 로그인으로 이동 중… ' +
    '<a href="' + url + '" target="_top">눌러서 계속하기</a></p>'
  ).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function handleKakaoCallback_(params) {
  const props = PropertiesService.getScriptProperties();
  const expected = props.getProperty(K_STATE);

  if (params.error) return htmlOut_('연결이 취소됐어요', String(params.error_description || params.error));
  if (!expected || params.state !== expected) {
    return htmlOut_('요청이 만료됐어요', '대시보드에서 "카톡 알림 연결"을 다시 눌러주세요.');
  }
  props.deleteProperty(K_STATE);

  const restKey = props.getProperty(K_REST);
  const res = UrlFetchApp.fetch('https://kauth.kakao.com/oauth/token', {
    method: 'post',
    muteHttpExceptions: true,
    payload: {
      grant_type: 'authorization_code',
      client_id: restKey,
      redirect_uri: redirectUri_(),
      code: params.code,
    },
  });
  const data = JSON.parse(res.getContentText());
  if (!data.access_token) {
    return htmlOut_('토큰 발급 실패', (data.error_description || res.getContentText()));
  }

  saveKakaoTokens_(data);
  props.setProperty(K_ALERTS_ON, 'true');
  sendKakao_('카톡 알림이 연결됐어요. 과도한 하락이나 선제 신호가 뜨면 여기로 알려드릴게요.');

  return htmlOut_('연결 완료 ✅', '이제 창을 닫으셔도 됩니다. 방금 테스트 메시지를 보냈어요.');
}

function saveKakaoTokens_(data) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty(K_ACCESS, data.access_token);
  if (data.refresh_token) props.setProperty(K_REFRESH, data.refresh_token);
  props.setProperty(K_EXPIRES, String(Date.now() + (Number(data.expires_in) || 3600) * 1000));
}

/* 액세스 토큰은 6시간짜리라 10분 트리거가 돌 때마다 만료를 확인하고 갱신한다. */
function kakaoAccessToken_() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty(K_ACCESS);
  const expires = Number(props.getProperty(K_EXPIRES) || 0);
  if (!token) return null;
  if (Date.now() < expires - 5 * 60 * 1000) return token;

  const refresh = props.getProperty(K_REFRESH);
  if (!refresh) return null;
  const res = UrlFetchApp.fetch('https://kauth.kakao.com/oauth/token', {
    method: 'post',
    muteHttpExceptions: true,
    payload: {
      grant_type: 'refresh_token',
      client_id: props.getProperty(K_REST),
      refresh_token: refresh,
    },
  });
  const data = JSON.parse(res.getContentText());
  if (!data.access_token) return null;
  saveKakaoTokens_(data);
  return data.access_token;
}

/* 카카오 텍스트 메시지는 본문 200자 제한이 있어 넘치면 잘라 보낸다. */
function sendKakao_(text, linkUrl) {
  const token = kakaoAccessToken_();
  if (!token) return { ok: false, error: 'not_connected' };

  const body = String(text).slice(0, 195);
  const url = linkUrl || 'https://kesjjang12-sudo.github.io/Stock/';
  const templateObject = {
    object_type: 'text',
    text: body,
    link: { web_url: url, mobile_web_url: url },
    button_title: '대시보드 열기',
  };

  try {
    const res = UrlFetchApp.fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
      method: 'post',
      muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + token },
      payload: { template_object: JSON.stringify(templateObject) },
    });
    const data = JSON.parse(res.getContentText() || '{}');
    if (data.result_code === 0) return { ok: true };
    return { ok: false, error: data.msg || res.getContentText() };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function kakaoStatus_() {
  const props = PropertiesService.getScriptProperties();
  return {
    hasRestKey: !!props.getProperty(K_REST),
    connected: !!props.getProperty(K_REFRESH),
    alertsOn: props.getProperty(K_ALERTS_ON) === 'true',
    redirectUri: redirectUri_(),
  };
}

function kakaoTest_() {
  const r = sendKakao_('테스트 메시지예요. 이게 보이면 알림 연동이 정상입니다.');
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

function kakaoDisconnect_() {
  const props = PropertiesService.getScriptProperties();
  [K_ACCESS, K_REFRESH, K_EXPIRES, K_ALERTS_ON].forEach((k) => props.deleteProperty(k));
  return { ok: true };
}

/* ============================================================
   알림 판단 — 같은 날 같은 사유로 두 번 보내지 않는다
   ============================================================ */

function checkAlerts_(ss, sectorResults) {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(K_ALERTS_ON) !== 'true') return;
  if (!props.getProperty(K_REFRESH)) return;

  const sheet = getOrCreateSheet_(ss, 'AlertLog', ['date', 'sectorId', 'type', 'sentAt', 'body']);
  const today = todayStr_();
  const sent = {};
  sheet.getDataRange().getValues().slice(1).forEach((r) => {
    if (r[0] === today) sent[r[1] + '|' + r[2]] = true;
  });

  const queue = [];

  sectorResults.forEach((r) => {
    if (r.avgChangePct <= DROP_THRESHOLD_PCT && !sent[r.id + '|drop']) {
      const lines = ['📉 [' + r.name + '] ' + r.avgChangePct + '% 하락'];
      if (hasFlow_(r)) lines.push('자금 평소 대비 ' + fmtSigned_(r.flowChangePct) + '%');
      const headline = latestHeadline_(ss, today, r.id);
      if (headline) lines.push(headline);
      queue.push({ sectorId: r.id, type: 'drop', body: lines.join('\n') });
    }

    const divergence = +(r.flowChangePct - r.newsChangePct).toFixed(1);
    if (hasFlow_(r) && r.newsBaselineReady && Math.abs(divergence) >= SIGNAL_THRESHOLD && !sent[r.id + '|signal']) {
      queue.push({
        sectorId: r.id, type: 'signal',
        body: (divergence > 0 ? '📈' : '⚠️') + ' [' + r.name + '] 선제 신호 ' + (divergence > 0 ? '+' : '') + divergence + '%p\n'
            + '자금 ' + fmtSigned_(r.flowChangePct) + '% / 뉴스 ' + fmtSigned_(r.newsChangePct) + '% (평소 대비)\n'
            + '수급 기준일 ' + (r.flowDate || '-'),
      });
    }
  });

  queue.slice(0, MAX_ALERTS_PER_RUN).forEach((q) => {
    const result = sendKakao_(q.body);
    if (result.ok) sheet.appendRow([today, q.sectorId, q.type, new Date().toISOString(), q.body]);
  });
}

function hasFlow_(r) {
  return (r.stocks || []).some(function (s) { return s.flow != null; });
}

function fmtSigned_(n) {
  return (n > 0 ? '+' : '') + n;
}

function latestHeadline_(ss, today, sectorId) {
  const sheet = getOrCreateSheet_(ss, 'DropEvents', ['date', 'sectorId', 'sectorName', 'changePct', 'headline', 'tags', 'loggedAt']);
  const rows = sheet.getDataRange().getValues().slice(1);
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i][0] === today && rows[i][1] === sectorId) return String(rows[i][4] || '');
  }
  return '';
}

/* ============================================================
   시트 유틸
   ============================================================ */

function todayStr_() {
  return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
}

function getDb_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('DB_SHEET_ID');
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) { /* 삭제된 경우 재생성 */ }
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
    return sheet;
  }
  // 컬럼이 추가된 버전으로 업그레이드된 경우 헤더를 맞춰준다
  if (sheet.getLastColumn() < headers.length) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sheet;
}

function writeRows_(sheet, rows) {
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
  if (rows.length) sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
}
