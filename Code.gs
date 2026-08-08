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
    // 편집기에 들어가지 않고 주소창만으로 트리거를 걸 수 있게 열어둔다
    if (action === 'setup') return htmlOut_('설정 점검 결과', setup().split('\n').join('<br>'));
    if (action === 'status') return jsonOut_(systemStatus_());
    if (action === 'history') return jsonOut_(getHistory_(params.period, params.market, params.metric));
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
  const managed = ['refreshAll', 'backfillOutcomes', 'syncUsDaily'];
  ScriptApp.getProjectTriggers().forEach((t) => {
    if (managed.indexOf(t.getHandlerFunction()) > -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('refreshAll').timeBased().everyMinutes(REFRESH_INTERVAL_MIN).create();
  ScriptApp.newTrigger('backfillOutcomes').timeBased().everyDays(1).atHour(8).create();
  ScriptApp.newTrigger('syncUsDaily').timeBased().everyDays(1).atHour(8).create();
  refreshAll();
}

/* ============================================================
   메인 갱신
   ============================================================ */

const SECTOR_HEADERS = [
  'id', 'name', 'icon', 'netFlow', 'flowChangePct', 'flowDate',
  'avgChangePct', 'krChangePct', 'usChangePct',
  'newsVolume', 'newsKr', 'newsUs', 'newsChangePct', 'newsBaselineReady', 'stocksJson', 'updatedAt',
];

function refreshAll() {
  const ss = getDb_();
  const quotes = fetchAllMarketData_();

  const results = SECTOR_CONFIG.map((sec) => buildSectorSnapshot_(ss, sec, quotes));

  const sectorSheet = getOrCreateSheet_(ss, 'SectorSnapshot', SECTOR_HEADERS);
  writeRows_(sectorSheet, results.map((r) => [
    r.id, r.name, r.icon, r.netFlow, r.flowChangePct, r.flowDate,
    r.avgChangePct, r.krChangePct, r.usChangePct,
    r.newsVolume, r.newsKr, r.newsUs, r.newsChangePct, r.newsBaselineReady,
    JSON.stringify(r.stocks), new Date().toISOString(),
  ]));

  logDailySectorPct_(ss, results);
  logSectorDailyFromQuotes_(ss, quotes);
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

  const news = fetchNewsVolume_(sec);
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
    newsKr: news.krCount,
    newsUs: news.usCount,
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
    return {
      title: t ? cleanHeadline_(t[1]) : '',
      pubDate: d ? d[1].trim() : '',
      link: l ? l[1].trim() : '',
    };
  }).filter((it) => it.title);
}

