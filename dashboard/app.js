// Token Radar — dashboard script, rewritten for the radar-2 board.
//
// Everything on the page comes from window.RADAR, the dataset main.ts
// writes beside this page as data.js. There is no fetch and no network:
// the ranked rows, the live-token set and the model constants all arrive
// in that one script tag, and this file only turns them into a page.
//
// What the page offers a reader:
//   * a top-three spotlight over the strongest implied values;
//   * a board that can be searched and filtered by category and chain,
//     with columns that sort both ways;
//   * a detail drawer for any protocol, showing the four multipliers
//     behind its implied value and a fresh recomputation of that value,
//     next to the seven-step plan for farming it;
//   * a tuner that re-scores the whole board live with the same formula
//     the model uses, so a reader can feel which input matters most.
// Tuning never touches board.json; it only changes what this page shows.
(function () {
  'use strict';

  var RADAR = window.RADAR;
  if (!RADAR) {
    return;
  }

  var root = document.getElementById('board');

  // What the reader is looking at right now. `view` drives every render;
  // the address hash mirrors it so a board, a filter or a detail view can
  // be linked to and reloaded.
  var view = {
    query: '',
    category: 'all',
    chain: 'all',
    tab: 'pre-token',
    sortKey: 'implied',
    sortDir: -1,
    selected: null
  };

  // The tuner's offsets from the submitted model. A scale of 1 and the
  // model's own growth weights mean "the board as submitted".
  var tuning = {
    baseScale: 1,
    growthUp: RADAR.model.growth_weight_up,
    growthDown: RADAR.model.growth_weight_down
  };

  // Set while the search box is being typed in, so a re-render can hand
  // focus straight back to it instead of dropping the caret.
  var searchHasFocus = false;

  // ---------------------------------------------------------------- money

  var dollars = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  });

  // A short dollar figure: $12.34B, $45.6M, $789K, or the full format
  // below a thousand. Used wherever a column has to stay narrow.
  function moneyShort(value) {
    if (value === null || value === undefined || !isFinite(value)) {
      return 'n/a';
    }
    var size = Math.abs(value);
    if (size >= 1e9) {
      return '$' + (value / 1e9).toFixed(2) + 'B';
    }
    if (size >= 1e6) {
      return '$' + (value / 1e6).toFixed(1) + 'M';
    }
    if (size >= 1e3) {
      return '$' + Math.round(value / 1e3) + 'K';
    }
    return dollars.format(value);
  }

  // A signed percentage with two decimals, or n/a when unreported.
  function pctChange(value) {
    if (value === null || value === undefined || !isFinite(value)) {
      return 'n/a';
    }
    return (value > 0 ? '+' : '') + value.toFixed(2) + '%';
  }

  // An age in days as years once it passes a year, else days.
  function ageLabel(days) {
    if (days === null || days === undefined) {
      return 'unknown';
    }
    if (days >= 365) {
      return (days / 365).toFixed(1) + 'y';
    }
    return Math.max(0, Math.round(days)) + 'd';
  }

  // ------------------------------------------------------- the model, live

  // The tiered base multiple for a TVL, straight from the model constants:
  // smaller protocols earn more per TVL dollar than giants do.
  function tierFor(tvl, model) {
    if (tvl >= model.large_tvl) {
      return model.base_multiple_large;
    }
    if (tvl >= model.mid_tvl) {
      return model.base_multiple_mid;
    }
    return model.base_multiple_small;
  }

  // One protocol's implied value under the radar-2 formula, the same
  // function lib/model.ts runs on the server side. `overrides` is the
  // tuner's set of constants; without it the submitted model is used, so
  // the drawer can check its recomputation against board.json exactly.
  function scoreProtocol(row, model, overrides) {
    var base = tierFor(row.tvl_usd, model);
    if (overrides) {
      base *= overrides.baseScale;
    }
    var rawGrowth = row.change_7d === null || row.change_7d === undefined
      ? 0
      : row.change_7d;
    var growth = Math.min(
      model.growth_cap,
      Math.max(model.growth_floor, rawGrowth)
    );
    var weight = growth >= 0
      ? (overrides ? overrides.growthUp : model.growth_weight_up)
      : (overrides ? overrides.growthDown : model.growth_weight_down);
    var growthMult = 1 + (growth / 100) * weight;
    var age = row.age_days === null || row.age_days === undefined
      ? model.unknown_age_days
      : row.age_days;
    var maturityMult = model.maturity_floor
      + model.maturity_range
        * Math.sqrt(
          Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days
        );
    var extraChains = Math.min(
      Math.max((row.chains || []).length - 1, 0),
      model.breadth_max_chains
    );
    var breadthMult = 1 + extraChains * model.breadth_per_chain;
    var implied = Math.max(
      1,
      Math.round(row.tvl_usd * base * growthMult * maturityMult * breadthMult)
    );
    return {
      implied: implied,
      base: base,
      growthMult: growthMult,
      maturityMult: maturityMult,
      breadthMult: breadthMult
    };
  }

  // Whether any tuner slider sits away from the submitted model.
  function isTuned() {
    return tuning.baseScale !== 1
      || tuning.growthUp !== RADAR.model.growth_weight_up
      || tuning.growthDown !== RADAR.model.growth_weight_down;
  }

  // The value the board shows for a row: the submitted figure, or the
  // tuner's recomputation while a slider is moved.
  function shownValue(row) {
    if (isTuned()) {
      return scoreProtocol(row, RADAR.model, tuning).implied;
    }
    return row.implied_value_usd;
  }

  // ------------------------------------------------------------ dom helper

  // Build one element. `opts` may carry a class, plain text, raw HTML, a
  // map of attributes, a map of event listeners, and child nodes. Children
  // may be nodes, strings, or arrays of either; nulls are skipped.
  function makeEl(tag, opts, kids) {
    var node = document.createElement(tag);
    var o = opts || {};
    if (o.cls) {
      node.className = o.cls;
    }
    if (o.text !== undefined && o.text !== null) {
      node.textContent = o.text;
    }
    if (o.html !== undefined && o.html !== null) {
      node.innerHTML = o.html;
    }
    if (o.attrs) {
      Object.keys(o.attrs).forEach(function (key) {
        var val = o.attrs[key];
        if (val !== null && val !== undefined) {
          node.setAttribute(key, val);
        }
      });
    }
    if (o.on) {
      Object.keys(o.on).forEach(function (eventName) {
        node.addEventListener(eventName, o.on[eventName]);
      });
    }
    var children = kids === undefined ? [] : kids;
    if (!Array.isArray(children)) {
      children = [children];
    }
    children.forEach(function (child) {
      if (child === null || child === undefined) {
        return;
      }
      if (Array.isArray(child)) {
        child.forEach(function (inner) {
          if (inner) {
            node.appendChild(inner);
          }
        });
        return;
      }
      if (typeof child === 'string') {
        node.appendChild(document.createTextNode(child));
      } else {
        node.appendChild(child);
      }
    });
    return node;
  }

  // A short "label / value" pair, used for the spotlight figures and the
  // drawer's equation rows.
  function labelled(label, valueNode, valueCls) {
    return makeEl('div', {}, [
      makeEl('span', { text: label }),
      makeEl('b', { cls: valueCls || 'num', text: valueNode })
    ]);
  }

  // ------------------------------------------------------------ farm plans

  // The farm plan is derived, never hand-written per protocol: the
  // protocol's category picks the main move and the second move, its TVL
  // picks the capital, and its age picks the hold. This is the same
  // derivation main.ts writes into board.json, so the drawer and the
  // board agree step for step. No protocol name is special-cased.
  function mainChainOf(protocol) {
    if (protocol.chains && protocol.chains.length > 0) {
      return protocol.chains[0];
    }
    return 'its main chain';
  }

  function stakeFor(protocol) {
    if (protocol.tvl_usd >= 5e9) {
      return 250;
    }
    if (protocol.tvl_usd >= 1e9) {
      return 150;
    }
    if (protocol.tvl_usd >= 1e8) {
      return 100;
    }
    return 50;
  }

  function holdFor(ageDays) {
    if (ageDays === null || ageDays === undefined) {
      return 30;
    }
    if (ageDays < 180) {
      return 60;
    }
    if (ageDays < 365) {
      return 45;
    }
    return 30;
  }

  // One entry per family of protocols. `keys` are the words in a category
  // that select the family; `main` and `follow` write that family's two
  // qualifying actions. The last entry is the fallback for anything
  // uncategorised.
  var FARM_FAMILIES = [
    {
      keys: ['lend', 'cdp', 'collateral'],
      main: function (name, capital, chain) {
        return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain
          + ' and keep the position open.';
      },
      follow: function (name, capital, chain) {
        var half = Math.max(10, Math.round(capital / 2));
        return 'Borrow $' + half + ' against the deposit on ' + name
          + ' and repay it within a week, so the wallet shows both sides of the market.';
      }
    },
    {
      keys: ['dex', 'yield', 'leveraged farm'],
      main: function (name, capital, chain) {
        return 'Provide $' + capital + ' of liquidity to ' + name
          + "'s main pool on " + chain + ' and keep the position open.';
      },
      follow: function (name, capital, chain) {
        var half = Math.max(10, Math.round(capital / 2));
        return 'Swap $' + half + ' through ' + name + "'s own router on "
          + chain + ' instead of an outside exchange, so the trade is counted on-protocol.';
      }
    },
    {
      keys: ['bridge'],
      main: function (name, capital, chain) {
        return 'Bridge $' + capital + ' of USDC to ' + chain + ' through '
          + name + ' and use the bridged funds in its app.';
      },
      follow: function (name, capital, chain) {
        return 'Bridge a second, smaller amount back through ' + name
          + ' the following week, so the wallet shows repeat use rather than one hop.';
      }
    },
    {
      keys: ['staking', 'restak'],
      main: function (name, capital, chain) {
        return "Stake $" + capital + " of the chain's staking asset through "
          + name + ' and keep the receipt.';
      },
      follow: function (name, capital, chain) {
        return "Vote once in " + name
          + "'s governance or delegate the stake to a validator the protocol lists, if it offers either.";
      }
    },
    {
      keys: ['perpetual', 'derivative'],
      main: function (name, capital, chain) {
        return 'Deposit $' + capital + ' of USDC as margin on ' + name
          + ' and open one small hedge.';
      },
      follow: function (name, capital, chain) {
        return 'Close the hedge after a week and open a fresh one at half size,'
          + ' so the wallet shows ongoing trading rather than one trade.';
      }
    },
    {
      keys: ['prediction'],
      main: function (name, capital, chain) {
        return 'Fund $' + capital + ' and place one market position on ' + name + '.';
      },
      follow: function (name, capital, chain) {
        return 'Settle one market and place a second, smaller position in a different market on ' + name + '.';
      }
    },
    {
      keys: ['curator', 'allocator'],
      main: function (name, capital, chain) {
        return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain
          + ' and keep the shares.';
      },
      follow: function (name, capital, chain) {
        var half = Math.max(10, Math.round(capital / 2));
        return 'Deposit a second tranche of $' + half + ' into a different '
          + name + ' vault on ' + chain + ' a week later.';
      }
    },
    {
      keys: ['stable'],
      main: function (name, capital, chain) {
        return 'Mint or deposit $' + capital + ' of the stable asset through '
          + name + ' on ' + chain + '.';
      },
      follow: function (name, capital, chain) {
        return 'Use the stable asset in one on-chain payment or pool on '
          + chain + ', rather than leaving it idle in the wallet.';
      }
    },
    {
      keys: ['rwa'],
      main: function (name, capital, chain) {
        return "Mint $" + capital + " of the protocol's yield asset on "
          + chain + ' and hold it.';
      },
      follow: function (name, capital, chain) {
        return 'Reinvest one yield payout from the ' + name
          + ' asset instead of withdrawing it, so the position compounds.';
      }
    },
    {
      keys: ['insurance'],
      main: function (name, capital, chain) {
        return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain
          + ' and keep the policy.';
      },
      follow: function (name, capital, chain) {
        return 'Renew or extend the ' + name
          + ' cover once, so the wallet shows a repeat customer rather than a one-off buyer.';
      }
    },
    {
      keys: [],
      main: function (name, capital, chain) {
        return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain
          + ' and keep the position open.';
      },
      follow: function (name, capital, chain) {
        return 'Use a second feature of ' + name + ' on ' + chain
          + ' — a swap, a vote or a second deposit — within the first week.';
      }
    }
  ];

  // The family whose keywords appear in a protocol's category, or the
  // fallback family when none do.
  function familyFor(protocol) {
    var category = (protocol.category || '').toLowerCase();
    for (var i = 0; i < FARM_FAMILIES.length; i++) {
      var family = FARM_FAMILIES[i];
      for (var j = 0; j < family.keys.length; j++) {
        if (category.indexOf(family.keys[j]) >= 0) {
          return family;
        }
      }
      if (family.keys.length === 0) {
        return family;
      }
    }
    return FARM_FAMILIES[FARM_FAMILIES.length - 1];
  }

  // One step as a single string: the action, then what it costs and how
  // long it takes. Kept inside the gate's 20 to 600 characters.
  function stepLine(step) {
    var line = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (line.length > 600) {
      line = line.slice(0, 596) + '...';
    }
    if (line.length < 20) {
      line = line + " Hold the position and check the protocol's own page.";
    }
    return line;
  }

  // Seven steps for one protocol: a fresh wallet, the main position, a
  // second qualifying action, a weekly cadence, the hold, a claim-safety
  // check, and a tested exit.
  function farmPlan(protocol) {
    var chain = mainChainOf(protocol);
    var capital = stakeFor(protocol);
    var hold = holdFor(protocol.age_days);
    var family = familyFor(protocol);
    var big = capital >= 150;
    var steps = [
      {
        text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
        cost: 'under $3 of gas for the first transaction',
        time: '5 minutes'
      },
      {
        text: family.main(protocol.name, capital, chain),
        cost: '$' + capital + ' of capital and about $' + (big ? 8 : 4) + ' of gas',
        time: '15 minutes to set up'
      },
      {
        text: family.follow(protocol.name, capital, chain),
        cost: 'about $' + (big ? 6 : 3) + ' of gas, no new capital',
        time: '10 minutes in the first week'
      },
      {
        text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.',
        cost: 'about $2 of gas a week',
        time: '10 minutes a week'
      },
      {
        text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.',
        cost: 'the $' + capital + ' stays in the position',
        time: hold + ' days'
      },
      {
        text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.",
        cost: 'no fee to check, and never pay to claim',
        time: '10 minutes'
      },
      {
        text: 'Test the exit first: withdraw a tenth of the position, confirm it lands, then unwind the rest and log every transaction.',
        cost: 'about $2 of gas for the test withdrawal',
        time: '15 minutes to unwind'
      }
    ];
    return steps.map(stepLine);
  }

  // ------------------------------------------------------- hash round-trip

  // Read the board's state back out of the address hash on load, so a
  // shared link reopens the same search, filters and detail view.
  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) {
      return;
    }
    var params = new URLSearchParams(hash);
    if (params.get('q')) {
      view.query = params.get('q');
    }
    if (params.get('p')) {
      view.selected = params.get('p');
    }
    if (params.get('category')) {
      view.category = params.get('category');
    }
    if (params.get('chain')) {
      view.chain = params.get('chain');
    }
  }

  // Write the current state into the hash without reloading the page.
  function writeHash() {
    var params = new URLSearchParams();
    if (view.query) {
      params.set('q', view.query);
    }
    if (view.category !== 'all') {
      params.set('category', view.category);
    }
    if (view.chain !== 'all') {
      params.set('chain', view.chain);
    }
    if (view.selected) {
      params.set('p', view.selected);
    }
    var next = params.toString();
    if (next) {
      window.history.replaceState(null, '', '#' + next);
    } else {
      window.history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search
      );
    }
  }

  // ------------------------------------------------- filtering and sorting

  // The pre-token rows that survive the search box and both dropdowns.
  function visibleRows() {
    var needle = view.query.trim().toLowerCase();
    return RADAR.rows.filter(function (row) {
      if (view.category !== 'all' && row.category !== view.category) {
        return false;
      }
      if (view.chain !== 'all' && (row.chains || []).indexOf(view.chain) < 0) {
        return false;
      }
      if (!needle) {
        return true;
      }
      var haystack = [
        row.name,
        row.slug,
        row.category,
        (row.chains || []).join(' ')
      ].join(' ').toLowerCase();
      return haystack.indexOf(needle) >= 0;
    });
  }

  // The rows in the reader's chosen order. `sortDir` -1 means strongest
  // first; a repeated click on the same column flips it. Equal values
  // break by slug so the order is stable run to run.
  function sortedVisible(list) {
    var key = view.sortKey;
    return list.slice().sort(function (a, b) {
      var first;
      var second;
      if (key === 'name') {
        first = a.name.toLowerCase();
        second = b.name.toLowerCase();
      } else if (key === 'tvl') {
        first = a.tvl_usd;
        second = b.tvl_usd;
      } else if (key === 'growth') {
        first = a.change_7d === null ? -Infinity : a.change_7d;
        second = b.change_7d === null ? -Infinity : b.change_7d;
      } else if (key === 'age') {
        first = a.age_days === null ? Infinity : a.age_days;
        second = b.age_days === null ? Infinity : b.age_days;
      } else {
        first = shownValue(a);
        second = shownValue(b);
      }
      if (first < second) {
        return -view.sortDir;
      }
      if (first > second) {
        return view.sortDir;
      }
      if (a.slug < b.slug) {
        return -1;
      }
      if (a.slug > b.slug) {
        return 1;
      }
      return 0;
    });
  }

  // ------------------------------------------------------------ page parts

  function renderTop() {
    return makeEl('header', { cls: 'top' }, [
      makeEl('div', { cls: 'brand' }, [
        makeEl('span', { cls: 'mark' }),
        makeEl('span', { cls: 'brand-name', text: 'Token Radar' })
      ]),
      makeEl('div', { cls: 'top-meta' }, [
        makeEl('span', { text: 'Snapshot ' + RADAR.as_of }),
        makeEl('span', { text: 'DefiLlama protocol index' }),
        makeEl('span', { text: RADAR.model_version + ' model' })
      ])
    ]);
  }

  function renderIntro() {
    var floorMillions = Math.round(RADAR.floor_usd / 1e6);
    return makeEl('section', { cls: 'lede' }, [
      makeEl('div', {}, [
        makeEl('h1', {
          text: RADAR.watchlist_size + ' watchlist protocols, ranked by implied value'
        }),
        makeEl('p', {
          text: 'The watchlist is the floor: every protocol with at least $'
            + floorMillions + 'M of TVL and no token on record. The early radar adds '
            + RADAR.early_size + ' pre-token protocols below that floor, so the board holds '
            + RADAR.board_size + ' rows. Implied value is a model, not a promise — and never a claim that a token will launch.'
        })
      ]),
      makeEl('div', { cls: 'facts' }, [
        makeEl('div', { cls: 'fact' }, [
          makeEl('span', { text: 'Watchlist covered' }),
          makeEl('b', { text: RADAR.watchlist_size + ' / ' + RADAR.watchlist_size })
        ]),
        makeEl('div', { cls: 'fact' }, [
          makeEl('span', { text: 'Pre-token rows scored' }),
          makeEl('b', { text: String(RADAR.board_size) })
        ]),
        makeEl('div', { cls: 'fact' }, [
          makeEl('span', { text: 'Early rows below the floor' }),
          makeEl('b', { text: String(RADAR.early_size) })
        ]),
        makeEl('div', { cls: 'fact' }, [
          makeEl('span', { text: 'Live-token protocols set aside' }),
          makeEl('b', { text: String(RADAR.live_size) })
        ])
      ])
    ]);
  }

  // The three strongest rows as cards. A card opens the same detail
  // drawer a table row opens.
  function renderSpotlights() {
    var cards = RADAR.rows.slice(0, 3).map(function (row) {
      var growthCls = row.change_7d !== null && row.change_7d >= 0 ? 'pos' : 'neg';
      var card = makeEl('article', {
        cls: 'spot',
        attrs: { tabindex: '0' },
        on: {
          click: function () { showProtocol(row.slug); },
          keydown: function (event) {
            if (event.key === 'Enter') {
              showProtocol(row.slug);
            }
          }
        }
      }, [
        makeEl('span', { cls: 'spot-rank', text: 'Rank ' + row.rank }),
        makeEl('h2', { text: row.name }),
        makeEl('p', {
          cls: 'sub',
          text: (row.category || 'Other') + ' on ' + (row.chains || []).slice(0, 2).join(', ')
        }),
        makeEl('div', { cls: 'spot-vals' }, [
          labelled('Implied value', moneyShort(shownValue(row))),
          labelled('TVL', moneyShort(row.tvl_usd)),
          makeEl('div', {}, [
            makeEl('span', { text: '7d' }),
            makeEl('b', { cls: 'num ' + growthCls, text: pctChange(row.change_7d) })
          ])
        ])
      ]);
      return card;
    });
    return makeEl('section', {
      cls: 'spots',
      attrs: { 'aria-label': 'Top three protocols' }
    }, cards);
  }

  // Search box, category and chain dropdowns, the pre-token / live-token
  // switch, and the count of rows the current filters leave showing.
  function renderFilters() {
    var categories = Array.from(
      new Set(RADAR.rows.map(function (row) { return row.category || 'Other'; }))
    ).sort();
    var chains = Array.from(
      new Set(RADAR.rows.flatMap(function (row) { return row.chains || []; }))
    ).sort();

    var search = makeEl('input', {
      attrs: {
        type: 'search',
        id: 'q',
        placeholder: 'Search name, category or chain',
        value: view.query,
        'aria-label': 'Search the board'
      },
      on: {
        input: function () {
          searchHasFocus = true;
          view.query = search.value;
          writeHash();
          renderAll();
        }
      }
    });

    var categorySelect = makeEl('select', {
      attrs: { id: 'category', 'aria-label': 'Filter by category' },
      on: {
        change: function () {
          view.category = categorySelect.value;
          writeHash();
          renderAll();
        }
      }
    }, [
      makeEl('option', { attrs: { value: 'all' }, text: 'All categories' }),
      categories.map(function (name) {
        return makeEl('option', {
          attrs: {
            value: name,
            selected: name === view.category ? 'selected' : null
          },
          text: name
        });
      })
    ]);

    var chainSelect = makeEl('select', {
      attrs: { id: 'chain', 'aria-label': 'Filter by chain' },
      on: {
        change: function () {
          view.chain = chainSelect.value;
          writeHash();
          renderAll();
        }
      }
    }, [
      makeEl('option', { attrs: { value: 'all' }, text: 'All chains' }),
      chains.map(function (name) {
        return makeEl('option', {
          attrs: {
            value: name,
            selected: name === view.chain ? 'selected' : null
          },
          text: name
        });
      })
    ]);

    var preTab = makeEl('button', {
      attrs: {
        type: 'button',
        'aria-pressed': view.tab === 'pre-token' ? 'true' : 'false'
      },
      text: 'Pre-token',
      on: { click: function () { view.tab = 'pre-token'; renderAll(); } }
    });
    var liveTab = makeEl('button', {
      attrs: {
        type: 'button',
        'aria-pressed': view.tab === 'live' ? 'true' : 'false'
      },
      text: 'Live token',
      on: { click: function () { view.tab = 'live'; renderAll(); } }
    });

    var countText = view.tab === 'pre-token'
      ? visibleRows().length + ' rows shown' + (isTuned() ? ' (tuned model)' : '')
      : RADAR.live.length + ' live-token protocols';

    return makeEl('div', { cls: 'controls' }, [
      makeEl('div', { cls: 'field' }, [
        makeEl('label', { attrs: { for: 'q' }, text: 'Search' }),
        search
      ]),
      makeEl('div', { cls: 'field' }, [
        makeEl('label', { attrs: { for: 'category' }, text: 'Category' }),
        categorySelect
      ]),
      makeEl('div', { cls: 'field' }, [
        makeEl('label', { attrs: { for: 'chain' }, text: 'Chain' }),
        chainSelect
      ]),
      makeEl('div', { cls: 'field' }, [
        makeEl('span', { cls: 'sub', text: 'Token status' }),
        makeEl('div', { cls: 'tabs' }, [preTab, liveTab])
      ]),
      makeEl('span', { cls: 'count', text: countText })
    ]);
  }

  // One sortable column head: clicking sorts by it, clicking again flips
  // the direction, and the arrow shows which column and way are active.
  function sortHead(key, label) {
    var marker = null;
    if (view.sortKey === key) {
      marker = makeEl('span', {
        attrs: { 'aria-hidden': 'true' },
        text: view.sortDir < 0 ? ' v' : ' ^'
      });
    }
    return makeEl('th', { attrs: { scope: 'col' } }, [
      makeEl('button', {
        attrs: { type: 'button' },
        on: {
          click: function () {
            if (view.sortKey === key) {
              view.sortDir = -view.sortDir;
            } else {
              view.sortKey = key;
              view.sortDir = -1;
            }
            renderAll();
          }
        }
      }, [label, marker])
    ]);
  }

  // A protocol's short chain line for a table row: the first two chains,
  // then how many more there are.
  function chainLine(row) {
    var chains = row.chains || [];
    var head = chains.length ? chains.slice(0, 2).join(', ') : 'an unnamed chain';
    var extra = chains.length > 2 ? ' +' + (chains.length - 2) : '';
    return (row.category || 'Other') + ' on ' + head + extra;
  }

  function renderBoard() {
    var list = sortedVisible(visibleRows());
    if (list.length === 0) {
      return makeEl('div', { cls: 'panel' }, [
        makeEl('div', { cls: 'empty' }, [
          makeEl('h2', { text: 'No protocol matches that filter' }),
          makeEl('p', { text: 'Clear the search or pick another category to see the board again.' }),
          makeEl('button', {
            cls: 'button primary',
            attrs: { type: 'button' },
            text: 'Clear filters',
            on: {
              click: function () {
                view.query = '';
                view.category = 'all';
                view.chain = 'all';
                writeHash();
                renderAll();
              }
            }
          })
        ])
      ]);
    }
    var top = Math.max.apply(null, list.map(shownValue)) || 1;
    var body = makeEl('tbody');
    list.forEach(function (row) {
      var growth = row.change_7d === null ? 'n/a' : pctChange(row.change_7d);
      var growthCls = row.change_7d === null
        ? ''
        : row.change_7d >= 0 ? 'pos' : 'neg';
      var value = shownValue(row);
      var width = Math.max(3, Math.round((value / top) * 100));
      var line = makeEl('tr', {
        attrs: {
          'data-selected': view.selected === row.slug ? 'true' : 'false',
          tabindex: '0'
        },
        on: {
          click: function () { showProtocol(row.slug); },
          keydown: function (event) {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              showProtocol(row.slug);
            }
          }
        }
      }, [
        makeEl('td', { cls: 'num', text: String(row.rank) }),
        makeEl('td', {}, [
          makeEl('div', { cls: 'name' }, [
            makeEl('b', { text: row.name }),
            makeEl('span', { cls: 'sub', text: chainLine(row) })
          ])
        ]),
        makeEl('td', { cls: 'num', text: moneyShort(row.tvl_usd) }),
        makeEl('td', { cls: 'num ' + growthCls, text: growth }),
        makeEl('td', { cls: 'num', text: ageLabel(row.age_days) }),
        makeEl('td', {}, [
          makeEl('div', { cls: 'implied' }, [
            makeEl('div', { cls: 'bar', attrs: { 'aria-hidden': 'true' } }, [
              makeEl('i', { attrs: { style: 'width:' + width + '%' } })
            ]),
            makeEl('span', { cls: 'num', text: moneyShort(value) })
          ])
        ]),
        makeEl('td', {}, [
          makeEl('span', { cls: 'status', text: 'no token' })
        ])
      ]);
      body.appendChild(line);
    });
    return makeEl('div', { cls: 'panel' }, [
      makeEl('div', { cls: 'table-wrap' }, [
        makeEl('table', {}, [
          makeEl('caption', {
            cls: 'sub',
            text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.'
          }),
          makeEl('thead', {}, [
            makeEl('tr', {}, [
              sortHead('implied', 'Rank'),
              sortHead('name', 'Protocol'),
              sortHead('tvl', 'TVL'),
              sortHead('growth', '7d'),
              sortHead('age', 'Age'),
              sortHead('implied', 'Implied value'),
              makeEl('th', { attrs: { scope: 'col' }, text: 'Token' })
            ])
          ]),
          body
        ])
      ])
    ]);
  }

  // The live-token set, apart from the ranking: these protocols already
  // trade, so the page shows their market caps instead of a model value.
  function renderLive() {
    var body = makeEl('tbody');
    RADAR.live.forEach(function (row) {
      var growthCls = row.change_7d !== null && row.change_7d >= 0 ? 'pos' : 'neg';
      body.appendChild(makeEl('tr', {}, [
        makeEl('td', { cls: 'num', text: 'live' }),
        makeEl('td', {}, [
          makeEl('div', { cls: 'name' }, [
            makeEl('b', { text: row.name }),
            makeEl('span', { cls: 'sub', text: chainLine(row) })
          ])
        ]),
        makeEl('td', { cls: 'num', text: moneyShort(row.tvl_usd) }),
        makeEl('td', { cls: 'num ' + growthCls, text: pctChange(row.change_7d) }),
        makeEl('td', { cls: 'num', text: moneyShort(row.mcap_usd) }),
        makeEl('td', {}, [
          makeEl('span', { cls: 'status', text: 'already trades' })
        ])
      ]));
    });
    return makeEl('div', { cls: 'panel' }, [
      makeEl('div', { cls: 'table-wrap' }, [
        makeEl('table', {}, [
          makeEl('caption', {
            cls: 'sub',
            text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.'
          }),
          makeEl('thead', {}, [
            makeEl('tr', {}, [
              makeEl('th', { attrs: { scope: 'col' }, text: 'Status' }),
              makeEl('th', { attrs: { scope: 'col' }, text: 'Protocol' }),
              makeEl('th', { attrs: { scope: 'col' }, text: 'TVL' }),
              makeEl('th', { attrs: { scope: 'col' }, text: '7d' }),
              makeEl('th', { attrs: { scope: 'col' }, text: 'Market cap' }),
              makeEl('th', { attrs: { scope: 'col' }, text: 'Token' })
            ])
          ]),
          body
        ])
      ])
    ]);
  }

  // ---------------------------------------------------------- model panel

  // One tuner slider. Dragging moves only the number beside it, so the
  // slider is never rebuilt under the pointer; releasing it applies the
  // new constant and re-scores the board.
  function sliderRow(label, min, max, step, value, apply) {
    var readout = makeEl('b', { cls: 'num', text: String(value) });
    var input = makeEl('input', {
      attrs: {
        type: 'range',
        min: String(min),
        max: String(max),
        step: String(step),
        value: String(value),
        'aria-label': label
      },
      on: {
        input: function () { readout.textContent = input.value; },
        change: function () {
          apply(parseFloat(input.value));
          renderAll();
        }
      }
    });
    return makeEl('div', { cls: 'tune' }, [
      makeEl('span', { text: label }),
      input,
      readout
    ]);
  }

  // The formula, in words and numbers, plus the three tuner sliders.
  function renderModel() {
    var m = RADAR.model;
    var formula = 'implied = round( tvl_usd x tiered base ('
      + m.base_multiple_small + ' below $100M, ' + m.base_multiple_mid
      + ' to $1B, ' + m.base_multiple_large + ' above) x (1 + clamp(change_7d, '
      + m.growth_floor + ', ' + m.growth_cap + ') / 100 x '
      + m.growth_weight_up + ' up / ' + m.growth_weight_down + ' down) x ('
      + m.maturity_floor + ' + ' + m.maturity_range
      + ' x sqrt(min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days
      + ')) x (1 + 0.03 x extra chains, to 1.12) )';
    var reset = makeEl('button', {
      cls: 'button',
      attrs: { type: 'button' },
      text: 'Reset to the submitted model',
      on: {
        click: function () {
          tuning = {
            baseScale: 1,
            growthUp: m.growth_weight_up,
            growthDown: m.growth_weight_down
          };
          renderAll();
        }
      }
    });
    return makeEl('section', { cls: 'panel model' }, [
      makeEl('h2', { text: 'How implied value is computed' }),
      makeEl('p', {
        cls: 'sub',
        text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.'
      }),
      makeEl('div', { cls: 'formula', text: formula }),
      makeEl('p', {
        cls: 'sub',
        text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses '
          + m.unknown_age_days + ' days. A fall is punished harder than a rise is rewarded, longevity counts with diminishing returns, and a multi-chain protocol earns a small breadth premium. The early radar is every pre-token protocol below the watchlist floor, by TVL, and the live-token protocols are set aside with their market caps shown.'
      }),
      makeEl('h3', { text: 'Try the model yourself' }),
      makeEl('p', {
        cls: 'sub',
        text: 'Move a slider and the board recomputes with the same formula. Tuning here changes only this page, never board.json.'
      }),
      makeEl('div', { cls: 'tuner' }, [
        sliderRow('Base multiple scale', 0.5, 2, 0.05, tuning.baseScale, function (v) {
          tuning.baseScale = v;
        }),
        sliderRow('Growth weight, rising', 0, 1.5, 0.05, tuning.growthUp, function (v) {
          tuning.growthUp = v;
        }),
        sliderRow('Growth weight, falling', 0, 1.5, 0.05, tuning.growthDown, function (v) {
          tuning.growthDown = v;
        }),
        reset
      ])
    ]);
  }

  // ---------------------------------------------------------- detail drawer

  // The drawer lives once, outside the re-rendered shell, so opening it
  // never loses its place. Closing it clears the selection and the hash.
  var drawer = makeEl('dialog', {
    cls: 'detail',
    attrs: { id: 'detail', 'aria-labelledby': 'detail-title' },
    on: {
      close: function () {
        view.selected = null;
        writeHash();
      }
    }
  });

  // Split one farm-step string into its action and its cost/time tail.
  function splitStep(line) {
    var at = line.indexOf(' Cost: ');
    if (at < 0) {
      return { action: line, tail: '' };
    }
    return { action: line.slice(0, at), tail: line.slice(at + 1) };
  }

  // Open the drawer for one protocol: its four multipliers, the page's
  // own recomputation of its implied value checked against board.json,
  // and its seven-step farm plan.
  function showProtocol(slug) {
    var row = null;
    for (var i = 0; i < RADAR.rows.length; i++) {
      if (RADAR.rows[i].slug === slug) {
        row = RADAR.rows[i];
        break;
      }
    }
    if (!row) {
      return;
    }
    view.selected = slug;
    writeHash();
    drawer.textContent = '';

    var recomputed = scoreProtocol(row, RADAR.model);
    var checkLine = 'Model ' + RADAR.model_version
      + ': the same function scores every protocol. The page recomputes this row as '
      + moneyShort(recomputed.implied)
      + (recomputed.implied === row.implied_value_usd
        ? ', the same number board.json carries.'
        : ', which differs from the board: the data would be stale.')
      + ' This is an estimate, not a price, and not a prediction that a token launches.';

    drawer.appendChild(makeEl('div', { cls: 'detail-head' }, [
      makeEl('div', {}, [
        makeEl('span', {
          cls: 'brand-name',
          text: 'Rank ' + row.rank + ' of ' + RADAR.board_size
        }),
        makeEl('h2', { attrs: { id: 'detail-title' }, text: row.name }),
        makeEl('p', {
          cls: 'sub',
          text: (row.category || 'Other') + ' on '
            + ((row.chains && row.chains.length) ? row.chains.join(', ') : 'an unnamed chain')
        })
      ]),
      makeEl('button', {
        cls: 'close',
        attrs: { type: 'button', 'aria-label': 'Close details' },
        text: 'Close',
        on: { click: function () { drawer.close(); } }
      })
    ]));

    var equation = makeEl('div', { cls: 'equation' }, [
      labelled('TVL', moneyShort(row.tvl_usd)),
      labelled('Seven-day growth', pctChange(row.change_7d)),
      labelled('Age with no token', ageLabel(row.age_days)),
      labelled('Chains', String((row.chains || []).length)),
      labelled('Base multiple', String(recomputed.base)),
      labelled('Growth multiplier', String(row.growth_multiplier)),
      labelled('Maturity multiplier', String(row.maturity_multiplier)),
      labelled('Breadth multiplier', String(row.breadth_multiplier)),
      labelled('Implied value', moneyShort(row.implied_value_usd))
    ]);
    drawer.appendChild(makeEl('section', { cls: 'detail-section' }, [
      makeEl('h3', { text: 'Implied value' }),
      equation,
      makeEl('p', { cls: 'sub', text: checkLine })
    ]));

    var plan = farmPlan(row).map(function (line) {
      var parts = splitStep(line);
      return makeEl('li', {}, [
        makeEl('b', { text: parts.action }),
        makeEl('span', { cls: 'cost', text: parts.tail })
      ]);
    });
    drawer.appendChild(makeEl('section', { cls: 'detail-section' }, [
      makeEl('h3', { text: 'Farm plan — 7 steps' }),
      makeEl('ol', { cls: 'steps' }, plan)
    ]));

    if (typeof drawer.showModal === 'function') {
      if (!drawer.open) {
        drawer.showModal();
      }
    } else {
      drawer.setAttribute('open', '');
    }
  }

  // ---------------------------------------------------------------- render

  // Rebuild the page from the current view. The drawer is re-attached
  // when it is not already in the page, and a selected protocol reopens
  // after the rebuild so a tuner move never closes it.
  function renderAll() {
    root.textContent = '';
    var shell = makeEl('div', { cls: 'shell' });
    shell.appendChild(renderTop());
    shell.appendChild(renderIntro());
    if (view.tab === 'pre-token') {
      shell.appendChild(renderSpotlights());
    }
    shell.appendChild(renderFilters());
    if (view.tab === 'pre-token') {
      shell.appendChild(renderBoard());
    } else {
      shell.appendChild(renderLive());
    }
    if (view.tab === 'pre-token') {
      shell.appendChild(renderModel());
    }
    root.appendChild(shell);
    root.setAttribute('aria-busy', 'false');
    if (!drawer.isConnected) {
      root.appendChild(drawer);
    }
    if (searchHasFocus) {
      searchHasFocus = false;
      var searchBox = document.getElementById('q');
      if (searchBox) {
        searchBox.focus();
        var end = searchBox.value.length;
        if (typeof searchBox.setSelectionRange === 'function') {
          searchBox.setSelectionRange(end, end);
        }
      }
    }
    if (view.selected) {
      showProtocol(view.selected);
    }
  }

  readHash();
  renderAll();
  window.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && drawer.open) {
      drawer.close();
    }
  });
})();
