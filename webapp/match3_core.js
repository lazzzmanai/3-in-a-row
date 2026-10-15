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
 * СПЕЦФИГУРЫ (13 октября, вторая итерация по замечаниям Andr'а). Правила, которые здесь записаны:
 *   · 4 в ряд      → на месте размена появляется 💣 БОМБА: при следующем перемещении
 *     взрывает квадрат 3×3 вокруг той клетки, куда её передвинули;
 *   · 5 в ряд      → +5 дополнительных ходов (без лимита за партию);
 *   · «Т» или «Г»  → две линии, пересекающиеся в одной клетке (≤6 клеток) → ⭐ ЗВЕЗДА: при
 *     перемещении на обычную фигуру стирает ВСЕ фигуры этого вида;
 *   · ДВЕ ЛИНИИ за один ход игрока → 💫 КОРОНА (решение Andr'а 2026-10-13 вечером: раньше
 *     корона была только за крест 5+3, а он одним свапом геометрически не строится — то есть
  *     награда висела на везении каскада). В каскаде корона остаётся возможной, но только
 *     как настоящий крест (5+3): две случайные линии в падении корону не дают, иначе на
 *     большом поле она сыпалась 23 раза за партию (замерено);
 *   · корона при перемещении стирает всю строку и весь столбец клетки, куда её передвинули
 *     (тот же «крест», что её породил);
 *   · бомба + бомба → ОДИН взрыв 5×5 в клетке назначения (не два по 3×3 — так читается);
 *   · звезда + бомба → 3 случайные фигуры становятся бомбами;
 *   · звезда + звезда → стирается всё поле; корона + корона → два креста (2×13 клеток);
 *   · чужой взрыв, попавший в спецфигуру, ЗАПУСКАЕТ её (цепная реакция, глубина
 *     ограничена MAX_SPECIAL_DEPTH — иначе теоретическая решётка из бомб не погаснет);
 *   · спецфигуры БЕСЦВЕТНЫЕ: сами линий не составляют и не могут быть «таким же видом»;
 *   · с вечера 13 октября спецфигуры рождаются и из каскада тоже — Andr решил попробовать
 *     щедрую версию (раньше было «только за своё решение», решение откатывается одним
 *     аргументом allowCreate в play());
 *   · размен со спецфигурой НЕ требует линии и списывает один ход: иначе из неё можно
 *     было бы «стрелять» бесплатно.
 */
(function (root) {
  "use strict";

  // ---------------------------------------------------------------- настройки
  var DEFAULTS = {
    rows: 7,        // высота поля. 10×10 мы попробовали 13 октября и вернулись к 7×7 по
    cols: 7,        // решению Andr'а: на 100 клетках каскады и спецфигуры сыпались так
                      // часто, что игра превращалась в шум, а не в заботу о питомце.
                      // Размер — настройка партии, симуляция мерит любую (\`--board=\`).
    kinds: 5,       // сколько видов кристалликов (5 — классика: не скучно и не каша)
    moves: 25,      // длина партии в ходах, а не в секундах: игру можно отложить
    seed: 1,        // зерно случайности; в бою его выдаёт бот
    // ─── три рычага щедрости. Они взаимосвязаны: каскад сыплет спецфигурами,
    // спецфигуры дают новые каскады, а «+5 без лимита» превращает партию в бесконечную.
    // Поэтому значения — НАСТРОЙКИ партии (newGame их принимает), а не текст кода:
    // их меряет scripts/sim_match3.js, и выбирать надо цифрами, а не правкой движка.
    cascadeSpecials: true,   // рождаются ли спецфигуры из каскада (решение Andr'а 13.10)
    maxSpawnPerMove: 2,      // сколько спецфигур может родиться за один ход (0 = без потолка)
    maxBonusPerMove: 1,      // сколько раз за ХОД «5 в ряд» дарит ходы: каскад не должен
                             // осыпать бонусами пачкой (глобального лимита при этом нет)
    bonusCap: 0,             // сколько бонусов вообще за партию (0 = без лимита — как просил Andr)
  };

  var MAX_CHAIN = 12;           // предохранитель от бесконечного каскада (на деле недостижим)
  var CHAIN_MULT_CAP = 5;       // «каскад ×5» — дальше множитель уже не растёт
  var POINTS_PER_GEM = 10;
  var BONUS_PER_EXTRA_GEM = 20; // четвёртый и пятый в линии стоят дороже
  var BOMB_RADIUS = 1;          // квадрат 3×3 вокруг клетки
  var TWIN_BOMB_RADIUS = 2;     // бомба-на-бомбу: 5×5 там, куда её передвинули
  var STAR_BOMB_TURNS = 3;      // звезда + бомба: сколько фигур становятся бомбами
  var EXTRA_MOVES_FOR_FIVE = 5; // пять в ряд — столько дополнительных ходов
  var MAX_SPECIAL_DEPTH = 12;   // цепная реакция спецфигур: сколько «волн» подряд
  var TARGET_PER_MOVE = 220;    // цель = базовых ходов × 220 = 5500 (замер 15.10 на поле 7×7
                                 // со всеми спецфигурами: умная модель берёт в 53,6 % партий)

  var SPECIAL_BOMB = 90;
  var SPECIAL_STAR = 91;
  var SPECIAL_CROWN = 92;       // «крест» 5+3: стирает всю строку и весь столбец

  function isSpecial(v) { return v === SPECIAL_BOMB || v === SPECIAL_STAR || v === SPECIAL_CROWN; }
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
      var hits = [];
      groups.forEach(function (g, idx) {
        for (var k = 0; k < run.cells.length; k++) { if (g.map[run.cells[k]]) { hits.push(idx); return; } }
      });
      if (!hits.length) {
        var map = {};
        run.cells.forEach(function (i) { map[i] = true; });
        groups.push({ runs: [run], map: map, cells: run.cells.slice() });
        return;
      }
      // Склеиваем ВСЕ задетые группы, а не только первую: иначе одна клетка могла попасть
      // в два кластера, и спецфигура рождалась в клетке, которую этот же шаг стирает
      // (нашел тест-инвариант 15 октября).
      var target = groups[hits[0]];
      var absorb = function (other) {
        other.runs.forEach(function (r) { target.runs.push(r); });
        other.cells.forEach(function (i) { if (!target.map[i]) { target.map[i] = true; target.cells.push(i); } });
      };
      for (var k = hits.length - 1; k >= 1; k--) { absorb(groups[hits[k]]); groups.splice(hits[k], 1); }
      absorb({ runs: [run], cells: run.cells });
      run.cells.forEach(function (i) { if (!target.map[i]) { target.map[i] = true; target.cells.push(i); } });
    });
    return groups;
  }

  /**
   * Что заслуживает эта фигура (только ФОРМА; бонус ＋5 за длину считает collapse — иначе
   * группа не могла бы дать и корону, и ходы):
   *   "crown" — «крест»: и горизонталь, и вертикаль, и всего 7+ клеток (например пятёрка
   *             по вертикали и тройка вбок от середины) → 💫 корона;
   *   "star"  — есть и горизонталь, и вертикаль (Т, Г, небольшой плюс) → ⭐ звезда;
   *   "bomb"  — один отрезок ровно из 4 → бомба;
   *   null    — обычная тройка.
   * Порядок именно такой: пересечение важнее пятёрки (собрать «крест» труднее, чем просто
   * пять в ряд), а корона важнее звезды — это его редшая версия (решение Andr'а 2026-10-13).
   */
  function decideShape(cluster) {
    var dirs = {};
    var longest = 0;   // longest больше не порождает "five": ＋5 ходов считаются в collapse
                       // по длине отрезка, иначе пятёрка «съедала» бы фигуру той же группы
    cluster.runs.forEach(function (r) { dirs[r.dir] = true; longest = Math.max(longest, r.len); });
    if (dirs.h && dirs.v) return cluster.cells.length >= 7 ? "crown" : "star";
    if (longest === 4) return "bomb";
    return null;
  }

  /** Клетка, общая для двух отрезков, — «центр» креста или угол буквы «Г». */
  function intersectionCell(cluster) {
    var seen = {};
    for (var i = 0; i < cluster.cells.length; i++) {
      var idx = cluster.cells[i], hits = 0;
      cluster.runs.forEach(function (r) { if (r.cells.indexOf(idx) >= 0) hits += 1; });
      if (hits > 1) return idx;
      if (seen[idx]) return idx;                 // clusters уже склеил, но на всякий случай
      seen[idx] = true;
    }
    return null;
  }

  /**
   * Клетка, где появится спецфигура. Звезда и корона — в пересечении (это их центр, иначе
   * «крест» мог бы родиться с краю и выглядеть обманом). Бомба — в клетку размена: игрок
   * должен видеть, что именно его палец её породил.
   */
  function spawnCell(cluster, swapA, swapB, shape) {
    var inCluster = function (i) {
      for (var k = 0; k < cluster.cells.length; k++) { if (cluster.cells[k] === i) return true; }
      return false;
    };
    if (shape === "star" || shape === "crown") {
      var cross = intersectionCell(cluster);
      if (cross !== null) return cross;
    }
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
  /** Набор клеток, входящих хотя бы в одну готовую линию. */
  function runCells(game) {
    var busy = {};
    findRuns(game).forEach(function (r) { r.cells.forEach(function (i) { busy[i] = true; }); });
    return busy;
  }

  /**
   * Починить поле, СОХРАНИВ набор кристалликов: меняем местами клетку из линии с клеткой
   * вне линий и другого вида. На 10×10 простая перестановка почти никогда не даёт поле
   * «без линий» (математика: линий ожидания ~6 на случайное поле), поэтому чиним, а не
   * перебираем. Игрок при перемешивании получает те же кристаллики, что у него были.
   */
  function repairRuns(game) {
    for (var pass = 0; pass < 300; pass++) {
      var busy = runCells(game);
      var lines = findRuns(game);
      if (!lines.length) return true;
      var victim = lines[0].cells[Math.floor(lines[0].cells.length / 2)];
      var done = false;
      for (var tries = 0; tries < 200 && !done; tries++) {
        var j = randInt(game.rng, game.cells.length);
        if (j === victim || busy[j] || isSpecial(game.cells[j])) continue;
        if (game.cells[j] === game.cells[victim]) continue;
        swap(game.cells, victim, j);
        done = true;
      }
      if (!done) return false;
    }
    return findRuns(game).length === 0;
  }

  function shuffleBoard(game) {
    var cells = game.cells.slice(), i, j, t;
    for (var attempt = 0; attempt < 12; attempt++) {
      for (i = cells.length - 1; i > 0; i--) {
        j = randInt(game.rng, i + 1);
        t = cells[i]; cells[i] = cells[j]; cells[j] = t;
      }
      game.cells = cells.slice();
      if (findRuns(game).length === 0 && hasMove(game)) return true;
    }
    // Перестановка не помогла (на 10×10 это норма): чиним текущее поле перестановками
    // пар — набор и спецфигуры при этом остаются.
    var keep = game.cells.slice();
    if (repairRuns(game) && hasMove(game)) return true;
    game.cells = keep;
    repairRuns(game);
    if (hasMove(game)) return true;
    // Совсем редкий случай: поле рисуется заново, но спецфигуры игрока обязаны выжить —
    // иначе перемешивание съедало бы заработанные бомбы и короны.
    var saved = game.cells.filter(isSpecial);
    game.cells = freshCells(game);
    var spots = [];
    for (i = 0; i < game.cells.length; i++) spots.push(i);
    saved.forEach(function (kind) {
      if (!spots.length) return;
      var pick = randInt(game.rng, spots.length);
      game.cells[spots[pick]] = kind;
      spots.splice(pick, 1);
    });
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
        var pos = r * cols + c;
        // Важно для 10×10: случайное заполнение большого поля САМО создаёт линии
        // (на 100 клетках из 5 видов — примерно 6 готовых троек на досып), и каскад
        // становился бесконечным: 9 каскадов на ход, десятки бонусов за партию.
        // Поэтому новый кристаллик выбирается с тем же запретом, что и при генерации
        // поля: не third подряд снизу и не third подряд слева.
        var kind = 0;
        for (var tries = 0; tries < 60; tries++) {
          kind = randInt(game.rng, game.kinds);
          var threeDown = r + 1 < rows && r + 2 < rows && cells[pos + cols] === kind && cells[pos + 2 * cols] === kind;
          var threeLeft = c >= 2 && cells[pos - 1] === kind && cells[pos - 2] === kind;
          if (!threeDown && !threeLeft) break;
        }
        cells[pos] = kind;
        born.push({ to: pos, kind: kind, from: -(write - r + 1) });
      }
    }
    return { moved: moved, born: born };
  }

  // ------------------------------------------------------------------ спецэффекты
  function markArea(game, center, out, radius) {
    var rad = radius === undefined ? BOMB_RADIUS : radius;
    var r0 = rowOf(game, center), c0 = colOf(game, center);
    for (var r = r0 - rad; r <= r0 + rad; r++) {
      for (var c = c0 - rad; c <= c0 + rad; c++) {
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
  /** Взрыв короны: вся строка и весь столбец клетки, куда её передвинули (тот же «крест», что её породил). */
  function markLine(game, center, out) {
    var r0 = rowOf(game, center), c0 = colOf(game, center), r, c;
    for (c = 0; c < game.cols; c++) out[at(game, r0, c)] = true;
    for (r = 0; r < game.rows; r++) out[at(game, r, c0)] = true;
    return out;
  }

  function activate(game, a, b) {
    var cleared = {}, log = { bomb: 0, star: 0, crown: 0, five: 0 }, spawned = [];
    var fired = {}, i;

    /**
     * Сработать одной спецфигуре. swapWith — подсказка «на что навели»: звезда, которой
     * показали обычный кристаллик, бьёт именно по его виду; без подсказки (её задел чужой
     * взрыв) — по самому частому виду на поле.
     */
    function fire(idx, swapWith) {
      if (fired[idx] || !isSpecial(game.cells[idx])) return false;
      fired[idx] = true;
      cleared[idx] = true;                      // спецфигура расходует себя
      var kind = game.cells[idx];
      if (kind === SPECIAL_BOMB) {
        log.bomb += 1;
        markArea(game, idx, cleared);
      } else if (kind === SPECIAL_CROWN) {
        log.crown += 1;
        markLine(game, idx, cleared);
      } else {
        log.star += 1;
        // ВАЖНО: isColor(undefined) вернуло бы true («undefined» — не спецфигура), и звезда,
        // задетая чужим взрывом, стирала бы «вид undefined», то есть НИЧЕГО. Из-за этого багa
        // она выглядела украденной (замечание Andr'а 2026-10-13). Проверять надо ЯВНО.
        var victim = (swapWith === undefined || !isColor(swapWith)) ? mostFrequentColor(game) : swapWith;
        log.swept = victim;
        game.cells.forEach(function (v, k) { if (v === victim) cleared[k] = true; });
      }
      return true;
    }

    var va = game.cells[a], vb = game.cells[b];
    var starBomb = (va === SPECIAL_STAR && vb === SPECIAL_BOMB) || (va === SPECIAL_BOMB && vb === SPECIAL_STAR);

    if (va === SPECIAL_STAR && vb === SPECIAL_STAR) {
      for (i = 0; i < game.cells.length; i++) cleared[i] = true;   // звезда + звезда: всё поле
      log.star = 2;
      return { cleared: cleared, log: log, spawned: spawned };
    }

    if (va === SPECIAL_CROWN && vb === SPECIAL_CROWN) {            // корона + корона: два креста
      markLine(game, a, cleared);
      markLine(game, b, cleared);
      fired[a] = fired[b] = true;
      log.crown = 2;
    } else if (va === SPECIAL_BOMB && vb === SPECIAL_BOMB) {       // бомба на бомбу: 5×5 в клетку назначения
      fired[a] = fired[b] = true;
      cleared[a] = cleared[b] = true;
      log.bomb = 2;
      markArea(game, b, cleared, TWIN_BOMB_RADIUS);
    } else if (starBomb) {                                         // звезда + бомба: три бомбы и сразу взрыв
      cleared[a] = cleared[b] = true;
      fired[a] = fired[b] = true;
      log.star += 1;
      log.bomb += 1;
      spawned = turnSomeIntoBombs(game, STAR_BOMB_TURNS, cleared);
      // По его правилу: «появляются три бомбы и сразу после этого взрываются».
      // Каждая из трёх бьёт как обычная бомба (и может зацепить четвёртую — цепная реакция
      // работает через тот же fire), а spawned оформлению покажет момент рождения.
      spawned.forEach(function (s) { fire(s.at); s.detonated = true; });
      // detonated — важно для экрана: эти бомбы показаны ТОЛЬКО как вспышка в своей
      // клетке, но в поле их нет (они израсходовались в этом же шаге). Без метки
      // страницы рисовали бомбы, которых не существует (замер: 3 случая на 10 845 ходов).
    } else {
      if (isSpecial(va)) fire(a, vb);
      if (isSpecial(vb)) fire(b, va);
    }

    // цепная реакция: всё, что попало в зону и само является спецфигурой, бьёт тоже
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
      bonusCap: o.bonusCap || 0,
      cascadeSpecials: o.cascadeSpecials !== false,
      maxSpawnPerMove: o.maxSpawnPerMove === undefined ? DEFAULTS.maxSpawnPerMove : o.maxSpawnPerMove,
      maxBonusPerMove: o.maxBonusPerMove === undefined ? DEFAULTS.maxBonusPerMove : o.maxBonusPerMove,
      _bonusLeft: Infinity,
      _spawnLeft: Infinity,
      score: 0,
      seed: o.seed,
      rng: rngFrom(o.seed),
      over: false
    };
    game.cells = freshCells(game);
    return game;
  }

  /**
   * Цель партии: 25 базовых ходов × 720 = 18000 очков.
   *
   * Как появилось число. Andr попросил 3200, играя БЕЗ спецфигур (тогда медиана была 1690,
   * и 3200 была честной планкой). Со спецфигурами `node scripts\sim_match3.js --model=smart`
   * даёт другое: средний счёт 6236, медиана 6080, а 3200 берут 98,7 % партий — цель
   * превратилась бы в формальность. Дальше цель ехала вместе с щедростью и размером поля:
   * 6000 (спецфигуры на 7×7) → 9000 (спецфигуры из каскада) → 18000 (поле 10×10 и честный
   * досып, который перестал сам собой собирать каскады). Замер сейчас: среднее 20875,
   * медиана 18470, и 18000 умная модель берёт ровно в половине партий.
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

    // Бюджет спецфигур готовит play() один раз на ход; здесь мы только расходуем его
    // (иначе лимит стал бы «на шаг каскада», и 12 шагов дали бы 24 спецфигуры за свайп).
    var room = function () { return game._spawnLeft; };
    var take = function () { game._spawnLeft -= 1; };
    // Корона за «две линии в одном ходе». Почему это вообще возможно пальцем: свап меняет
    // ДВЕ клетки (туда и обратно), и каждая из них может закончить свою линию. Раньше корона
    // была только за крест 5+3, а он одним свапом не строится (нужны 5 готовых клеток креста,
    // а они уже дали бы линию) — то есть награда была недостижима намеренно. (Решение Andr'а
    // 2026-10-13: «корона = две линии за один ход».)
    var crownGroup = -1;
    if (allowCreate && chain === 1 && groups.length >= 2) {
      for (var gi = 0; gi < groups.length; gi++) {
        if (groups[gi].cells.indexOf(swapB) >= 0 || groups[gi].cells.indexOf(swapA) >= 0) { crownGroup = gi; break; }
      }
      if (crownGroup < 0) crownGroup = 0;
    }
    var twoLines = crownGroup >= 0;

    groups.forEach(function (group, gi) {
      // «Пятёрка» платит ВСЕГДА, даже если из этой же фигуры выходит корона или звезда:
      // 15 октября Andr попросил не выбирать между наградой за длину и наградой за форму
      // (раньше они исключали друг друга — gatherShape возвращал либо "five", либо фигуру).
      var runs5 = group.runs.some(function (r) { return r.len >= 5; });
      if (allowCreate && runs5 && game._bonusLeft > 0) {
        game._bonusLeft -= 1;
        bonus += EXTRA_MOVES_FOR_FIVE;
      }

      var shape = allowCreate ? decideShape(group) : null;
      if (shape === "five") shape = null;              // её щедрость уже учтена выше
      if (twoLines) shape = (gi === crownGroup) ? "crown" : null;   // остальные кластеры
                                                                    // дают только ＋5, не фигурки
      if (shape === "star" || shape === "bomb" || shape === "crown") {
        if (room() <= 0) shape = null;                 // бюджет хода исчерпан
        else { take(); spawn.push({ at: spawnCell(group, swapA, swapB, shape), type: shape }); }
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
      game.cells[dest] = s.type === "star" ? SPECIAL_STAR
                     : s.type === "crown" ? SPECIAL_CROWN : SPECIAL_BOMB;
      s.at = dest;                                   // оформлению говорим итоговую клетку
    });

    if (bonus && (!game.bonusCap || game.bonuses < game.bonusCap)) {
      game.movesLeft += bonus;
      // поля может не оказаться у поля, собранного тестом вручную, — не превращаем их в NaN
      game.bonusMoves = (game.bonusMoves || 0) + bonus;   // сумма подаренных ходов: партия = moves + bonusMoves
      game.bonuses = (game.bonuses || 0) + 1;              // сколько раз сработало «5 в ряд»
    } else if (bonus) {
      // Кап подаренных ходов исчерпан: пятёрка в этот раз не даёт ничего сверх очков
      // за сами клетки (специального бонуса к очкам нет — придумывать его молча не будем).
      bonus = 0;
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
    // бюджет спецфигур на весь ход (включая все каскады), см. collapse()
    game._spawnLeft = game.maxSpawnPerMove > 0 ? game.maxSpawnPerMove : Infinity;
    game._bonusLeft = game.maxBonusPerMove > 0 ? game.maxBonusPerMove : Infinity;
    // куда приедут спецфигуры — нужно оформлению, чтобы нарисовать ударную волну ровно там,
    // где игрок сказал «бум», а не где-нибудь рядом
    var centers = [];
    if (isSpecial(game.cells[a])) centers.push(b);
    if (isSpecial(game.cells[b])) centers.push(a);
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
                   chain: 1, gained: points, special: act.log, spawned: act.spawned,
                   centers: centers });
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

    // allowCreate=true и здесь: с 13 октября (вечер) спецфигуры рождаются и из каскада —
    // Andr захотел попробовать, что это меняет в ощущениях. Было «только за своё решение»,
    // стало «щедрее партия». Если разойдётся с балансом — откатывается этим же аргументом.
    while (chain <= MAX_CHAIN) {
      var next = collapse(game, chain, game.cascadeSpecials !== false, a, b);
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
    SPECIAL_CROWN: SPECIAL_CROWN,
    TARGET_PER_MOVE: TARGET_PER_MOVE,
    EXTRA_MOVES_FOR_FIVE: EXTRA_MOVES_FOR_FIVE,
    BOMB_RADIUS: BOMB_RADIUS,
    TWIN_BOMB_RADIUS: TWIN_BOMB_RADIUS,
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
