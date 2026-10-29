// src/paperCut.ts
// Движок «Раскрой бумаги» — порт калькулятора paper-calc / paper-calc-pro
// (andreykalenik), согласованный с автором. Механика и результаты сохранены,
// внутренности переписаны под React:
//   • чистые функции без DOM — UI не перерисовывается от расчётов;
//   • кэш результатов решателя (в оригинале одни и те же раскладки считались
//     по несколько раз: equalStage + plan + stage2/stage4 на каждый вариант);
//   • бюджет узлов перебора оставлен тем же, поэтому результат совпадает,
//     но время падает в разы.
//
// Два режима:
//   Простой — одно изделие на листе. «По долевой» = сетка без поворота,
//             «Без долевой» = вертикальные/горизонтальные полосы с поворотом.
//   ПРО     — несколько разных форматов на одном листе, количества подбираются
//             автоматически (равные количества → минимум свободного места →
//             минимум резов → группировка одинаковых форматов).

export type Tile = [number, number, number, number];

export interface SimpleLayout {
  fits: boolean;
  amount: number;
  waste: number;
  outline: number;
  nx?: number;
  ny?: number;
  tiles?: Tile[];
  mode: string;
}

/** Стандартные листы, которые всегда показываются в таблице сравнения. */
export const FIXED_SHEETS: Array<[number, number]> = [
  [325, 470],
  [470, 650],
  [650, 940],
  [700, 1000],
  [720, 1040],
  [787, 1092],
];

/** Пресеты листа на кнопках. */
export const SHEET_PRESETS: Array<[number, number]> = [
  [325, 470],
  [470, 650],
  [650, 940],
  [700, 1000],
  [720, 1040],
  [787, 1092],
];

/**
 * Толщина материала в микрометрах — для расчёта высоты стопы.
 * Значения перенесены из paper-calc-pro без изменений.
 */
export const MATERIALS: Array<{ group: string; label: string; microns: number }> = [
  { group: 'Картон', label: 'картон 270 — 390 мкм', microns: 390 },
  { group: 'Мел мат', label: 'мел мат 90 — 80 мкм', microns: 80 },
  { group: 'Мел мат', label: 'мел мат 115 — 110 мкм', microns: 110 },
  { group: 'Мел мат', label: 'мел мат 130 — 131 мкм', microns: 131 },
  { group: 'Мел мат', label: 'мел мат 150 — 153 мкм', microns: 153 },
  { group: 'Мел мат', label: 'мел мат 170 — 175 мкм', microns: 175 },
  { group: 'Мел мат', label: 'мел мат 200 — 210 мкм', microns: 210 },
  { group: 'Мел мат', label: 'мел мат 250 — 250 мкм', microns: 250 },
  { group: 'Мел мат', label: 'мел мат 300 — 285 мкм', microns: 285 },
  { group: 'Мел мат', label: 'мел мат 350 — 340 мкм', microns: 340 },
  { group: 'Мел глянец', label: 'мел глянец 90 — 75 мкм', microns: 75 },
  { group: 'Мел глянец', label: 'мел глянец 115 — 91 мкм', microns: 91 },
  { group: 'Мел глянец', label: 'мел глянец 130 — 105 мкм', microns: 105 },
  { group: 'Мел глянец', label: 'мел глянец 150 — 125 мкм', microns: 125 },
  { group: 'Мел глянец', label: 'мел глянец 170 — 147 мкм', microns: 147 },
  { group: 'Мел глянец', label: 'мел глянец 200 — 176 мкм', microns: 176 },
  { group: 'Мел глянец', label: 'мел глянец 250 — 225 мкм', microns: 225 },
  { group: 'Мел глянец', label: 'мел глянец 300 — 270 мкм', microns: 270 },
  { group: 'Мел глянец', label: 'мел глянец 350 — 330 мкм', microns: 330 },
  { group: 'Офсет', label: 'офсет 80 — 100 мкм', microns: 100 },
  { group: 'Офсет', label: 'офсет 100 — 124 мкм', microns: 124 },
  { group: 'Офсет', label: 'офсет 120 — 140 мкм', microns: 140 },
  { group: 'Офсет', label: 'офсет 160 — 180 мкм', microns: 180 },
  { group: 'Каландр', label: 'каландр 90 — 98 мкм', microns: 98 },
  { group: 'Каландр', label: 'каландр 100 — 106 мкм', microns: 106 },
  { group: 'Каландр', label: 'каландр 120 — 126 мкм', microns: 126 },
  { group: 'Каландр', label: 'каландр 160 — 166 мкм', microns: 166 },
  { group: 'Каландр', label: 'каландр 200 — 200 мкм', microns: 200 },
  { group: 'Каландр', label: 'каландр 250 — 245 мкм', microns: 245 },
  { group: 'Каландр', label: 'каландр 300 — 305 мкм', microns: 305 },
  { group: 'Каландр', label: 'каландр 350 — 350 мкм', microns: 350 },
];

export function fmtWaste(w: number): string {
  return `${String(w).replace('.', ',')} %`;
}

