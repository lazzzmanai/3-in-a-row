/*
 * match3_core.js — ПРАВИЛА игры «три в ряд».
 *
 * Здесь нет ни одной строчки про картинку и про Telegram: только поле, ходы и очки.
 * Зачем разделять: правила можно проверить скриптом (scripts/test_match3_core.js),
 * а внешний вид менять, ничего не сломав. Картинка живёт в match3.html.
 *
 * Главное свойство этого файла: ВСЯ случайность приходит через `game.rng` — функцию,
 * которая выдаёт числа от 0 до 1. Если начать с одного и того же зерна (seed) и делать
 * те же ходы в том же порядке, игра получится клетка в клетку такая же. Это нужно не
 * для экономии памяти, а для честности: однажды бот сможет перепроверить результат,
 * повторив партию по зерну и списку ходов.
 *
 * Как читать файл снизу вверх:
 *   1) rngFrom / randInt   — случайность, которую можно повторить
 *   2) findRuns            — «где на поле сейчас есть линии из 3+ одинаковых»
 *   3) clusters / decideShape — «что за фигура сложилась: тройка, четвёрка, пятёрка, Т»
 *   4) adjacent / hasMove  — «разрешён ли этот ход»
 *   5) applyClearAndDrop   — линии исчезли, верхние клетки упали, сверху пришли новые
 *   6) activate            — спецфигуры: взрыв бомбы, сметание звезды, цепная реакция
 *   7) play                — один ход целиком: проверка → спецэффект или линии → каскады
 *
 * СПЕЦФИГУРЫ (с 13 октября, по замечаниям Andr'а). Правила, которые здесь записаны:
 *   · 4 в ряд      → на месте размена появляется 💣 БОМБА: при следующем перемещении
 *     взрывает квадрат 3×3 вокруг той клетки, куда её передвинули;
 *   · 5 в ряд      → +5 дополнительных ходов (без лимита за партию);
 *   · «Т» или «Г»  → две линии по 3, пересекающиеся в одной клетке → ⭐ ЗВЕЗДА: при
 *     перемещении на обычную фигуру стирает ВСЕ фигуры этого вида;
 *   · звезда + бомба → 3 случайные фигуры становятся бомбами;
 *   · звезда + звезда → стирается всё поле;
 *   · чужой взрыв, попавший в спецфигуру, ЗАПУСКАЕТ её (цепная реакция, глубина
 *     ограничена MAX_SPECIAL_DEPTH — иначе теоретическая решётка из бомб не погаснет);
 *   · спецфигуры БЕСЦВЕТНЫЕ: сами линий не составляют и не могут быть «таким же видом»;
 *   · спецфигуры создаются ТОЛЬКО из линии, которую игрок собрал своим разменом. При
 *     каскаде (линии, сложившиеся сами от падения) очков много, а спецфигуры нет —
 *     награда за решение, а не за везение (решение Andr'а 2026-10-13);
 *   · размен со спецфигурой НЕ требует линии и списывает один ход: иначе из неё можно
 *     было бы «стрелять» бесплатно.
 */
