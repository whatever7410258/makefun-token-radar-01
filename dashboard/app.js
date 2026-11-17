// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/
// by main.ts) and renders the ranked board, a filterable table, a
// per-protocol detail view and the live market section. No network: every
// byte it shows is in data.js. Views are hash-addressed, so a screenshot can
// open one directly: #board, #detail/<slug>, #filter/<category>.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var app = document.getElementById('app');
  if (!DATA || !app) return;

  var WATCHLIST = {};
  DATA.watchlist.forEach(function (s) { WATCHLIST[s] = true; });
  var state = { view: 'board', slug: null, category: 'all', status: 'all', q: '', sort: 'rank', dir: 1 };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function pctClass(n) {
    if (n === null || n === undefined || !isFinite(n)) return '';
    return n > 0 ? 'up' : n < 0 ? 'down' : '';
  }

  // The hash is the view: #detail/<slug>, #filter/<category>, #board, or empty.
  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    state.view = 'board';
    state.slug = null;
    state.category = 'all';
    if (!hash || hash === 'board') return;
    var parts = hash.split('/');
    if (parts[0] === 'detail' && parts[1]) {
      state.view = 'detail';
      state.slug = decodeURIComponent(parts[1]);
    } else if (parts[0] === 'filter' && parts[1] !== undefined) {
      state.category = decodeURIComponent(parts[1]) || 'all';
    }
  }

  function categories() {
    var seen = {};
    DATA.rows.forEach(function (r) { if (r.category) seen[r.category] = true; });
    return Object.keys(seen).sort();
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (state.status === 'pre-token' && r.token_status !== 'pre-token') return false;
      if (state.status === 'live' && r.token_status !== 'live') return false;
      if (state.status === 'watchlist' && !WATCHLIST[r.slug]) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (q && (r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0)) return false;
      return true;
    });
    var key = state.sort;
    var dir = state.dir;
    rows.sort(function (a, b) {
      var d = 0;
      if (key === 'rank') d = a.rank - b.rank;
      else if (key === 'tvl') d = a.tvl_usd - b.tvl_usd;
      else if (key === 'change') d = (a.change_7d === null ? -Infinity : a.change_7d) - (b.change_7d === null ? -Infinity : b.change_7d);
      else if (key === 'implied') d = a.implied_value_usd - b.implied_value_usd;
      if (d === 0) d = a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
      return d * dir;
    });
    return rows;
  }

  function sortArrow(key) {
    if (state.sort !== key) return '';
    return state.dir === 1 ? ' &#8593;' : ' &#8595;';
  }

  function statusBadge(r) {
    if (r.token_status === 'live') return '<span class="badge live">Live token</span>';
    var watch = WATCHLIST[r.slug] ? '<span class="badge watch">Watchlist</span>' : '';
    return '<span class="badge pre">Pre-token</span>' + watch;
  }

  function headerHtml() {
    return '<div class="masthead">' +
      '<div class="brand"><span class="dot"></span><span class="word">Token Radar</span></div>' +
      '<div class="meta"><span>Snapshot ' + esc(DATA.as_of) + '</span><span>Model ' + esc(DATA.model_version) + '</span>' +
      '<span>Floor ' + fmtUsd(DATA.floor_usd) + '</span></div></div>';
  }

  function ledeHtml() {
    return '<div class="lede"><div><h1>What would the token be worth?</h1>' +
      '<p>Every protocol below records no token yet, or trades already and stands as a comparable. ' +
      'The board ranks them by implied value: what a token would be worth if the protocol\u2019s ' +
      'record stayed as it is. It never predicts whether or when a token is issued.</p></div>' +
      '<div class="stats">' +
      '<div class="stat"><b>' + DATA.board_size + '</b><span>protocols ranked</span></div>' +
      '<div class="stat"><b>' + DATA.watchlist_size + '</b><span>on the watchlist</span></div>' +
      '<div class="stat"><b>' + DATA.early_size + '</b><span>early, below the floor</span></div>' +
      '<div class="stat"><b>' + DATA.comparable_size + '</b><span>live comparables</span></div>' +
      '</div></div>';
  }

  function controlsHtml(count) {
    var cats = categories();
    var opts = '<option value="all"' + (state.category === 'all' ? ' selected' : '') + '>All categories</option>' +
      cats.map(function (c) {
        return '<option value="' + esc(c) + '"' + (state.category === c ? ' selected' : '') + '>' + esc(c) + '</option>';
      }).join('');
    function tab(key, label) {
      return '<button type="button" data-status="' + key + '" aria-pressed="' + (state.status === key) + '">' + label + '</button>';
    }
    return '<div class="controls">' +
      '<div class="field"><label for="q">Search</label>' +
      '<input id="q" type="search" value="' + esc(state.q) + '" placeholder="Name or slug" autocomplete="off"></div>' +
      '<div class="field"><label for="cat">Category</label><select id="cat">' + opts + '</select></div>' +
      '<div class="tabs" role="group" aria-label="Token status">' +
      tab('all', 'All') + tab('pre-token', 'Pre-token') + tab('live', 'Live') + tab('watchlist', 'Watchlist') +
      '</div><span class="count">' + count + ' of ' + DATA.board_size + ' rows</span></div>';
  }

  function tableHtml(rows) {
    if (rows.length === 0) return '<div class="panel"><div class="empty">No protocol matches this filter.</div></div>';
    var max = rows.reduce(function (m, r) { return Math.max(m, r.implied_value_usd); }, 1);
    var head = '<tr><th><button type="button" data-sort="rank">Rank' + sortArrow('rank') + '</button></th>' +
      '<th>Protocol</th><th>Category</th>' +
      '<th><button type="button" data-sort="tvl">TVL' + sortArrow('tvl') + '</button></th>' +
      '<th><button type="button" data-sort="change">7d' + sortArrow('change') + '</button></th>' +
      '<th><button type="button" data-sort="implied">Implied value' + sortArrow('implied') + '</button></th>' +
      '<th>Status</th></tr>';
    var body = rows.map(function (r) {
      var width = Math.max(2, Math.round((r.implied_value_usd / max) * 100));
      return '<tr data-slug="' + esc(r.slug) + '"' + (r.token_status === 'live' ? ' class="live-row"' : '') + '>' +
        '<td class="rank">' + r.rank + '</td>' +
        '<td><div class="name"><b>' + esc(r.name) + '</b><span class="sub">' + esc(r.slug) + ' · ' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</span></div></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num ' + pctClass(r.change_7d) + '">' + fmtPct(r.change_7d) + '</td>' +
        '<td class="num">' + fmtUsd(r.implied_value_usd) + '<span class="bar"><i style="width:' + width + '%"></i></span></td>' +
        '<td>' + statusBadge(r) + '</td></tr>';
    }).join('');
    return '<div class="panel"><div class="table-wrap"><table><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div></div>';
  }

  function modelHtml() {
    var m = DATA.model;
    return '<div class="section"><h2>The model</h2>' +
      '<p>One formula scores every pre-token row, from the snapshot\u2019s own figures only. ' +
      'No protocol name is ever special-cased; the category table is the only judgement in it.</p>' +
      '<div class="formula">implied = TVL &times; category multiple &times; growth &times; maturity &times; breadth<br>' +
      '<span>growth = 1 + clamp(7d change, ' + m.growth_floor + '%, ' + m.growth_cap + '%) / 100 &times; ' + m.growth_weight + '<br>' +
      'maturity = ' + m.maturity_floor + ' + ' + m.maturity_range + ' &times; (1 &minus; e<sup>&minus;age / ' + m.maturity_halflife_days + ' days</sup>) &nbsp;·&nbsp; ' +
      'breadth = 1 + ' + m.breadth_per_chain + ' &times; min(chains, ' + m.breadth_max_chains + ') &nbsp;·&nbsp; ' +
      'default multiple ' + m.default_multiple + ', unknown age ' + m.unknown_age_days + ' days</span></div>' +
      '<p class="note">Live comparables are not modelled: their implied value is their market cap, ' +
      'chosen nearest the board\u2019s median implied value so they calibrate the model instead of towering over it.</p></div>';
  }

  function liveHtml() {
    if (!DATA.live || DATA.live.length === 0) return '';
    var rows = DATA.live.map(function (p) {
      var ratio = p.tvl_usd > 0 && p.mcap_usd ? (p.mcap_usd / p.tvl_usd).toFixed(2) + '×' : 'n/a';
      return '<tr><td><div class="name"><b>' + esc(p.name) + '</b><span class="sub">' + esc(p.slug) + '</span></div></td>' +
        '<td>' + esc(p.category || '—') + '</td><td class="num">' + fmtUsd(p.tvl_usd) + '</td>' +
        '<td class="num">' + fmtUsd(p.mcap_usd) + '</td><td class="num">' + ratio + '</td>' +
        '<td class="num ' + pctClass(p.change_7d) + '">' + fmtPct(p.change_7d) + '</td></tr>';
    }).join('');
    return '<div class="section"><h2>Live market</h2>' +
      '<p>The largest tokens that already trade, for calibration: their market cap over TVL is the ' +
      'multiple the market actually pays, against which the model\u2019s multiples can be read.</p>' +
      '<div class="panel"><div class="table-wrap"><table><thead><tr><th>Protocol</th><th>Category</th>' +
      '<th>TVL</th><th>Market cap</th><th>MCap / TVL</th><th>7d</th></tr></thead><tbody>' + rows + '</tbody></table></div></div></div>';
  }

  function footerHtml() {
    return '<div class="footer">Snapshot: DefiLlama public protocol data, as of ' + esc(DATA.as_of) + '. ' +
      'A protocol \u201Crecords no token\u201D when its DefiLlama record carries no market cap, no CoinGecko id ' +
      'and no symbol; the snapshot is not proof that no token exists. Implied values are this entry\u2019s ' +
      'own model, never a prediction that a token will be issued.</div>';
  }

  function boardView() {
    var rows = filteredRows();
    return '<div class="shell">' + headerHtml() + ledeHtml() + controlsHtml(rows.length) +
      tableHtml(rows) + modelHtml() + liveHtml() + footerHtml() + '</div>';
  }

  function breakdownHtml(r) {
    if (r.token_status === 'live') {
      return '<div class="breakdown"><h3>Value</h3><div class="equation">' +
        '<div><span>Market cap (the market\u2019s own value)</span><b>' + fmtUsd(r.mcap_usd) + '</b></div>' +
        '<div><span>TVL</span><b>' + fmtUsd(r.tvl_usd) + '</b></div>' +
        '<div><span>Market cap / TVL</span><b>' + (r.tvl_usd > 0 && r.mcap_usd ? (r.mcap_usd / r.tvl_usd).toFixed(2) + '×' : 'n/a') + '</b></div>' +
        '</div><p class="note">This protocol already trades, so the board shows the market\u2019s number, not a model\u2019s.</p></div>';
    }
    var growthPct = r.change_7d === null ? 0 : Math.min(DATA.model.growth_cap, Math.max(DATA.model.growth_floor, r.change_7d));
    return '<div class="breakdown"><h3>How the implied value is built</h3><div class="equation">' +
      '<div><span>TVL</span><b>' + fmtUsd(r.tvl_usd) + '</b></div>' +
      '<div><span>Category multiple (' + esc(r.category || 'default') + ')</span><b>&times; ' + r.base_multiple + '</b></div>' +
      '<div><span>Growth (7d ' + fmtPct(r.change_7d) + ', clamped to ' + growthPct.toFixed(1) + '%)</span><b>&times; ' + r.growth_multiplier + '</b></div>' +
      '<div><span>Maturity (' + fmtAge(r.age_days) + ' tracked)</span><b>&times; ' + r.maturity_multiplier + '</b></div>' +
      '<div><span>Breadth (' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + ')</span><b>&times; ' + r.breadth_multiplier + '</b></div>' +
      '<div><span>Implied value</span><b>' + fmtUsd(r.implied_value_usd) + '</b></div>' +
      '</div></div>';
  }

  function detailView() {
    var r = null;
    for (var i = 0; i < DATA.rows.length; i++) {
      if (DATA.rows[i].slug === state.slug) { r = DATA.rows[i]; break; }
    }
    if (!r) {
      return '<div class="shell">' + headerHtml() +
        '<p style="margin-top:24px">No protocol on this board has the slug \u201C' + esc(state.slug) + '\u201D.</p>' +
        '<p style="margin-top:8px"><a href="#board">Back to the board</a></p></div>';
    }
    var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    return '<div class="shell">' + headerHtml() +
      '<div style="margin-top:20px"><a class="back" href="#board">&larr; Back to the board</a>' +
      '<div class="detail-head"><h1>' + esc(r.name) + '</h1>' + statusBadge(r) + '</div>' +
      '<div class="sub" style="margin-top:8px">' + esc(r.slug) + ' · ' + esc(r.category || 'uncategorised') + ' · ' + esc(r.chains.join(', ')) + '</div>' +
      '<div class="detail-grid">' +
      '<div class="cell"><b>#' + r.rank + ' of ' + DATA.board_size + '</b><span>board rank</span></div>' +
      '<div class="cell"><b>' + fmtUsd(r.implied_value_usd) + '</b><span>implied value</span></div>' +
      '<div class="cell"><b>' + fmtUsd(r.tvl_usd) + '</b><span>TVL</span></div>' +
      '<div class="cell"><b class="' + pctClass(r.change_7d) + '">' + fmtPct(r.change_7d) + '</b><span>TVL, 7 days</span></div>' +
      '<div class="cell"><b>' + fmtAge(r.age_days) + '</b><span>tracked since ' + esc(r.listed_at || 'unknown') + '</span></div>' +
      '<div class="cell"><b>' + r.chains.length + '</b><span>chains</span></div>' +
      '<div class="cell"><b>' + fmtUsd(r.mcap_usd) + '</b><span>market cap</span></div>' +
      '<div class="cell"><b>' + esc(r.symbol || '—') + '</b><span>token symbol</span></div>' +
      '</div>' + breakdownHtml(r) +
      '<div class="section"><h2>Farm plan</h2>' +
      '<p>Concrete steps for this protocol, from its own record. Costs are the chain\u2019s usual gas, not a quote.</p>' +
      '<ol class="steps">' + steps + '</ol></div>' +
      footerHtml() + '</div></div>';
  }

  function render() {
    // Keep the search box's focus and caret across re-renders.
    var hadFocus = document.activeElement && document.activeElement.id === 'q';
    var caret = hadFocus ? document.activeElement.selectionStart : 0;
    var value = hadFocus ? document.activeElement.value : state.q;
    app.innerHTML = state.view === 'detail' ? detailView() : boardView();
    if (hadFocus) {
      var q = document.getElementById('q');
      if (q) {
        q.value = value;
        q.focus();
        try { q.setSelectionRange(caret, caret); } catch (e) { /* older browsers */ }
      }
    }
  }

  app.addEventListener('click', function (ev) {
    var sortBtn = ev.target.closest ? ev.target.closest('[data-sort]') : null;
    if (sortBtn) {
      var key = sortBtn.getAttribute('data-sort');
      if (state.sort === key) state.dir = -state.dir;
      else { state.sort = key; state.dir = key === 'rank' ? 1 : -1; }
      render();
      return;
    }
    var tab = ev.target.closest ? ev.target.closest('[data-status]') : null;
    if (tab) {
      state.status = tab.getAttribute('data-status');
      render();
      return;
    }
    var row = ev.target.closest ? ev.target.closest('tbody tr[data-slug]') : null;
    if (row) window.location.hash = '#detail/' + row.getAttribute('data-slug');
  });
  app.addEventListener('input', function (ev) {
    if (ev.target.id === 'q') { state.q = ev.target.value; render(); }
  });
  app.addEventListener('change', function (ev) {
    if (ev.target.id === 'cat') {
      state.category = ev.target.value;
      render();
    }
  });
  window.addEventListener('hashchange', function () {
    readHash();
    render();
    window.scrollTo(0, 0);
  });

  readHash();
  render();
})();