/**
 * Материал из текста ТЗ: «Мелованная 350 г/м², 4+0, лам. 1+1 мат. 30 мк»
 * → запись справочника MATERIALS («мел мат 350 — 340 мкм»).
 *
 * Ламинацию из строки ВЫРЕЗАЕМ до разбора: «лам. мат. 30 мк» — это про плёнку,
 * а не про бумагу, и без этого любая ламинация делала бумагу матовой.
 */
export function guessMaterialFromTz(text: string): { label: string; microns: number } | null {
  const src = String(text || '');
  if (!src.trim()) return null;

  // Уже готовое значение справочника («мел мат 350 — 340 мкм») — берём как есть.
  const exactLabel = MATERIALS.find((m) => m.label.toLowerCase() === src.trim().toLowerCase());
  if (exactLabel) return { label: exactLabel.label, microns: exactLabel.microns };

  // Убираем ламинацию и всё после неё в том же сегменте («лам. 1+1 мат. 30 мк»).
  const paperOnly = src.replace(/лам[а-яё.]*\s*[^,;\n]*/gi, ' ');
  const lower = paperOnly.toLowerCase();

  let group = '';
  if (/картон/.test(lower)) group = 'Картон';
  else if (/офсет/.test(lower)) group = 'Офсет';
  else if (/каландр/.test(lower)) group = 'Каландр';
  else if (/мелованн|мел\.|мел\s/.test(lower)) {
    if (/мат/.test(lower)) group = 'Мел мат';
    else if (/глян/.test(lower)) group = 'Мел глянец';
    else group = 'Мел мат';
  } else if (/самоклей|самокле|рафлатак|raflatac/.test(lower)) {
    group = '';
  }

  const densityMatch = paperOnly.match(/(\d{2,4})\s*(?:г\/м²|г\/м2|гр(?![а-яё])|г(?![а-яё]))/i);
  const gsm = densityMatch ? parseInt(densityMatch[1], 10) : 0;

  const pool = group ? MATERIALS.filter((m) => m.group === group) : MATERIALS;

  if (gsm > 0) {
    const exact = pool.find((m) => new RegExp(`\\b${gsm}\\b`).test(m.label));
    if (exact) return { label: exact.label, microns: exact.microns };
  }
  if (group) {
    const first = MATERIALS.find((m) => m.group === group);
    if (first) return { label: first.label, microns: first.microns };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Простой режим
// ─────────────────────────────────────────────────────────────────────────────

/** Полосы с поворотом: максимум изделий при делении листа на вертикальные полосы. */
function bestVerticalStrips(cW: number, cH: number, pW: number, pH: number) {
  const rowsA = Math.floor(cH / pH);
  const rowsB = Math.floor(cH / pW);
  const maxA = Math.floor(cW / pW);
  let best = { total: -1, nA: 0, nB: 0, rowsA, rowsB, rest: 0 };

  for (let nA = 0; nA <= maxA; nA++) {
    const rem = cW - nA * pW;
    const nB = Math.floor(rem / pH);
    const total = nA * rowsA + nB * rowsB;
    const rest = rem - nB * pH;
    if (total > best.total || (total === best.total && rest < best.rest)) {
      best = { total, nA, nB, rowsA, rowsB, rest };
    }
  }
  return best;
}

/** То же, но лист делится на горизонтальные полосы. */
function bestHorizontalStrips(cW: number, cH: number, pW: number, pH: number) {
  const colsA = Math.floor(cW / pW);
  const colsB = Math.floor(cW / pH);
  const maxA = Math.floor(cH / pH);
  let best = { total: -1, nA: 0, nB: 0, colsA, colsB, rest: 0 };

  for (let nA = 0; nA <= maxA; nA++) {
    const rem = cH - nA * pH;
    const nB = Math.floor(rem / pW);
    const total = nA * colsA + nB * colsB;
    const rest = rem - nB * pW;
    if (total > best.total || (total === best.total && rest < best.rest)) {
      best = { total, nA, nB, colsA, colsB, rest };
    }
  }
  return best;
}

/** Комбинированная раскладка: часть полос прямо, часть повёрнуто. */
export function buildTilesMixed(cW: number, cH: number, pW: number, pH: number): { tiles: Tile[]; mode: string } {
  const v = bestVerticalStrips(cW, cH, pW, pH);
  const h = bestHorizontalStrips(cW, cH, pW, pH);
  const tiles: Tile[] = [];
  let mode: string;

  if (v.total >= h.total) {
    mode =
      'вертикальные полосы' +
      (v.nA > 0 && v.nB > 0 ? ' (комбинированный)' : v.nB > 0 ? ' (все повёрнуты)' : '');
    let x = 0;
    for (let i = 0; i < v.nA; i++) {
      for (let j = 0; j < v.rowsA; j++) tiles.push([x, j * pH, pW, pH]);
      x += pW;
    }
    for (let i = 0; i < v.nB; i++) {
      for (let j = 0; j < v.rowsB; j++) tiles.push([x, j * pW, pH, pW]);
      x += pH;
    }
  } else {
    mode =
      'горизонтальные полосы' +
      (h.nA > 0 && h.nB > 0 ? ' (комбинированный)' : h.nB > 0 ? ' (все повёрнуты)' : '');
    let y = 0;
    for (let r = 0; r < h.nA; r++) {
      for (let c = 0; c < h.colsA; c++) tiles.push([c * pW, y, pW, pH]);
      y += pH;
    }
    for (let r = 0; r < h.nB; r++) {
      for (let c = 0; c < h.colsB; c++) tiles.push([c * pH, y, pH, pW]);
      y += pW;
    }
  }
  return { tiles, mode };
}

export function wastePct(cW: number, cH: number, pW: number, pH: number, amount: number): number {
  return Math.round(((cW * cH - amount * pW * pH) / (cW * cH)) * 1000) / 10;
}

/**
 * Раскладка одного изделия на листе.
 * withRuller = true → «резать с учётом долевой»: сетка nx × ny без поворота.
 * withRuller = false → полосы с поворотом (плотнее, но волокно может пойти поперёк).
 */
export function computeLayout(
  cW: number,
  cH: number,
  pW: number,
  pH: number,
  withRuller: boolean,
): SimpleLayout {
  if (withRuller) {
    if (pW > cW || pH > cH) return { fits: false, amount: 0, waste: 0, outline: 0, mode: '' };
    const nx = Math.floor(cW / pW);
    const ny = Math.floor(cH / pH);
    const amount = nx * ny;
    // Допустимый зазор между изделиями: сколько остаётся на равные промежутки.
    const s = Math.min(10, (cW % pW) / (nx + 1), (cH % pH) / (ny + 1));
    const outline = s >= 6 ? Math.min(10, Math.floor(s)) : 0;
    return {
      fits: true,
      amount,
      outline,
      waste: wastePct(cW, cH, pW, pH, amount),
      nx,
      ny,
      mode: `по долевой: ${nx} × ${ny}`,
    };
  }

  const straight = pW <= cW && pH <= cH;
  const rotated = pW <= cH && pH <= cW;
  if (!straight && !rotated) return { fits: false, amount: 0, waste: 0, outline: 0, mode: '' };

  const res = buildTilesMixed(cW, cH, pW, pH);
  return {
    fits: true,
    amount: res.tiles.length,
    outline: 0,
    waste: wastePct(cW, cH, pW, pH, res.tiles.length),
    tiles: res.tiles,
    mode: res.mode,
  };
}

/** Автовыбор «долевой»: включаем, если без поворота не теряем изделия. */
export function resolveRuller(cW: number, cH: number, pW: number, pH: number): boolean {
  const a = computeLayout(cW, cH, pW, pH, true);
  const b = computeLayout(cW, cH, pW, pH, false);
  const s = a.fits ? a.amount : 0;
  const m = b.fits ? b.amount : 0;
  return !(m > s);
}

/** Сравнение текущего листа со стандартными — таблица под результатом. */
export interface SheetCompareRow {
  w: number;
  h: number;
  straight: SimpleLayout;
  mixed: SimpleLayout;
  isCurrent: boolean;
}

export function compareSheets(
  product: { w: number; h: number },
  current: { w: number; h: number },
  history: Array<{ w: number; h: number }>,
): SheetCompareRow[] {
  const sheets: Array<{ w: number; h: number }> = [...history];
  for (const [w, h] of FIXED_SHEETS) sheets.push({ w, h });

  const same = (a: { w: number; h: number }, b: { w: number; h: number }) =>
    (a.w === b.w && a.h === b.h) || (a.w === b.h && a.h === b.w);

  return sheets.map((s) => ({
    w: s.w,
    h: s.h,
    straight: computeLayout(s.w, s.h, product.w, product.h, true),
    mixed: computeLayout(s.w, s.h, product.w, product.h, false),
    isCurrent: current.w > 0 && current.h > 0 && same(s, current),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// ПРО режим: несколько форматов на одном листе
// ─────────────────────────────────────────────────────────────────────────────

export interface ProFormat {
  id: string;
  w: number;
  h: number;
  rotate: boolean;
  /** Подпись для итогов и эскиза */
  label?: string;
}

export interface ProPlacement {
  x: number;
  y: number;
  w: number;
  h: number;
  sourceW: number;
  sourceH: number;
  formatId: string;
  rotated: boolean;
}

export interface ProStage {
  label: string;
  result: ProResult;
}

export interface ProResult {
  placements: ProPlacement[];
  counts: Record<string, number>;
  usedArea: number;
  waste: number;
  cuts: number;
  truncated: boolean;
  nodes: number;
  sourceArea: number;
  requested: number;
  /** Разные раскладки по приоритетам — как четыре шага в оригинале. */
  stages?: ProStage[];
  /** Сколько изделий каждого формата на листе, по порядку форматов */
  perFormat: Array<{ formatId: string; label: string; w: number; h: number; count: number }>;
}

interface PackItem {
  w: number;
  h: number;
  sourceW: number;
  sourceH: number;
  rotate: boolean;
  formatId: string;
  copyIndex: number;
}

const EMPTY_RESULT = (): ProResult => ({
  placements: [],
  counts: {},
  usedArea: 0,
  waste: 0,
  cuts: 0,
  truncated: false,
  nodes: 0,
  sourceArea: 0,
  requested: 0,
  perFormat: [],
});

function proInteger(v: number): number {
  return !Number.isFinite(v) || v < 0 ? 0 : Math.floor(v);
}

function normalizeItem(item: PackItem): PackItem {
  let w = proInteger(item.w);
  let h = proInteger(item.h);
  if (item.rotate && w > h) [w, h] = [h, w];
  return { ...item, w, h };
}

function itemFormatId(item: PackItem): string {
  return item.formatId;
}

function orientationsOf(item: PackItem) {
  const result = [{ w: item.w, h: item.h, rotated: item.w !== item.sourceW || item.h !== item.sourceH }];
  if (item.rotate && item.w !== item.h) {
    result.push({ w: item.h, h: item.w, rotated: item.h !== item.sourceW || item.w !== item.sourceH });
  }
  return result;
}

function splitRegion(
  region: { x: number; y: number; w: number; h: number },
  w: number,
  h: number,
  gap: number,
  direction: 'horizontal' | 'vertical',
) {
  const rightW = region.w - w - gap;
  const bottomH = region.h - h - gap;
  const result: Array<{ x: number; y: number; w: number; h: number }> = [];
  if (direction === 'horizontal') {
    if (bottomH > 0) result.push({ x: region.x, y: region.y + h + gap, w: region.w, h: bottomH });
    if (rightW > 0) result.push({ x: region.x + w + gap, y: region.y, w: rightW, h });
  } else {
    if (rightW > 0) result.push({ x: region.x + w + gap, y: region.y, w: rightW, h: region.h });
    if (bottomH > 0) result.push({ x: region.x, y: region.y + h + gap, w, h: bottomH });
  }
  return result;
}

function formatKey(p: { sourceW: number; sourceH: number }): string {
  const a = Math.min(p.sourceW, p.sourceH);
  const b = Math.max(p.sourceW, p.sourceH);
  return `${a}×${b}`;
}

const eq = (a: number, b: number) => Math.abs(a - b) < 0.0001;

function sameFormatAligned(a: ProPlacement, b: ProPlacement): boolean {
  if (formatKey(a) !== formatKey(b)) return false;
  const sameRow = eq(a.y, b.y) && eq(a.h, b.h);
  const sameCol = eq(a.x, b.x) && eq(a.w, b.w);
  return sameRow || sameCol;
}

function sameFormatTouching(a: ProPlacement, b: ProPlacement, gap: number): boolean {
  if (!sameFormatAligned(a, b)) return false;
  const horizontal = eq(a.y, b.y) && eq(a.h, b.h) && (eq(a.x + a.w + gap, b.x) || eq(b.x + b.w + gap, a.x));
  const vertical = eq(a.x, b.x) && eq(a.w, b.w) && (eq(a.y + a.h + gap, b.y) || eq(b.y + b.h + gap, a.y));
  return horizontal || vertical;
}

function anyFormatTouching(a: ProPlacement, b: ProPlacement, gap: number): boolean {
  const horizontal = eq(a.y, b.y) && eq(a.h, b.h) && (eq(a.x + a.w + gap, b.x) || eq(b.x + b.w + gap, a.x));
  const vertical = eq(a.x, b.x) && eq(a.w, b.w) && (eq(a.y + a.h + gap, b.y) || eq(b.y + b.h + gap, a.y));
  return horizontal || vertical;
}

interface Preference {
  touching: number;
  aligned: number;
  runScore: number;
  maxComponent: number;
  componentCount: number;
  multiComponentCount: number;
  mixedTouching: number;
}

function layoutPreference(placements: ProPlacement[], gap: number): Preference {
  const parent: number[] = [];
  let aligned = 0;
  let touching = 0;
  let mixedTouching = 0;
  for (let i = 0; i < placements.length; i++) parent[i] = i;

  const find = (n: number): number => {
    while (parent[n] !== n) {
      parent[n] = parent[parent[n]];
      n = parent[n];
    }
    return n;
  };
  const unite = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  for (let i = 0; i < placements.length; i++) {
    for (let j = i + 1; j < placements.length; j++) {
      const sameFormat = formatKey(placements[i]) === formatKey(placements[j]);
      if (sameFormat) {
        if (sameFormatAligned(placements[i], placements[j])) aligned++;
        if (sameFormatTouching(placements[i], placements[j], gap)) {
          touching++;
          unite(i, j);
        }
      } else if (anyFormatTouching(placements[i], placements[j], gap)) {
        mixedTouching++;
      }
    }
  }

  const components: Record<number, number> = {};
  for (let i = 0; i < placements.length; i++) {
    const root = find(i);
    components[root] = (components[root] || 0) + 1;
  }

  let runScore = 0;
  let maxComponent = 0;
  let componentCount = 0;
  let multiComponentCount = 0;
  for (const key of Object.keys(components)) {
    const size = components[Number(key)];
    componentCount++;
    if (size > 1) {
      multiComponentCount++;
      runScore += size * size;
      maxComponent = Math.max(maxComponent, size);
    }
  }

  return { touching, aligned, runScore, maxComponent, componentCount, multiComponentCount, mixedTouching };
}

function balanceProfile(placements: ProPlacement[], formatIds: string[]) {
  const counts: Record<string, number> = {};
  for (const id of formatIds) counts[id] = 0;
  for (const p of placements) if (p.formatId in counts) counts[p.formatId]++;
  const values = formatIds.map((id) => counts[id]).sort((a, b) => a - b);
  return { counts, values };
}

function compareBalance(a: { values: number[] }, b: { values: number[] }): number {
  const length = Math.max(a.values.length, b.values.length);
  for (let i = 0; i < length; i++) {
    const av = a.values[i] || 0;
    const bv = b.values[i] || 0;
    if (av !== bv) return av > bv ? 1 : -1;
  }
  return 0;
}

function layoutSignature(placements: ProPlacement[]): string {
  return placements
    .slice()
    .sort((a, b) => {
      if (a.y !== b.y) return a.y - b.y;
      if (a.x !== b.x) return a.x - b.x;
      if (a.w !== b.w) return a.w - b.w;
      if (a.h !== b.h) return a.h - b.h;
      return String(a.formatId).localeCompare(String(b.formatId));
    })
    .map((t) => [t.x, t.y, t.w, t.h, t.formatId].join(','))
    .join(';');
}

function compareGrouping(a: Preference, b: Preference): number {
  if (a.runScore !== b.runScore) return a.runScore > b.runScore ? 1 : -1;
  if (a.maxComponent !== b.maxComponent) return a.maxComponent > b.maxComponent ? 1 : -1;
  if (a.touching !== b.touching) return a.touching > b.touching ? 1 : -1;
  if (a.multiComponentCount !== b.multiComponentCount) return a.multiComponentCount < b.multiComponentCount ? 1 : -1;
  if (a.componentCount !== b.componentCount) return a.componentCount < b.componentCount ? 1 : -1;
  if (a.mixedTouching !== b.mixedTouching) return a.mixedTouching < b.mixedTouching ? 1 : -1;
  if (a.aligned !== b.aligned) return a.aligned > b.aligned ? 1 : -1;
  return 0;
}

interface SolverResult {
  placements: ProPlacement[];
  usedArea: number;
  cuts: number;
  /** Отход, % — нужен для отбора планов (минимум свободного места). */
  waste: number;
  balance: { counts: Record<string, number>; values: number[] };
  preference: Preference;
  signature: string;
  gap: number;
  truncated: boolean;
  nodes: number;
}

/** Экспорт для тестов и отладки: решатель раскладки заданного набора изделий. */
export function solveProLayoutForTest(
  cW: number,
  cH: number,
  items: Array<{ w: number; h: number; rotate: boolean; formatId: string; copyIndex?: number }>,
  gap: number,
  level: number,
) {
  const packItems: PackItem[] = items.map((i) => ({
    w: i.w,
    h: i.h,
    sourceW: i.w,
    sourceH: i.h,
    rotate: i.rotate,
    formatId: i.formatId,
    copyIndex: i.copyIndex || 1,
  }));
  return solveProLayout(cW, cH, packItems, gap, level);
}

function solveProLayout(
  cW: number,
  cH: number,
  inputItems: PackItem[],
  gap: number,
  priorityLevel: number,
): SolverResult {
  const level = priorityLevel || 3;
  const items = inputItems
    .map(normalizeItem)
    .sort((a, b) => {
      const areaDiff = b.w * b.h - a.w * a.h;
      if (areaDiff !== 0) return areaDiff;
      const maxSide = Math.max(b.w, b.h) - Math.max(a.w, a.h);
      if (maxSide !== 0) return maxSide;
      const minSide = Math.min(b.w, b.h) - Math.min(a.w, a.h);
      if (minSide !== 0) return minSide;
      const ida = itemFormatId(a);
      const idb = itemFormatId(b);
      if (ida !== idb) return String(ida).localeCompare(String(idb));
      return a.copyIndex - b.copyIndex;
    });

  let best: SolverResult | null = null;
  let nodes = 0;
  let truncated = false;
  const maxNodes = level >= 4 ? 24000 : 18000;
  const sourceArea = cW * cH;
  const formatIds: string[] = [];
  const seen: Record<string, boolean> = {};
  for (const item of inputItems) {
    const id = itemFormatId(item);
    if (!seen[id]) {
      seen[id] = true;
      formatIds.push(id);
    }
  }

  const freeCompare = (a: { w: number; h: number; y: number; x: number }, b: { w: number; h: number; y: number; x: number }) => {
    const areaDiff = a.w * a.h - b.w * b.h;
    if (areaDiff !== 0) return areaDiff;
    if (a.y !== b.y) return a.y - b.y;
    if (a.x !== b.x) return a.x - b.x;
    if (a.w !== b.w) return a.w - b.w;
    return a.h - b.h;
  };

  type Region = { x: number; y: number; w: number; h: number };

  const normalizeFree = (free: Region[]): Region[] => {
    const result: Region[] = [];
    const seenKey: Record<string, boolean> = {};
    for (const r of free) {
      if (r.w <= 0 || r.h <= 0) continue;
      const key = [r.x, r.y, r.w, r.h].join(',');
      if (seenKey[key]) continue;
      seenKey[key] = true;
      result.push({ x: r.x, y: r.y, w: r.w, h: r.h });
    }
    result.sort(freeCompare);
    return result;
  };

  const freeSignature = (free: Region[]) => free.map((r) => [r.x, r.y, r.w, r.h].join(',')).join('|');

  const better = (candidate: SolverResult, current: SolverResult | null): boolean => {
    if (!current) return true;
    const balance = compareBalance(candidate.balance, current.balance);
    if (balance !== 0) return balance > 0;
    if (level < 2) return false;
    if (candidate.usedArea !== current.usedArea) return candidate.usedArea > current.usedArea;
    if (level < 3) return false;
    if (candidate.cuts !== current.cuts) return candidate.cuts < current.cuts;
    if (level < 4) return false;
    if (!candidate.preference) candidate.preference = layoutPreference(candidate.placements, gap);
    if (!current.preference) current.preference = layoutPreference(current.placements, gap);
    if (!candidate.signature) candidate.signature = layoutSignature(candidate.placements);
    if (!current.signature) current.signature = layoutSignature(current.placements);
    const grouping = compareGrouping(candidate.preference, current.preference);
    if (grouping !== 0) return grouping > 0;
    return String(candidate.signature) < String(current.signature);
  };

  const inspect = (
    free: Region[],
    placements: ProPlacement[],
    skipped: PackItem[],
    usedArea: number,
    cuts: number,
  ) => {
    const candidate: SolverResult = {
      placements: placements.slice(),
      usedArea,
      cuts,
      waste: sourceArea > 0 ? Math.round(((sourceArea - usedArea) / sourceArea) * 1000) / 10 : 0,
      balance: balanceProfile(placements, formatIds),
      preference: null as unknown as Preference,
      signature: '',
      gap,
      truncated: false,
      nodes: 0,
    };
    if (better(candidate, best)) best = candidate;
  };

  const search = (
    index: number,
    free: Region[],
    placements: ProPlacement[],
    skipped: PackItem[],
    usedArea: number,
    cuts: number,
  ) => {
    if (level < 3) {
      if (best && (best as SolverResult).placements.length === items.length) return;
      inspect(free, placements, skipped, usedArea, cuts);
    } else {
      if (!best || (best as SolverResult).placements.length < items.length || index >= items.length) {
        inspect(free, placements, skipped, usedArea, cuts);
      }
      if (best && (best as SolverResult).placements.length === items.length) {
        const remainingItems = items.length - index;
        const minimumFinalRegions = Math.max(0, free.length - remainingItems);
        const minimumCuts = minimumFinalRegions + items.length - 1;
        if (minimumCuts > (best as SolverResult).cuts) return;
      }
    }

    if (index >= items.length) return;
    if (nodes++ >= maxNodes) {
      truncated = true;
      return;
    }

    const item = items[index];
    const orientations = orientationsOf(item);
    const regions = free.slice().sort(freeCompare);
    const branchSeen: Record<string, boolean> = {};

    for (const region of regions) {
      for (const orientation of orientations) {
        if (orientation.w > region.w || orientation.h > region.h) continue;

        const directions = [
          { name: 'horizontal' as const, parts: splitRegion(region, orientation.w, orientation.h, gap, 'horizontal') },
          { name: 'vertical' as const, parts: splitRegion(region, orientation.w, orientation.h, gap, 'vertical') },
        ];
        directions.sort((a, b) => {
          if (a.parts.length !== b.parts.length) return a.parts.length - b.parts.length;
          return a.name.localeCompare(b.name);
        });

        for (const dir of directions) {
          const nextFree = free.slice();
          const freeIndex = nextFree.indexOf(region);
          if (freeIndex < 0) continue;
          nextFree.splice(freeIndex, 1);
          for (const part of dir.parts) nextFree.push(part);
          const normalized = normalizeFree(nextFree);

          const branchKey =
            freeSignature(normalized) + '|' + [region.x, region.y, orientation.w, orientation.h, dir.name].join(',');
          if (branchSeen[branchKey]) continue;
          branchSeen[branchKey] = true;

          const nextPlacements = placements.slice();
          nextPlacements.push({
            x: region.x,
            y: region.y,
            w: orientation.w,
            h: orientation.h,
            sourceW: item.sourceW,
            sourceH: item.sourceH,
            formatId: itemFormatId(item),
            rotated: orientation.rotated,
          });

          search(index + 1, normalized, nextPlacements, skipped, usedArea + item.w * item.h, cuts + dir.parts.length);
        }
      }
    }

    if (level < 3) {
      const nextSkipped = skipped.slice();
      nextSkipped.push(item);
      search(index + 1, free, placements, nextSkipped, usedArea, cuts);
    }
  };

  search(0, normalizeFree([{ x: 0, y: 0, w: cW, h: cH }]), [], [], 0, 0);

  const result: SolverResult = best || {
    placements: [],
    usedArea: 0,
    cuts: 0,
    waste: 100,
    balance: balanceProfile([], formatIds),
    preference: layoutPreference([], gap),
    signature: '',
    gap,
    truncated: false,
    nodes: 0,
  };

  if (!result.balance) result.balance = balanceProfile(result.placements, formatIds);
  if (!result.preference) result.preference = layoutPreference(result.placements, gap);
  result.truncated = truncated;
  result.nodes = nodes;
  result.usedArea = result.usedArea || 0;
  result.waste = Math.round(((sourceArea - result.usedArea) / sourceArea) * 1000) / 10;
  return result;
}

function toProResult(
  items: PackItem[],
  result: SolverResult,
  formats: ProFormat[],
  sourceArea: number,
): ProResult {
  const counts = balanceProfile(result.placements, formats.map((f) => f.id)).counts;
  return {
    placements: result.placements,
    counts,
    usedArea: result.usedArea,
    waste: Math.round(((sourceArea - result.usedArea) / sourceArea) * 1000) / 10,
    cuts: result.cuts,
    truncated: result.truncated,
    nodes: result.nodes,
    sourceArea,
    requested: items.length,
    perFormat: formats.map((f) => ({
      formatId: f.id,
      label: f.label || `${f.w}×${f.h}`,
      w: f.w,
      h: f.h,
      count: counts[f.id] || 0,
    })),
  };
}

/** Кэш решателя: одинаковые наборы считаются один раз. */
const solveCache = new Map<string, SolverResult>();

function solveCached(
  cW: number,
  cH: number,
  items: PackItem[],
  gap: number,
  level: number,
): SolverResult {
  const key =
    `${cW}x${cH}|${gap}|${level}|` +
    items
      .map((i) => `${i.formatId}:${i.w}x${i.h}:${i.rotate ? 1 : 0}`)
      .sort()
      .join(',');
  const hit = solveCache.get(key);
  if (hit) return hit;
  const result = solveProLayout(cW, cH, items, gap, level);
  // Кэш ограничен по размеру: раскроев за смену много, память не бесконечна.
  if (solveCache.size > 300) solveCache.clear();
  solveCache.set(key, result);
  return result;
}

function buildEqualItems(formats: ProFormat[], count: number): PackItem[] {
  const items: PackItem[] = [];
  for (const f of formats) {
    for (let i = 0; i < count; i++) {
      items.push({
        w: f.w,
        h: f.h,
        sourceW: f.w,
        sourceH: f.h,
        rotate: f.rotate,
        formatId: f.id,
        copyIndex: i + 1,
      });
    }
  }
  return items;
}

/**
 * ПРО режим: подобрать, сколько изделий каждого формата положить на лист.
 * Логика оригинала: идём от максимума «поровну» вниз, добиваем свободное место
 * экстра-копиями, затем выбираем план по числу резов и группировке.
 */
export function computeProLayout(
  cW: number,
  cH: number,
  formats: ProFormat[],
  gap = 0,
): ProResult {
  const active = formats.filter((f) => f.w > 0 && f.h > 0);
  if (!active.length || cW <= 0 || cH <= 0) return EMPTY_RESULT();

  const normalized = active.map((f) => {
    let w = proInteger(f.w);
    let h = proInteger(f.h);
    if (f.rotate && w > h) [w, h] = [h, w];
    return { ...f, w, h };
  });

  // Лист можно транспонировать, только если все форматы разрешают поворот.
  const canTranspose = normalized.length > 0 && normalized.every((f) => f.rotate);
  const transpose = canTranspose && cW > cH;
  const workW = transpose ? cH : cW;
  const workH = transpose ? cW : cH;
  const sourceArea = workW * workH;

  const transposeResult = (res: ProResult): ProResult => {
    if (!transpose) return res;
    const mapped: ProResult = {
      ...res,
      placements: res.placements.map((t) => ({ ...t, x: t.y, y: t.x, w: t.h, h: t.w })),
    };
    return mapped;
  };

  let maxEqual = Infinity;
  let totalFormatArea = 0;
  for (const f of normalized) {
    maxEqual = Math.min(maxEqual, Math.floor(sourceArea / (f.w * f.h)));
    totalFormatArea += f.w * f.h;
  }
  maxEqual = Math.min(maxEqual === Infinity ? 0 : maxEqual, 50);

  const finish = (items: PackItem[], stages: ProStage[]): ProResult => {
    const mapped = stages.map((s) => ({ label: s.label, result: transposeResult(s.result) }));
    const last = mapped[mapped.length - 1].result;
    return { ...last, stages: mapped };
  };

  for (let count = maxEqual; count >= 1; count--) {
    const baseArea = count * totalFormatArea;
    if (baseArea > sourceArea) continue;

    const equalItems = buildEqualItems(normalized, count);
    const equalStage = solveCached(workW, workH, equalItems, gap, 1);
    const equalCounts = equalStage.balance.values;
    const fitsAll =
      equalCounts.length === normalized.length && equalCounts.every((value) => value >= count);
    if (!fitsAll) continue;

    const remainingArea = sourceArea - baseArea;
    const plans: Array<{ extras: number[]; area: number }> = [];

    const collectPlans = (index: number, leftArea: number, extras: number[], extraArea: number) => {
      if (index >= normalized.length) {
        plans.push({ extras: extras.slice(), area: extraArea });
        return;
      }
      const formatArea = normalized[index].w * normalized[index].h;
      const maxExtra = Math.min(50 - count, Math.floor(leftArea / formatArea));
      for (let extra = maxExtra; extra >= 0; extra--) {
        extras.push(extra);
        collectPlans(index + 1, leftArea - extra * formatArea, extras, extraArea + extra * formatArea);
        extras.pop();
      }
    };
    collectPlans(0, remainingArea, [], 0);

    plans.sort((a, b) => {
      if (b.area !== a.area) return b.area - a.area;
      for (let i = 0; i < a.extras.length; i++) if (a.extras[i] !== b.extras[i]) return b.extras[i] - a.extras[i];
      return 0;
    });

    let maxFeasibleArea = -1;
    const feasiblePlans: Array<{ plan: { extras: number[]; area: number }; items: PackItem[] }> = [
      { plan: { extras: normalized.map(() => 0), area: 0 }, items: equalItems },
    ];

    for (const plan of plans) {
      if (plan.extras.every((extra) => extra === 0)) continue;
      if (maxFeasibleArea >= 0 && plan.area < maxFeasibleArea) break;

      const planItems: PackItem[] = [];
      normalized.forEach((f, fi) => {
        const copies = count + plan.extras[fi];
        for (let copy = 0; copy < copies; copy++) {
          planItems.push({
            w: f.w,
            h: f.h,
            sourceW: f.w,
            sourceH: f.h,
            rotate: f.rotate,
            formatId: f.id,
            copyIndex: copy + 1,
          });
        }
      });

      const candidate = solveCached(workW, workH, planItems, gap, 1);
      if (candidate.placements.length === planItems.length) {
        if (maxFeasibleArea < 0) maxFeasibleArea = plan.area;
        if (plan.area === maxFeasibleArea) feasiblePlans.push({ plan, items: planItems });
      }
    }

    const evaluated = feasiblePlans.map((feasible) => ({
      items: feasible.items,
      stage2: solveCached(workW, workH, feasible.items, gap, 2),
      stage4: solveCached(workW, workH, feasible.items, gap, 4),
    }));

    const densityWaste = Math.min(...evaluated.map((c) => c.stage4.waste));
    const SIMPLE_CUT_WASTE_TOLERANCE = 5;

    let selected: (typeof evaluated)[number] | null = null;
    for (const candidate of evaluated) {
      if (candidate.stage4.waste > densityWaste + SIMPLE_CUT_WASTE_TOLERANCE) continue;
      if (!selected || planIsBetter(candidate.stage4, selected.stage4)) selected = candidate;
    }
    if (!selected) selected = evaluated[0];

    const stages: ProStage[] = [
      { label: 'Равные количества форматов', result: toProResult(equalItems, equalStage, normalized, sourceArea) },
      { label: 'Минимум свободного места', result: toProResult(selected.items, selected.stage2, normalized, sourceArea) },
      { label: 'Минимум резов', result: toProResult(selected.items, selected.stage4, normalized, sourceArea) },
      { label: 'Группировка одинаковых форматов', result: toProResult(selected.items, selected.stage4, normalized, sourceArea) },
    ];
    return finish(selected.items, stages);
  }

  // Фолбэк: каждому формату максимум по площади.
  const fallbackItems: PackItem[] = [];
  for (const f of normalized) {
    const areaLimit = Math.floor(sourceArea / (f.w * f.h));
    const normalLimit = Math.floor(workW / f.w) * Math.floor(workH / f.h);
    const rotatedLimit = f.rotate ? Math.floor(workW / f.h) * Math.floor(workH / f.w) : 0;
    const copies = Math.min(50, Math.max(1, areaLimit, normalLimit, rotatedLimit));
    for (let i = 0; i < copies; i++) {
      fallbackItems.push({
        w: f.w,
        h: f.h,
        sourceW: f.w,
        sourceH: f.h,
        rotate: f.rotate,
        formatId: f.id,
        copyIndex: i + 1,
      });
    }
  }

  const s1 = solveCached(workW, workH, fallbackItems, gap, 1);
  const s2 = solveCached(workW, workH, fallbackItems, gap, 2);
  const s4 = solveCached(workW, workH, fallbackItems, gap, 4);

  return finish(fallbackItems, [
    { label: 'Равные количества форматов', result: toProResult(fallbackItems, s1, normalized, sourceArea) },
    { label: 'Минимум свободного места', result: toProResult(fallbackItems, s2, normalized, sourceArea) },
    { label: 'Минимум резов', result: toProResult(fallbackItems, s4, normalized, sourceArea) },
    { label: 'Группировка одинаковых форматов', result: toProResult(fallbackItems, s4, normalized, sourceArea) },
  ]);
}

function planIsBetter(candidate: SolverResult, best: SolverResult): boolean {
  if (candidate.cuts !== best.cuts) return candidate.cuts < best.cuts;
  const grouping = compareGrouping(candidate.preference, best.preference);
  if (grouping !== 0) return grouping > 0;
  const spreadA = balanceSpread(candidate.balance);
  const spreadB = balanceSpread(best.balance);
  if (spreadA !== spreadB) return spreadA < spreadB;
  if (candidate.usedArea !== best.usedArea) return candidate.usedArea > best.usedArea;
  if (candidate.placements.length !== best.placements.length) {
    return candidate.placements.length < best.placements.length;
  }
  if (!candidate.signature) candidate.signature = layoutSignature(candidate.placements);
  if (!best.signature) best.signature = layoutSignature(best.placements);
  return String(candidate.signature) < String(best.signature);
}

function balanceSpread(balance: { values: number[] }): number {
  if (!balance.values.length) return 0;
  return balance.values[balance.values.length - 1] - balance.values[0];
}