(function (root) {
  "use strict";

  // ---------------------------------------------------------------- настройки
  var DEFAULTS = {
    rows: 7,        // высота поля
    cols: 7,        // ширина поля
    kinds: 5,       // сколько видов кристалликов (5 — классика: не скучно и не каша)
    moves: 25,      // длина партии в ходах, а не в секундах: игру можно отложить
    seed: 1         // зерно случайности; в бою его выдаёт бот
  };

  var MAX_CHAIN = 12;           // предохранитель от бесконечного каскада (на деле недостижим)
  var CHAIN_MULT_CAP = 5;       // «каскад ×5» — дальше множитель уже не растёт
  var POINTS_PER_GEM = 10;
  var BONUS_PER_EXTRA_GEM = 20; // четвёртый и пятый в линии стоят дороже
  var BOMB_RADIUS = 1;          // квадрат 3×3 вокруг клетки
  var STAR_BOMB_TURNS = 3;      // звезда + бомба: сколько фигур становятся бомбами
  var EXTRA_MOVES_FOR_FIVE = 5; // пять в ряд — столько дополнительных ходов
  var MAX_SPECIAL_DEPTH = 12;   // цепная реакция спецфигур: сколько «волн» подряд
  var TARGET_PER_MOVE = 240;    // цель = базовых ходов × 240 = 6000 (выбрана по замеру 2026-10-13:
                                 // умная модель берёт её примерно в половине партий, см. sim_match3.js)

  var SPECIAL_BOMB = 90;
  var SPECIAL_STAR = 91;

  function isSpecial(v) { return v === SPECIAL_BOMB || v === SPECIAL_STAR; }
  function isColor(v) { return !isSpecial(v); }

  // ------------------------------------------------------ случайность по зерну
  /** mulberry32 — крохотный генератор чисел. Одинаковое seed → одинаковая игра. */
  function rngFrom(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Целое от 0 до n-1 по нашей воспроизводимой случайности. */
  function randInt(rng, n) {
    return Math.floor(rng() * n) % n;
  }

  // ------------------------------------------------------------------- адрес
  function at(game, r, c) {
    return r * game.cols + c;
  }

  function rowOf(game, i) {
    return Math.floor(i / game.cols);
  }

  function colOf(game, i) {
    return i % game.cols;
  }

  /**
   * Соседние ли клетки (только по вертикали и горизонтали).
   *
   * Диагональ — НЕ ход. И важен второй случай: клетки «последняя строка, первый
   * столбец» и «первая строка следующего ряда» выглядят соседями, если просто
   * сравнить номера. Отсюда классический базис всех «три в ряд»: поле склеивается
   * по краям. Проверка `colOf(a) !== colOf(b) && rowOf(a) !== rowOf(b)` это закрыта.
   */
  function adjacent(game, a, b) {
    if (a === b) return false;
    var dr = Math.abs(rowOf(game, a) - rowOf(game, b));
    var dc = Math.abs(colOf(game, a) - colOf(game, b));
    return (dr + dc) === 1;
  }

  // ------------------------------------------------------------- поиск линий
  /**
   * Все линии из трёх и более одинаковых на текущем поле.
   * Возвращает список {cells:[номера], kind, len, dir} — максимальные отрезки,
   * то есть линия из четырёх это ОДНА запись длиной 4, а не две тройки.
   *
   * Спецфигуры в линиях не участвуют: две бомбы рядом — не «пара одного вида»,
   * они бесцветные. Отсюда isColor в условии продолжения отрезка.
   */
  function findRuns(game) {
    var cells = game.cells, rows = game.rows, cols = game.cols;
    var runs = [], r, c, start, i;

    for (r = 0; r < rows; r++) {                 // горизонтали
      start = 0;
      for (c = 1; c <= cols; c++) {
        var same = c < cols && cells[at(game, r, c)] === cells[at(game, r, start)] &&
                   isColor(cells[at(game, r, c)]);
        if (!same) {
          if (c - start >= 3 && isColor(cells[at(game, r, start)])) {
            var line = [];
            for (i = start; i < c; i++) line.push(at(game, r, i));
            runs.push({ cells: line, kind: cells[at(game, r, start)], len: c - start, dir: "h" });
          }
          start = c;
        }
      }
    }

    for (c = 0; c < cols; c++) {                 // вертикали
      start = 0;
      for (r = 1; r <= rows; r++) {
        var sameV = r < rows && cells[at(game, r, c)] === cells[at(game, start, c)] &&
                    isColor(cells[at(game, r, c)]);
        if (!sameV) {
          if (r - start >= 3 && isColor(cells[at(game, start, c)])) {
            var vert = [];
            for (i = start; i < r; i++) vert.push(at(game, i, c));
            runs.push({ cells: vert, kind: cells[at(game, start, c)], len: r - start, dir: "v" });
          }
          start = r;
        }
      }
    }
    return runs;
  }

  /**
   * Склеиваем пересекающиеся отрезки в «фигуры»: Т-образная линия — это ДВА отрезка
   * (горизонталь и вертикаль) с общей клеткой, и решать «что за неё дать» надо по
   * фигуре целиком, а не по каждому отрезку.
   */
  function clusters(runs) {
    var groups = [];
    runs.forEach(function (run) {
      var mine = {};
      run.cells.forEach(function (i) { mine[i] = true; });
      var hit = null;
        groups.forEach(function (g) {
          if (hit) return;
          for (var k = 0; k < run.cells.length; k++) {
            if (g.map[run.cells[k]]) { hit = g; break; }
          }
        });
      if (hit) {
        hit.runs.push(run);
        run.cells.forEach(function (i) { if (!hit.map[i]) { hit.map[i] = true; hit.cells.push(i); } });
      } else {
        var g2 = { runs: [run], map: mine, cells: run.cells.slice() };
        groups.push(g2);
      }
    });
    return groups;
  }

  /**
   * Что заслуживает эта фигура:
   *   "star"  — есть и горизонталь, и вертикаль (Т, Г, плюс) → звезда;
   *   "five"  — один отрезок из 5+ → дополнительные ходы;
   *   "bomb"  — один отрезок ровно из 4 → бомба;
   *   null    — обычная тройка.
   * Пересечение важнее пятёрки: если игрок собрал «Т» из пяти и трёх, он заслужил
   * именно звезду (сложнее), а не пять ходов.
   */
  function decideShape(cluster) {
    var dirs = {};
    var longest = 0;
    cluster.runs.forEach(function (r) { dirs[r.dir] = true; longest = Math.max(longest, r.len); });
    if (dirs.h && dirs.v) return "star";
    if (longest >= 5) return "five";
    if (longest === 4) return "bomb";
    return null;
  }

  /** Клетка, где появится спецфигура: та из клетки размена, что попала в фигуру. */
  function spawnCell(cluster, swapA, swapB) {
    var inCluster = function (i) {
      for (var k = 0; k < cluster.cells.length; k++) { if (cluster.cells[k] === i) return true; }
      return false;
    };
    if (swapB !== undefined && inCluster(swapB)) return swapB;   // куда переместили фигуру
    if (inCluster(swapA)) return swapA;
    return cluster.cells[Math.floor(cluster.cells.length / 2)];  // не должен случаться, но поле целое
  }

  /** Сколько стоит одна линия: длина 3 → 30, 4 → 60, 5 → 90. */
  function scoreRun(len) {
    return POINTS_PER_GEM * len + (len > 3 ? BONUS_PER_EXTRA_GEM * (len - 3) : 0);
  }

  function chainMult(chain) {
    return Math.min(chain, CHAIN_MULT_CAP);
  }

  // --------------------------------------------------------- есть ли куда ход
  /**
   * Есть ли хотя бы один полезный ход. Перебираем пары «вправо» и «вниз» —
   * этого достаточно: ход «влево» это тот же «вправо», только с другой стороны.
   *
   * Важно: на поле есть спецфигура — ход есть всегда (её можно переместить и получить
   * взрыв или сметание). Без этой строчки игрок застрял бы на мёртвом поле, на котором
   * бомба лежит прямо перед ним.
   */
  function hasMove(game) {
    var r, c, i;
    for (i = 0; i < game.cells.length; i++) {
      if (isSpecial(game.cells[i])) return true;
    }
    for (r = 0; r < game.rows; r++) {
      for (c = 0; c < game.cols; c++) {
        i = at(game, r, c);
        var partners = [];
        if (c + 1 < game.cols) partners.push(at(game, r, c + 1));
        if (r + 1 < game.rows) partners.push(at(game, r + 1, c));
        for (var p = 0; p < partners.length; p++) {
          var j = partners[p];
          swap(game.cells, i, j);
          var ok = findRuns(game).length > 0;
          swap(game.cells, i, j);
          if (ok) return true;
        }
      }
    }
    return false;
  }

  function swap(cells, a, b) {
    var t = cells[a];
    cells[a] = cells[b];
    cells[b] = t;
    return cells;
  }

  // ------------------------------------------------------- генерация и перемешивание
  /**
   * Новое поле без готовых линий и с хотя бы одним ходом. Спецфигур тут не бывает:
   * они награда за ход игрока, а не содержимое мешка.
   */
  function freshCells(game) {
    var rows = game.rows, cols = game.cols, kinds = game.kinds;

    for (var attempt = 0; attempt < 200; attempt++) {
      var cells = [];
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          var kind = 0;
          for (var tries = 0; tries < 60; tries++) {
            kind = randInt(game.rng, kinds);
            var threeLeft = c >= 2 && cells[r * cols + c - 1] === kind && cells[r * cols + c - 2] === kind;
            var threeUp = r >= 2 && cells[(r - 1) * cols + c] === kind && cells[(r - 2) * cols + c] === kind;
            if (!threeLeft && !threeUp) break;
          }
          cells.push(kind);
        }
      }
      game.cells = cells;
      // поле с готовой линией или без единого хода — рисуем заново (обычно помогает 1–2 попытка)
      if (findRuns(game).length === 0 && hasMove(game)) return cells.slice();
    }
    return game.cells.slice();
  }

  /**
   * Перемешивание, когда ходов не осталось: кристаллики те же самые, порядок новый.
   * Игрок не должен терять партию из-за того, что поле «застряло» — это наказание за
   * чужую случайность, а не за его решение.
   */
  function shuffleBoard(game) {
    var cells = game.cells.slice(), i, j, t;
    for (var attempt = 0; attempt < 40; attempt++) {
      for (i = cells.length - 1; i > 0; i--) {
        j = randInt(game.rng, i + 1);
        t = cells[i]; cells[i] = cells[j]; cells[j] = t;
      }
      game.cells = cells.slice();
      if (findRuns(game).length === 0 && hasMove(game)) return true;
    }
    game.cells = freshCells(game);      // совсем редкий случай — новое поле
    return true;
  }

  // ----------------------------------------------------------- очистка и падение
  /**
   * Линии убраны: всё, что ниже — сдвигается вниз, сверху падают новые кристаллики.
   * Возвращает {moved:[{from,to}], born:[{to,kind,from}]} — ровно то, что нужно
   * оформлению, чтобы показать падение, а не мгновенную подмену картинки.
   *
   * Новые клетки ВСЕГДА обычные: спецфигура может появиться только из фигуры, которую
   * собрал игрок (см. шапку файла).
   */
  function applyClearAndDrop(game, cleared) {
    var cols = game.cols, rows = game.rows;
    var cells = game.cells, moved = [], born = [], c, r, i;

    for (c = 0; c < cols; c++) {
      var write = rows - 1;                       // куда ставить следующего выжившего
      for (r = rows - 1; r >= 0; r--) {
        i = r * cols + c;
        if (cleared[i]) continue;
        var to = write * cols + c;
        if (to !== i) {
          cells[to] = cells[i];
          moved.push({ from: i, to: to });
        }
        write--;
      }
      for (r = write; r >= 0; r--) {              // сверху дорисовываем новые
        var kind = randInt(game.rng, game.kinds);
        var pos = r * cols + c;
        cells[pos] = kind;
        born.push({ to: pos, kind: kind, from: -(write - r + 1) });
      }
    }
    return { moved: moved, born: born };
  }

  // ------------------------------------------------------------------ спецэффекты
  function markArea(game, center, out) {
    var r0 = rowOf(game, center), c0 = colOf(game, center);
    for (var r = r0 - BOMB_RADIUS; r <= r0 + BOMB_RADIUS; r++) {
      for (var c = c0 - BOMB_RADIUS; c <= c0 + BOMB_RADIUS; c++) {
        if (r < 0 || c < 0 || r >= game.rows || c >= game.cols) continue;   // угол не вылезает за поле
        out[at(game, r, c)] = true;
      }
    }
    return out;
  }

  function colorCounts(game) {
    var counts = {};
    game.cells.forEach(function (v) { if (isColor(v)) counts[v] = (counts[v] || 0) + 1; });
    return counts;
  }

  /** Самый частый вид на поле — то, по чему бьёт звезда, которую подорвали чужим взрывом. */
  function mostFrequentColor(game) {
    var counts = colorCounts(game), best = null, bestN = -1;
    Object.keys(counts).map(Number).sort(function (a, b) { return a - b; }).forEach(function (kind) {
      if (counts[kind] > bestN) { bestN = counts[kind]; best = kind; }
    });
    return best;
  }

  /**
   * Размен со спецфигурой. Возвращает {cleared: карта клеток, log, spawned}.
   *
   * Поле ЗДЕСЬ уже перемешано (игрок сделал размен, и мы двигали клетки до вызова),
   * поэтому `a` и `b` — это «откуда» и «куда», а взрыв считается вокруг клетки, куда
   * приехала спецфигура.
   *
   * Порядок: сначала первичный эффект (звезда/бомба), потом одна и та же функция
   * chainPass'а запускает всё, что попало в зону и само является спецфигурой, —
   * это и есть цепная реакция. `fired` не даёт клетке сработать дважды, а
   * MAX_SPECIAL_DEPTH ограничивает число волн: решётка из бомб должна гаснуть, а не
   * зацикливать ход.
   */
  function activate(game, a, b) {
    var cleared = {}, log = { bomb: 0, star: 0, five: 0 }, spawned = [];
    var fired = {}, i;

    function fire(idx) {
      if (fired[idx] || !isSpecial(game.cells[idx])) return false;
      fired[idx] = true;
      cleared[idx] = true;                      // спецфигура расходует себя
      if (game.cells[idx] === SPECIAL_BOMB) {
        log.bomb += 1;
        markArea(game, idx, cleared);
      } else {
        log.star += 1;
        var victim = mostFrequentColor(game);   // звезду подорвали — бьёт по самому частому виду
        game.cells.forEach(function (v, k) { if (v === victim) cleared[k] = true; });
      }
      return true;
    }

    var va = game.cells[a], vb = game.cells[b];

    if (va === SPECIAL_STAR && vb === SPECIAL_STAR) {
      for (i = 0; i < game.cells.length; i++) cleared[i] = true;   // звезда + звезда: всё поле
      log.star = 2;
      return { cleared: cleared, log: log, spawned: spawned };
    }

    if (va === SPECIAL_STAR || vb === SPECIAL_STAR) {
      var starAt = va === SPECIAL_STAR ? a : b;
      var otherAt = va === SPECIAL_STAR ? b : a;
      var other = game.cells[otherAt];
      cleared[starAt] = true;
      fired[starAt] = true;
      log.star += 1;
      if (other === SPECIAL_BOMB) {
        cleared[otherAt] = true;
        fired[otherAt] = true;
        log.bomb += 1;
        spawned = turnSomeIntoBombs(game, STAR_BOMB_TURNS, cleared);   // новые бомбы молчат до хода
      } else if (isColor(other)) {
        game.cells.forEach(function (v, idx) { if (v === other) cleared[idx] = true; });
      }
    } else {
      [a, b].forEach(function (idx) { if (game.cells[idx] === SPECIAL_BOMB) fire(idx); });
    }

    var depth = 0;
    while (depth < MAX_SPECIAL_DEPTH) {
      var changed = false;
      Object.keys(cleared).forEach(function (key) { if (fire(Number(key))) changed = true; });
      if (!changed) break;
      depth += 1;
    }

    return { cleared: cleared, log: log, spawned: spawned };
  }

  /**
   * Звезда + бомба: несколько случайных фигур становятся бомбами (и пока молчат).
   * Клетки, которые уже летят в мусор, не выбираем: иначе «новая бомба» воскресла бы
   * посреди стёртой зоны.
   */
  function turnSomeIntoBombs(game, n, cleared) {
    var candidates = [];
    game.cells.forEach(function (v, i) {
      if (isColor(v) && !cleared[i]) candidates.push(i);
    });
    var spawned = [];
    for (var k = 0; k < n && candidates.length; k++) {
      var pick = randInt(game.rng, candidates.length);
      var idx = candidates.splice(pick, 1)[0];
      game.cells[idx] = SPECIAL_BOMB;
      spawned.push({ at: idx, type: "bomb" });
    }
    return spawned;
  }

  // --------------------------------------------------------------------- партия
  function newGame(opts) {
    var o = {};
    for (var k in DEFAULTS) o[k] = DEFAULTS[k];
    for (k in (opts || {})) o[k] = opts[k];
    var game = {
      rows: o.rows, cols: o.cols, kinds: o.kinds,
      cells: [],
      moves: o.moves,
      movesLeft: o.moves,
      bonuses: 0,
      bonusMoves: 0,
      score: 0,
      seed: o.seed,
      rng: rngFrom(o.seed),
      over: false
    };
    game.cells = freshCells(game);
    return game;
  }

  /**
   * Цель партии: 25 базовых ходов × 240 = 6000 очков.
   *
   * Как появилось число. Andr попросил 3200, играя БЕЗ спецфигур (тогда медиана была 1690,
   * и 3200 была честной планкой). Со спецфигурами `node scripts\sim_match3.js --model=smart`
   * даёт другое: средний счёт 6236, медиана 6080, а 3200 берут 98,7 % партий — цель
   * превратилась бы в формальность. Выбрали 6000: примерно половина «умных» партий её берут,
   * а живой человек (он планирует каскады, модель — нет) — чаще.
   * Меняешь множитель — пересчитай симуляцией, иначе цель снова станет выдуманной цифрой.
   */
  function target(game) {
    return game.moves * TARGET_PER_MOVE;
  }

  /**
   * Один шаг каскада: нашёл линии → решил, что из них рождается → стёр → уронил.
   * allowCreate — спецфигуры рождаются только на первом шаге (ход игрока).
   *
   * Очки считаем по УНИКАЛЬНЫМ клеткам: в «Т» средняя клетка принадлежит и
   * горизонтали, и вертикали, и платить за неё дважды было бы начёсом от того, в каком
   * порядке findRuns нашёл отрезки. Формула та же, что и раньше: 10 за клетку плюс
   * 20 за каждый кристаллик сверх трёх в длинном отрезке → 3→30, 4→60, 5→90.
   */
  function collapse(game, chain, allowCreate, swapA, swapB) {
    var runs = findRuns(game);
    if (runs.length === 0) return null;

    var groups = clusters(runs);
    var cleared = {}, all = [], bonus = 0, spawn = [];

    // Очки: сумма по отрезкам, но за клетку пересечения платим один раз. Для прямой
    // линии это ровно scoreRun (3→30, 4→60, 5→90), для «Т» из двух троек — 30+30−10=50.
    var raw = 0, counted = {};
    runs.forEach(function (r) {
      raw += scoreRun(r.len);
      r.cells.forEach(function (idx) {
        if (counted[idx]) raw -= POINTS_PER_GEM;    // вторую встречу с той же клеткой не оплачиваем
        counted[idx] = true;
      });
    });

    groups.forEach(function (group) {
      var shape = allowCreate ? decideShape(group) : null;
      if (shape === "five") {
        bonus += EXTRA_MOVES_FOR_FIVE;
      } else if (shape === "star" || shape === "bomb") {
        spawn.push({ at: spawnCell(group, swapA, swapB), type: shape });
      }
    });

    var skip = {};
    spawn.forEach(function (s) { skip[s.at] = true; });      // эта клетка не стирается, а становится спецфигурой

    groups.forEach(function (group) {
      group.cells.forEach(function (idx) {
        if (skip[idx] || cleared[idx]) return;
        cleared[idx] = true;
        all.push(idx);
      });
    });
    // клетка, ставшая спецфигурой, очков не приносит: она не стёрта, она осталась на поле
    var spared = 0;
    spawn.forEach(function (s) { if (counted[s.at]) spared += 1; });
    var gain = (raw - spared * POINTS_PER_GEM) * chainMult(chain);

    var drop = applyClearAndDrop(game, cleared);

    // спецфигура пережила падение и могла уехать вниз: ищем, куда именно она переехала
    var movedFrom = {};
    drop.moved.forEach(function (m) { movedFrom[m.from] = m.to; });
    spawn.forEach(function (s) {
      var dest = movedFrom[s.at] === undefined ? s.at : movedFrom[s.at];
      game.cells[dest] = s.type === "star" ? SPECIAL_STAR : SPECIAL_BOMB;
      s.at = dest;                                   // оформлению говорим итоговую клетку
    });

    if (bonus) {
      game.movesLeft += bonus;
      // поля может не оказаться у поля, собранного тестом вручную, — не превращаем их в NaN
      game.bonusMoves = (game.bonusMoves || 0) + bonus;   // сумма подаренных ходов: партия = moves + bonusMoves
      game.bonuses = (game.bonuses || 0) + 1;              // сколько раз сработало «5 в ряд»
    }

    return { step: { cleared: all, moved: drop.moved, born: drop.born, chain: chain,
                    gained: gain, spawn: spawn, bonus: bonus },
             gained: gain };
  }

  /**
   * Один ход. Ничего не рисует, только считает.
   *
   * Возвращает:
   *   {ok:false, reason:"far"}      — не соседи (кнопка/свайп мимо)
   *   {ok:false, reason:"nomatch"}  — размена линии не вышло: поле прежнее, ход НЕ списан
   *   {ok:false, reason:"over"}     — партия кончилась
   *   {ok:true, steps:[...], gained, chains, reshuffles, special}
   *
   * steps[0] — «сделали размен», дальше по шагу на каскад, последний может быть
   * {shuffled:true}. Оформлению остаётся показывать их по очереди.
   */
  function play(game, a, b) {
    if (game.over || game.movesLeft <= 0) return { ok: false, reason: "over" };
    if (!adjacent(game, a, b)) return { ok: false, reason: "far" };

    var touching = isSpecial(game.cells[a]) || isSpecial(game.cells[b]);
    swap(game.cells, a, b);
    var steps = [{ swaps: [a, b] }];
    var gained = 0, chain = 1, reshuffles = 0, special = null;

    if (touching) {
      // спецфигуру можно двигать ВСЕГДА: линия для этого не нужна, но ход списывается
      game.movesLeft -= 1;
      var act = activate(game, a, b);
      special = act.log;
      var list = Object.keys(act.cleared).map(Number);   // вновь рождённые бомбы сюда не попадают
      var points = list.length * POINTS_PER_GEM;
      var clearedMap = {};
      list.forEach(function (idx) { clearedMap[idx] = true; });
      var dropB = applyClearAndDrop(game, clearedMap);
      gained += points;
      steps.push({ cleared: list, moved: dropB.moved, born: dropB.born,
                   chain: 1, gained: points, special: act.log, spawned: act.spawned });
      chain = 2;
    } else {
      if (findRuns(game).length === 0) {
        swap(game.cells, a, b);                    // откат: наказание за «не угадал» не нужно
        return { ok: false, reason: "nomatch" };
      }
      game.movesLeft -= 1;
      var first = collapse(game, 1, true, a, b);
      if (first) {
        steps.push(first.step);
        gained += first.gained;
        chain = 2;
      }
    }

    while (chain <= MAX_CHAIN) {
      var next = collapse(game, chain, false, a, b);
      if (!next) break;
      steps.push(next.step);
      gained += next.gained;
      chain += 1;
    }

    if (!hasMove(game)) {
      shuffleBoard(game);
      reshuffles += 1;
      steps.push({ shuffled: true });
    }

    game.score += gained;
    if (game.movesLeft <= 0) game.over = true;

    return { ok: true, steps: steps, gained: gained, chains: chain - 1,
             reshuffles: reshuffles, special: special };
  }

  // --------------------------------------------------------------- экспорт
  var Match3 = {
    DEFAULTS: DEFAULTS,
    SPECIAL_BOMB: SPECIAL_BOMB,
    SPECIAL_STAR: SPECIAL_STAR,
    TARGET_PER_MOVE: TARGET_PER_MOVE,
    EXTRA_MOVES_FOR_FIVE: EXTRA_MOVES_FOR_FIVE,
    BOMB_RADIUS: BOMB_RADIUS,
    STAR_BOMB_TURNS: STAR_BOMB_TURNS,
    MAX_SPECIAL_DEPTH: MAX_SPECIAL_DEPTH,
    isSpecial: isSpecial,
    isColor: isColor,
    rngFrom: rngFrom,
    randInt: randInt,
    at: at,
    rowOf: rowOf,
    colOf: colOf,
    adjacent: adjacent,
    findRuns: findRuns,
    clusters: clusters,
    decideShape: decideShape,
    scoreRun: scoreRun,
    chainMult: chainMult,
    hasMove: hasMove,
    newGame: newGame,
    freshCells: freshCells,
    shuffleBoard: shuffleBoard,
    applyClearAndDrop: applyClearAndDrop,
    play: play,
    target: target
  };

  root.Match3 = Match3;                          // браузер: <script src="match3_core.js">
  if (typeof module !== "undefined" && module.exports) {
    module.exports = Match3;                     // node: scripts/test_match3_core.js
  }
})(typeof window !== "undefined" ? window : globalThis);
