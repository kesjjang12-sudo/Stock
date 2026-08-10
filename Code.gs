/**
 * 섹터 자금흐름 대시보드 — 백엔드 (Google Apps Script)
 * ============================================================
 * 배포 방법 (API 키 등록 불필요)
 * 1. script.google.com → 새 프로젝트 → 이 파일 내용을 Code.gs에 붙여넣기
 * 2. 배포 → 새 배포 → 유형: 웹 앱 → 실행: 나 / 액세스 권한: 모든 사용자 → 배포
 * 3. 함수 목록에서 setup 선택 → 실행 (권한 승인 필요, 최초 1회)
 *    → 실행 로그에 연동 점검 결과와 대시보드에 넣을 URL이 출력된다
 * 4. 대시보드 ⚙️ 에 그 URL과 아래 SECRET_KEY 입력
 *
 * 데이터는 자동 생성되는 "StockDashboard_DB" 스프레드시트에 쌓인다.
 *
 * ── 데이터의 성격 (중요) ────────────────────────────────────
 * · 시세(changePct)   : 실시간(장중 갱신). 네이버 금융.
 * · 수급(netFlow)     : 네이버가 확정 집계한 **직전 거래일** 기준. 장중 실시간 아님.
 *                       그래서 응답에 flowDate를 같이 내려보내 UI에 표기한다.
 * · 수급 대상         : 국내 상장 종목만. 미국 종목은 외국인/기관 순매매 공개 데이터가
 *                       없어 flow = null 이며 netFlow 합계에 포함되지 않는다.
 * · 뉴스              : 구글뉴스 RSS. API 키가 필요 없고 한국어/영어를 따로 뽑는다.
 *                       미국 종목은 영어 원문이 한국 언론 번역보다 몇 시간 빠르다.
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

/* etf가 있는 섹터는 구성종목을 ETF에서 자동으로 가져온다 (syncEtfHoldings).
   kr은 ETF 동기화 전/실패 시 쓰는 폴백이자, ETF가 없는 섹터의 확정 목록이다.
   미국 ETF는 네이버가 구성종목·순유입을 주지 않으므로 us는 항상 수동이다. */