/* 구글뉴스 제목은 "기사제목 - 매체명" 형태이고 HTML 엔티티가 섞여 있다. */
function cleanHeadline_(s) {
  let out = String(s).replace(/<!\[CDATA\[|\]\]>/g, '').trim();
  out = out.replace(/&quot;/g, '"').replace(/&#39;/g, "'")
           .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  out = out.replace(/<[^>]+>/g, '');
  return out.replace(/\s+-\s+[^-]{2,30}$/, '').trim();
}

function countWithin24h_(items) {
  const now = Date.now();
  return items.filter((it) => {
    const t = new Date(it.pubDate).getTime();
    return isFinite(t) && now - t <= 24 * 60 * 60 * 1000;
  });
}

/* 국내/해외 피드를 각각 받아 24시간 건수를 합산한다. */
function fetchNewsVolume_(sec) {
  const queries = [];
  if (sec.newsQueryKr) queries.push({ url: googleNewsUrl_(sec.newsQueryKr, 'ko'), lang: 'ko' });
  if (sec.newsQueryUs) queries.push({ url: googleNewsUrl_(sec.newsQueryUs, 'en'), lang: 'en' });
  if (!queries.length) return { count: 0, krCount: 0, usCount: 0, items: [] };

  let responses;
  try {
    responses = UrlFetchApp.fetchAll(queries.map((q) => ({ url: q.url, muteHttpExceptions: true })));
  } catch (e) {
    return { count: 0, krCount: 0, usCount: 0, items: [] };
  }

  let krCount = 0;
  let usCount = 0;
  let recent = [];
  responses.forEach((res, i) => {
    if (!res) return;
    try {
      const fresh = countWithin24h_(parseRssItems_(res.getContentText()));
      if (queries[i].lang === 'ko') krCount = fresh.length; else usCount = fresh.length;
      recent = recent.concat(fresh);
    } catch (e) { /* 한쪽 피드 실패는 무시 */ }
  });

  recent.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  return {
    count: krCount + usCount,
    krCount: krCount,
    usCount: usCount,
    items: recent.slice(0, 5),
  };
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
   섹터 일별 히스토리 (일/월/연 차트용)
   ============================================================ */

/* 시장(KR/US)을 행으로 분리해 저장한다 — 국장/미장 탭과 그대로 맞물린다.
   수급은 국내 종목에만 존재하므로 US 행의 netFlow는 항상 0이다. */
const SECTOR_DAILY_HEADERS = ['date', 'sectorId', 'market', 'netFlow', 'avgChangePct', 'stockCount'];

const BACKFILL_KR_PAGES = 20; // frgn 페이지당 20거래일 → 약 400거래일
const BACKFILL_US_PAGES = 7;  // pageSize 60(API 상한) → 약 420거래일
const US_PRICE_PAGE_SIZE = 60; // 이 값을 넘기면 API가 에러 문자열을 돌려준다
const FETCH_CHUNK = 20;       // 네이버에 한 번에 몰지 않도록 나눠 보낸다

/* refreshAll이 이미 종목마다 20거래일치 수급 이력을 받아놓고 최신 하루만 쓰고 버린다.
   그걸 그대로 저장하므로 추가 네트워크 요청이 없다. 최근 20거래일을 매번 덮어써서
   중간에 실행이 빠진 날짜도 저절로 메워진다. */
function logSectorDailyFromQuotes_(ss, quotes) {
  const byKey = {};
  SECTOR_CONFIG.forEach((sec) => {
    sec.kr.forEach((s) => {
      addKrDaily_(byKey, sec.id, quotes.krFlow[s.code]);
    });
  });
  if (!Object.keys(byKey).length) return;
  upsertSectorDaily_(getOrCreateSheet_(ss, 'SectorDaily', SECTOR_DAILY_HEADERS), byKey);
}

/* 등락률은 연속한 두 종가에서 직접 계산한다. 매매동향 페이지의 등락률 칸은
   부호가 별도 스타일로만 표시돼 텍스트만으로는 방향을 알 수 없다. */
function addKrDaily_(byKey, sectorId, hist) {
  if (!hist || hist.length < 2) return;
  for (let i = 0; i < hist.length - 1; i++) {
    const cur = hist[i];
    const prev = hist[i + 1];
    if (!cur.date || !prev.closePrice) continue;
    const pct = +(((cur.closePrice / prev.closePrice) - 1) * 100).toFixed(2);
    bucketAdd_(byKey, cur.date, sectorId, 'KR', cur.flow, pct);
  }
}

function bucketAdd_(byKey, date, sectorId, market, flow, pct) {
  const k = date + '|' + sectorId + '|' + market;
  if (!byKey[k]) byKey[k] = { date: date, sectorId: sectorId, market: market, flow: 0, pcts: [] };
  byKey[k].flow += flow || 0;
  if (isFinite(pct)) byKey[k].pcts.push(pct);
}

/* 시트에서 읽은 날짜는 Date로 역변환돼 올 수 있어 항상 문자열로 맞춘다 */
function asDateStr_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd');
  }
  return String(v || '').slice(0, 10);
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
    const row = [b.date, b.sectorId, b.market, Math.round(b.flow), mean_(b.pcts), b.pcts.length];
    if (idx[k] !== undefined) values[idx[k]] = row;
    else added.push(row);
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

function backfillSector_(sec) {
  const byKey = {};

  sec.kr.forEach((s) => {
    const reqs = [];
    for (let p = 1; p <= BACKFILL_KR_PAGES; p++) {
      reqs.push({
        url: 'https://finance.naver.com/item/frgn.naver?code=' + s.code + '&page=' + p,
        muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' },
      });
    }
    const seen = {};
    const hist = [];
    fetchAllChunked_(reqs).forEach((res) => {
      if (!res) return;
      try {
        parseKrFlowHistory_(res.getContentText()).forEach((h) => {
          if (seen[h.date]) return;
          seen[h.date] = true;
          hist.push(h);
        });
      } catch (e) { /* 페이지 하나 실패는 건너뛴다 */ }
    });
    hist.sort((a, b) => (a.date < b.date ? 1 : -1));
    addKrDaily_(byKey, sec.id, hist);
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
          bucketAdd_(byKey, d.date, sec.id, 'US', 0, d.changePct);
        });
      } catch (e) { /* 페이지 하나 실패는 건너뛴다 */ }
    });
  });

  return byKey;
}

