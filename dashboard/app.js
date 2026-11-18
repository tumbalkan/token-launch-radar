// Token Launch Radar's dashboard. Reads window.RADAR (written beside
// dashboard/ by main.ts) and renders the ranked board, a filterable table,
// a per-protocol detail drawer with the model's own inputs and the
// protocol's farm plan. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;

  var view = { query: '', category: 'all', tab: 'pre-token', sortKey: 'implied', sortDir: -1, open: null };

  var moneyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return moneyFmt.format(n);
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function ageLabel(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // The radar-2 model in one function: the page recomputes a row from the
  // snapshot figures and checks the number board.json carries, so the
  // page's code and the board's data are visibly the same arithmetic.
  // implied = tvl x benchmark x haircut x growth x maturity x breadth.
  function impliedOf(row, tune) {
    var growth = Math.min(tune.growth_max, Math.max(tune.growth_min, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * tune.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? tune.unknown_age : row.age_days;
    var maturity = tune.maturity_base + (Math.min(Math.max(age, 0), tune.maturity_days) / tune.maturity_days) * tune.maturity_span;
    var breadth = Math.min(tune.breadth_cap, 1 + Math.max(0, (row.chains || []).length - 1) * tune.breadth_step);
    return Math.max(1, Math.round(row.tvl_usd * row.benchmark * tune.haircut * growthMult * maturity * breadth));
  }

  function make(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined) return;
        if (k === 'className') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.indexOf('on') === 0) node.addEventListener(k.slice(2).toLowerCase(), v);
        else node.setAttribute(k, v);
      });
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else if (Array.isArray(c)) c.forEach(function (x) { if (x) node.appendChild(x); });
      else node.appendChild(c);
    });
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json:
  // category, chains, TVL and age decide the action, the capital, the
  // hold and every cost and time. No name is special-cased.
  function chainName(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function stakeFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function weeklyFor(p) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'add to a vault or rebalance between vaults';
    if (c.indexOf('rwa') >= 0) return 'mint or hold the yield asset';
    if (c.indexOf('basis') >= 0) return 'check the hedge and rebalance the basis position';
    if (c.indexOf('prediction') >= 0) return 'place or settle a market position';
    if (c.indexOf('payment') >= 0) return 'send or receive a payment through the protocol';
    if (c.indexOf('govern') >= 0) return 'vote on an active proposal';
    if (c.indexOf('chain') >= 0 || c.indexOf('layer') >= 0) return 'use a dapp on the chain or bridge assets in';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0) return 'supply, borrow or repay';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0) return 'add liquidity or claim rewards';
    return 'deposit, swap, vote or otherwise use the app';
  }
  function openingFor(p, stake, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + stake + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + stake + " of " + name + "'s yield asset on " + chain + ' and hold it.';
    if (c.indexOf('basis') >= 0) return "Deposit $" + stake + " of USDC into " + name + "'s hedged position on " + chain + ' and keep it open.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + stake + ' and place one market position on ' + name + '.';
    if (c.indexOf('payment') >= 0) return 'Route $' + stake + ' of payments through ' + name + ' on ' + chain + '.';
    if (c.indexOf('govern') >= 0) return "Deposit $" + stake + " of USDC into " + name + "'s governance vault on " + chain + '.';
    if (c.indexOf('chain') >= 0 || c.indexOf('layer') >= 0) return 'Bridge $' + stake + ' of USDC to ' + name + ' and use one of its dapps.';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + stake + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + stake + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + stake + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + stake + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + stake + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + stake + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + stake + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    return 'Deposit $' + stake + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function flatten(step) {
    var s = step.action + ' Cost: ' + step.cost + '. Time: ' + step.duration + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmPlan(p) {
    var chain = chainName(p);
    var stake = stakeFor(p);
    var hold = holdFor(p.age_days);
    return [
      { action: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', duration: '5 minutes' },
      { action: openingFor(p, stake, chain), cost: '$' + stake + ' of capital and about $' + (stake >= 150 ? 8 : 4) + ' of gas', duration: '15 minutes to set up' },
      { action: 'Make one qualifying action each week, such as to ' + weeklyFor(p) + '.', cost: 'about $2 of gas a week', duration: '10 minutes a week' },
      { action: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + stake + ' stays in the position', duration: hold + ' days' },
      { action: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', duration: '10 minutes' },
      { action: 'Unwind in one transaction when you exit, and write the wallet, the dates and every transaction in a farm log.', cost: 'one exit transaction', duration: '5 minutes' }
    ].map(flatten);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) view.query = params.get('q');
    if (params.get('p')) view.open = params.get('p');
    if (params.get('category')) view.category = params.get('category');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (view.query) params.set('q', view.query);
    if (view.category !== 'all') params.set('category', view.category);
    if (view.open) params.set('p', view.open);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function filtered() {
    var q = view.query.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (view.category !== 'all' && (r.category || 'Other') !== view.category) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sorted(list) {
    var key = view.sortKey;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -view.sortDir;
      if (av > bv) return view.sortDir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function metaLine() {
    var meta = document.getElementById('meta');
    meta.textContent = '';
    ['Snapshot ' + DATA.as_of, 'DefiLlama protocol index', DATA.model_version + ' model'].forEach(function (t) {
      meta.appendChild(make('span', { text: t }));
    });
    document.getElementById('headline').textContent = DATA.watchlist_size + ' watchlist protocols, ranked by implied value';
    var stats = document.getElementById('stats');
    stats.textContent = '';
    [
      ['Watchlist covered', DATA.watchlist_size + ' / ' + DATA.watchlist_size],
      ['Pre-token rows scored', String(DATA.board_size)],
      ['Early rows below the floor', String(DATA.early_size)],
      ['Live-token protocols set aside', String(DATA.live_size)]
    ].forEach(function (pair) {
      stats.appendChild(make('div', null, [
        make('dt', { text: pair[0] }),
        make('dd', { text: pair[1] })
      ]));
    });
  }

  function categoryOptions() {
    var select = document.getElementById('category');
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    cats.forEach(function (c) {
      var opt = make('option', { value: c, text: c });
      if (c === view.category) opt.selected = true;
      select.appendChild(opt);
    });
  }

  function sortTh(key, label) {
    var arrow = view.sortKey === key ? make('span', { 'aria-hidden': 'true', text: view.sortDir < 0 ? ' v' : ' ^' }) : null;
    return make('th', { scope: 'col' }, [
      make('button', { type: 'button', onClick: function () {
        if (view.sortKey === key) view.sortDir = -view.sortDir;
        else { view.sortKey = key; view.sortDir = -1; }
        renderBoard();
      } }, [label, arrow])
    ]);
  }

  function preTokenTable() {
    var list = sorted(filtered());
    var board = document.getElementById('board');
    board.textContent = '';
    if (list.length === 0) {
      board.appendChild(make('div', { className: 'no-match' }, [
        make('h2', { text: 'No protocol matches that filter' }),
        make('p', { text: 'Clear the search or pick another category to see the board again.' }),
        make('button', { className: 'btn solid', type: 'button', text: 'Clear filters', onClick: function () {
          view.query = ''; view.category = 'all';
          document.getElementById('search').value = '';
          document.getElementById('category').value = 'all';
          writeHash(); renderBoard();
        } })
      ]));
      return;
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = make('tbody');
    list.forEach(function (r) {
      var growthCls = r.change_7d === null ? '' : r.change_7d >= 0 ? ' rise' : ' fall';
      var tr = make('tr', {
        'data-open': view.open === r.slug ? 'true' : 'false',
        tabindex: '0',
        onClick: function () { showDetail(r.slug); },
        onKeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showDetail(r.slug); } }
      }, [
        make('td', { className: 'figure', text: String(r.rank) }),
        make('td', null, [make('div', { className: 'proto' }, [
          make('b', { text: r.name }),
          make('span', { className: 'detail-line', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        ])]),
        make('td', { className: 'figure', text: money(r.tvl_usd) }),
        make('td', { className: 'figure' + growthCls, text: pct(r.change_7d) }),
        make('td', { className: 'figure', text: ageLabel(r.age_days) }),
        make('td', null, [make('div', { className: 'value-cell' }, [
          make('div', { className: 'value-bar', 'aria-hidden': 'true' }, [
            make('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })
          ]),
          make('span', { className: 'figure', text: money(r.implied_value_usd) })
        ])]),
        make('td', null, [make('span', { className: 'badge', text: 'no token' })])
      ]);
      tbody.appendChild(tr);
    });
    board.appendChild(make('div', { className: 'scroll-x' }, [
      make('table', null, [
        make('caption', { className: 'detail-line', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
        make('thead', null, [make('tr', null, [
          sortTh('implied', 'Rank'),
          sortTh('name', 'Protocol'),
          sortTh('tvl', 'TVL'),
          sortTh('growth', '7d'),
          sortTh('age', 'Age'),
          sortTh('implied', 'Implied value'),
          make('th', { scope: 'col', text: 'Token' })
        ])]),
        tbody
      ])
    ]));
  }

  function liveTokenTable() {
    var board = document.getElementById('board');
    board.textContent = '';
    var tbody = make('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(make('tr', null, [
        make('td', { className: 'figure', text: 'live' }),
        make('td', null, [make('div', { className: 'proto' }, [
          make('b', { text: r.name }),
          make('span', { className: 'detail-line', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        ])]),
        make('td', { className: 'figure', text: money(r.tvl_usd) }),
        make('td', { className: 'figure' + (r.change_7d !== null && r.change_7d >= 0 ? ' rise' : ' fall'), text: pct(r.change_7d) }),
        make('td', { className: 'figure', text: money(r.mcap_usd) }),
        make('td', null, [make('span', { className: 'badge live', text: 'already trades' })])
      ]));
    });
    board.appendChild(make('div', { className: 'scroll-x' }, [
      make('table', null, [
        make('caption', { className: 'detail-line', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
        make('thead', null, [make('tr', null, [
          make('th', { scope: 'col', text: 'Status' }),
          make('th', { scope: 'col', text: 'Protocol' }),
          make('th', { scope: 'col', text: 'TVL' }),
          make('th', { scope: 'col', text: '7d' }),
          make('th', { scope: 'col', text: 'Market cap' }),
          make('th', { scope: 'col', text: 'Token' })
        ])]),
        tbody
      ])
    ]));
  }

  function modelSection() {
    var m = DATA.model;
    var section = document.getElementById('model');
    section.textContent = '';
    section.appendChild(make('h2', { text: 'How implied value is computed' }));
    section.appendChild(make('p', { className: 'detail-line', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }));
    section.appendChild(make('div', { className: 'formula', text:
      'implied = round( tvl_usd x benchmark x ' + m.haircut + ' x (1 + clamp(change_7d, ' + m.growth_min + ', ' + m.growth_max + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_base + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_span + ') x min(' + m.breadth_cap + ', 1 + (chains - 1) x ' + m.breadth_step + ') )'
    }));
    section.appendChild(make('p', { className: 'detail-line', text:
      'The benchmark is the median market-cap / TVL of the live-token protocols in the same category (at least ' + m.anchor_min_peers + ' peers, clamped to [' + m.anchor_min + ', ' + m.anchor_max + ']); a category with too few live peers falls back to the global median of ' + DATA.global_benchmark.toFixed(4) + ' over ' + DATA.global_peers + ' live protocols. The ' + m.haircut + ' haircut prices a token that does not exist yet below one that trades. Age is the time since the protocol was first listed; an unlisted age uses ' + m.unknown_age + ' days. Rankable rows exclude Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC and CEX categories, versioned names, wrapped or staked names, and exchange-prefixed names — products of a token that already trades, not launches waiting to happen.'
    }));
  }

  var drawer = document.getElementById('drawer');
  drawer.addEventListener('close', function () { view.open = null; writeHash(); });

  function showDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    view.open = slug;
    writeHash();
    drawer.textContent = '';
    var steps = farmPlan(row);
    var recomputed = impliedOf(row, DATA.model);
    var benchNote = row.benchmark_fallback
      ? 'Global median (' + row.benchmark_peers + ' live protocols): too few peers in this category'
      : 'Category median over ' + row.benchmark_peers + ' live peers';
    drawer.appendChild(make('div', { className: 'drawer-top' }, [
      make('div', null, [
        make('span', { className: 'masthead-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        make('h2', { id: 'drawer-title', text: row.name }),
        make('p', { className: 'detail-line', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ]),
      make('button', { className: 'drawer-close', type: 'button', 'aria-label': 'Close details', text: 'Close', onClick: function () { drawer.close(); } })
    ]));
    drawer.appendChild(make('section', { className: 'drawer-section' }, [
      make('h3', { text: 'Implied value' }),
      make('div', { className: 'factors' }, [
        ['TVL', money(row.tvl_usd)],
        ['Benchmark multiple', row.benchmark.toFixed(4) + 'x'],
        ['Benchmark source', benchNote],
        ['Pre-token haircut', 'x' + DATA.model.haircut],
        ['Seven-day growth', pct(row.change_7d)],
        ['Growth multiplier', String(row.growth_multiplier)],
        ['Age with no token', ageLabel(row.age_days)],
        ['Maturity multiplier', String(row.maturity_multiplier)],
        ['Chains', String((row.chains || []).length)],
        ['Breadth multiplier', String(row.breadth_multiplier)],
        ['Implied value', money(row.implied_value_usd)]
      ].map(function (pair) {
        return make('div', null, [make('span', { text: pair[0] }), make('b', { text: pair[1] })]);
      })),
      make('p', { className: 'detail-line', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + money(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ]));
    drawer.appendChild(make('section', { className: 'drawer-section' }, [
      make('h3', { text: 'Farm plan' }),
      make('ol', { className: 'plan' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return make('li', null, [make('b', { text: action }), make('span', { className: 'plan-cost', text: tail })]);
      }))
    ]));
    if (typeof drawer.showModal === 'function') {
      if (!drawer.open) drawer.showModal();
    } else {
      drawer.setAttribute('open', '');
    }
  }

  function updateCount() {
    var count = document.getElementById('count');
    count.textContent = view.tab === 'pre-token' ? filtered().length + ' rows shown' : DATA.live.length + ' live-token protocols';
  }

  function renderBoard() {
    if (view.tab === 'pre-token') preTokenTable();
    else liveTokenTable();
    updateCount();
    if (view.open) showDetail(view.open);
  }

  function setTab(tab) {
    view.tab = tab;
    document.getElementById('view-pre').setAttribute('aria-pressed', tab === 'pre-token' ? 'true' : 'false');
    document.getElementById('view-live').setAttribute('aria-pressed', tab === 'live' ? 'true' : 'false');
    renderBoard();
  }

  readHash();
  metaLine();
  categoryOptions();
  modelSection();

  var search = document.getElementById('search');
  search.value = view.query;
  search.addEventListener('input', function () { view.query = search.value; writeHash(); renderBoard(); });
  var select = document.getElementById('category');
  select.value = view.category;
  select.addEventListener('change', function () { view.category = select.value; writeHash(); renderBoard(); });
  document.getElementById('view-pre').addEventListener('click', function () { setTab('pre-token'); });
  document.getElementById('view-live').addEventListener('click', function () { setTab('live'); });

  renderBoard();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && drawer.open) drawer.close();
  });
})();
