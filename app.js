/* ============================================================
   데이터 레이어
   지금은 전부 샘플(mock) 데이터. 실제 연동 시 아래 SECTORS / EVENTS를
   fetchSectorData() / fetchDropEvents() 같은 async 함수로 바꿔서
   네이버금융 크롤링 결과(GAS 백엔드가 캐싱해둔 값)를 채우면 된다.
   구조(필드명)는 그대로 유지하는 걸 추천.
   ============================================================ */

const SECTORS = [
  {
    id: 'bigtech', name: '빅테크', icon: '💻',
    netFlow: 1240, flowChangePct: 3.2,
    newsVolume: 128, newsChangePct: 14,
    stocks: [
      { ticker: 'AAPL', name: '애플', market: 'US', changePct: 1.2, flow: 320 },
      { ticker: 'MSFT', name: '마이크로소프트', market: 'US', changePct: 0.8, flow: 410 },
      { ticker: 'GOOGL', name: '알파벳', market: 'US', changePct: -0.4, flow: -60 },
      { ticker: 'AMZN', name: '아마존', market: 'US', changePct: 2.1, flow: 380 },
      { ticker: 'META', name: '메타', market: 'US', changePct: 1.6, flow: 190 },
    ],
  },
  {
    id: 'semi', name: '반도체', icon: '🔧',
    netFlow: -860, flowChangePct: -5.4,
    newsVolume: 96, newsChangePct: 41,
    stocks: [
      { ticker: 'NVDA', name: '엔비디아', market: 'US', changePct: -2.8, flow: -420 },
      { ticker: '005930', name: '삼성전자', market: 'KR', changePct: -1.1, flow: -180 },
      { ticker: '000660', name: 'SK하이닉스', market: 'KR', changePct: -1.9, flow: -210 },
      { ticker: 'TSM', name: 'TSMC', market: 'US', changePct: -0.6, flow: -30 },
      { ticker: 'AMD', name: 'AMD', market: 'US', changePct: -1.3, flow: -20 },
    ],
  },
  {
    id: 'software', name: '소프트웨어', icon: '🖥️',
    netFlow: 410, flowChangePct: 1.8,
    newsVolume: 54, newsChangePct: 6,
    stocks: [
      { ticker: 'CRM', name: '세일즈포스', market: 'US', changePct: 0.9, flow: 90 },
      { ticker: 'ORCL', name: '오라클', market: 'US', changePct: 1.1, flow: 120 },
      { ticker: '035420', name: '네이버', market: 'KR', changePct: 0.5, flow: 60 },
      { ticker: '035720', name: '카카오', market: 'KR', changePct: -0.8, flow: -40 },
      { ticker: 'ADBE', name: '어도비', market: 'US', changePct: 1.4, flow: 180 },
    ],
  },
  {
    id: 'finance', name: '금융', icon: '🏦',
    netFlow: 300, flowChangePct: 0.9,
    newsVolume: 38, newsChangePct: -12,
    stocks: [
      { ticker: 'JPM', name: 'JP모건', market: 'US', changePct: 0.4, flow: 70 },
      { ticker: '105560', name: 'KB금융', market: 'KR', changePct: 0.6, flow: 80 },
      { ticker: '055550', name: '신한지주', market: 'KR', changePct: 0.3, flow: 40 },
      { ticker: '086790', name: '하나금융지주', market: 'KR', changePct: 0.2, flow: 30 },
      { ticker: 'BAC', name: '뱅크오브아메리카', market: 'US', changePct: 0.5, flow: 80 },
    ],
  },
  {
    id: 'battery', name: '2차전지·에너지', icon: '🔋',
    netFlow: -520, flowChangePct: -3.9,
    newsVolume: 71, newsChangePct: 22,
    stocks: [
      { ticker: 'TSLA', name: '테슬라', market: 'US', changePct: -2.2, flow: -220 },
      { ticker: '373220', name: 'LG에너지솔루션', market: 'KR', changePct: -1.7, flow: -160 },
      { ticker: '006400', name: '삼성SDI', market: 'KR', changePct: -1.5, flow: -90 },
      { ticker: 'ENPH', name: '엔페이즈', market: 'US', changePct: -3.1, flow: -50 },
    ],
  },
  {
    id: 'health', name: '헬스케어·바이오', icon: '🧬',
    netFlow: 260, flowChangePct: 2.4,
    newsVolume: 29, newsChangePct: 3,
    stocks: [
      { ticker: 'LLY', name: '일라이릴리', market: 'US', changePct: 1.3, flow: 110 },
      { ticker: '207940', name: '삼성바이오로직스', market: 'KR', changePct: 0.7, flow: 70 },
      { ticker: '068270', name: '셀트리온', market: 'KR', changePct: -0.3, flow: -20 },
      { ticker: 'UNH', name: '유나이티드헬스', market: 'US', changePct: 0.9, flow: 100 },
    ],
  },
];

