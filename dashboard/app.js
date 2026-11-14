// Token Radar's dashboard, radar-2. It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, a filterable table, and a per-protocol detail view with the model's
// own inputs and the protocol's farm plan. No network: every byte it shows lives in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var board = document.getElementById('board');
  var view = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usdFmt.format(n);
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function ageText(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  // The model in one function: the page recomputes a row from the snapshot figures and checks the
  // number board.json carries, so the page's code and the board's data are visibly the same arithmetic.
  function recompute(row, model) {
    var change = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, change));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var chains = row.chains ? row.chains.length : 0;
    var reach = 1 + model.reach_per_chain * Math.min(Math.max(chains - 1, 0), model.reach_max_chains);
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthMult * maturity * reach));
  }

  function elem(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and age
  // decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function firstChain(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalNeeded(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDays(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function mainAction(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0 || c.indexOf('money market') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and borrow a small amount against it, then repay.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0 || c.indexOf('canonical bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('restak') >= 0) return 'Restake $' + capital + ' of liquid staking tokens through ' + name + ' on ' + chain + ' and keep the receipt.';
    if (c.indexOf('liquid staking') >= 0 || c.indexOf('staking') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt token.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge, then close it.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + ', then settle it.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('vault') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    if (c.indexOf('gaming') >= 0 || c.indexOf('game') >= 0) return 'Play ' + name + ' on ' + chain + ' with $' + capital + ' of in-game assets and finish one quest line.';
    if (c.indexOf('ai') >= 0 || c.indexOf('data') >= 0) return 'Run one ' + name + ' job on ' + chain + ' with $' + capital + ' of credits and keep the receipt.';
    if (c.indexOf('social') >= 0) return 'Post and engage daily on ' + name + ' for a week with a $' + capital + ' starter balance.';
    if (c.indexOf('nft') >= 0) return 'Mint or trade one ' + name + ' item on ' + chain + ' for about $' + capital + ' and list it once.';
    if (c.indexOf('payment') >= 0) return 'Pay $' + capital + ' through ' + name + ' on ' + chain + ' and keep the receipt.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function weeklyHabit(p) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0) return 'Adjust the borrow once a week, such as adding collateral or repaying a little.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0) return 'Claim or compound the pool rewards once a week and rebalance if the range drifts.';
    if (c.indexOf('bridge') >= 0) return 'Bridge a small amount back and forth once a week so the route stays active.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Open and close one small position each week, never leaving a large trade open.';
    if (c.indexOf('prediction') >= 0) return 'Place one small market position each week and settle it before it expires.';
    if (c.indexOf('gaming') >= 0 || c.indexOf('social') >= 0) return 'Finish one daily quest each week and keep the streak alive.';
    return 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.';
  }
  function formatStep(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function buildSteps(p) {
    var chain = firstChain(p);
    var capital = capitalNeeded(p);
    var hold = holdDays(p.age_days);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: mainAction(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: weeklyHabit(p), cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: "Open the protocol's own points, quests or rewards page and finish every free task it lists.", cost: 'no fee for the tasks themselves', time: '20 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Check the protocol's announcements once a week for snapshot dates, and do not move funds the day before one.", cost: 'nothing but the check', time: '5 minutes a week' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(formatStep);
  }

  function readState() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) view.q = params.get('q');
    if (params.get('p')) view.selected = params.get('p');
    if (params.get('category')) view.category = params.get('category');
    if (params.get('chain')) view.chain = params.get('chain');
  }
  function writeState() {
    var params = new URLSearchParams();
    if (view.q) params.set('q', view.q);
    if (view.category !== 'all') params.set('category', view.category);
    if (view.chain !== 'all') params.set('chain', view.chain);
    if (view.selected) params.set('p', view.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function visibleRows() {
    var q = view.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (view.category !== 'all' && r.category !== view.category) return false;
      if (view.chain !== 'all' && !(r.chains || []).includes(view.chain)) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortRows(list) {
    var key = view.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'chains') { av = (a.chains || []).length; bv = (b.chains || []).length; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -view.dir;
      if (av > bv) return view.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function signalCls(s) {
    if (s === 'Rising fast' || s === 'Growing') return 'signal hot';
    if (s === 'Cooling off') return 'signal cold';
    return 'signal';
  }

  function topBar() {
    return elem('header', { class: 'top' },
      elem('div', { class: 'brand' }, elem('span', { class: 'mark' }), elem('span', { class: 'brand-name', text: 'Token Radar' })),
      elem('div', { class: 'top-meta' },
        elem('span', { text: 'Snapshot ' + DATA.as_of }),
        elem('span', { text: 'DefiLlama protocol index' }),
        elem('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function intro() {
    return elem('section', { class: 'lede' },
      elem('div', null,
        elem('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        elem('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor. Implied value is a model, not a promise.' })
      ),
      elem('div', { class: 'facts' },
        elem('div', { class: 'fact' }, elem('span', { text: 'Watchlist covered' }), elem('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        elem('div', { class: 'fact' }, elem('span', { text: 'Pre-token rows scored' }), elem('b', { text: String(DATA.board_size) })),
        elem('div', { class: 'fact' }, elem('span', { text: 'Early rows below the floor' }), elem('b', { text: String(DATA.early_size) })),
        elem('div', { class: 'fact' }, elem('span', { text: 'Live-token protocols set aside' }), elem('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function topThree() {
    var top = DATA.rows.slice(0, 3);
    return elem('div', { class: 'spotlight' }, top.map(function (r) {
      return elem('button', { type: 'button', class: 'spot', onclick: function () { openDetail(r.slug); } },
        elem('span', { class: 'rank', text: 'Rank ' + r.rank + ' · ' + r.signal }),
        elem('h3', { text: r.name }),
        elem('p', { text: (r.category || 'Other') + ' · TVL ' + money(r.tvl_usd) + ' · ' + (r.chains || []).slice(0, 3).join(', ') }),
        elem('div', { class: 'value', text: money(r.implied_value_usd) + ' implied' })
      );
    }));
  }

  function filterBar() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = elem('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: view.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { view.q = search.value; writeState(); render(); });
    var select = elem('select', { id: 'category', 'aria-label': 'Filter by category' },
      elem('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return elem('option', { value: c, text: c, selected: c === view.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { view.category = select.value; writeState(); render(); });
    var chainSelect = elem('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      elem('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return elem('option', { value: c, text: c, selected: c === view.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { view.chain = chainSelect.value; writeState(); render(); });
    var pre = elem('button', { type: 'button', 'aria-pressed': view.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { view.tab = 'pre-token'; render(); } });
    var live = elem('button', { type: 'button', 'aria-pressed': view.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { view.tab = 'live'; render(); } });
    return elem('div', { class: 'controls' },
      elem('div', { class: 'field' }, elem('label', { for: 'q', text: 'Search' }), search),
      elem('div', { class: 'field' }, elem('label', { for: 'category', text: 'Category' }), select),
      elem('div', { class: 'field' }, elem('label', { for: 'chain', text: 'Chain' }), chainSelect),
      elem('div', { class: 'field' }, elem('span', { class: 'sub', text: 'Token status' }), elem('div', { class: 'tabs' }, pre, live)),
      elem('span', { class: 'count', text: view.tab === 'pre-token' ? visibleRows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHead(key, label) {
    return elem('th', { scope: 'col' },
      elem('button', { type: 'button', onclick: function () { if (view.sort === key) view.dir = -view.dir; else { view.sort = key; view.dir = -1; } render(); } },
        label,
        view.sort === key ? elem('span', { 'aria-hidden': 'true', text: view.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortRows(visibleRows());
    if (list.length === 0) {
      return elem('div', { class: 'panel' }, elem('div', { class: 'empty' },
        elem('h2', { text: 'No protocol matches that filter' }),
        elem('p', { text: 'Clear the search or pick another category to see the board again.' }),
        elem('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { view.q = ''; view.category = 'all'; view.chain = 'all'; writeState(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = elem('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : pct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = elem('tr', {
        'data-selected': view.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        elem('td', { class: 'num', text: String(r.rank) }),
        elem('td', null, elem('div', { class: 'name' },
          elem('b', { text: r.name }),
          elem('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        elem('td', { class: 'num', text: money(r.tvl_usd) }),
        elem('td', { class: 'num ' + growthClass, text: growth }),
        elem('td', { class: 'num', text: ageText(r.age_days) }),
        elem('td', null, elem('div', { class: 'implied' },
          elem('div', { class: 'bar', 'aria-hidden': 'true' }, elem('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          elem('span', { class: 'num', text: money(r.implied_value_usd) })
        )),
        elem('td', null, elem('span', { class: signalCls(r.signal), text: r.signal })),
        elem('td', null, elem('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return elem('div', { class: 'panel' },
      elem('div', { class: 'table-wrap' },
        elem('table', null,
          elem('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          elem('thead', null, elem('tr', null,
            sortHead('implied', 'Rank'),
            sortHead('name', 'Protocol'),
            sortHead('tvl', 'TVL'),
            sortHead('growth', '7d'),
            sortHead('age', 'Age'),
            sortHead('implied', 'Implied value'),
            elem('th', { scope: 'col', text: 'Signal' }),
            elem('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = elem('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(elem('tr', null,
        elem('td', { class: 'num', text: 'live' }),
        elem('td', null, elem('div', { class: 'name' }, elem('b', { text: r.name }), elem('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        elem('td', { class: 'num', text: money(r.tvl_usd) }),
        elem('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: pct(r.change_7d) }),
        elem('td', { class: 'num', text: money(r.mcap_usd) }),
        elem('td', null, elem('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return elem('div', { class: 'panel' },
      elem('div', { class: 'table-wrap' },
        elem('table', null,
          elem('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          elem('thead', null, elem('tr', null, elem('th', { scope: 'col', text: 'Status' }), elem('th', { scope: 'col', text: 'Protocol' }), elem('th', { scope: 'col', text: 'TVL' }), elem('th', { scope: 'col', text: '7d' }), elem('th', { scope: 'col', text: 'Market cap' }), elem('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    return elem('section', { class: 'panel model' },
      elem('h2', { text: 'How implied value is computed' }),
      elem('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      elem('div', { class: 'formula' },
        'implied = round( tvl_usd x ' + m.base_multiple + ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (1 + ' + m.reach_per_chain + ' x min(chains - 1, ' + m.reach_max_chains + ')) )'
      ),
      elem('p', { class: 'sub', text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. Reach rewards protocols live on several chains, where more users can farm. The early radar is every pre-token protocol below the watchlist floor, by TVL, and the live-token protocols are set aside with their market caps shown.' })
    );
  }

  var dialog = elem('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { view.selected = null; writeState(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    view.selected = slug;
    writeState();
    dialog.textContent = '';
    var steps = buildSteps(row);
    dialog.appendChild(elem('div', { class: 'detail-head' },
      elem('div', null,
        elem('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + ' · ' + row.signal }),
        elem('h2', { id: 'detail-title', text: row.name }),
        elem('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      elem('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(elem('section', { class: 'detail-section' },
      elem('h3', { text: 'Implied value' }),
      elem('div', { class: 'equation' },
        elem('div', null, elem('span', { text: 'TVL' }), elem('b', { class: 'num', text: money(row.tvl_usd) })),
        elem('div', null, elem('span', { text: 'Seven-day growth' }), elem('b', { class: 'num', text: pct(row.change_7d) })),
        elem('div', null, elem('span', { text: 'Age with no token' }), elem('b', { class: 'num', text: ageText(row.age_days) })),
        elem('div', null, elem('span', { text: 'Chains' }), elem('b', { class: 'num', text: String((row.chains || []).length) })),
        elem('div', null, elem('span', { text: 'Growth multiplier' }), elem('b', { class: 'num', text: String(row.growth_multiplier) })),
        elem('div', null, elem('span', { text: 'Maturity multiplier' }), elem('b', { class: 'num', text: String(row.maturity_multiplier) })),
        elem('div', null, elem('span', { text: 'Reach multiplier' }), elem('b', { class: 'num', text: String(row.reach_multiplier) })),
        elem('div', null, elem('span', { text: 'Implied value' }), elem('b', { class: 'num', text: money(row.implied_value_usd) }))
      ),
      elem('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + money(recompute(row, DATA.model)) + (recompute(row, DATA.model) === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(elem('section', { class: 'detail-section' },
      elem('h3', { text: 'Farm plan' }),
      elem('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return elem('li', null, elem('b', { text: action }), elem('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    board.textContent = '';
    var shell = elem('div', { class: 'shell' });
    shell.appendChild(topBar());
    shell.appendChild(intro());
    if (view.tab === 'pre-token') shell.appendChild(topThree());
    shell.appendChild(filterBar());
    shell.appendChild(view.tab === 'pre-token' ? boardTable() : liveTable());
    if (view.tab === 'pre-token') shell.appendChild(modelPanel());
    board.appendChild(shell);
    board.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) board.appendChild(dialog);
    if (view.selected) openDetail(view.selected);
  }

  readState();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