const SECTOR_CONFIG = [
  {
    id: 'bigtech', name: '빅테크', icon: '💻',
    newsQueryKr: '빅테크 주가', newsQueryUs: 'big tech stocks Nasdaq',
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
    id: 'semi', name: '반도체', icon: '🔧',
    newsQueryKr: '반도체 업황', newsQueryUs: 'semiconductor stocks chip sector',
    etf: { code: '396500', name: 'TIGER 반도체TOP10' },
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
    id: 'software', name: '소프트웨어', icon: '🖥️',
    newsQueryKr: '소프트웨어 업종 주가', newsQueryUs: 'enterprise software stocks cloud',
    // 국내 소프트웨어 ETF는 규모가 작고 인터넷 ETF는 통신장비가 섞여 있어 수동으로 둔다
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
    id: 'finance', name: '금융', icon: '🏦',
    newsQueryKr: '금융주 실적', newsQueryUs: 'bank stocks financial sector',
    etf: { code: '091170', name: 'KODEX 은행' },
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
    id: 'battery', name: '2차전지·에너지', icon: '🔋',
    newsQueryKr: '2차전지 업황', newsQueryUs: 'EV battery stocks clean energy',
    etf: { code: '305720', name: 'KODEX 2차전지산업' },
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
    id: 'health', name: '헬스케어·바이오', icon: '🧬',
    newsQueryKr: '제약 바이오 주가', newsQueryUs: 'healthcare pharma stocks',
    etf: { code: '364970', name: 'TIGER 바이오TOP10' },
    kr: [
      { code: '207940', name: '삼성바이오로직스' },
      { code: '068270', name: '셀트리온' },
    ],
    us: [
      { symbol: 'LLY', name: '일라이릴리' },
      { symbol: 'UNH', name: '유나이티드헬스' },
    ],
  },
  {
    id: 'beauty', name: '뷰티', icon: '💄',
    newsQueryKr: '화장품 수출 실적', newsQueryUs: 'K-beauty cosmetics stocks',
    etf: { code: '228790', name: 'TIGER 화장품' },
    kr: [
      { code: '051900', name: 'LG생활건강' },
      { code: '192820', name: '코스맥스' },
    ],
    us: [],
  },
  {
    id: 'power', name: '전력', icon: '⚡',
    newsQueryKr: '전력기기 전력설비 수주', newsQueryUs: 'power grid equipment stocks',
    etf: { code: '0117V0', name: 'TIGER 코리아AI전력기기TOP3플러스' },
    kr: [
      { code: '298040', name: '효성중공업' },
      { code: '010120', name: 'LS ELECTRIC' },
      { code: '267260', name: 'HD현대일렉트릭' },
    ],
    us: [],
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
    // 편집기에 들어가지 않고 주소창만으로 트리거를 걸 수 있게 열어둔다
    if (action === 'setup') return htmlOut_('설정 점검 결과', setup().split('\n').join('<br>'));
    if (action === 'status') return jsonOut_(systemStatus_());
    if (action === 'history') return jsonOut_(getHistory_(params.period, params.market, params.metric, params.investor, params.from, params.to));
    if (action === 'syncEtf') return jsonOut_(syncEtfHoldings());
    if (action === 'profile') return jsonOut_(profileRefresh_());
    if (action === 'backfill') {
      const r = backfillSectorDaily_(4.5 * 60 * 1000);
      return htmlOut_(r.finished ? '백필 완료' : '백필 진행 중',
        r.log.join('<br>') + '<br><br>' + r.done + ' / ' + r.total + ' 섹터' +
        (r.finished ? '<br><br>끝났습니다. 대시보드 추이 탭을 확인하세요.' : '<br><br>아직 남았습니다. 이 페이지를 <b>새로고침</b>하면 이어서 진행합니다.'));
    }
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

/* 최초 1회 실행용. 트리거를 걸고, 각 연동이 실제로 되는지 점검해서
   무엇이 남았는지 로그로 알려준다. (보기 > 실행 로그) */
function setup() {
  const props = PropertiesService.getScriptProperties();
  const out = [];

  migrateAlertLog_();
  sortSectorDaily_(getOrCreateSheet_(getDb_(), 'SectorDaily', SECTOR_DAILY_HEADERS));

  setupTrigger();
  out.push('✅ 자동 갱신 트리거 등록됨 (' + REFRESH_INTERVAL_MIN + '분마다)');

  const ss = getDb_();
  out.push('✅ 데이터 시트 준비됨: ' + ss.getUrl());

  // 수급/시세는 키가 필요 없으므로 바로 확인 가능
  try {
    const q = parseKrQuote_(UrlFetchApp.fetch(
      'https://polling.finance.naver.com/api/realtime/domestic/stock/005930',
      { muteHttpExceptions: true }).getContentText());
    out.push(q ? '✅ 시세 연동 정상 (삼성전자 ' + q.changePct + '%)' : '❌ 시세 응답을 해석하지 못했습니다');
  } catch (e) {
    out.push('❌ 시세 연동 실패: ' + e);
  }

  try {
    const h = parseKrFlowHistory_(UrlFetchApp.fetch(
      'https://finance.naver.com/item/frgn.naver?code=005930&page=1',
      { muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' } }).getContentText());
    out.push(h.length ? '✅ 수급 연동 정상 (' + h.length + '일치, 최신 ' + h[0].date + ')' : '❌ 수급 데이터를 읽지 못했습니다');
  } catch (e) {
    out.push('❌ 수급 연동 실패: ' + e);
  }

  try {
    const news = fetchNewsVolume_(SECTOR_CONFIG[1]); // 반도체
    out.push(news.count > 0
      ? '✅ 뉴스 연동 정상 (반도체 최근 24시간: 국내 ' + news.krCount + '건 / 해외 ' + news.usCount + '건)'
      : '⚠️ 뉴스를 가져오지 못했습니다. 잠시 후 setup을 다시 실행해보세요.');
  } catch (e) {
    out.push('❌ 뉴스 연동 실패: ' + e);
  }

  let webAppUrl = '';
  try { webAppUrl = ScriptApp.getService().getUrl(); } catch (e) { /* 미배포 상태 */ }
  if (webAppUrl && webAppUrl.indexOf('/exec') > -1) {
    out.push('✅ 웹앱 배포됨');
    out.push('   이 주소가 app.js의 DEFAULT_GAS_URL과 같아야 합니다:');
    out.push('   ' + webAppUrl);
    out.push('   SECRET KEY: ' + SECRET_KEY);
  } else {
    out.push('⬜ 아직 웹앱으로 배포되지 않았습니다.');
    out.push('   우측 상단 [배포] > [새 배포] > 유형 "웹 앱"');
    out.push('   실행: 나 / 액세스 권한: 모든 사용자 > [배포]');
  }

  const msg = '\n===== 설정 점검 결과 =====\n' + out.join('\n') + '\n=========================';
  Logger.log(msg);
  return msg;
}

/* 트리거가 실제로 돌고 있는지 밖에서 확인하는 용도.
   대시보드 응답의 updatedAt은 호출 시각이라 데이터가 언제 갱신됐는지 알 수 없다. */
function systemStatus_() {
  const handlers = ScriptApp.getProjectTriggers().map((t) => t.getHandlerFunction());

  const ss = getDb_();
  const sheet = getOrCreateSheet_(ss, 'SectorSnapshot', SECTOR_HEADERS);
  const rows = sheet.getDataRange().getValues();
  const headers = rows.shift();
  const col = headers.indexOf('updatedAt');

  let last = '';
  rows.forEach((r) => {
    const v = r[col] instanceof Date ? r[col].toISOString() : String(r[col] || '');
    if (v > last) last = v;
  });

  const daily = getOrCreateSheet_(ss, 'SectorDaily', SECTOR_DAILY_HEADERS).getDataRange().getValues();
  const dailyDates = daily.slice(1).map((r) => asDateStr_(r[0])).filter(Boolean).sort();

  return {
    triggerReady: handlers.indexOf('refreshAll') > -1,
    triggers: handlers,
    refreshIntervalMin: REFRESH_INTERVAL_MIN,
    sectorDailyRows: Math.max(0, daily.length - 1),
    sectorDailyFrom: dailyDates[0] || '',
    sectorDailyTo: dailyDates[dailyDates.length - 1] || '',
    backfillCursor: PropertiesService.getScriptProperties().getProperty('BACKFILL_CURSOR') || 'none',
    sectorRows: rows.length,
    lastSnapshotAt: last,
    lastSnapshotAgeMin: last ? Math.round((Date.now() - new Date(last).getTime()) / 60000) : null,
    spreadsheetUrl: ss.getUrl(),
    now: new Date().toISOString(),
  };
}

function setupTrigger() {
  const managed = ['refreshAll', 'backfillOutcomes', 'syncUsDaily', 'syncEtfHoldings'];
  ScriptApp.getProjectTriggers().forEach((t) => {
    if (managed.indexOf(t.getHandlerFunction()) > -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('refreshAll').timeBased().everyMinutes(REFRESH_INTERVAL_MIN).create();
  ScriptApp.newTrigger('backfillOutcomes').timeBased().everyDays(1).atHour(8).create();
  ScriptApp.newTrigger('syncUsDaily').timeBased().everyDays(1).atHour(8).create();
  ScriptApp.newTrigger('syncEtfHoldings').timeBased().everyDays(1).atHour(7).create();
  syncEtfHoldings();
  refreshAll();
}

/* ============================================================
   메인 갱신
   ============================================================ */

const SECTOR_HEADERS = [
  'id', 'name', 'icon', 'netFlow', 'flowChangePct', 'flowDate',
  'avgChangePct', 'krChangePct', 'usChangePct',
  'newsVolume', 'newsKr', 'newsUs', 'newsChangePct', 'newsBaselineReady', 'stocksJson', 'updatedAt',
  'frgnFlow', 'orgFlow', 'indiFlow', 'etfName', 'newsRaw', 'newsItemsJson',
];

function refreshAll() {
  // 백필과 겹치면 서로 읽은 시점의 시트를 각자 통째로 되돌려써서 갱신이 사라진다
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try { refreshAllInner_(); } finally { lock.releaseLock(); }
}

function refreshAllInner_() {
  const ss = getDb_();
  // 구성종목 스냅샷이 없으면 먼저 만든다 (최초 실행/신규 섹터 추가 시)
  if (!hasEtfHoldings_(ss)) syncEtfHoldings();
  const quotes = fetchAllMarketData_(ss);

  const results = SECTOR_CONFIG.map((sec) => buildSectorSnapshot_(ss, sec, quotes));

  const sectorSheet = getOrCreateSheet_(ss, 'SectorSnapshot', SECTOR_HEADERS);
  writeRows_(sectorSheet, results.map((r) => [
    r.id, r.name, r.icon, r.netFlow, r.flowChangePct, r.flowDate,
    r.avgChangePct, r.krChangePct, r.usChangePct,
    r.newsVolume, r.newsKr, r.newsUs, r.newsChangePct, r.newsBaselineReady,
    JSON.stringify(r.stocks), new Date().toISOString(),
    r.frgnFlow, r.orgFlow, r.indiFlow, r.etfName, r.newsRaw, JSON.stringify(r.newsItems || []),
  ]));

  logDailySectorPct_(ss, results);
  logSectorDailyFromQuotes_(ss, quotes);
  detectDropEvents_(ss, results);
  checkAlerts_(ss, results, quotes);
}

/* 모든 종목의 시세/수급 요청을 한 번에 병렬 실행한다.
   GAS는 실행시간 6분 제한이 있어 순차 fetch로는 종목이 늘어날수록 위험하다.
   국내 시세는 콤마로 묶어 한 번에 받으므로 종목이 70개로 늘어도 요청은 몇 건뿐이다. */
function fetchAllMarketData_(ss) {
  const krStocks = activeKrStocks_(ss);

  // 섹터 간 중복 종목은 한 번만 받는다
  const codes = [];
  const seen = {};
  SECTOR_CONFIG.forEach((sec) => {
    (krStocks[sec.id] || []).forEach((s) => {
      if (seen[s.code]) return;
      seen[s.code] = true;
      codes.push(s.code);
    });
  });

  const out = { krQuote: {}, krTrend: {}, usQuote: {}, market: {}, krStocks: krStocks };

  // 1) 국내 시세 — 콤마로 묶어서 배치 요청
  const quoteReqs = [];
  for (let i = 0; i < codes.length; i += QUOTE_BATCH) {
    quoteReqs.push({
      url: 'https://polling.finance.naver.com/api/realtime/domestic/stock/' + codes.slice(i, i + QUOTE_BATCH).join(','),
      muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' },
    });
  }
  fetchAllChunked_(quoteReqs).forEach((res) => {
    if (!res) return;
    try {
      const d = JSON.parse(res.getContentText());
      (d.datas || []).forEach((it) => {
        const code = String(it.itemCode || '');
        if (!code) return;
        out.krQuote[code] = {
          changePct: signedRatio_(it.fluctuationsRatio, it.compareToPreviousPrice),
          price: numOf_(it.closePrice),
        };
        const ex = (it.stockExchangeType && it.stockExchangeType.code) || '';
        out.market[code] = ex === 'KQ' ? 'KOSDAQ' : 'KOSPI';
      });
    } catch (e) { /* 배치 하나 실패는 나머지를 살린다 */ }
  });

  // 2) 국내 수급 — 전일 확정치라 장중에 바뀌지 않는다. 캐시해서 하루 몇 번만 실제로 받는다.
  out.krTrend = fetchKrTrends_(codes);

  // 3) 미국 시세 — 배치 엔드포인트가 없어 종목당 1요청
  const usReqs = [];
  const usMeta = [];
  SECTOR_CONFIG.forEach((sec) => {
    sec.us.forEach((s) => {
      usReqs.push({ url: 'https://api.stock.naver.com/stock/' + s.symbol + '/basic', muteHttpExceptions: true });
      usMeta.push(s.symbol);
    });
  });
  fetchAllChunked_(usReqs).forEach((res, i) => {
    if (!res) return;
    try { out.usQuote[usMeta[i]] = parseUsQuote_(res.getContentText()); } catch (e) { /* 무시 */ }
  });

  saveMarketMap_(ss, out.market);
  return out;
}

/* 코스피/코스닥 구분은 시세 응답에 딸려오므로 공짜다.
   백필은 시세를 안 받으므로 시트에 저장해두고 재사용한다. */
function saveMarketMap_(ss, map) {
  const codes = Object.keys(map);
  if (!codes.length) return;
  const sheet = getOrCreateSheet_(ss, 'StockMarket', ['itemCode', 'market']);
  writeRows_(sheet, codes.map((c) => ["'" + c, map[c]]));
}

function loadMarketMap_(ss) {
  const sheet = getOrCreateSheet_(ss, 'StockMarket', ['itemCode', 'market']);
  const out = {};
  sheet.getDataRange().getValues().slice(1).forEach((r) => {
    if (r[0]) out[padKrCode_(r[0])] = String(r[1] || 'KOSPI');
  });
  return out;
}

/* 수급은 당일 장 마감 후에야 갱신된다. 10분마다 62종목을 다시 받으면
   무료 실행시간(90분/일)과 UrlFetch 한도(2만건/일)를 금방 태운다. */
const TREND_CACHE_SEC = 3 * 3600;

function fetchKrTrends_(codes) {
  const cache = CacheService.getScriptCache();
  const keys = codes.map((c) => 'tr|' + c);
  let hit = {};
  try { hit = cache.getAll(keys) || {}; } catch (e) { hit = {}; }

  const out = {};
  const miss = [];
  codes.forEach((c, i) => {
    const v = hit[keys[i]];
    if (v) {
      try { out[c] = JSON.parse(v); return; } catch (e) { /* 깨진 캐시는 다시 받는다 */ }
    }
    miss.push(c);
  });

  if (miss.length) {
    const reqs = miss.map((c) => ({
      url: trendUrl_(c, ''), muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' },
    }));
    const put = {};
    fetchAllChunked_(reqs).forEach((res, i) => {
      if (!res) return;
      try {
        const rows = parseTrendHistory_(res.getContentText());
        if (rows.length) {
          out[miss[i]] = rows;
          put['tr|' + miss[i]] = JSON.stringify(rows);
        }
      } catch (e) { /* 무시 */ }
    });
    if (Object.keys(put).length) {
      try { cache.putAll(put, TREND_CACHE_SEC); } catch (e) { /* 무시 */ }
      // 수급이 새로 들어왔을 때만 추이 캐시를 버린다
      invalidateHistoryCache_();
    }
  }
  return out;
}

function buildSectorSnapshot_(ss, sec, quotes) {
  const stocks = [];
  const krPcts = [];
  const usPcts = [];

  let frgnFlow = 0;
  let orgFlow = 0;
  let indiFlow = 0;
  let priorMeanFlow = 0;
  let priorMeanAbsFlow = 0;
  let flowDate = '';

  (quotes.krStocks[sec.id] || []).forEach((s) => {
    const q = quotes.krQuote[s.code];
    const hist = quotes.krTrend[s.code];
    const changePct = q ? q.changePct : 0;
    let flow = null;

    if (hist && hist.length) {
      const cur = hist[0];
      flow = cur.frgnFlow + cur.orgFlow;
      frgnFlow += cur.frgnFlow;
      orgFlow += cur.orgFlow;
      indiFlow += cur.indiFlow;

      const prior = hist.slice(1);
      if (prior.length) {
        const net = (h) => h.frgnFlow + h.orgFlow;
        priorMeanFlow += prior.reduce((a, h) => a + net(h), 0) / prior.length;
        priorMeanAbsFlow += prior.reduce((a, h) => a + Math.abs(net(h)), 0) / prior.length;
      }
      if (!flowDate || cur.date > flowDate) flowDate = cur.date;
    }

    stocks.push({
      ticker: s.code, name: s.name, market: quotes.market[s.code] || 'KOSPI',
      changePct, flow,
    });
    krPcts.push(changePct);
  });

  sec.us.forEach((s) => {
    const q = quotes.usQuote[s.symbol];
    const changePct = q ? q.changePct : 0;
    stocks.push({ ticker: s.symbol.replace(/\.[A-Z]$/, ''), name: s.name, market: 'US', changePct, flow: null });
    usPcts.push(changePct);
  });

  const netFlow = frgnFlow + orgFlow;

  // 평소 수급 규모로 정규화한 이례도. 평균이 0 근처여도 폭주하지 않는다.
  const flowChangePct = priorMeanAbsFlow > 0
    ? clampPct_(((netFlow - priorMeanFlow) / priorMeanAbsFlow) * 100)
    : 0;

  const news = fetchNewsVolume_(sec);
  const newsBase = computeNewsChange_(ss, sec.id, news.count);

  const allPcts = krPcts.concat(usPcts);
  return {
    id: sec.id, name: sec.name, icon: sec.icon,
    etfName: sec.etf ? sec.etf.name : '',
    netFlow: Math.round(netFlow),
    frgnFlow: Math.round(frgnFlow),
    orgFlow: Math.round(orgFlow),
    indiFlow: Math.round(indiFlow),
    flowChangePct,
    flowDate,
    avgChangePct: mean_(allPcts),
    krChangePct: mean_(krPcts),
    usChangePct: mean_(usPcts),
    newsVolume: news.count,
    newsKr: news.krCount,
    newsUs: news.usCount,
    newsChangePct: newsBase.changePct,
    newsBaselineReady: newsBase.ready,
    newsRaw: news.rawCount || 0,
    newsItems: news.items || [],
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

/* 구글뉴스 RSS를 쓴다. API 키가 필요 없고, 한국어(hl=ko)와 영어(hl=en) 양쪽을
   같은 방식으로 뽑을 수 있다. 미국 종목은 영어 원문이 한국 언론 번역보다
   몇 시간 빠르기 때문에 섹터마다 국내/해외 쿼리를 따로 둔다. */
function googleNewsUrl_(query, lang) {
  return lang === 'en'
    ? 'https://news.google.com/rss/search?q=' + encodeURIComponent(query) + '&hl=en-US&gl=US&ceid=US:en'
    : 'https://news.google.com/rss/search?q=' + encodeURIComponent(query) + '&hl=ko&gl=KR&ceid=KR:ko';
}

function parseRssItems_(xml) {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  return items.map((raw) => {
    const t = raw.match(/<title>([\s\S]*?)<\/title>/);
    const d = raw.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
    const l = raw.match(/<link>([\s\S]*?)<\/link>/);
    const rawTitle = t ? t[1] : '';
    return {
      title: cleanHeadline_(rawTitle),
      source: splitSource_(rawTitle),
      pubDate: d ? d[1].trim() : '',
      link: l ? l[1].trim() : '',
    };
  }).filter((it) => it.title);
}

/* 구글뉴스 제목은 "기사제목 - 매체명" 형태이고 HTML 엔티티가 섞여 있다. */
function decodeHeadline_(s) {
  let out = String(s).replace(/<!\[CDATA\[|\]\]>/g, '').trim();
  out = out.replace(/&quot;/g, '"').replace(/&#39;/g, "'")
           .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return out.replace(/<[^>]+>/g, '').trim();
}

/* 구글뉴스 제목은 "기사제목 - 매체명" 형태다 */
const SOURCE_SUFFIX = /\s+-\s+([^-]{2,30})$/;

function cleanHeadline_(s) {
  return decodeHeadline_(s).replace(SOURCE_SUFFIX, '').trim();
}

function splitSource_(s) {
  const m = decodeHeadline_(s).match(SOURCE_SUFFIX);
  return m ? m[1].trim() : '';
}

function countWithin24h_(items) {
  const now = Date.now();
  return items.filter((it) => {
    const t = new Date(it.pubDate).getTime();
    return isFinite(t) && now - t <= 24 * 60 * 60 * 1000;
  });
}

/* 증시와 무관한 기사가 섞이면 언급량이 뉴스 신호가 아니라 잡음이 된다.
   제목에 시장·주가 관련 단어가 하나도 없으면 집계에서 뺀다. */
const MARKET_WORDS_KR = ['주가', '주식', '증시', '코스피', '코스닥', '상장', '실적', '어닝',
  '매수', '매도', '급등', '급락', '강세', '약세', '목표주가', '수주', '공시', '투자', '수출',
  '영업이익', '적자', '흑자', '시총', '외국인', '기관', '반등', '조정'];
const MARKET_WORDS_EN = ['stock', 'shares', 'nasdaq', 'earnings', 'revenue', 'profit', 'guidance',
  'rally', 'plunge', 'surge', 'slump', 'analyst', 'upgrade', 'downgrade', 'market cap',
  'investor', 'outlook', 'forecast', 'buy rating', 'price target'];

function isMarketRelated_(title, lang) {
  const t = String(title || '');
  const words = lang === 'en' ? MARKET_WORDS_EN : MARKET_WORDS_KR;
  const hay = lang === 'en' ? t.toLowerCase() : t;
  for (let i = 0; i < words.length; i++) {
    if (hay.indexOf(words[i]) > -1) return true;
  }
  return false;
}

/* 같은 사건을 여러 매체가 쓰면 제목이 거의 같지만 [속보] 같은 말머리나
   어미가 달라 앞부분 비교로는 못 잡는다. 단어 집합이 얼마나 겹치는지로 판단한다. */
const NEWS_DUP_RATIO = 0.6;

function newsTokens_(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/\[[^\]]*\]|【[^】]*】|<[^>]*>/g, ' ')
    .replace(/[^0-9a-z가-힣]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

function tokenOverlap_(a, b) {
  if (!a.length || !b.length) return 0;
  const inA = {};
  a.forEach((w) => { inA[w] = true; });
  const counted = {};
  let inter = 0;
  b.forEach((w) => {
    if (inA[w] && !counted[w]) { counted[w] = true; inter++; }
  });
  const uniqA = Object.keys(inA).length;
  const uniqB = b.filter((w, i) => b.indexOf(w) === i).length;
  const union = uniqA + uniqB - inter;
  return union ? inter / union : 0;
}

function dedupeNews_(items) {
  const kept = [];
  const keptTokens = [];
  items.forEach((it) => {
    const tokens = newsTokens_(it.title);
    if (!tokens.length) return;
    for (let i = 0; i < keptTokens.length; i++) {
      if (tokenOverlap_(keptTokens[i], tokens) >= NEWS_DUP_RATIO) return;
    }
    kept.push(it);
    keptTokens.push(tokens);
  });
  return kept;
}

/* 뉴스는 10분마다 받을 이유가 없다. 1시간 캐시로 요청을 6분의 1로 줄인다. */
const NEWS_CACHE_SEC = 3600;

function fetchNewsVolume_(sec) {
  const cache = CacheService.getScriptCache();
  const ck = 'news|' + sec.id;
  try {
    const hit = cache.get(ck);
    if (hit) return JSON.parse(hit);
  } catch (e) { /* 무시 */ }

  const out = fetchNewsVolumeFresh_(sec);
  try { cache.put(ck, JSON.stringify(out), NEWS_CACHE_SEC); } catch (e) { /* 무시 */ }
  return out;
}

/* 국내/해외 피드를 각각 받아 24시간 건수를 센다.
   증시 무관 기사와 중복 기사를 뺀 뒤 세므로 예전보다 건수가 작게 나온다. */
function fetchNewsVolumeFresh_(sec) {
  const queries = [];
  if (sec.newsQueryKr) queries.push({ url: googleNewsUrl_(sec.newsQueryKr, 'ko'), lang: 'ko' });
  if (sec.newsQueryUs) queries.push({ url: googleNewsUrl_(sec.newsQueryUs, 'en'), lang: 'en' });
  const empty = { count: 0, krCount: 0, usCount: 0, rawCount: 0, items: [] };
  if (!queries.length) return empty;

  let responses;
  try {
    responses = UrlFetchApp.fetchAll(queries.map((q) => ({ url: q.url, muteHttpExceptions: true })));
  } catch (e) {
    return empty;
  }

  let krCount = 0;
  let usCount = 0;
  let rawCount = 0;
  let recent = [];

  responses.forEach((res, i) => {
    if (!res) return;
    const lang = queries[i].lang;
    try {
      const fresh = countWithin24h_(parseRssItems_(res.getContentText()));
      rawCount += fresh.length;
      const kept = dedupeNews_(fresh.filter((it) => isMarketRelated_(it.title, lang)))
        .map((it) => ({ title: it.title, source: it.source, link: it.link, pubDate: it.pubDate, lang: lang }));
      if (lang === 'ko') krCount = kept.length; else usCount = kept.length;
      recent = recent.concat(kept);
    } catch (e) { /* 한쪽 피드 실패는 무시 */ }
  });

  recent.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  return {
    count: krCount + usCount,
    krCount: krCount,
    usCount: usCount,
    rawCount: rawCount,
    items: recent.slice(0, 6),
  };
}

function computeNewsChange_(ss, sectorId, count) {
  const sheet = getOrCreateSheet_(ss, 'NewsDailyLog', ['date', 'sectorId', 'count']);
  const today = todayStr_();
  const rows = normalizeDateCol_(sheet.getDataRange().getValues().slice(1), 0);

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
  const existing = normalizeDateCol_(sheet.getDataRange().getValues().slice(1), 0);
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

    const news = fetchNewsVolume_(secCfg);
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
   ETF 구성종목 / 순유입
   ============================================================ */

const ETF_HOLDINGS_HEADERS = ['date', 'sectorId', 'etfCode', 'etfName', 'rank', 'itemCode', 'itemName', 'weight'];
const ETF_FLOW_HEADERS = ['date', 'sectorId', 'etfCode', 'etfName', 'inflow1d', 'inflow1w', 'inflow1m', 'marketValue'];

/* "4조 7,626억" / "-1,691억" 같은 한글 금액을 억 단위 숫자로 바꾼다 */
function parseKoreanAmount_(s) {
  const t = String(s == null ? '' : s).replace(/[,\s]/g, '');
  if (!t) return 0;
  const neg = t.indexOf('-') > -1;
  const jo = t.match(/(\d+(?:\.\d+)?)조/);
  const eok = t.match(/(-?\d+(?:\.\d+)?)억/);
  let v = 0;
  if (jo) v += parseFloat(jo[1]) * 10000;
  if (eok) v += Math.abs(parseFloat(eok[1]));
  if (!jo && !eok) v = Math.abs(parseFloat(t)) || 0;
  return neg ? -v : v;
}

/* ETF 구성종목은 리밸런싱으로 바뀐다. 날짜별 스냅샷으로 남겨야
   "그때는 무엇이 들어 있었나"를 나중에 확인할 수 있다. */
function syncEtfHoldings() {
  const ss = getDb_();
  const targets = SECTOR_CONFIG.filter((s) => s.etf);
  if (!targets.length) return { updated: 0 };

  const reqs = targets.map((s) => ({
    url: 'https://m.stock.naver.com/api/stock/' + s.etf.code + '/etfAnalysis',
    muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' },
  }));

  const today = todayStr_();
  const holdRows = [];
  const flowRows = [];

  fetchAllChunked_(reqs).forEach((res, i) => {
    if (!res) return;
    const sec = targets[i];
    let d;
    try { d = JSON.parse(res.getContentText()); } catch (e) { return; }
    const top = d.etfTop10MajorConstituentAssets || [];
    if (!top.length) return;

    top.forEach((a) => {
      holdRows.push([today, sec.id, sec.etf.code, d.itemName || sec.etf.name,
        Number(a.seq) || 0, "'" + padKrCode_(a.itemCode), String(a.itemName || ''),
        parseFloat(String(a.etfWeight || '0').replace('%', '')) || 0]);
    });

    const inf = d.cumulativeNetInflowList || {};
    flowRows.push([today, sec.id, sec.etf.code, d.itemName || sec.etf.name,
      parseKoreanAmount_(inf.cumulativeNetInflow1d),
      parseKoreanAmount_(inf.cumulativeNetInflow1w),
      parseKoreanAmount_(inf.cumulativeNetInflow1m),
      parseKoreanAmount_(d.marketValue)]);
  });

  if (holdRows.length) replaceRowsForDate_(getOrCreateSheet_(ss, 'EtfHoldings', ETF_HOLDINGS_HEADERS), today, holdRows);
  if (flowRows.length) replaceRowsForDate_(getOrCreateSheet_(ss, 'EtfFlow', ETF_FLOW_HEADERS), today, flowRows);
  return { updated: flowRows.length, holdings: holdRows.length };
}

/* 같은 날짜 행을 지우고 새로 넣는다 (하루 여러 번 돌려도 중복이 안 쌓인다) */
function replaceRowsForDate_(sheet, date, rows) {
  const values = sheet.getDataRange().getValues();
  const headers = values.shift();
  const kept = values.filter((r) => asDateStr_(r[0]) !== date);
  const all = kept.concat(rows);
  sheet.getRange(2, 1, Math.max(all.length, values.length), headers.length)
    .setValues(padRows_(all, Math.max(all.length, values.length), headers.length));
}

function padRows_(rows, n, cols) {
  const out = rows.slice();
  while (out.length < n) out.push(new Array(cols).fill(''));
  return out;
}

/* 섹터가 실제로 집계에 쓰는 국내 종목. ETF 스냅샷이 있으면 그걸,
   없으면 SECTOR_CONFIG의 수동 목록을 쓴다. */
function activeKrStocks_(ss) {
  const sheet = getOrCreateSheet_(ss, 'EtfHoldings', ETF_HOLDINGS_HEADERS);
  const rows = normalizeDateCol_(sheet.getDataRange().getValues().slice(1), 0);

  let latest = '';
  rows.forEach((r) => { if (r[0] > latest) latest = r[0]; });

  const bySector = {};
  if (latest) {
    rows.forEach((r) => {
      if (r[0] !== latest) return;
      const sid = r[1];
      if (!bySector[sid]) bySector[sid] = [];
      bySector[sid].push({ code: padKrCode_(r[5]), name: String(r[6]), weight: Number(r[7]) || 0 });
    });
    Object.keys(bySector).forEach((k) => bySector[k].sort((a, b) => b.weight - a.weight));
  }

  const out = {};
  SECTOR_CONFIG.forEach((sec) => {
    out[sec.id] = (bySector[sec.id] && bySector[sec.id].length) ? bySector[sec.id] : sec.kr.slice();
  });
  return out;
}

/* ============================================================
   섹터 일별 히스토리 (일/월/연 차트용)
   ============================================================ */

/* 시장(KOSPI/KOSDAQ/US)을 행으로 분리해 저장한다.
   수급은 국내 종목에만 존재하므로 US 행의 수급은 항상 0이다.
   netFlow는 예전 정의(외국인+기관)를 유지하고, 3주체를 각각 따로 남긴다. */
const SECTOR_DAILY_HEADERS = [
  'date', 'sectorId', 'market',
  'netFlow', 'frgnFlow', 'orgFlow', 'indiFlow',
  'avgChangePct', 'stockCount',
];

const TREND_PAGE_DAYS = 10;    // trend API가 한 번에 주는 거래일 수
const BACKFILL_TREND_PAGES = 40; // 10일 × 40 ≈ 400거래일
const BACKFILL_US_PAGES = 7;   // pageSize 60(API 상한) → 약 420거래일
const US_PRICE_PAGE_SIZE = 60; // 이 값을 넘기면 API가 에러 문자열을 돌려준다
const FETCH_CHUNK = 20;        // 네이버에 한 번에 몰지 않도록 나눠 보낸다
const QUOTE_BATCH = 20;        // 시세는 콤마로 묶어 한 번에 받는다

function numOf_(s) {
  return parseFloat(String(s == null ? '' : s).replace(/[,+%\s]/g, '')) || 0;
}

function trendUrl_(code, bizdate) {
  return 'https://m.stock.naver.com/api/stock/' + code + '/trend' + (bizdate ? '?bizdate=' + bizdate : '');
}

/* 투자자별 매매동향 API. 개인·외국인·기관을 모두 주고 JSON이라
   HTML 정규식 파싱보다 훨씬 덜 깨진다. 수량이므로 종가를 곱해 억원으로 환산한다.
   반환: [{date, closePrice, frgnFlow, orgFlow, indiFlow}] 최신일 우선 */
function parseTrendHistory_(text) {
  let arr;
  try { arr = JSON.parse(text); } catch (e) { return []; }
  if (!Array.isArray(arr)) return [];

  const out = [];
  arr.forEach((it) => {
    const bd = String(it.bizdate || '');
    if (bd.length !== 8) return;
    const close = numOf_(it.closePrice);
    if (!close) return;
    const toEok = (q) => Math.round((numOf_(q) * close) / 100000000);
    out.push({
      date: bd.slice(0, 4) + '-' + bd.slice(4, 6) + '-' + bd.slice(6, 8),
      closePrice: close,
      frgnFlow: toEok(it.foreignerPureBuyQuant),
      orgFlow: toEok(it.organPureBuyQuant),
      indiFlow: toEok(it.individualPureBuyQuant),
    });
  });
  return out;
}

/* refreshAll이 이미 종목마다 수급 이력을 받아놓는다. 그걸 그대로 저장하므로
   추가 네트워크 요청이 없다. 최근 며칠을 매번 덮어써서 실행이 빠진 날짜도 메워진다. */
function logSectorDailyFromQuotes_(ss, quotes) {
  const byKey = {};
  SECTOR_CONFIG.forEach((sec) => {
    (quotes.krStocks[sec.id] || []).forEach((s) => {
      addKrDaily_(byKey, sec.id, quotes.market[s.code] || 'KOSPI', quotes.krTrend[s.code]);
    });
  });
  if (!Object.keys(byKey).length) return;
  upsertSectorDailyTail_(getOrCreateSheet_(ss, 'SectorDaily', SECTOR_DAILY_HEADERS), byKey);
}

/* 등락률은 연속한 두 종가로 직접 계산한다. trend API는 등락률 자체를 주지 않는다. */
function addKrDaily_(byKey, sectorId, market, hist) {
  if (!hist || hist.length < 2) return;
  for (let i = 0; i < hist.length - 1; i++) {
    const cur = hist[i];
    const prev = hist[i + 1];
    if (!cur.date || !prev.closePrice) continue;
    const pct = +(((cur.closePrice / prev.closePrice) - 1) * 100).toFixed(2);
    bucketAdd_(byKey, cur.date, sectorId, market, cur, pct);
  }
}

function bucketAdd_(byKey, date, sectorId, market, flows, pct) {
  const k = date + '|' + sectorId + '|' + market;
  if (!byKey[k]) {
    byKey[k] = { date: date, sectorId: sectorId, market: market, frgn: 0, org: 0, indi: 0, pcts: [] };
  }
  const b = byKey[k];
  if (flows) {
    b.frgn += flows.frgnFlow || 0;
    b.org += flows.orgFlow || 0;
    b.indi += flows.indiFlow || 0;
  }
  if (isFinite(pct)) b.pcts.push(pct);
}

/* 시트는 'YYYY-MM-DD' 문자열을 날짜 셀로 자동 변환해서 읽을 때 Date 객체로 돌려준다.
   그대로 쓰면 (1) JSON에 UTC ISO로 직렬화돼 화면에 하루 전 날짜가 찍히고
   (2) `r[0] === todayStr_()` 문자열 비교가 항상 실패해 중복 행·중복 알림이 생긴다.
   시트에서 날짜를 읽는 모든 지점에서 이걸 통과시켜야 한다. */
function asDateStr_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd');
  }
  return String(v || '').slice(0, 10);
}

/* 시트가 '005930'을 숫자 5930으로 바꿔 앞자리 0을 날린다.
   한국 종목코드는 대부분 0으로 시작하므로 그대로 쓰면 조회가 통째로 실패한다.
   ETF 코드에는 '0117V0'처럼 문자가 섞여 있어 숫자일 때만 채운다. */
function padKrCode_(v) {
  const t = String(v == null ? '' : v).replace(/^'/, '').trim();
  if (!t) return '';
  return /^\d{1,6}$/.test(t) ? ('000000' + t).slice(-6) : t;
}

function normalizeDateCol_(rows, col) {
  rows.forEach((r) => { r[col] = asDateStr_(r[col]); });
  return rows;
}

/* refreshAll은 최근 10거래일만 건드리는데 7천 행 전체를 읽고 다시 쓰느라
   한 번에 7초씩 썼다. 시트를 날짜순으로 정렬해두면 최근 날짜가 끝에 몰리므로
   꼬리 일부만 읽고 쓰면 된다. */
const DAILY_TAIL_ROWS = 800;

function sortSectorDaily_(sheet) {
  const last = sheet.getLastRow();
  if (last < 3) return;
  sheet.getRange(2, 1, last - 1, SECTOR_DAILY_HEADERS.length).sort([{ column: 1, ascending: true }]);
}


/* 수급 조회가 일부 실패하면 적은 종목으로 계산된 합계가 만들어진다.
   그대로 덮어쓰면 이미 온전했던 과거 값이 깎인다. 종목 수가 줄면 건너뛴다. */
function keepsCoverage_(oldRow, newRow) {
  if (!oldRow) return true;
  const oldN = Number(oldRow[8]) || 0;
  const newN = Number(newRow[8]) || 0;
  return newN >= oldN;
}

function upsertSectorDailyTail_(sheet, byKey) {
  const W = SECTOR_DAILY_HEADERS.length;
  const last = sheet.getLastRow();
  const n = Math.min(DAILY_TAIL_ROWS, Math.max(0, last - 1));
  if (!n) return upsertSectorDaily_(sheet, byKey);

  const startRow = last - n + 1;
  const values = sheet.getRange(startRow, 1, n, W).getValues();
  const idx = {};
  let minDate = '9999-99-99';
  values.forEach((r, i) => {
    r[0] = asDateStr_(r[0]);
    if (r[0] && r[0] < minDate) minDate = r[0];
    idx[r[0] + '|' + r[1] + '|' + r[2]] = i;
  });

  // 꼬리가 날짜순이 아니면 앞쪽에 같은 키가 숨어 있을 수 있다 → 안전하게 전체 경로
  if (!(values[0][0] <= values[n - 1][0])) return upsertSectorDaily_(sheet, byKey);

  const added = [];
  let dirty = false;
  const keys = Object.keys(byKey);
  for (let i = 0; i < keys.length; i++) {
    const b = byKey[keys[i]];
    const row = [
      b.date, b.sectorId, b.market,
      Math.round(b.frgn + b.org), Math.round(b.frgn), Math.round(b.org), Math.round(b.indi),
      mean_(b.pcts), b.pcts.length,
    ];
    if (idx[keys[i]] !== undefined) {
      if (!keepsCoverage_(values[idx[keys[i]]], row)) continue;
      values[idx[keys[i]]] = row;
      dirty = true;
    }
    else if (b.date >= minDate) added.push(row);
    else return upsertSectorDaily_(sheet, byKey); // 꼬리 밖 과거 날짜
  }

  if (dirty) sheet.getRange(startRow, 1, n, W).setValues(values);
  if (added.length) sheet.getRange(last + 1, 1, added.length, W).setValues(added);
}

function upsertSectorDaily_(sheet, byKey) {
  const values = sheet.getDataRange().getValues();
  values.shift();

  const idx = {};
  values.forEach((r, i) => {
    r[0] = asDateStr_(r[0]);
    idx[r[0] + '|' + r[1] + '|' + r[2]] = i;
  });

  const added = [];
  Object.keys(byKey).forEach((k) => {
    const b = byKey[k];
    const row = [
      b.date, b.sectorId, b.market,
      Math.round(b.frgn + b.org), Math.round(b.frgn), Math.round(b.org), Math.round(b.indi),
      mean_(b.pcts), b.pcts.length,
    ];
    if (idx[k] !== undefined) {
      if (keepsCoverage_(values[idx[k]], row)) values[idx[k]] = row;
    } else added.push(row);
  });

  const all = values.concat(added);
  if (!all.length) return;
  sheet.getRange(2, 1, all.length, SECTOR_DAILY_HEADERS.length).setValues(all);
}

/* ============================================================
   과거 백필 (1회성, 커서로 이어달리기)
   ============================================================ */

function fetchAllChunked_(reqs) {
  const out = [];
  for (let i = 0; i < reqs.length; i += FETCH_CHUNK) {
    const part = reqs.slice(i, i + FETCH_CHUNK);
    try {
      UrlFetchApp.fetchAll(part).forEach((r) => out.push(r));
    } catch (e) {
      part.forEach(() => out.push(null));
    }
    if (i + FETCH_CHUNK < reqs.length) Utilities.sleep(300);
  }
  return out;
}

/* 이 API는 파라미터가 잘못되면 JSON이 아니라 평문 에러를 돌려준다 */
function parseUsPriceHistory_(text) {
  let arr;
  try { arr = JSON.parse(text); } catch (e) { return []; }
  if (!Array.isArray(arr)) return [];
  const out = [];
  arr.forEach((it) => {
    const date = String(it.localTradedAt || '').slice(0, 10);
    if (!date) return;
    out.push({ date: date, changePct: signedRatio_(it.fluctuationsRatio, it.compareToPreviousPrice) });
  });
  return out;
}

/* trend API는 bizdate를 커서로 그 날짜 이전 10거래일을 준다.
   페이지마다 앞 페이지의 가장 오래된 날짜를 넘겨 거슬러 올라간다. */
function fetchTrendDeep_(code, pages) {
  const seen = {};
  const hist = [];
  let cursor = '';

  for (let p = 0; p < pages; p++) {
    let res;
    try {
      res = UrlFetchApp.fetch(trendUrl_(code, cursor), { muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' } });
    } catch (e) { break; }
    const rows = parseTrendHistory_(res.getContentText());
    if (!rows.length) break;

    let added = 0;
    rows.forEach((r) => {
      if (seen[r.date]) return;
      seen[r.date] = true;
      hist.push(r);
      added++;
    });
    if (!added) break;

    cursor = hist[hist.length - 1].date.replace(/-/g, '');
    Utilities.sleep(120);
  }

  hist.sort((a, b) => (a.date < b.date ? 1 : -1));
  return hist;
}

function backfillSector_(sec, krStocks, marketOf) {
  const byKey = {};

  krStocks.forEach((s) => {
    addKrDaily_(byKey, sec.id, marketOf[s.code] || 'KOSPI', fetchTrendDeep_(s.code, BACKFILL_TREND_PAGES));
  });

  sec.us.forEach((s) => {
    const reqs = [];
    for (let p = 1; p <= BACKFILL_US_PAGES; p++) {
      reqs.push({
        url: 'https://api.stock.naver.com/stock/' + s.symbol + '/price?pageSize=' + US_PRICE_PAGE_SIZE + '&page=' + p,
        muteHttpExceptions: true,
      });
    }
    const seen = {};
    fetchAllChunked_(reqs).forEach((res) => {
      if (!res) return;
      try {
        parseUsPriceHistory_(res.getContentText()).forEach((d) => {
          if (seen[d.date]) return;
          seen[d.date] = true;
          bucketAdd_(byKey, d.date, sec.id, 'US', null, d.changePct);
        });
      } catch (e) { /* 페이지 하나 실패는 건너뛴다 */ }
    });
  });

  return byKey;
}

/* 섹터 단위로 끊어서 처리하고 커서를 저장한다. 한 번에 다 못 끝내면
   같은 주소를 다시 열어 이어서 진행하면 된다. */
function backfillSectorDaily_(maxMs) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) return { finished: false, done: 0, total: SECTOR_CONFIG.length, log: ['다른 작업이 시트를 쓰고 있어 건너뜁니다. 잠시 후 다시 열어주세요.'] };
  try { return backfillSectorDailyInner_(maxMs); } finally { lock.releaseLock(); }
}

function backfillSectorDailyInner_(maxMs) {
  const props = PropertiesService.getScriptProperties();
  const ss = getDb_();
  const sheet = getOrCreateSheet_(ss, 'SectorDaily', SECTOR_DAILY_HEADERS);
  const started = Date.now();
  const log = [];

  const active = activeKrStocks_(ss);
  const marketOf = loadMarketMap_(ss);

  let cursor = parseInt(props.getProperty('BACKFILL_CURSOR') || '0', 10);
  if (!(cursor >= 0)) cursor = 0;

  while (cursor < SECTOR_CONFIG.length && Date.now() - started < maxMs) {
    const sec = SECTOR_CONFIG[cursor];
    const byKey = backfillSector_(sec, active[sec.id] || [], marketOf);
    upsertSectorDaily_(sheet, byKey);
    log.push('✅ ' + sec.name + ' — ' + Object.keys(byKey).length + '행 (' + (active[sec.id] || []).length + '종목)');
    cursor++;
    props.setProperty('BACKFILL_CURSOR', String(cursor));
  }

  invalidateHistoryCache_();
  const finished = cursor >= SECTOR_CONFIG.length;
  if (finished) {
    props.deleteProperty('BACKFILL_CURSOR');
    sortSectorDaily_(sheet);
  }
  return { finished: finished, done: cursor, total: SECTOR_CONFIG.length, log: log };
}

/* 미국 종목은 refreshAll이 현재가만 받아서 일별 이력이 쌓이지 않는다.
   하루 한 번 최근 10거래일만 받아 메운다 (종목당 1요청). */
function syncUsDaily() {
  const ss = getDb_();
  const reqs = [];
  const meta = [];
  SECTOR_CONFIG.forEach((sec) => {
    sec.us.forEach((s) => {
      reqs.push({ url: 'https://api.stock.naver.com/stock/' + s.symbol + '/price?pageSize=10&page=1', muteHttpExceptions: true });
      meta.push(sec.id);
    });
  });

  const byKey = {};
  fetchAllChunked_(reqs).forEach((res, i) => {
    if (!res) return;
    try {
      parseUsPriceHistory_(res.getContentText()).forEach((d) => {
        bucketAdd_(byKey, d.date, meta[i], 'US', null, d.changePct);
      });
    } catch (e) { /* 무시 */ }
  });

  if (Object.keys(byKey).length) {
    upsertSectorDaily_(getOrCreateSheet_(ss, 'SectorDaily', SECTOR_DAILY_HEADERS), byKey);
    invalidateHistoryCache_();
  }
}

/* ============================================================
   일/월/연 집계 조회
   ============================================================ */

const HISTORY_LIMIT = { day: 400, month: 60, year: 20 };
const FLOW_COL = { net: 3, frgn: 4, org: 5, indi: 6 };

function bucketKey_(date, period) {
  if (period === 'year') return date.slice(0, 4);
  if (period === 'month') return date.slice(0, 7);
  return date;
}

function marketMatches_(mk, filter) {
  if (filter === 'all') return true;
  if (filter === 'kr') return mk === 'KOSPI' || mk === 'KOSDAQ';
  if (filter === 'kospi') return mk === 'KOSPI';
  if (filter === 'kosdaq') return mk === 'KOSDAQ';
  if (filter === 'us') return mk === 'US';
  return true;
}

/* 수급은 합계, 등락률은 누적 수익률(곱), 뉴스는 합계로 접는다.
   등락률을 평균이나 합으로 접으면 기간 수익률이 아닌 값이 나온다. */
/* 시트가 수천 행이라 매번 다시 접으면 6~15초가 걸린다.
   조합별로 캐시해두면 두 번째부터는 즉시 응답한다.
   refreshAll이 10분마다 도니 TTL도 10분으로 맞춘다. */
const HISTORY_CACHE_SEC = 3 * 3600;
const CACHE_MAX_BYTES = 90000; // CacheService 항목 상한(100KB)보다 여유 있게

function getHistory_(period, market, metric, investor, from, to) {
  const cacheKey = ['h', historyCacheVersion_(), period, market, metric, investor, from, to].join('|');
  const cache = CacheService.getScriptCache();
  try {
    const hit = cache.get(cacheKey);
    if (hit) return JSON.parse(hit);
  } catch (e) { /* 캐시 실패는 무시하고 새로 계산 */ }

  const out = computeHistory_(period, market, metric, investor, from, to);
  try {
    const json = JSON.stringify(out);
    if (json.length < CACHE_MAX_BYTES) cache.put(cacheKey, json, HISTORY_CACHE_SEC);
  } catch (e) { /* 무시 */ }
  return out;
}

function computeHistory_(period, market, metric, investor, from, to) {
  period = HISTORY_LIMIT[period] ? period : 'day';
  market = ['kr', 'us', 'kospi', 'kosdaq'].indexOf(market) > -1 ? market : 'all';
  metric = (metric === 'price' || metric === 'news') ? metric : 'flow';
  const flowCol = FLOW_COL[investor] !== undefined ? FLOW_COL[investor] : FLOW_COL.net;

  const ss = getDb_();
  const acc = {};
  const bucketSet = {};

  const touch = (sectorId, bucket) => {
    if (!acc[sectorId]) acc[sectorId] = {};
    if (!acc[sectorId][bucket]) acc[sectorId][bucket] = { flow: 0, pctByDate: {}, news: 0 };
    bucketSet[bucket] = true;
    return acc[sectorId][bucket];
  };

  const inRange = (d) => (!from || d >= from) && (!to || d <= to);

  if (metric === 'news') {
    const sheet = getOrCreateSheet_(ss, 'NewsDailyLog', ['date', 'sectorId', 'count']);
    sheet.getDataRange().getValues().slice(1).forEach((r) => {
      const date = asDateStr_(r[0]);
      if (!date || !inRange(date)) return;
      touch(r[1], bucketKey_(date, period)).news += Number(r[2]) || 0;
    });
  } else {
    const sheet = getOrCreateSheet_(ss, 'SectorDaily', SECTOR_DAILY_HEADERS);
    sheet.getDataRange().getValues().slice(1).forEach((r) => {
      const date = asDateStr_(r[0]);
      if (!date || !inRange(date)) return;
      if (!marketMatches_(String(r[2] || ''), market)) return;

      const b = touch(r[1], bucketKey_(date, period));
      b.flow += Number(r[flowCol]) || 0;
      // 같은 날 여러 시장 행이 오면 종목 수로 가중해 하루치 등락률을 하나로 만든다
      const n = Number(r[8]) || 0;
      if (n > 0) {
        if (!b.pctByDate[date]) b.pctByDate[date] = { sum: 0, n: 0 };
        b.pctByDate[date].sum += (Number(r[7]) || 0) * n;
        b.pctByDate[date].n += n;
      }
    });
  }

  const buckets = Object.keys(bucketSet).sort().slice(-HISTORY_LIMIT[period]);
  const series = SECTOR_CONFIG.map((sec) => {
    const rows = acc[sec.id] || {};
    return {
      sectorId: sec.id,
      name: sec.name,
      icon: sec.icon,
      points: buckets.map((bk) => {
        const b = rows[bk];
        if (!b) return null;
        if (metric === 'news') return b.news;
        if (metric === 'flow') return Math.round(b.flow);
        const dates = Object.keys(b.pctByDate);
        if (!dates.length) return null;
        let comp = 1;
        dates.forEach((d) => { comp *= 1 + (b.pctByDate[d].sum / b.pctByDate[d].n) / 100; });
        return +((comp - 1) * 100).toFixed(2);
      }),
    };
  }).filter((s) => s.points.some((p) => p !== null));

  return {
    period: period,
    market: market,
    metric: metric,
    investor: investor || 'net',
    unit: metric === 'flow' ? '억원' : metric === 'price' ? '%' : '건',
    buckets: buckets,
    series: series,
    constituents: historyConstituents_(ss),
    flowAvailable: market !== 'us',
  };
}

/* 어떤 종목으로 집계했는지 화면에서 확인할 수 있게 같이 내려보낸다 */
function historyConstituents_(ss) {
  const active = activeKrStocks_(ss);
  const out = {};
  SECTOR_CONFIG.forEach((sec) => {
    out[sec.id] = {
      etf: sec.etf ? sec.etf.name : '',
      kr: (active[sec.id] || []).map((s) => s.name),
      us: sec.us.map((s) => s.name),
    };
  });
  return out;
}

/* ============================================================
   일별 로그 / outcome
   ============================================================ */

/* 하루 한 행을 유지하되 갱신될 때마다 최신값으로 덮어쓴다.
   (예전 구현은 그날 첫 실행값만 남겨서 장 시작 직후의 0%에 가까운 값이 박혔다) */
function logDailySectorPct_(ss, sectorResults) {
  const sheet = getOrCreateSheet_(ss, 'SectorDailyLog', ['date', 'sectorId', 'avgChangePct']);
  const today = todayStr_();
  const rows = normalizeDateCol_(sheet.getDataRange().getValues().slice(1), 0);
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

  const events = normalizeDateCol_(eventSheet.getDataRange().getValues().slice(1), 0);
  const doneKeys = {};
  normalizeDateCol_(outcomeSheet.getDataRange().getValues().slice(1), 0).forEach((r) => { doneKeys[r[0] + '|' + r[1]] = true; });
  const logRows = normalizeDateCol_(logSheet.getDataRange().getValues().slice(1), 0);

  events.forEach((ev) => {
    const date = ev[0];
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
      frgnFlow: Number(o.frgnFlow) || 0,
      orgFlow: Number(o.orgFlow) || 0,
      indiFlow: Number(o.indiFlow) || 0,
      etfName: o.etfName || '',
      flowChangePct: Number(o.flowChangePct) || 0,
      flowDate: asDateStr_(o.flowDate),
      avgChangePct: Number(o.avgChangePct) || 0,
      krChangePct: Number(o.krChangePct) || 0,
      usChangePct: Number(o.usChangePct) || 0,
      newsVolume: Number(o.newsVolume) || 0,
      newsKr: Number(o.newsKr) || 0,
      newsUs: Number(o.newsUs) || 0,
      newsChangePct: Number(o.newsChangePct) || 0,
      newsBaselineReady: o.newsBaselineReady === true || o.newsBaselineReady === 'TRUE',
      newsRaw: Number(o.newsRaw) || 0,
      newsItems: safeParseJson_(o.newsItemsJson, []),
      stocks: safeParseJson_(o.stocksJson, []),
    };
  });

  const eventSheet = getOrCreateSheet_(ss, 'DropEvents', ['date', 'sectorId', 'sectorName', 'changePct', 'headline', 'tags', 'loggedAt']);
  const outcomeSheet = getOrCreateSheet_(ss, 'DropOutcomes', ['date', 'sectorId', 'outcomePct', 'positive', 'computedAt']);
  const outcomeMap = {};
  normalizeDateCol_(outcomeSheet.getDataRange().getValues().slice(1), 0).forEach((r) => {
    outcomeMap[r[0] + '|' + r[1]] = { pct: Number(r[2]), positive: r[3] === true || r[3] === 'TRUE' };
  });

  const events = normalizeDateCol_(eventSheet.getDataRange().getValues().slice(1), 0)
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

  const alertSheet = getOrCreateSheet_(ss, 'AlertLog', ALERT_HEADERS);
  const alerts = normalizeDateCol_(alertSheet.getDataRange().getValues().slice(1), 0)
    .map((r) => ({
      id: r[0] + '|' + r[1] + '|' + r[3],
      date: r[0],
      sectorId: r[1],
      sectorName: r[2],
      type: r[3],
      at: r[4] ? new Date(r[4]).toISOString() : '',
      body: String(r[5] || ''),
      direction: String(r[6] || 'caution'),
      headline: String(r[7] || ''),
      source: String(r[8] || ''),
      link: String(r[9] || ''),
      basis: safeParseJson_(r[10], []),
    }))
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, 30);

  return {
    sectors: sectors,
    events: events,
    alerts: alerts,
    newsEnabled: true, // 구글뉴스 RSS는 키가 필요 없어 항상 동작한다
    updatedAt: new Date().toISOString(),
  };
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

/* 알림은 카카오 연결 여부와 무관하게 항상 시트에 기록한다.
   웹 대시보드가 이 기록을 그대로 읽어 화면에 띄우고,
   카카오가 연결돼 있을 때만 추가로 카톡을 보낸다. */
/* 알림은 "무슨 일이 있었나 / 왜 떴나 / 좋은 신호인가"가 한눈에 보여야 한다.
   예전에는 괴리 %p만 던져서 사라는 건지 팔라는 건지 알 수 없었다.
   AlertLog 스키마: [date, sectorId, sectorName, type, sentAt, body, direction, headline, source, link, basisJson] */
const ALERT_HEADERS = ['date', 'sectorId', 'sectorName', 'type', 'sentAt', 'body',
  'direction', 'headline', 'source', 'link', 'basisJson'];

const ALERT_KIND = {
  inflow:  { label: '자금 유입',  icon: '💰', direction: 'positive' },
  outflow: { label: '자금 이탈',  icon: '🚪', direction: 'negative' },
  drop:    { label: '급락',       icon: '📉', direction: 'caution' },
  turn_buy:  { label: '수급 전환(매수)', icon: '🔄', direction: 'positive' },
  turn_sell: { label: '수급 전환(매도)', icon: '🔄', direction: 'negative' },
};

/* 연속 순매도 뒤 순매수로 돌아선 날을 잡는다. 방향이 바뀌는 지점이
   단순 크기보다 의미 있는 경우가 많다. */
function detectFlowTurn_(hist) {
  if (!hist || hist.length < 4) return null;
  const net = (h) => h.frgnFlow + h.orgFlow;
  const today = net(hist[0]);
  if (today === 0) return null;

  let streak = 0;
  for (let i = 1; i < hist.length; i++) {
    const v = net(hist[i]);
    if (today > 0 && v < 0) streak++;
    else if (today < 0 && v > 0) streak++;
    else break;
  }
  if (streak < 3) return null;
  return { streak: streak, today: today, kind: today > 0 ? 'turn_buy' : 'turn_sell' };
}

function checkAlerts_(ss, sectorResults, quotes) {
  const props = PropertiesService.getScriptProperties();
  const kakaoOn = props.getProperty(K_ALERTS_ON) === 'true' && !!props.getProperty(K_REFRESH);

  const sheet = getOrCreateSheet_(ss, 'AlertLog', ALERT_HEADERS);
  const today = todayStr_();
  const sent = {};
  normalizeDateCol_(sheet.getDataRange().getValues().slice(1), 0).forEach((r) => {
    if (r[0] === today) sent[r[1] + '|' + r[3]] = true;
  });

  const queue = [];

  sectorResults.forEach((r) => {
    const news = topNewsFor_(r);

    // 1) 급락 — 판단이 가장 명확하다
    if (r.avgChangePct <= DROP_THRESHOLD_PCT && !sent[r.id + '|drop']) {
      queue.push(buildAlert_('drop', r, news, [
        ['섹터 평균 등락률', fmtSigned_(r.avgChangePct) + '%', '기준 ' + DROP_THRESHOLD_PCT + '% 이하'],
        hasFlow_(r) ? ['외국인·기관 수급', fmtFlowEok_(r.netFlow), '평소 대비 ' + fmtSigned_(r.flowChangePct) + '%'] : null,
      ]));
    }

    // 2) 자금 유입/이탈 — 평소 수급 규모로 정규화한 이례도
    if (hasFlow_(r) && Math.abs(r.flowChangePct) >= SIGNAL_THRESHOLD) {
      const kind = r.flowChangePct > 0 ? 'inflow' : 'outflow';
      if (!sent[r.id + '|' + kind]) {
        queue.push(buildAlert_(kind, r, news, [
          ['외국인·기관 순매매', fmtFlowEok_(r.netFlow), '평소 대비 ' + fmtSigned_(r.flowChangePct) + '%'],
          ['외국인', fmtFlowEok_(r.frgnFlow), ''],
          ['기관', fmtFlowEok_(r.orgFlow), ''],
          ['개인', fmtFlowEok_(r.indiFlow), '개인은 보통 반대로 움직인다'],
          ['기준일', r.flowDate || '-', '수급은 전 거래일 확정치'],
        ]));
      }
    }

    // 3) 수급 전환 — 연속 매도/매수가 끊긴 날
    const turn = sectorTurn_(r, quotes);
    if (turn && !sent[r.id + '|' + turn.kind]) {
      queue.push(buildAlert_(turn.kind, r, news, [
        ['직전 흐름', turn.streak + '거래일 연속 ' + (turn.kind === 'turn_buy' ? '순매도' : '순매수'), ''],
        ['오늘', fmtFlowEok_(turn.today), turn.kind === 'turn_buy' ? '매수로 전환' : '매도로 전환'],
        ['기준일', r.flowDate || '-', ''],
      ]));
    }
  });

  queue.slice(0, MAX_ALERTS_PER_RUN).forEach((q) => {
    sheet.appendRow([today, q.sectorId, q.sectorName, q.type, new Date().toISOString(), q.body,
      q.direction, q.headline, q.source, q.link, JSON.stringify(q.basis)]);
    if (kakaoOn) sendKakao_(q.body);
  });
}

/* 섹터 안의 종목 수급 이력을 합쳐 전환 여부를 본다 */
function sectorTurn_(r, quotes) {
  if (!quotes || !quotes.krStocks || !hasFlow_(r)) return null;
  const list = quotes.krStocks[r.id] || [];
  if (!list.length) return null;

  const merged = [];
  list.forEach((s) => {
    (quotes.krTrend[s.code] || []).forEach((h, i) => {
      if (!merged[i]) merged[i] = { frgnFlow: 0, orgFlow: 0 };
      merged[i].frgnFlow += h.frgnFlow;
      merged[i].orgFlow += h.orgFlow;
    });
  });
  return detectFlowTurn_(merged);
}

function hasFlow_(r) {
  return (r.stocks || []).some(function (s) { return s.flow != null; });
}

function fmtSigned_(n) {
  return (n > 0 ? '+' : '') + n;
}

function fmtFlowEok_(n) {
  const v = Math.round(Number(n) || 0);
  return (v >= 0 ? '+' : '') + v.toLocaleString('en-US') + '억';
}

function topNewsFor_(r) {
  const items = (r.newsItems || []);
  return items.length ? items[0] : null;
}

function buildAlert_(kind, r, news, basisRaw) {
  const meta = ALERT_KIND[kind];
  const basis = (basisRaw || []).filter(Boolean).map((b) => ({ label: b[0], value: b[1], note: b[2] || '' }));

  const lines = [meta.icon + ' [' + r.name + '] ' + meta.label];
  basis.slice(0, 3).forEach((b) => lines.push(b.label + ' ' + b.value + (b.note ? ' (' + b.note + ')' : '')));
  if (news && news.title) lines.push('· ' + news.title + (news.source ? ' — ' + news.source : ''));

  return {
    sectorId: r.id, sectorName: r.name, type: kind,
    direction: meta.direction,
    body: lines.join('\n'),
    headline: news ? news.title : '',
    source: news ? news.source : '',
    link: news ? news.link : '',
    basis: basis,
  };
}

function latestHeadline_(ss, today, sectorId) {
  const sheet = getOrCreateSheet_(ss, 'DropEvents', ['date', 'sectorId', 'sectorName', 'changePct', 'headline', 'tags', 'loggedAt']);
  const rows = normalizeDateCol_(sheet.getDataRange().getValues().slice(1), 0);
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

/* 키를 일일이 지우는 대신 버전을 올린다. 기간 지정처럼 조합이 무한한 키도 한 번에 무효화된다. */
function historyCacheVersion_() {
  const cache = CacheService.getScriptCache();
  let v = cache.get('hver');
  if (!v) {
    v = Utilities.getUuid();
    cache.put('hver', v, 21600);
  }
  return v;
}

/* 타임스탬프를 쓰면 같은 밀리초 안에 두 번 무효화될 때 값이 그대로라 캐시가 안 비워진다 */
function invalidateHistoryCache_() {
  try { CacheService.getScriptCache().put('hver', Utilities.getUuid(), 21600); } catch (e) { /* 무시 */ }
}

/* 알림 스키마가 6열 → 11열로 늘었다. 옛 행은 근거·출처가 없어 화면에서
   본문만 보여주게 되므로, 헤더만 새로 맞추고 기존 행은 그대로 둔다. */
function migrateAlertLog_() {
  const ss = getDb_();
  const sheet = getOrCreateSheet_(ss, 'AlertLog', ALERT_HEADERS);
  const width = sheet.getLastColumn();
  if (width >= ALERT_HEADERS.length) return;
  sheet.getRange(1, 1, 1, ALERT_HEADERS.length).setValues([ALERT_HEADERS]);
}

/* 어디서 시간이 가는지 실측한다. 추측으로 최적화하면 엉뚱한 데를 고친다. */
function profileRefresh_() {
  const t = [];
  let last = Date.now();
  const mark = (label) => { const now = Date.now(); t.push([label, now - last]); last = now; };

  const ss = getDb_();
  mark('시트 열기');
  const quotes = fetchAllMarketData_(ss);
  mark('시세·수급 수집');
  const results = SECTOR_CONFIG.map((sec) => buildSectorSnapshot_(ss, sec, quotes));
  mark('스냅샷 생성(뉴스 포함)');

  const sectorSheet = getOrCreateSheet_(ss, 'SectorSnapshot', SECTOR_HEADERS);
  writeRows_(sectorSheet, results.map((r) => [
    r.id, r.name, r.icon, r.netFlow, r.flowChangePct, r.flowDate,
    r.avgChangePct, r.krChangePct, r.usChangePct,
    r.newsVolume, r.newsKr, r.newsUs, r.newsChangePct, r.newsBaselineReady,
    JSON.stringify(r.stocks), new Date().toISOString(),
    r.frgnFlow, r.orgFlow, r.indiFlow, r.etfName, r.newsRaw, JSON.stringify(r.newsItems || []),
  ]));
  mark('스냅샷 쓰기');

  logDailySectorPct_(ss, results);
  mark('일별 등락률 로그');
  logSectorDailyFromQuotes_(ss, quotes);
  mark('SectorDaily upsert');
  detectDropEvents_(ss, results);
  mark('하락 이벤트');
  checkAlerts_(ss, results, quotes);
  mark('알림');

  const total = t.reduce((a, x) => a + x[1], 0);
  return { totalMs: total, steps: t, sectorDailyRows: getOrCreateSheet_(ss, 'SectorDaily', SECTOR_DAILY_HEADERS).getLastRow() - 1 };
}

function hasEtfHoldings_(ss) {
  return getOrCreateSheet_(ss, 'EtfHoldings', ETF_HOLDINGS_HEADERS).getLastRow() > 1;
}
