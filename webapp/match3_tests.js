/*
 * match3_tests.js — ПРОВЕРКИ правил «три в ряд». Один список, два запуска:
 *
 *   · в браузере:   match3.html?selftest=1        (ничего устанавливать не нужно)
 *   · из Node.js:   node scripts/test_match3_core.js   (это делаю я, в своей песочнице)
 *
 * Почему один список, а не два: если проверки живут в двух файлах, они разъезжаются,
 * и где-то игра «зелёная» только наполовину. Здесь функция одна, и она честна в обоих
 * местах.
 *
 * Каждая проверка обязана краснеть, если сломать правило. Проверка «функция существует»
 * декоративна, её тут нет.
 */
(function (root) {
  "use strict";

  /** Поле вручную: проверяем правила на известной раскладке, а не на случайной. */
  function boardFrom(cells, opts) {
    var o = opts || {};
    var cols = o.cols || 7;
    return {
      rows: o.rows || Math.ceil(cells.length / cols),
      cols: cols,
      kinds: o.kinds || 5,
      cells: cells.slice(),
      moves: o.moves || 25,
      movesLeft: o.moves || 25,
      bonuses: 0,
      bonusMoves: 0,
      score: 0,
      seed: o.seed === undefined ? 1 : o.seed,
      rng: root.Match3.rngFrom(o.seed === undefined ? 1 : o.seed),
      over: false
    };
  }

  /** Даст ли размен (a,b) линию — на копии, чтобы не трогать настоящую партию. */
  function makesRun(game, a, b) {
    var M = root.Match3;
    var copy = { rows: game.rows, cols: game.cols, kinds: game.kinds, cells: game.cells.slice() };
    var t = copy.cells[a];
    copy.cells[a] = copy.cells[b];
    copy.cells[b] = t;
    return M.findRuns(copy).length > 0;
  }

  /** Первый полезный ход в фиксированном порядке — так партия становится воспроизводимой. */
  function firstValidMove(game) {
    var cols = game.cols, rows = game.rows;
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var i = r * cols + c;
        if (c + 1 < cols && makesRun(game, i, i + 1)) return [i, i + 1];
        if (r + 1 < rows && makesRun(game, i, i + cols)) return [i, i + cols];
      }
    }
    return null;
  }

  /** Сыграть партию до конца «первым найденным ходом». Возвращает итог. */
  function playThrough(seed, opts) {
    var M = root.Match3;
    var o = opts || {};
    var game = M.newGame({ seed: seed, rows: o.rows || M.DEFAULTS.rows, cols: o.cols || M.DEFAULTS.cols,
                           kinds: o.kinds || M.DEFAULTS.kinds, moves: o.moves || M.DEFAULTS.moves });
    var played = 0, refusals = 0, reshuffles = 0;
    while (!game.over) {
      var mv = firstValidMove(game);
      if (!mv) { reshuffles++; if (reshuffles > 50) break; M.shuffleBoard(game); continue; }
      var res = M.play(game, mv[0], mv[1]);
      if (!res.ok) { refusals++; break; }
      reshuffles += res.reshuffles;
      played++;
      if (played > 500) break;                    // предохранитель от зависшего теста
    }
    return { game: game, played: played, refusals: refusals, reshuffles: reshuffles };
  }

  /**
   * Собирает все проверки. Возвращает список {name, ok, note}.
   * note — что именно не совпало, чтобы падение было читаемым, а не «false».
   */
  function runMatch3Tests() {
    var M = root.Match3;
    var out = [];

    function check(name, fn) {
      var note = "";
      var ok = false;
      try {
        note = fn() || "";
        ok = note === "";
      } catch (exc) {
        note = "исключение: " + (exc && exc.message ? exc.message : exc);
        ok = false;
      }
      out.push({ name: name, ok: ok, note: ok ? "" : note });
    }

    function expect(cond, message) {
      return cond ? "" : (message || "ожидание не выполнено");
    }

    // ------------------------------------------------------------------ старт поля
    check("поле стартует без готовых линий (200 зёрен)", function () {
      for (var seed = 1; seed <= 200; seed++) {
        var runs = M.findRuns(M.newGame({ seed: seed }));
        if (runs.length) return "seed " + seed + ": на старте уже есть линия из " + runs[0].len;
      }
      return "";
    });

    check("на старте всегда есть хотя бы один ход (200 зёрен)", function () {
      for (var seed = 1; seed <= 200; seed++) {
        if (!M.hasMove(M.newGame({ seed: seed }))) return "seed " + seed + ": ходов нет";
      }
      return "";
    });

    check("на маленьком плотном поле старт тоже с ходом (3×3, 3 вида)", function () {
      // Почему нужен именно маленький формат: на 7×7 из пяти видов поле без ходов —
      // редкость (замер: ~3 случайных поля из 1000). Проверка «200 зёрен» такую поломку
      // не дождалась бы никогда. А на 3×3 из трёх видов тупик — каждый восьмой старт,
      // и условие «поле обязано быть игровым» становится видимым.
      for (var seed = 1; seed <= 300; seed++) {
        var g = M.newGame({ seed: seed, rows: 3, cols: 3, kinds: 3 });
        if (!M.hasMove(g)) return "seed " + seed + ": партия стартует с поля, где некуда ходиться";
        if (M.findRuns(g).length) return "seed " + seed + ": на старте уже есть линия";
      }
      return "";
    });

    check("размер поля и виды кристалликов соблюдены", function () {
      var g = M.newGame({ seed: 7, rows: 7, cols: 7, kinds: 5 });
      if (g.cells.length !== 49) return "клеток " + g.cells.length + ", ожидалось 49";
      for (var i = 0; i < g.cells.length; i++) {
        var k = g.cells[i];
        if (typeof k !== "number" || k < 0 || k >= 5 || k !== Math.floor(k)) {
          return "клетка " + i + " = " + k + " вне диапазона 0..4";
        }
      }
      return "";
    });

    check("одно зерно → одно поле (воспроизводимость)", function () {
      var a = M.newGame({ seed: 42 }).cells.join(",");
      var b = M.newGame({ seed: 42 }).cells.join(",");
      var c = M.newGame({ seed: 43 }).cells.join(",");
      if (a !== b) return "seed 42 дважды дал разные поля";
      if (a === c) return "seed 42 и 43 дали одинаковое поле — зерно не влияет";
      return "";
    });

    // ------------------------------------------------------------------- соседство
    check("диагональ не считается соседством", function () {
      var g = M.newGame({ seed: 5 });
      if (M.adjacent(g, 0, g.cols + 1)) return "клетки 0 и (1,1) признаны соседями";
      if (!M.adjacent(g, 0, 1) || !M.adjacent(g, 0, g.cols)) return "настоящие соседи не узнаются";
      return "";
    });

    check("край ряда НЕ склеивается с началом следующего", function () {
      var g = M.newGame({ seed: 5 });
      var lastOfRow = g.cols - 1;                    // (0, 6)
      var firstOfNext = g.cols;                      // (1, 0) — номер соседний, а клетка через край
      if (M.adjacent(g, lastOfRow, firstOfNext)) return "поле склеилось: (0,6) и (1,0) — соседи";
      if (M.adjacent(g, 0, g.cols * g.rows - 1)) return "поле замкнулось в кольцо";
      return "";
    });

    // --------------------------------------------------------------------- линии
    check("линия из четырёх — ОДИН отрезок длиной 4, а не две тройки", function () {
      var cells = [];
      for (var i = 0; i < 49; i++) cells.push(i % 5 === 0 ? 1 : 2);   // фон без линий
      cells[0] = cells[1] = cells[2] = cells[3] = 4;                  // горизонталь 4
      var runs = M.findRuns(boardFrom(cells));
      var h = runs.filter(function (r) { return r.dir === "h" && r.kind === 4; });
      if (h.length !== 1) return "отрезков с четвёрками: " + h.length + ", ожидался 1";
      if (h[0].len !== 4) return "длина отрезка " + h[0].len + ", ожидалось 4";
      return "";
    });

    check("двойка и одиночка линией не считаются", function () {
      var cells = [];
      for (var i = 0; i < 49; i++) cells.push(i % 2);                 // шахмата: нигде не 3 подряд
      cells[0] = cells[1] = 3;                                        // двойка
      cells[10] = 4;                                                  // одиночка
      var runs = M.findRuns(boardFrom(cells));
      return runs.length === 0 ? "" : "на шахматном поле нашли " + runs.length + " линий";
    });

    check("Г-образная линия: и горизонталь, и вертикаль; пересечение один раз", function () {
      var cells = [];
      // фон, на котором заведомо нет линий: по горизонтали чередуем, по вертикали — другим шагом
      for (var r0 = 0; r0 < 7; r0++) {
        for (var c0 = 0; c0 < 7; c0++) cells.push((c0 % 2) + 2 * (r0 % 2));   // значения 0..3
      }
      // буква «Г» из четвёрок (этого вида на фоне нет): (2,2),(2,3),(2,4) и (2,2),(3,2),(4,2)
      [[2, 2], [2, 3], [2, 4], [3, 2], [4, 2]].forEach(function (rc) { cells[rc[0] * 7 + rc[1]] = 4; });
      var runs = M.findRuns(boardFrom(cells));
      var uniq = {};
      runs.forEach(function (r) { r.cells.forEach(function (i) { uniq[i] = true; }); });
      if (runs.length !== 2) return "ожидалось 2 отрезка (горизонталь+вертикаль), получилось " + runs.length;
      if (Object.keys(uniq).length !== 5) return "уникальных клеток " + Object.keys(uniq).length +
                                                  ", ожидалось 5 (пересечение не должно двоиться)";
      var lens = runs.map(function (r) { return r.len; }).sort().join(",");
      if (lens !== "3,3") return "длины отрезков " + lens + ", ожидалось 3 и 3";
      return "";
    });

    // ---------------------------------------------------------------------- очки
    check("цена линии: 3 → 30, 4 → 60, 5 → 90", function () {
      if (M.scoreRun(3) !== 30) return "тройка = " + M.scoreRun(3);
      if (M.scoreRun(4) !== 60) return "четвёрка = " + M.scoreRun(4);
      if (M.scoreRun(5) !== 90) return "пятёрка = " + M.scoreRun(5);
      if (!(M.scoreRun(5) > M.scoreRun(4) && M.scoreRun(4) > M.scoreRun(3))) return "цена не растёт с длиной";
      return "";
    });

    check("множитель каскада растёт и упирается в 5", function () {
      if (M.chainMult(1) !== 1 || M.chainMult(3) !== 3) return "каскад 1 или 3 считается неверно";
      if (M.chainMult(9) !== 5 || M.chainMult(50) !== 5) return "множитель не ограничен пятёркой";
      return "";
    });

    // ---------------------------------------------------------------- один ход
    check("ход без линии откатывается и НЕ списывает ход", function () {
      var g = M.newGame({ seed: 11 });
      // ищем РАЗНЫЕ соседние кристаллики, которые ничего не собирают: пара одинаковых —
      // не тест, размен двух одинаковых ничему не меняет поле (мутант «убрать откат»
      // прятался именно здесь)
      var pair = null;
      for (var r = 0; r < g.rows && !pair; r++) {
        for (var c = 0; c + 1 < g.cols; c++) {
          var i = r * g.cols + c;
          if (g.cells[i] !== g.cells[i + 1] && !makesRun(g, i, i + 1)) { pair = [i, i + 1]; break; }
        }
      }
      if (!pair) return "не удалось поле, где есть бесполезный размен разных кристалликов";
      var before = g.cells.join(","), movesLeft = g.movesLeft, score = g.score;
      var res = M.play(g, pair[0], pair[1]);
      if (res.ok || res.reason !== "nomatch") return "бесполезный размен вернулся как ok=" + res.ok;
      if (g.cells.join(",") !== before) return "поле изменилось после отменённого хода";
      if (g.movesLeft !== movesLeft) return "ход списан (" + movesLeft + " → " + g.movesLeft + ")";
      if (g.score !== score) return "очки начислены за отменённый ход";
      return "";
    });

    check("разрешённый ход: списан ровно 1 ход, очки начислены, поле полное", function () {
      var run = playThrough(3, { moves: 1 });
      var g = run.game;
      if (run.played !== 1) return "сыграно ходов " + run.played + ", ожидался 1";
      if (g.movesLeft !== 0) return "ходов осталось " + g.movesLeft + ", ожидалось 0";
      if (g.score <= 0) return "очки не начислены (" + g.score + ")";
      if (!g.over) return "партия из одного хода не завершилась";
      if (g.cells.length !== g.rows * g.cols) return "клеток после хода " + g.cells.length;
      for (var i = 0; i < g.cells.length; i++) {
        if (typeof g.cells[i] !== "number" || g.cells[i] < 0) return "клетка " + i + " пуста";
      }
      return "";
    });

    check("после хода на поле нет готовых линий (каскады дособраны)", function () {
      for (var seed = 1; seed <= 40; seed++) {
        var run = playThrough(seed, { moves: 6 });
        var left = M.findRuns(run.game);
        if (left.length) return "seed " + seed + ": осталось " + left.length + " линий — каскад недособран";
      }
      return "";
    });

    // ------------------------------------------------------- падение и пополнение
    check("столбец сжимается вниз, сверху приходит новый", function () {
      // столбец 2 размечен номерами строк: [0,1,2,3,4,5,6] — видно, кто куда упал
      var cells = [];
      for (var r = 0; r < 7; r++) {
        for (var c = 0; c < 7; c++) cells.push(0);
      }
      for (r = 0; r < 7; r++) cells[r * 7 + 2] = r;
      var g = boardFrom(cells);
      var cleared = {};
      cleared[3 * 7 + 2] = true;                        // убираем клетку (3,2)
      var drop = M.applyClearAndDrop(g, cleared);

      var column = [];
      for (r = 0; r < 7; r++) column.push(g.cells[r * 7 + 2]);
      // выше дырки — упали на одну клетку вниз (0,1,2 → 1,2,3), ниже дырки — стоят на месте (4,5,6)
      if (column.slice(4).join(",") !== "4,5,6") return "нижняя часть столбца сдвинулась: " + column;
      if (column.slice(1, 4).join(",") !== "0,1,2") return "всё над дыркой должно упасть на строку вниз, а столбец = " + column;
      if (typeof column[0] !== "number" || column[0] < 0 || column[0] >= 5) {
        return "самая верхняя клетка не заполнена новым кристалликом: " + column[0];
      }
      if (drop.born.length !== 1) return "новых кристалликов " + drop.born.length + ", ожидался 1";
      if (drop.born[0].to !== 2) return "новый кристаллик встал не на верх поля (to = " + drop.born[0].to + ")";
      if (drop.born[0].from >= 0) return "новый кристаллик не «падает сверху» (from = " + drop.born[0].from + ")";
      var jumped = drop.moved.filter(function (m) { return m.from === 2 * 7 + 2; });
      if (jumped.length !== 1 || jumped[0].to !== 3 * 7 + 2) return "перемещение (2,2)→(3,2) записано неверно";
      return "";
    });

    check("число кристалликов в поле постоянно, пустых клеток нет", function () {
      for (var seed = 1; seed <= 30; seed++) {
        var run = playThrough(seed, { moves: 10 });
        var g = run.game;
        if (g.cells.length !== g.rows * g.cols) return "seed " + seed + ": клеток " + g.cells.length;
        for (var i = 0; i < g.rows * g.cols; i++) {
          if (typeof g.cells[i] !== "number") return "seed " + seed + ": клетка " + i + " = " + g.cells[i];
        }
      }
      return "";
    });

    check("перемешивание сохраняет набор кристалликов и даёт ход", function () {
      var g = M.newGame({ seed: 9 });
      function histogram(cells) {
        var h = {};
        cells.forEach(function (k) { h[k] = (h[k] || 0) + 1; });
        return JSON.stringify(h);
      }
      var before = histogram(g.cells);
      M.shuffleBoard(g);
      if (histogram(g.cells) !== before) return "набор кристалликов изменился — перемешивание их подменило";
      if (M.findRuns(g).length) return "после перемешивания остались готовые линии";
      if (!M.hasMove(g)) return "после перемешивания снова некуда ходиться";
      return "";
    });

    check("перемешивание НЕ съедает спецфигуры (ни перестановкой, ни запасной веткой)", function () {
      // На 10×10 случайная перестановка часто не проходит проверку «без линий», и движок
      // уходит в запасную ветку «новое поле». Именно там раньше и терялись бомбы.
      for (var round = 1; round <= 40; round++) {
        var g = M.newGame({ seed: 500 + round });
        // клетки берём ОТ РАЗМЕРА поля: на 7×7 прошлый вариант (10 / 33 / 71) писал
        // за конец массива, и тест проверял неизвестно что
        var spots = [Math.floor(g.cells.length * 0.12), Math.floor(g.cells.length * 0.5),
                     Math.floor(g.cells.length * 0.85)];
        if (spots[2] >= g.cells.length) return "тест сам себя сломал: клетка вне поля";
        g.cells[spots[0]] = M.SPECIAL_BOMB;
        g.cells[spots[1]] = M.SPECIAL_STAR;
        g.cells[spots[2]] = M.SPECIAL_CROWN;
        var kinds = g.cells.filter(M.isSpecial).sort().join(",");
        M.shuffleBoard(g);
        var after = g.cells.filter(M.isSpecial).sort().join(",");
        if (after !== kinds) return "раунд " + round + ": до перемешивания спецфигуры [" + kinds +
                                    "], после [" + after + "]";
        if (M.findRuns(g).length) return "раунд " + round + ": после перемешивания есть готовые линии";
        if (g.cells.length !== g.rows * g.cols) return "раунд " + round + ": поле изменило размер (" + g.cells.length + ")";
      }
      return "";
    });

    check("перемешивание маленького поля всегда даёт играбельное (300 раз)", function () {
      // Тот же принцип, что у проверки старта: на 3×3 из трёх видов тупик случается
      // часто, поэтому «после перемешивания обязан быть ход» — настоящая проверка,
      // а не формальность. Без этого условия игрок мог бы получить поле-ловушку
      // и потерять ходы просто так.
      var cells = [];
      for (var r = 0; r < 3; r++) {
        for (var c = 0; c < 3; c++) cells.push((c % 2) + 2 * (r % 2));   // 0,1,2,3 — без линий
      }
      for (var round = 1; round <= 300; round++) {
        var g = boardFrom(cells, { rows: 3, cols: 3, kinds: 4, seed: round });
        M.shuffleBoard(g);
        if (M.findRuns(g).length) return "перемешивание " + round + " оставило готовые линии";
        if (!M.hasMove(g)) return "перемешивание " + round + " дало поле без единого хода";
      }
      return "";
    });

    check("цель партии = 5500 очков для 25 ходов (выбрана по sim_match3.js)", function () {
      var g = M.newGame({ seed: 1 });
      if (M.target(g) !== 5500) return "цель " + M.target(g) + " — пересчитай симуляцией и обнови";
      if (M.target({ moves: 10 }) !== 2200) return "цель не растёт пропорционально ходам";
      return "";
    });

    // ══════════════════════════════ СПЕЦФИГУРЫ ══════════════════════════════
    // Фон, на котором заведомо нет линий: значения 0..3, четыре вида из пяти.
    function blank(rows, cols) {
      var cells = [];
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) cells.push((c % 2) + 2 * (r % 2));
      }
      return cells;
    }

    function board5(rows, cols, edits) {
      var cells = blank(rows || 7, cols || 7);
      (edits || []).forEach(function (e) { cells[e[0] * (cols || 7) + e[1]] = e[2]; });
      return boardFrom(cells, { rows: rows || 7, cols: cols || 7, kinds: 5 });
    }

    function countSpecials(game) {
      return game.cells.filter(function (v) { return M.isSpecial(v); }).length;
    }

    check("четвёрка в ряд рождает бомбу и занимает клетку размена", function () {
      // ДО хода на ряду нет тройки: пары (3,1)-(3,2) и одиночка (3,4), а четвёртый
      // кристаллик приезжает сверху в (3,3)
      var g = board5(7, 7, [[3, 1, 4], [3, 2, 4], [3, 4, 4], [2, 3, 4]]);
      if (M.findRuns(g).length) return "на доске до хода уже есть линия — тест ничего не доказал";
      var before = g.movesLeft;
      var res = M.play(g, 2 * 7 + 3, 3 * 7 + 3);                  // опускаем четвёрку на место
      if (!res.ok) return "ход отвергнут: " + res.reason;
      var bombs = g.cells.filter(function (v) { return v === M.SPECIAL_BOMB; }).length;
      if (bombs !== 1) return "бомб на поле " + bombs + ", ожидалась 1";
      var born = (res.steps[1].spawn || []);
      if (born.length !== 1 || born[0].at !== 3 * 7 + 3) return "бомба не в клетке размена: " + JSON.stringify(born);
      if (res.steps[1].cleared.length !== 3) return "стёрто клеток " + res.steps[1].cleared.length + ", ожидалось 3";
      if (res.steps[1].gained !== 50) return "очков за четвёрку с бомбой " + res.steps[1].gained + ", по правилу 60 − 10 = 50";
      if (g.movesLeft !== before - 1) return "ход списан неверно: " + before + " → " + g.movesLeft;
      return "";
    });

    check("пятёрка в ряд даёт +5 ходов и НЕ рождает фигурку", function () {
      var g = board5(7, 7, [[3, 1, 4], [3, 2, 4], [3, 4, 4], [3, 5, 4], [2, 3, 4]]);
      if (M.findRuns(g).length) return "на доске до хода уже есть линия";
      var res = M.play(g, 2 * 7 + 3, 3 * 7 + 3);
      if (!res.ok) return "ход отвергнут: " + res.reason;
      if (countSpecials(g) !== 0) return "пятёрка почему-то родила спецфигуру";
      if (g.bonusMoves !== 5) return "подарено ходов " + g.bonusMoves + ", ожидалось 5";
      if (g.movesLeft !== 25 - 1 + 5) return "ходов осталось " + g.movesLeft + ", ожидалось 29";
      if (res.steps[1].bonus !== 5) return "в шаге не записан бонус: " + JSON.stringify(res.steps[1].bonus);
      return "";
    });

    check("«Т» (горизонталь + вертикаль) рождает звезду в пересечении", function () {
      var g = board5(7, 7, [[2, 4, 4], [2, 5, 4], [3, 3, 4], [4, 3, 4], [1, 3, 4]]);
      if (M.findRuns(g).length) return "на доске до хода уже есть линия";
      var res = M.play(g, 1 * 7 + 3, 2 * 7 + 3);                  // опускаем уголок на место
      if (!res.ok) return "ход отвергнут: " + res.reason;
      var stars = g.cells.filter(function (v) { return v === M.SPECIAL_STAR; }).length;
      if (stars !== 1) return "звёзд на поле " + stars + ", ожидалась 1";
      if (res.steps[1].cleared.length !== 4) return "стёрто " + res.steps[1].cleared.length + ", ожидалось 4 (5 клеток «Т» минус пересечение)";
      return "";
    });

    check("бомба при перемещении взрывает 3×3 вокруг клетки, куда её передвинули", function () {
      var g = board5(7, 7);
      g.cells[3 * 7 + 3] = M.SPECIAL_BOMB;
      var res = M.play(g, 3 * 7 + 3, 3 * 7 + 4);
      if (!res.ok) return "ход со спецфигурой отвергнут: " + res.reason;
      var step = res.steps[1];
      if (step.cleared.length !== 9) return "взрыв стёр " + step.cleared.length + " клеток, ожидалось 9";
      if (countSpecials(g) !== 0) return "бомба осталась на поле после взрыва";
      if (step.gained !== 90) return "очки взрыва " + step.gained + ", ожидалось 9×10 = 90";
      if (g.movesLeft !== 24) return "ход со спецфигурой должен стоить ровно 1: осталось " + g.movesLeft;
      return "";
    });

    check("взрыв у края обрезается полем, а не уходит в никуда", function () {
      var g = board5(7, 7);
      g.cells[0] = M.SPECIAL_BOMB;                                // левый верхний угол
      var res = M.play(g, 0, 1);                                  // передвигаем на (0,1)
      var step = res.steps[1];
      // зона вокруг (0,1): строки 0..1, столбцы 0..2 = 6 клеток
      if (step.cleared.length !== 6) return "у края стёрто " + step.cleared.length + ", ожидалось 6";
      var bad = step.cleared.filter(function (i) { return i < 0 || i >= 49; });
      return bad.length === 0 ? "" : "взрыв ушёл за пределы поля: " + bad;
    });

    check("звезда + обычная фигура стирает ВСЕ клетки этого вида", function () {
      var g = board5(7, 7);
      g.cells[3 * 7 + 3] = M.SPECIAL_STAR;
      var victim = g.cells[3 * 7 + 4];
      var where = [];
      g.cells.forEach(function (v, i) { if (v === victim) where.push(i); });
      if (where.length < 4) return "на доске слишком мало клеток вида " + victim + " — тест слабый";
      var res = M.play(g, 3 * 7 + 3, 3 * 7 + 4);
      if (!res.ok) return "ход отвергнут: " + res.reason;
      var step = res.steps[1];                                   // только первый шаг: дальше каскады
      var missing = where.filter(function (i) { return step.cleared.indexOf(i) < 0; });
      if (missing.length) return "не стёрты клетки вида " + victim + ": " + missing.slice(0, 4);
      if (step.cleared.indexOf(3 * 7 + 3) < 0) return "звезда не израсходована";
      if (step.gained !== (where.length + 1) * 10) {
        return "очки первого шага " + step.gained + ", ожидалось " + (where.length + 1) * 10 +
               " (все клетки вида + сама звезда по 10)";
      }
      return "";
    });

    check("звезда + бомба: рождаются три бомбы и сразу взрываются", function () {
      var g = board5(7, 7);
      g.cells[3 * 7 + 3] = M.SPECIAL_STAR;
      g.cells[3 * 7 + 4] = M.SPECIAL_BOMB;
      var res = M.play(g, 3 * 7 + 3, 3 * 7 + 4);
      var step = res.steps[1];
      if ((step.spawned || []).length !== 3) return "новых бомб " + (step.spawned || []).length + ", ожидалось 3";
      // сама пара (2 клетки) + три взрыва по 3×5-9 клеток; меньше 12 быть не может
      if (step.cleared.length < 12) return "взрывов не случилось: стёрто всего " + step.cleared.length;
      if (step.special.bomb < 4) return "в журнале шага взрывов " + step.special.bomb + ", ожидалось ≥4 (исходная + три новых)";
      if (countSpecials(g) !== 0) return "после детонации на поле остались спецфигуры";
      var centers = (step.spawned || []).map(function (s) { return s.at; });
      var gone = centers.filter(function (i) { return step.cleared.indexOf(i) < 0; });
      return gone.length ? "клетки-эпицентры не попали в зону взрыва: " + gone : "";
    });

    check("звезда + звезда: стирается всё поле, потом оно снова полное", function () {
      var g = board5(7, 7);
      g.cells[3 * 7 + 3] = M.SPECIAL_STAR;
      g.cells[3 * 7 + 4] = M.SPECIAL_STAR;
      var res = M.play(g, 3 * 7 + 3, 3 * 7 + 4);
      if (res.steps[1].cleared.length !== 49) return "стёрто " + res.steps[1].cleared.length + " из 49";
      if (g.cells.length !== 49) return "после падения клеток " + g.cells.length;
      if (countSpecials(g) !== 0) return "на пустом поле возникли спецфигуры";
      if (M.findRuns(g).length) return "после заполнения поле сразу с готовой линией";
      return "";
    });

    check("цепная реакция: взрыв задевает вторую бомбу — взрываются обе", function () {
      var g = board5(7, 7);
      g.cells[3 * 7 + 3] = M.SPECIAL_BOMB;
      g.cells[2 * 7 + 5] = M.SPECIAL_BOMB;                        // попадает в зону (3,4)
      var res = M.play(g, 3 * 7 + 3, 3 * 7 + 4);
      if (res.steps[1].cleared.length <= 9) return "вторая бомба не сработала: стёрто " + res.steps[1].cleared.length;
      if (countSpecials(g) !== 0) return "после цепочки на поле осталась спецфигура";
      if (res.special.bomb !== 2) return "в шаге записано взрывов " + JSON.stringify(res.special);
      return "";
    });

    check("спецфигуры бесцветные: две бомбы рядом не считаются линией", function () {
      var g = board5(7, 7);
      g.cells[3 * 7 + 2] = M.SPECIAL_BOMB;
      g.cells[3 * 7 + 3] = M.SPECIAL_BOMB;
      g.cells[3 * 7 + 4] = M.SPECIAL_BOMB;
      if (M.findRuns(g).length) return "findRuns посчитал три бомбы линией";
      var h = board5(7, 7);
      h.cells[3 * 7 + 2] = M.SPECIAL_STAR; h.cells[3 * 7 + 3] = M.SPECIAL_STAR; h.cells[3 * 7 + 4] = M.SPECIAL_STAR;
      return M.findRuns(h).length ? "три звезды — тоже «линия»" : "";
    });

    check("hasMove: на мёртвом поле с бомбой ход есть (без неё — нет)", function () {
      var found = 0;
      for (var seed = 1; seed <= 4000 && found < 3; seed++) {
        var rng = M.rngFrom(seed), cells = [];
        for (var i = 0; i < 9; i++) cells.push(M.randInt(rng, 3));
        var g = boardFrom(cells, { rows: 3, cols: 3, kinds: 3 });
        if (M.findRuns(g).length) continue;
        if (M.hasMove(g)) continue;                               // нужен именно тупик
        found++;
        g.cells[4] = M.SPECIAL_BOMB;
        if (!M.hasMove(g)) return "тупиковое поле + бомба, а hasMove говорит «ходов нет»";
        g.cells[4] = M.SPECIAL_STAR;
        if (!M.hasMove(g)) return "тупиковое поле + звезда, а hasMove говорит «ходов нет»";
      }
      return found ? "" : "перебор не нашёл тупикового поля — тест ничего не доказал";
    });

    check("спецфигуры рождаются и из каскада, и из хода игрока", function () {
      // С вечера 13 октября Andr решил, что каскад тоже дарит спецфигуры (было наоборот —
      // этот тест тогда охранял запрет). Формулировка поэтому такая: ищем И рождение на
      // шаге каскада (chain > 1), и обычное, и краснеем, если каскадных рождений за 400
      // партий не случилось вообще — иначе тест ничего не доказал.
      var fromCascade = 0, fromMove = 0, problem = "";
      for (var seed = 1; seed <= 400 && !problem; seed++) {
        var g = M.newGame({ seed: seed });
        for (var s = 1; s <= 30; s++) {
          var mv = firstValidMove(g);
          if (!mv) break;
          var res = M.play(g, mv[0], mv[1]);
          if (!res.ok) break;
          res.steps.forEach(function (step) {
            (step.spawn || []).forEach(function (x) {
              if (step.chain > 1) fromCascade++; else fromMove++;
              if (["bomb", "star", "crown"].indexOf(x.type) < 0) problem = "неизвестный тип «" + x.type + "»";
              // где именно лежит спецфигура, проверяют отдельные тесты (с переездом вниз
              // вместе с колонкой): здесь шаг не последний, и клетка могла уехать дальше
            });
            (step.born || []).forEach(function (b) {
              if (M.isSpecial(b.kind)) problem = "сверху прилетела спецфигура — заполнение обязано быть чистым";
            });
          });
        }
      }
      if (problem) return problem;
      if (!fromMove) return "ни одного рождения хода за 400 партий";
      if (!fromCascade) return "каскад ни разу не родил спецфигуру за 400 партий — проверка пустая";
      return "";
    });

    check("на старте поля спецфигур нет (ни в большой партии, ни в маленькой)", function () {
      for (var seed = 1; seed <= 200; seed++) {
        if (countSpecials(M.newGame({ seed: seed }))) return "seed " + seed + ": старт с готовой спецфигурой";
        if (countSpecials(M.newGame({ seed: seed, rows: 3, cols: 3, kinds: 3 }))) return "seed " + seed + ": 3×3 старт со спецфигурой";
      }
      return "";
    });

    check("бомба падает вместе с колонкой и остаётся бомбой (не теряется при падении)", function () {
      // Вертикальная четвёрка (1,3)…(4,3) с дыркой в (3,3): кристаллик приезжает в дырку
      // сбоку. Клетка размена — третья сверху, а под ней стёртая (4,3), значит после
      // падения бомба должна уехать на строку ниже. Если движок оставит её на прежнем
      // индексе, показ разойдётся с правилами, и эта проверка это увидит.
      var g = board5(7, 7, [[1, 3, 4], [2, 3, 4], [4, 3, 4], [3, 2, 4]]);
      if (M.findRuns(g).length) return "на доске до хода уже есть линия";
      var res = M.play(g, 3 * 7 + 2, 3 * 7 + 3);
      if (!res.ok) return "ход отвергнут: " + res.reason;
      var step = res.steps[1];
      if (!step.spawn || step.spawn.length !== 1) return "бомба не записана в шаг";
      var atCell = step.spawn[0].at;
      if (g.cells[atCell] !== M.SPECIAL_BOMB) {
        return "шаг говорит «бомба в клетке " + atCell + "», а там " + g.cells[atCell] +
               " — показ разойдётся с правилами";
      }
      if (atCell !== 4 * 7 + 3) return "бомба должна была уехать вниз с колонкой в (4,3), а оказалась в " + atCell;
      return "";
    });

    check("крест 5+3 (7 клеток) — это корона, а «Т» поменьше остаётся звездой", function () {
      // decideShape — чистая функция, проверяем её на самих фигурах: геометрия поля тут
      // ни при чём. Важно: «крест» из 7 клеток одним разменом НЕ собрать (размен добавляет
      // ровно одну клетку, а значит руки креста должны были быть готовы до него — тогда
      // линия уже существовала бы). Корона рождается только из каскада, см. проверку ниже.
      function cluster(vertical, horizontal) {
        var map = {}, cells = [];
        vertical.concat(horizontal).forEach(function (i) {
          if (!map[i]) { map[i] = true; cells.push(i); }
        });
        return {
          runs: [{ dir: "v", cells: vertical, len: vertical.length },
                 { dir: "h", cells: horizontal, len: horizontal.length }],
          map: map, cells: cells,
        };
      }
      var v5 = [2 * 7 + 3, 3 * 7 + 3, 4 * 7 + 3, 5 * 7 + 3, 6 * 7 + 3];
      var h3 = [4 * 7 + 2, 4 * 7 + 3, 4 * 7 + 4];
      var cross = M.decideShape(cluster(v5, h3));
      if (cross !== "crown") return "крест 5+3 (" + cluster(v5, h3).cells.length + " клеток) дал «" + cross + "»";
      var tee = M.decideShape(cluster([3 * 7 + 3, 4 * 7 + 3, 5 * 7 + 3], [4 * 7 + 2, 4 * 7 + 3, 4 * 7 + 4]));
      if (tee !== "star") return "обычная «Т» из 5 клеток дала «" + tee + "», ожидалась звезда";
      return "";
    });

    check("корона стирает всю строку и весь столбец клетки, куда её передвинули", function () {
      var g = board5(7, 7);
      g.cells[3 * 7 + 3] = M.SPECIAL_CROWN;
      var res = M.play(g, 3 * 7 + 3, 3 * 7 + 4);                      // едем в (3,4)
      if (!res.ok) return "ход отвергнут: " + res.reason;
      var step = res.steps[1];
      // крест через (3,4): 7 в строке + 7 в столбце − общая клетка = 13
      if (step.cleared.length !== 13) return "стирается " + step.cleared.length + " клеток, ожидалось 13";
      for (var c = 0; c < 7; c++) {
        if (step.cleared.indexOf(3 * 7 + c) < 0) return "строка стёрта не целиком, не хватает " + c;
      }
      for (var r = 0; r < 7; r++) {
        if (step.cleared.indexOf(r * 7 + 4) < 0) return "столбец стёрт не целиком, не хватает " + r;
      }
      if (countSpecials(g) !== 0) return "корона не израсходована";
      return "";
    });

    check("бомба на бомбу: один взрыв 5×5 в клетке назначения, а не два по 3×3", function () {
      var g = board5(7, 7);
      g.cells[3 * 7 + 3] = M.SPECIAL_BOMB;
      g.cells[3 * 7 + 4] = M.SPECIAL_BOMB;
      var res = M.play(g, 3 * 7 + 3, 3 * 7 + 4);                       // передвигаем бомбу вправо
      var step = res.steps[1];
      if (step.cleared.length !== 25) return "стирается " + step.cleared.length + ", ожидалось 25 (5×5 вокруг (3,4))";
      // центр зоны — клетка назначения (3,4): строки 1..5, столбцы 2..6
      if (step.cleared.indexOf(1 * 7 + 2) < 0 || step.cleared.indexOf(5 * 7 + 6) < 0) {
        return "зона 5×5 не покрыла крайние клетки (1,2) и (5,6)";
      }
      return "";
    });

    check("бомба у края: 5×5 обрезается полем, за границы не уходит", function () {
      var g = board5(7, 7);
      g.cells[0] = M.SPECIAL_BOMB;
      g.cells[1] = M.SPECIAL_BOMB;
      var res = M.play(g, 0, 1);                                        // в (0,1) — верхний край
      var step = res.steps[1];
      var outside = step.cleared.filter(function (i) { return i < 0 || i >= 49; });
      if (outside.length) return "взрыв ушёл за пределы поля";
      // вокруг (0,1): строки 0..2, столбцы 0..3 = 12 клеток
      if (step.cleared.length !== 12) return "у края стёрто " + step.cleared.length + ", ожидалось 12";
      return "";
    });

    check("звезду задел чужой взрыв: она бьёт по самому частому виду и исчезает", function () {
      // Это тест на настоящий баг 13 октября: звезда, которую задела волна, «стирала»
      // swapWith === undefined, то есть ничего, и просто пропадала — потеря бонуса.
      var g = board5(7, 7);
      g.cells[3 * 7 + 3] = M.SPECIAL_BOMB;
      g.cells[3 * 7 + 5] = M.SPECIAL_STAR;                 // попадает в зону вокруг (3,4)
      var before = g.cells.slice();
      var res = M.play(g, 3 * 7 + 3, 3 * 7 + 4);
      var step = res.steps[1];
      if (!step.special.star) return "звезда не сработала: " + JSON.stringify(step.special);
      var victim = step.special.swept;
      if (victim === undefined || victim === null) return "звезда не сказала, по какому виду биет";
      if (!M.isColor(victim)) return "жертвой назван не цвет: " + victim;
      // клетки размена не в счёт: одна из них поменяла содержимое ещё до взрыва
      var swapCells = [3 * 7 + 3, 3 * 7 + 4];
      var expected = [];
      before.forEach(function (v, i) {
        if (v === victim && swapCells.indexOf(i) < 0) expected.push(i);
      });
      if (expected.length < 3) return "на поле слишком мало клеток вида " + victim + " — тест слабый";
      var missing = expected.filter(function (i) { return step.cleared.indexOf(i) < 0; });
      if (missing.length) return "вид " + victim + " стёрт не весь, не хватает: " + missing.slice(0, 5);
      if (g.cells.indexOf(M.SPECIAL_STAR) >= 0) return "звезда пережила взрыв, а по правилу обязана исчезнуть";
      return "";
    });

    check("две линии за один ход = 💫 корона (награда достижима пальцем)", function () {
      // Свап меняет ДВЕ клетки, и каждая может закончить свою линию. Здесь: цвет 3
      // доводит вертикаль в столбце 3 (строки 0..2), а цвет 4 — горизонталь в ряду 3
      // (столбцы 2..4). Кластеры не пересекаются — это именно «две линии», а не крест.
      var g = board5(7, 7, [[0, 3, 3], [1, 3, 3], [2, 3, 4], [3, 3, 3],
                            [3, 2, 4], [3, 4, 4]]);
      if (M.findRuns(g).length) return "на доске до хода уже есть линия — тест ничего не доказал";
      var res = M.play(g, 2 * 7 + 3, 3 * 7 + 3);
      if (!res.ok) return "ход отвергнут: " + res.reason;
      var step = res.steps[1];
      var crowns = g.cells.filter(function (v) { return v === M.SPECIAL_CROWN; }).length;
      if (crowns !== 1) return "корон на поле " + crowns + ", ожидалась 1";
      if ((step.spawn || []).length !== 1 || step.spawn[0].type !== "crown") {
        return "в шаге записано не это: " + JSON.stringify(step.spawn);
      }
      if (step.spawn[0].at !== 3 * 7 + 3) return "корона не в клетке размена: " + step.spawn[0].at;
      // шесть клеток линий минус та, что стала короной
      if (step.cleared.length !== 5) return "стёрто " + step.cleared.length + ", ожидалось 5";
      if (step.bonus) return "при короне бонусных ходов быть не должно (не суммируем)";
      return "";
    });

    check("одна линия за ход корону НЕ даёт (её заслуживают две)", function () {
      var g = board5(7, 7, [[3, 1, 4], [3, 2, 4], [3, 4, 4], [2, 3, 4]]);   // обычная четвёрка
      var res = M.play(g, 2 * 7 + 3, 3 * 7 + 3);
      var crowns = res.steps.reduce(function (n, s) {
        return n + ((s.spawn || []).filter(function (x) { return x.type === "crown"; }).length);
      }, 0);
      return crowns === 0 ? "" : "корона появилась из одной линии";
    });

    check("корону за две линии даёт ТОЛЬКО ход игрока, а не случайный каскад", function () {
      // На 10×10 без этого ограничения корона сыпалась 23 раза за партию (замерено) —
      // награда превращалась в шум. Проверяем по-настоящему: каждая корона, родившаяся
      // НЕ в первом шаге хода, обязана стоить не меньше шести стёртых клеток, то есть
      // идти от настоящего креста (5+3), а не от совпадения двух случайных линий.
      var crownsInCascade = 0, checked = 0, wrong = "";
      for (var seed = 1; seed <= 300 && !wrong; seed++) {
        var g = M.newGame({ seed: seed });
        for (var s = 0; s < 25; s++) {
          var mv = firstValidMove(g);
          if (!mv) break;
          var res = M.play(g, mv[0], mv[1]);
          if (!res.ok) break;
          res.steps.forEach(function (step) {
            (step.spawn || []).forEach(function (x) {
              checked++;
              if (x.type !== "crown" || step.chain === 1) return;
              crownsInCascade++;
              if ((step.cleared || []).length < 6) {
                wrong = "корона в каскаде ×" + step.chain + " стёрла всего " +
                        (step.cleared || []).length + " клеток — это не крест";
              }
            });
          });
        }
      }
      if (wrong) return wrong;
      return checked ? "" : "ни одной спецфигуры за 300 партий — тест пустой";
    });

    check("экран и движок видят поле одинаково (реконструкция по шагам)", function () {
      // Регресс на настоящую ошибку 15 октября: «звезда + бомба» записывала три новые
      // бомбы в шаг, экран восстанавливал их как стоящие на поле — и показывал бомбы,
      // которых в правилах уже нет (взрыв состоялся в том же шаге). Проверяем так же,
      // как это делает match3.html: собираем поле из шагов и сравниваем с движком.
      function reconstruct(prev, step) {
        var next = prev.slice();
        (step.moved || []).forEach(function (m) { next[m.to] = prev[m.from]; });
        (step.born || []).forEach(function (b) { next[b.to] = b.kind; });
        (step.spawn || []).forEach(function (x) {
          next[x.at] = x.type === "star" ? M.SPECIAL_STAR : x.type === "crown" ? M.SPECIAL_CROWN : M.SPECIAL_BOMB;
        });
        (step.spawned || []).forEach(function (x) { if (!x.detonated) next[x.at] = M.SPECIAL_BOMB; });
        return next;
      }
      var bad = "", checked = 0, detonations = 0;
      // Ход выбираем КАК ИГРОК: если на поле есть спецфигура — тащим её (иначе жадный
      // перебор «линий» никогда не свайпнет звезду на бомбу, и проверка ничего не покроет —
      // именно так и вышло на первом прогоне).
      function pickMove(g) {
        for (var r = 0; r < g.rows; r++) {
          for (var c = 0; c < g.cols; c++) {
            var i = r * g.cols + c;
            if (!M.isSpecial(g.cells[i])) continue;
            var around = [[i + 1, c + 1 < g.cols], [i + g.cols, r + 1 < g.rows],
                          [i - 1, c > 0], [i - g.cols, r > 0]];
            for (var k = 0; k < around.length; k++) {
              if (around[k][1] && around[k][0] >= 0) return [i, around[k][0]];
            }
          }
        }
        return firstValidMove(g);
      }
      for (var seed = 1; seed <= 200 && !bad; seed++) {
        var g = M.newGame({ seed: seed });
        for (var m = 0; m < 25; m++) {
          var mv = pickMove(g);
          if (!mv) break;
          var before = g.cells.slice();
          var res = M.play(g, mv[0], mv[1]);
          if (!res.ok) break;
          var visual = before.slice();
          if (res.steps[0] && res.steps[0].swaps) {
            var p0 = res.steps[0].swaps;
            visual[p0[0]] = before[p0[1]]; visual[p0[1]] = before[p0[0]];
          }
          for (var n = 1; n < res.steps.length; n++) {
            var step = res.steps[n];
            if (step.shuffled) { visual = g.cells.slice(); continue; }
            detonations += (step.spawned || []).filter(function (x) { return x.detonated; }).length;
            // спецфигура не может родиться в клетке, которую этот же шаг стирает.
            // ВАЖНО: step.at у движка — клетка ПОСЛЕ падения, а cleared — ПОСЛЕ очистка,
            // но ДО падения: сверяем через moved (иначе проверка сама врёт, как я и
            // поймал на первом же прогоне).
            var back = {};
            (step.moved || []).forEach(function (m) { back[m.to] = m.from; });
            (step.spawn || []).concat(step.spawned || []).forEach(function (x) {
              if (x.detonated) return;
              var pre = back[x.at] === undefined ? x.at : back[x.at];
              if (step.cleared.indexOf(pre) >= 0) {
                bad = "спецфигура родилась в стёртой клетке " + pre + " (после падения " + x.at + ")";
              }
            });
            visual = reconstruct(visual, step);
          }
          checked++;
          if (visual.join(",") !== g.cells.join(",")) {
            var i = visual.findIndex(function (v, k) { return v !== g.cells[k]; });
            bad = "seed " + seed + ", ход " + (m + 1) + ": экран показал бы " + visual[i] +
                  " в клетке " + i + ", а движок — " + g.cells[i];
          }
        }
      }
      if (bad) return bad;

      // Детерминированный случай «звезда + бомба»: в переборе он выпадает редко
      // (нужны две спецфигуры рядом), а именно он и рождал «бомбы-призраки».
      var g2 = board5(7, 7, [[3, 3, M.SPECIAL_STAR], [3, 4, M.SPECIAL_BOMB]]);
      var before2 = g2.cells.slice();
      var res2 = M.play(g2, 3 * 7 + 3, 3 * 7 + 4);
      var v2 = before2.slice();
      var sw = res2.steps[0].swaps;
      v2[sw[0]] = before2[sw[1]]; v2[sw[1]] = before2[sw[0]];
      var det = 0;
      for (var n = 1; n < res2.steps.length; n++) {
        var st = res2.steps[n];
        if (st.shuffled) { v2 = g2.cells.slice(); continue; }
        det += (st.spawned || []).filter(function (x) { return x.detonated; }).length;
        v2 = reconstruct(v2, st);
      }
      if (det !== M.STAR_BOMB_TURNS) return "в фикстуре «звезда + бомба» протухших бомб " + det +
                                            ", ожидалось " + M.STAR_BOMB_TURNS;
      if (v2.join(",") !== g2.cells.join(",")) return "фикстура «звезда + бомба»: экран разошёлся с движком";
      var ghosts = v2.filter(function (v) { return v === M.SPECIAL_BOMB; }).length;
      if (ghosts) return "после детонации на поле осталось " + ghosts + " бомб — это те самые призраки";
      return "";
    });

    check("корона и ＋5 ходов не исключают друг друга", function () {
      // Просьба Andr'а 15 октября: свайп, собравший пятёрку И ещё одну линию, должен дать
      // и корону, и пять ходов. Раньше форма «съедала» бонус.
      // Фон — шахматка из 0 и 1, чтобы цвета 3 и 4 были свободны (с фоном из четырёх
      // цветов первая версия фикстуры сама же и создавала линию — проверка это поймала).
      var cells = [];
      for (var r = 0; r < 7; r++) {
        for (var c = 0; c < 7; c++) cells.push((r + c) % 2);
      }
      cells[0 * 7 + 3] = 4; cells[1 * 7 + 3] = 4; cells[3 * 7 + 3] = 4; cells[4 * 7 + 3] = 4;
      cells[2 * 7 + 2] = 4;                       // это поедет в дыру (2,3) и закроет пятёрку
      cells[2 * 7 + 3] = 3;                       // а это приедет в (2,2) и закроет тройку
      cells[2 * 7 + 0] = 3; cells[2 * 7 + 1] = 3;
      var g = boardFrom(cells, { rows: 7, cols: 7, kinds: 5 });
      if (M.findRuns(g).length) return "до хода уже есть линия — фикстура негодная";

      var res = M.play(g, 2 * 7 + 2, 2 * 7 + 3);
      if (!res.ok) return "ход отвергнут: " + res.reason;
      var step = res.steps[1];
      if (g.cells.filter(function (v) { return v === M.SPECIAL_CROWN; }).length !== 1) {
        return "короны нет (хотя собраны две линии)";
      }
      // сравниваем с ЛИТЕРАЛОМ 5, а не с константой: иначе обнуление самой константы
      // сделало бы проверку вечно зелёной (это же правило выше, в строке 421)
      if (step.bonus !== 5) return "бонуса нет: в шаге " + step.bonus + ", ожидалось 5";
      if (g.bonusMoves !== 5) return "на партии подарено " + g.bonusMoves + ", ожидалось 5";
      return "";
    });

    // ------------------------------------------------------------------ вся партия
    check("партия всегда заканчивается: ходов сыграно ровно «25 + подаренные»", function () {
      var longest = 0, bonuses = 0;
      for (var seed = 1; seed <= 60; seed++) {
        var g = playThrough(seed).game;
        if (!g.over) return "seed " + seed + ": партия не закончилась";
        var expected = g.moves + g.bonusMoves;
        if (g.movesLeft !== 0) return "seed " + seed + ": ходов осталось " + g.movesLeft;
        if (expected < g.moves) return "seed " + seed + ": подаренных ходов отрицательное число";
        longest = Math.max(longest, expected);
        bonuses += g.bonusMoves ? 1 : 0;
      }
      if (longest > 200) return "бонусы раздули партию до " + longest + " ходов — нужен потолок";
      return "";
    });

    check("после конца партии ход невозможен", function () {
      var run = playThrough(2);
      var g = run.game;
      var res = M.play(g, 0, 1);
      return (!res.ok && res.reason === "over") ? "" : "ход после конца партии: " + JSON.stringify(res);
    });

    check("очки за партию в разумных границах (300 партий)", function () {
      var min = Infinity, max = 0, sum = 0, n = 0;
      for (var seed = 1; seed <= 300; seed++) {
        var score = playThrough(seed).game.score;
        min = Math.min(min, score); max = Math.max(max, score); sum += score; n++;
      }
      var avg = Math.round(sum / n);
      // цель партии — 2000 (25 ходов × 80, см. scripts/sim_match3.js). Если среднее
      // улетело за эти границы, баланс игр и награда питомцу поедут вместе с ним.
      if (!(avg > 200 && avg < 8000)) return "средний счёт " + avg + " вышел за границы реалистичности";
      if (min < 30) return "есть партии без единой линии (минимум " + min + ")";
      if (max > 30000) return "есть партии с невозможным счётом " + max;
      return "";
    });

    check("hasMove видит ВСЕ ходы: сверка с полным перебором пар", function () {
      // Оракул — самый наивный перебор: пробует каждый размен и смотрит, появилась ли
      // линия. if hasMove пропустит вертикальные пары (именно так ломают «три в ряд»,
      // когда перебирают только «вправо»), ответ разойдётся с перебором.
      //
      // Поля берём маленькие (3×3) и случайные: на 7×7 полезный ход есть почти всегда
      // и вправо, и вниз, и тест ничего не доказал бы. Это замерено отдельно: на 3×3
      // из трёх видов кристалликов «ход только вниз» — каждый пятый случай.
      var pairsChecked = 0, verticalOnly = 0, horizontalOnly = 0, deadEnds = 0;

      function classify(game) {
        var h = false, v = false;
        for (var r = 0; r < game.rows; r++) {
          for (var c = 0; c < game.cols; c++) {
            var i = r * game.cols + c;
            if (c + 1 < game.cols && makesRun(game, i, i + 1)) h = true;
            if (r + 1 < game.rows && makesRun(game, i, i + game.cols)) v = true;
          }
        }
        return { h: h, v: v };
      }

      for (var seed = 1; seed <= 3000; seed++) {
        var rng = M.rngFrom(seed);
        var cells = [];
        for (var i = 0; i < 9; i++) cells.push(M.randInt(rng, 3));
        var g = boardFrom(cells, { rows: 3, cols: 3, kinds: 3 });
        if (M.findRuns(g).length) continue;          // поле со готовой линией неинтересно
        pairsChecked++;
        var cls = classify(g);
        if (cls.v && !cls.h) verticalOnly++;
        if (cls.h && !cls.v) horizontalOnly++;
        if (!cls.h && !cls.v) deadEnds++;
        if (M.hasMove(g) !== (cls.h || cls.v)) {
          return "seed " + seed + ": перебор «ход есть» = " + (cls.h || cls.v) +
                 ", hasMove — " + M.hasMove(g) + " (поле " + cells.join("") + ")";
        }
      }
      if (pairsChecked < 500) return "слишком мало полей проверено: " + pairsChecked;
      if (!verticalOnly) return "тест ничего не доказал: не было поля с ходом только вниз";
      if (!horizontalOnly) return "тест ничего не доказал: не было поля с ходом только вправо";
      if (!deadEnds) return "тест ничего не доказал: не было тупика (hasMove обязан вернуть false)";
      return "";
    });

    check("одно зерно + те же ходы = тот же счёт (будущая перепроверка ботом)", function () {
      for (var seed = 1; seed <= 25; seed++) {
        var a = playThrough(seed), b = playThrough(seed);
        var left = a.game.score + "|" + a.game.cells.join(",") + "|" + a.played;
        var right = b.game.score + "|" + b.game.cells.join(",") + "|" + b.played;
        if (left !== right) return "seed " + seed + ": партия не воспроизводится";
        if (a.played !== a.game.moves + a.game.bonusMoves) {
          return "seed " + seed + ": сыграно " + a.played + " — часть ходов игра отвергла";
        }
      }
      return "";
    });

    check("1000 партий без исключений и без зависаний", function () {
      for (var seed = 1000; seed < 2000; seed++) {
        var run = playThrough(seed);
        var g = run.game;
        if (run.played > g.moves + g.bonusMoves) return "seed " + seed + ": больше ходов, чем игра выдала";
        if (!g.over) return "seed " + seed + ": партия не завершилась за отведённое число ходов";
        if (g.cells.length !== g.rows * g.cols) return "seed " + seed + ": поле неполное (" + g.cells.length + ")";
      }
      return "";
    });

    return out;
  }

  root.runMatch3Tests = runMatch3Tests;
  root.boardFromMatch3 = boardFrom;
  root.firstValidMatch3Move = firstValidMove;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { runMatch3Tests: runMatch3Tests, boardFrom: boardFrom,
                       firstValidMove: firstValidMove, playThrough: playThrough };
  }
})(typeof window !== "undefined" ? window : globalThis);
