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
 *   3) adjacent / hasMove  — «разрешён ли этот ход»
 *   4) applyClearAndDrop   — линии исчезли, верхние клетки упали, сверху пришли новые
 *   5) play                — один ход целиком: проверка → очистка → каскады → перемешивание
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

  var MAX_CHAIN = 12;    // предохранитель от бесконечного каскада (на деле недостижим)
  var CHAIN_MULT_CAP = 5; // «каскад ×5» — дальше множитель уже не растёт
  var POINTS_PER_GEM = 10;
  var BONUS_PER_EXTRA_GEM = 20; // четвёртый и пятый в линии стоят дороже

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
   */
  function findRuns(game) {
    var cells = game.cells, rows = game.rows, cols = game.cols;
    var runs = [], r, c, start, i;

    for (r = 0; r < rows; r++) {                 // горизонтали
      start = 0;
      for (c = 1; c <= cols; c++) {
        var same = c < cols && cells[at(game, r, c)] === cells[at(game, r, start)];
        if (!same) {
          if (c - start >= 3) {
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
        var sameV = r < rows && cells[at(game, r, c)] === cells[at(game, start, c)];
        if (!sameV) {
          if (r - start >= 3) {
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
   */
  function hasMove(game) {
    var r, c, ok = false;
    for (r = 0; r < game.rows; r++) {
      for (c = 0; c < game.cols; c++) {
        var i = at(game, r, c);
        var partners = [];
        if (c + 1 < game.cols) partners.push(at(game, r, c + 1));
        if (r + 1 < game.rows) partners.push(at(game, r + 1, c));
        for (var p = 0; p < partners.length; p++) {
          var j = partners[p];
          swap(game.cells, i, j);
          ok = findRuns(game).length > 0;
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
   * Новое поле без готовых линий и с хотя бы одним ходом.
   *
   * Готовую линию при генерации запрещаем сразу: выбирая кристаллик, смотрим, не будет
   * ли он третьим подряд слева или третьим подряд сверху. Так старт партии не выглядит
   * как «мне уже подарили очки», и пересчитывать первый ход не нужно.
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
      score: 0,
      seed: o.seed,
      rng: rngFrom(o.seed),
      over: false
    };
    game.cells = freshCells(game);
    return game;
  }

  /**
   * Цель партии: 25 ходов × 80 = 2000 очков.
   *
   * Множитель взят не на глаз: `node scripts\sim_match3.js 20000` считает распределение
   * очков и долю взятия цели для кандидатов ×50…×140. При ×50 цель берут 88 % партий —
   * это формальность; при ×80 — 29,6 %, и это «жадная» модель (первый попавшийся ход),
   * а живой человек играет лучше, то есть примерно вполовину партий.
   * Меняешь множитель — пересчитай симуляцией, иначе цель станет выдуманной цифрой.
   */
  function target(game) {
    return game.moves * 80;
  }

  /**
   * Один ход. Ничего не рисует, только считает.
   *
   * Возвращает:
   *   {ok:false, reason:"far"}      — не соседи (кнопка/свайп мимо)
   *   {ok:false, reason:"nomatch"}  — размена не было: поле осталось прежним, ход НЕ списан
   *   {ok:false, reason:"over"}     — партия кончилась
   *   {ok:true, steps:[...], gained, swaps:[a,b]}
   *
   * steps[0] — «сделали размен», дальше по одному шагу на каскад, последний шаг может
   * быть {shuffled:true}. Оформлению остаётся только показывать их по очереди.
   */
  function play(game, a, b) {
    if (game.over || game.movesLeft <= 0) return { ok: false, reason: "over" };
    if (!adjacent(game, a, b)) return { ok: false, reason: "far" };

    swap(game.cells, a, b);
    if (findRuns(game).length === 0) {
      swap(game.cells, a, b);                    // откат: наказание за «не угадал» не нужно
      return { ok: false, reason: "nomatch" };
    }

    game.movesLeft -= 1;
    var steps = [{ swaps: [a, b] }];
    var gained = 0, chain = 1, reshuffles = 0;

    while (chain <= MAX_CHAIN) {
      var runs = findRuns(game);
      if (runs.length === 0) break;
      var cleared = {}, all = [], stepGain = 0, i, r, j;
      for (i = 0; i < runs.length; i++) {
        r = runs[i];
        stepGain += scoreRun(r.len) * chainMult(chain);
        for (j = 0; j < r.cells.length; j++) {
          // клетка может входить и в горизонталь, и в вертикаль (буквой «Г») —
          // считаем её один раз, иначе очки зависели бы от порядка поиска линий
          if (cleared[r.cells[j]]) continue;
          cleared[r.cells[j]] = true;
          all.push(r.cells[j]);
        }
      }
      var drop = applyClearAndDrop(game, cleared);
      gained += stepGain;
      steps.push({ cleared: all, moved: drop.moved, born: drop.born, chain: chain, gained: stepGain });
      chain += 1;
    }

    if (!hasMove(game)) {
      shuffleBoard(game);
      reshuffles += 1;
      steps.push({ shuffled: true });
    }

    game.score += gained;
    if (game.movesLeft <= 0) game.over = true;

    return { ok: true, steps: steps, gained: gained, chains: chain - 1, reshuffles: reshuffles };
  }

  // --------------------------------------------------------------- экспорт
  var Match3 = {
    DEFAULTS: DEFAULTS,
    rngFrom: rngFrom,
    randInt: randInt,
    at: at,
    rowOf: rowOf,
    colOf: colOf,
    adjacent: adjacent,
    findRuns: findRuns,
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