const EVENTS = [
  {
    date: '2026-07-18', sector: '반도체', changePct: -4.1,
    headline: 'AI 반도체 수출규제 우려 확산, 필라델피아 반도체지수 급락',
    tags: ['규제 우려', '반도체'],
    outcome: { days: 20, pct: 9.6, positive: true },
  },
  {
    date: '2026-05-06', sector: '2차전지·에너지', changePct: -3.5,
    headline: '전기차 수요 둔화 지표 발표, 배터리 밸류체인 동반 하락',
    tags: ['수요 둔화', '실적 우려'],
    outcome: { days: 20, pct: 6.1, positive: true },
  },
  {
    date: '2026-03-10', sector: '빅테크', changePct: -3.0,
    headline: '미 국채금리 급등, 밸류에이션 부담에 성장주 매도',
    tags: ['금리', '밸류에이션'],
    outcome: { days: 20, pct: 11.4, positive: true },
  },
  {
    date: '2026-01-22', sector: '금융', changePct: -2.6,
    headline: '지역은행 부실채권 우려 재부각, 금융주 전반 약세',
    tags: ['신용 우려'],
    outcome: { days: 20, pct: -1.8, positive: false },
  },
  {
    date: '2025-11-03', sector: '소프트웨어', changePct: -3.3,
    headline: '클라우드 대기업 실적 가이던스 하향, 소프트웨어 섹터 조정',
    tags: ['실적 쇼크'],
    outcome: { days: 20, pct: 7.2, positive: true },
  },
  {
    date: '2025-09-15', sector: '반도체', changePct: -3.4,
    headline: '미 상무부 반도체 수출 통제 강화 발표',
    tags: ['규제', '지정학'],
    outcome: { days: 20, pct: 8.2, positive: true },
  },
];

/* ============================================================
   상태 / 유틸
   ============================================================ */

let currentPage = 'flow';
let lastUpdated = new Date();