/* 섹터 단위로 끊어서 처리하고 커서를 저장한다. 한 번에 다 못 끝내면
   같은 주소를 다시 열어 이어서 진행하면 된다. */
function backfillSectorDaily_(maxMs) {
  const props = PropertiesService.getScriptProperties();
  const ss = getDb_();
  const sheet = getOrCreateSheet_(ss, 'SectorDaily', SECTOR_DAILY_HEADERS);
  const started = Date.now();
  const log = [];

  let cursor = parseInt(props.getProperty('BACKFILL_CURSOR') || '0', 10);
  if (!(cursor >= 0)) cursor = 0;

  while (cursor < SECTOR_CONFIG.length && Date.now() - started < maxMs) {
    const sec = SECTOR_CONFIG[cursor];
    const byKey = backfillSector_(sec);
    upsertSectorDaily_(sheet, byKey);
    log.push('✅ ' + sec.name + ' — ' + Object.keys(byKey).length + '행');
    cursor++;
    props.setProperty('BACKFILL_CURSOR', String(cursor));
  }

  const finished = cursor >= SECTOR_CONFIG.length;
  if (finished) props.deleteProperty('BACKFILL_CURSOR');
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
        bucketAdd_(byKey, d.date, meta[i], 'US', 0, d.changePct);
      });
    } catch (e) { /* 무시 */ }
  });

  if (Object.keys(byKey).length) {
    upsertSectorDaily_(getOrCreateSheet_(ss, 'SectorDaily', SECTOR_DAILY_HEADERS), byKey);
  }
}

/* ============================================================
   일/월/연 집계 조회
   ============================================================ */

const HISTORY_LIMIT = { day: 120, month: 36, year: 20 };

function bucketKey_(date, period) {
  if (period === 'year') return date.slice(0, 4);
  if (period === 'month') return date.slice(0, 7);
  return date;
}

/* 수급은 합계, 등락률은 누적 수익률(곱), 뉴스는 합계로 접는다.
   등락률을 평균이나 합으로 접으면 기간 수익률이 아닌 값이 나온다. */