function fmtFlow(n) {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toLocaleString('ko-KR')}억`;
}
function fmtPct(n) {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}
function pillClass(n) {
  return n > 0 ? 'pill-up' : n < 0 ? 'pill-down' : 'pill-neutral';
}
function arrow(n) {
  return n > 0 ? '▲' : n < 0 ? '▼' : '·';
}
function timeAgoLabel() {
  const diffMin = Math.max(0, Math.round((Date.now() - lastUpdated.getTime()) / 60000));
  if (diffMin < 1) return '방금 업데이트';
  return `${diffMin}분 전 업데이트`;
}

/* 섹터별 선제 신호 점수: 자금 유입 강도와 뉴스 언급량 증가율의 괴리를 본다.
   자금은 이미 들어오는데 뉴스가 아직 안 떠들면(언급 증가율이 낮으면) 선제 후보. */
function computeSignals() {
  return SECTORS
    .map((s) => {
      const flowScore = s.flowChangePct;
      const newsScore = s.newsChangePct;
      const divergence = flowScore - newsScore / 10;
      return { ...s, divergence };
    })
    .filter((s) => Math.abs(s.divergence) >= 1.5)
    .sort((a, b) => Math.abs(b.divergence) - Math.abs(a.divergence));
}

/* ============================================================
   렌더링
   ============================================================ */

function render() {
  const el = document.getElementById('pageContainer');
  el.innerHTML = '';
  if (currentPage === 'flow') renderFlowPage(el);
  else if (currentPage === 'history') renderHistoryPage(el);
  else if (currentPage === 'signal') renderSignalPage(el);
  document.getElementById('updateTime').textContent = timeAgoLabel();
}

function renderFlowPage(el) {
  const inflow = [...SECTORS].sort((a, b) => b.netFlow - a.netFlow);
  el.innerHTML = `
    <div class="section-title">섹터별 자금흐름 (오늘, 샘플)</div>
    <div class="sector-grid">
      ${inflow.map(sectorCardHtml).join('')}
    </div>
  `;
  el.querySelectorAll('.sector-card').forEach((card) => {
    card.addEventListener('click', () => openSectorDetail(card.dataset.id));
  });
}

function sectorCardHtml(s) {
  return `
    <div class="sector-card" data-id="${s.id}">
      <div class="sector-card-head">
        <div class="sector-name"><span class="sector-icon">${s.icon}</span>${s.name}</div>
        <span class="pill ${pillClass(s.flowChangePct)}">${arrow(s.flowChangePct)} ${fmtPct(s.flowChangePct)}</span>
      </div>
      <div class="sector-flow-amt ${s.netFlow >= 0 ? 'val-up' : 'val-down'}">${fmtFlow(s.netFlow)}</div>
      <div class="sector-flow-sub">순매수 추정 · 뉴스 언급 ${s.newsVolume}건 (${fmtPct(s.newsChangePct)})</div>
      <div class="sector-stocks">
        ${s.stocks.slice(0, 3).map((st) => `
          <div class="mini-stock-row">
            <span class="mini-stock-name"><b>${st.name}</b> ${st.market}</span>
            <span class="${st.changePct >= 0 ? 'val-up' : 'val-down'}">${fmtPct(st.changePct)}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderHistoryPage(el) {
  el.innerHTML = `
    <div class="section-title">과도한 하락 히스토리 — 돌아보면 매수 관점이었을까?</div>
    <div class="timeline">
      ${EVENTS.map(eventCardHtml).join('')}
    </div>
  `;
}

function eventCardHtml(ev) {
  const outcomeText = ev.outcome.positive
    ? `이후 ${ev.outcome.days}거래일간 <b>+${ev.outcome.pct.toFixed(1)}%</b> 반등 — 돌아보면 매수 기회였음`
    : `이후 ${ev.outcome.days}거래일간 ${ev.outcome.pct.toFixed(1)}% — 추세적 하락이 이어짐`;
  return `
    <div class="event-card">
      <div class="event-top">
        <span class="event-date">${ev.date} · ${ev.sector}</span>
        <span class="pill pill-down">${arrow(ev.changePct)} ${fmtPct(ev.changePct)}</span>
      </div>
      <div class="event-headline">${ev.headline}</div>
      <div class="event-tags">
        ${ev.tags.map((t) => `<span class="pill pill-neutral">${t}</span>`).join('')}
      </div>
      <div class="event-outcome ${ev.outcome.positive ? '' : 'neutral'}">
        ${ev.outcome.positive ? '📈' : '📉'} ${outcomeText}
      </div>
    </div>
  `;
}

function renderSignalPage(el) {
  const signals = computeSignals();
  if (signals.length === 0) {
    el.innerHTML = `
      <div class="section-title">선제 신호</div>
      <div class="empty-state">
        <div class="empty-icon">🔍</div>
        현재 뚜렷한 선제 신호가 감지되지 않았어요.
      </div>
    `;
    return;
  }
  el.innerHTML = `
    <div class="section-title">선제 신호 — 뉴스보다 자금이 먼저 움직이는 섹터</div>
    ${signals.map(signalCardHtml).join('')}
  `;
}

function signalCardHtml(s) {
  const isInflow = s.flowChangePct > 0;
  const desc = isInflow
    ? `자금은 ${fmtPct(s.flowChangePct)}로 유입 중인데 뉴스 언급 증가율은 ${fmtPct(s.newsChangePct)}로 아직 덜 알려졌어요. 뉴스가 따라붙기 전 선제 진입 후보로 볼 수 있어요.`
    : `자금이 ${fmtPct(s.flowChangePct)}로 이탈 중인데 뉴스 언급은 ${fmtPct(s.newsChangePct)}에 그쳐요. 아직 시장이 눈치채기 전 이탈 조짐일 수 있어요.`;
  const flowPct = Math.min(100, Math.abs(s.flowChangePct) * 10);
  const newsPct = Math.min(100, Math.abs(s.newsChangePct) * 2);
  return `
    <div class="signal-card">
      <div class="signal-top">
        <div class="signal-name"><span class="sector-icon">${s.icon}</span>${s.name}</div>
        <span class="signal-score">divergence ${s.divergence.toFixed(1)}</span>
      </div>
      <div class="signal-desc">${desc}</div>
      <div class="signal-bars">
        <div class="signal-bar-item">
          <div class="signal-bar-label"><span>자금 변화</span><span>${fmtPct(s.flowChangePct)}</span></div>
          <div class="signal-bar-track"><div class="signal-bar-fill" style="width:${flowPct}%;background:${isInflow ? 'var(--up)' : 'var(--down)'}"></div></div>
        </div>
        <div class="signal-bar-item">
          <div class="signal-bar-label"><span>뉴스 언급 변화</span><span>${fmtPct(s.newsChangePct)}</span></div>
          <div class="signal-bar-track"><div class="signal-bar-fill" style="width:${newsPct}%;background:var(--primary)"></div></div>
        </div>
      </div>
    </div>
  `;
}

/* ============================================================
   섹터 상세 모달
   ============================================================ */

function openSectorDetail(id) {
  const s = SECTORS.find((x) => x.id === id);
  if (!s) return;
  const box = document.getElementById('modalBox');
  box.innerHTML = `
    <div class="modal-head">
      <div class="modal-title"><span class="sector-icon">${s.icon}</span>${s.name}</div>
      <button class="modal-close" id="modalCloseBtn">✕</button>
    </div>
    <span class="pill ${pillClass(s.netFlow)}">${fmtFlow(s.netFlow)} · ${fmtPct(s.flowChangePct)}</span>
    <table class="detail-stock-table">
      <thead>
        <tr><th>종목</th><th>등락률</th><th>추정 수급</th></tr>
      </thead>
      <tbody>
        ${s.stocks.map((st) => `
          <tr>
            <td>${st.name} <span style="color:var(--text-faint)">${st.market}</span></td>
            <td class="${st.changePct >= 0 ? 'val-up' : 'val-down'}">${fmtPct(st.changePct)}</td>
            <td class="${st.flow >= 0 ? 'val-up' : 'val-down'}">${fmtFlow(st.flow)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <div class="section-title" style="margin-top:20px;">관련 뉴스 (샘플)</div>
    <div class="news-list">
      ${mockNewsFor(s).map((n) => `
        <div class="news-item">
          <div class="news-item-title">${n.title}</div>
          <div class="news-item-meta">${n.source} · ${n.time}</div>
        </div>
      `).join('')}
    </div>
  `;
  document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
  document.getElementById('modalOverlay').classList.add('open');
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
}

function mockNewsFor(s) {
  return [
    { title: `${s.name} 섹터, 외국인 순매수 전환 조짐`, source: '샘플뉴스', time: '32분 전' },
    { title: `${s.stocks[0].name}, 실적 기대감에 강세`, source: '샘플뉴스', time: '1시간 전' },
    { title: `${s.name} 관련 종목 수급 동향 정리`, source: '샘플뉴스', time: '3시간 전' },
  ];
}

/* ============================================================
   새로고침 시뮬레이션 (실제 연동 전까지는 숫자를 살짝 흔들어서
   "자동 갱신되고 있다"는 느낌만 재현)
   ============================================================ */

function jitterData() {
  SECTORS.forEach((s) => {
    const flowDelta = Math.round((Math.random() - 0.5) * 80);
    const pctDelta = (Math.random() - 0.5) * 0.6;
    s.netFlow += flowDelta;
    s.flowChangePct = +(s.flowChangePct + pctDelta).toFixed(1);
    s.newsChangePct = +(s.newsChangePct + (Math.random() - 0.5) * 4).toFixed(1);
    s.stocks.forEach((st) => {
      st.changePct = +(st.changePct + (Math.random() - 0.5) * 0.4).toFixed(1);
      st.flow += Math.round((Math.random() - 0.5) * 20);
    });
  });
}

function doRefresh() {
  const btn = document.getElementById('refreshBtn');
  btn.classList.add('spinning');
  setTimeout(() => btn.classList.remove('spinning'), 700);
  jitterData();
  lastUpdated = new Date();
  render();
}

/* ============================================================
   초기화
   ============================================================ */

function init() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentPage = btn.dataset.page;
      render();
    });
  });

  document.getElementById('refreshBtn').addEventListener('click', doRefresh);
  document.getElementById('modalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'modalOverlay') closeModal();
  });

  render();

  // 자동 갱신 시뮬레이션 (8분 주기) — 실제 연동 시 fetch 결과로 교체
  setInterval(doRefresh, 8 * 60 * 1000);
  // 상단 "n분 전" 텍스트만 30초마다 갱신
  setInterval(() => {
    document.getElementById('updateTime').textContent = timeAgoLabel();
  }, 30 * 1000);
}

document.addEventListener('DOMContentLoaded', init);