function getHistory_(period, market, metric) {
  period = HISTORY_LIMIT[period] ? period : 'day';
  market = (market === 'kr' || market === 'us') ? market : 'all';
  metric = (metric === 'price' || metric === 'news') ? metric : 'flow';

  const ss = getDb_();
  const acc = {}; // sectorId → bucket → {flow, pctByDate:{date:{sum,n}}, news}
  const bucketSet = {};

  const touch = (sectorId, bucket) => {
    if (!acc[sectorId]) acc[sectorId] = {};
    if (!acc[sectorId][bucket]) acc[sectorId][bucket] = { flow: 0, pctByDate: {}, news: 0 };
    bucketSet[bucket] = true;
    return acc[sectorId][bucket];
  };

  if (metric === 'news') {
    const sheet = getOrCreateSheet_(ss, 'NewsDailyLog', ['date', 'sectorId', 'count']);
    sheet.getDataRange().getValues().slice(1).forEach((r) => {
      const date = asDateStr_(r[0]);
      if (!date) return;
      touch(r[1], bucketKey_(date, period)).news += Number(r[2]) || 0;
    });
  } else {
    const sheet = getOrCreateSheet_(ss, 'SectorDaily', SECTOR_DAILY_HEADERS);
    sheet.getDataRange().getValues().slice(1).forEach((r) => {
      const date = asDateStr_(r[0]);
      if (!date) return;
      const mk = String(r[2] || '');
      if (market === 'kr' && mk !== 'KR') return;
      if (market === 'us' && mk !== 'US') return;

      const b = touch(r[1], bucketKey_(date, period));
      b.flow += Number(r[3]) || 0;
      // 같은 날 KR/US 두 행이 오면 종목 수로 가중해 하루치 등락률을 하나로 만든다
      const n = Number(r[5]) || 0;
      if (n > 0) {
        if (!b.pctByDate[date]) b.pctByDate[date] = { sum: 0, n: 0 };
        b.pctByDate[date].sum += (Number(r[4]) || 0) * n;
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
    unit: metric === 'flow' ? '억원' : metric === 'price' ? '%' : '건',
    buckets: buckets,
    series: series,
    flowAvailable: market !== 'us',
  };
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
      newsKr: Number(o.newsKr) || 0,
      newsUs: Number(o.newsUs) || 0,
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

  const alertSheet = getOrCreateSheet_(ss, 'AlertLog', ['date', 'sectorId', 'sectorName', 'type', 'sentAt', 'body']);
  const alerts = alertSheet.getDataRange().getValues().slice(1)
    .map((r) => ({
      id: String(r[0]) + '|' + r[1] + '|' + r[3],
      date: String(r[0]),
      sectorId: r[1],
      sectorName: r[2],
      type: r[3],
      at: r[4] ? new Date(r[4]).toISOString() : '',
      body: String(r[5] || ''),
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
function checkAlerts_(ss, sectorResults) {
  const props = PropertiesService.getScriptProperties();
  const kakaoOn = props.getProperty(K_ALERTS_ON) === 'true' && !!props.getProperty(K_REFRESH);

  const sheet = getOrCreateSheet_(ss, 'AlertLog', ['date', 'sectorId', 'sectorName', 'type', 'sentAt', 'body']);
  const today = todayStr_();
  const sent = {};
  sheet.getDataRange().getValues().slice(1).forEach((r) => {
    if (r[0] === today) sent[r[1] + '|' + r[3]] = true;
  });

  const queue = [];

  sectorResults.forEach((r) => {
    if (r.avgChangePct <= DROP_THRESHOLD_PCT && !sent[r.id + '|drop']) {
      const lines = ['📉 [' + r.name + '] ' + r.avgChangePct + '% 하락'];
      if (hasFlow_(r)) lines.push('자금 평소 대비 ' + fmtSigned_(r.flowChangePct) + '%');
      const headline = latestHeadline_(ss, today, r.id);
      if (headline) lines.push(headline);
      queue.push({ sectorId: r.id, sectorName: r.name, type: 'drop', body: lines.join('\n') });
    }

    const divergence = +(r.flowChangePct - r.newsChangePct).toFixed(1);
    if (hasFlow_(r) && r.newsBaselineReady && Math.abs(divergence) >= SIGNAL_THRESHOLD && !sent[r.id + '|signal']) {
      queue.push({
        sectorId: r.id, sectorName: r.name, type: 'signal',
        body: (divergence > 0 ? '📈' : '⚠️') + ' [' + r.name + '] 선제 신호 ' + (divergence > 0 ? '+' : '') + divergence + '%p\n'
            + '자금 ' + fmtSigned_(r.flowChangePct) + '% / 뉴스 ' + fmtSigned_(r.newsChangePct) + '% (평소 대비)\n'
            + '수급 기준일 ' + (r.flowDate || '-'),
      });
    }
  });

  queue.slice(0, MAX_ALERTS_PER_RUN).forEach((q) => {
    sheet.appendRow([today, q.sectorId, q.sectorName, q.type, new Date().toISOString(), q.body]);
    if (kakaoOn) sendKakao_(q.body);
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
