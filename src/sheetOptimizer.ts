// src/sheetOptimizer.ts
// Подбор промежуточного печатного листа: какой лист вырезать из большого,
// чтобы на тираж ушло меньше бумаги.
//
// Задача цеха: большой лист (650×940 и др.) нельзя положить в машину целиком —
// максимальная ширина листа 330 мм. Его режут на промежуточные листы, и от того,
// как разрезать, зависит, сколько изделий выйдет с одного большого листа.
// Пример: 650×940 → 4 листа SRA3 320×450 по 24 визитки = 96 визиток,
// а 650×940 → 6 листов 325×313 по 27 визиток = 162 визитки с того же большого листа.
//
// Модель реза больших листов — гильотинная сетка: большой лист режется на полосы
// по ширине (не шире 330), полоса — на листы по длине. Полосы берём максимально
// широкие, поэтому остаток по ширине — один (в отход). Произвольную упаковку
// не считаем: такой раскрой резчик ножом не повторит.
//
// Ограничения машин (из цеха):
//   • ширина промежуточного листа ≤ 330 мм (maxWidth);
//   • длина листа ограничена машиной: Рико 9200 — 700 мм, КМ 6085 — 760 в дуплексе
//     и 1300 в симплексе, КМ 12000 — 900 в дуплексе и 1300 в симплексе (maxLength);
//   • при ламинации лист не уже 320 мм (minWidth) — иначе не пройдёт ламинатор.

import { computeCut, type CutFormat, type CutPlan, type SheetSpec } from './cutCalc.ts';

export interface BigSheet {
  id: string;
  label: string;
  /** Ширина большого листа, мм */
  w: number;
  /** Длина большого листа, мм */
  h: number;
}

/** Стандартные большие листы цеха (те же, что в «Раскрое»). */
export const BIG_SHEETS: BigSheet[] = [
  { id: '650x940', label: '650×940', w: 650, h: 940 },
  { id: '720x1040', label: '720×1040', w: 720, h: 1040 },
  { id: '700x1000', label: '700×1000', w: 700, h: 1000 },
  { id: '787x1092', label: '787×1092', w: 787, h: 1092 },
  { id: '470x650', label: '470×650', w: 470, h: 650 },
  { id: '325x470', label: '325×470', w: 325, h: 470 },
];

/**
 * Машины цеха: максимальная ширина листа и максимальная длина в дуплексе/симплексе.
 * Лимит длины — то, что машина реально протягивает по направлению подачи.
 */
export interface Machine {
  id: string;
  label: string;
  /** Макс. ширина листа, мм */
  maxWidth: number;
  /** Макс. длина листа в дуплексе, мм */
  duplexLength: number;
  /** Макс. длина листа в симплексе, мм */
  simplexLength: number;
}

export const MACHINES: Machine[] = [
  { id: 'ricoh9200', label: 'Рико 9200', maxWidth: 330, duplexLength: 700, simplexLength: 700 },
  { id: 'km6085', label: 'КМ 6085', maxWidth: 330, duplexLength: 760, simplexLength: 1300 },
  { id: 'km12000', label: 'КМ 12000', maxWidth: 330, duplexLength: 900, simplexLength: 1300 },
];

/** Лимит длины выбранной машины в выбранном режиме. */
export function machineMaxLength(machine: Machine, duplex: boolean): number {
  return duplex ? machine.duplexLength : machine.simplexLength;
}

export interface OptimizeOptions {
  /** Зазор на рез между изделиями, мм */
  gap: number;
  /** Поле по краю листа, мм */
  margin: number;
  /** Максимальная ширина листа, которую тянет машина (330) */
  maxWidth: number;
  /** Максимальная длина листа по машине и режиму печати, мм */
  maxLength: number;
  /** Минимальная ширина листа (ламинация — 320), мм */
  minWidth: number;
  /**
   * Сколько прогонов сейчас (листов на текущем листе). Вариант, который гонит
   * машину дольше, чем сейчас, не рекомендуем: экономия бумаги не стоит
   * вчетверо большего времени печати. 0 — не ограничивать.
   */
  maxPasses: number;
}

export interface SheetCandidate {
  /** Размер промежуточного листа, мм */
  w: number;
  h: number;
  /** Сколько полос по ширине большого листа */
  strips: number;
  /** Сколько листов в полосе по длине */
  rows: number;
  /** Сколько промежуточных листов выходит с одного большого */
  piecesPerBig: number;
  /** Раскладка изделий на этом листе */
  plan: CutPlan;
  /** Промежуточных листов на тираж */
  sheets: number;
  /** Больших листов на тираж (0 — тираж не задан) */
  bigSheets: number;
  /** Изделий с одного большого листа */
  productsPerBig: number;
  /** КПД: полезная площадь изделий / площадь больших листов, % */
  efficiency: number;
  /** Остаток полосы по ширине / по длине, мм */
  leftoverW: number;
  leftoverH: number;
  /** Вариант требует больше прогонов, чем текущий лист */
  overPasses: boolean;
}

export interface OptimizeResult {
  candidates: SheetCandidate[];
  best: SheetCandidate | null;
  problems: string[];
}

interface SizeGuess {
  w: number;
  h: number;
  strips: number;
  rows: number;
  /** Остаток большого листа при таком резе, мм */
  leftoverW: number;
  leftoverH: number;
}

/**
 * Кандидаты размеров промежуточного листа для одного положения большого листа.
 * Ширина полосы — min(maxWidth, floor(bigW / n)), длина листа — floor(bigH / m).
 * Лист длиннее машины (maxLength) не рассматривается вовсе: его не протянуть.
 */
function sizeCandidates(big: { w: number; h: number }, opts: OptimizeOptions, minSide: number): SizeGuess[] {
  const minW = Math.max(1, opts.minWidth, minSide);
  const maxW = Math.max(minW, opts.maxWidth);
  const maxH = Math.max(0, opts.maxLength);

  const widths: number[] = [];
  for (let n = 1; n <= 200; n++) {
    const w = Math.min(maxW, Math.floor(big.w / n));
    if (w < minW) break;
    if (!widths.includes(w)) widths.push(w);
  }

  const heights: number[] = [];
  for (let m = 1; m <= 400; m++) {
    const h = Math.floor(big.h / m);
    if (h < minSide) break;
    if (h > maxH) continue;
    if (!heights.includes(h)) heights.push(h);
  }

  const out: SizeGuess[] = [];
  for (const w of widths) {
    const strips = Math.max(1, Math.floor(big.w / w));
    for (const h of heights) {
      const rows = Math.max(1, Math.floor(big.h / h));
      out.push({ w, h, strips, rows, leftoverW: big.w - strips * w, leftoverH: big.h - rows * h });
    }
  }
  return out;
}

/** Сколько промежуточных листов w×h выходит из большого (лучшая ориентация). */
export function piecesFromBig(big: BigSheet, w: number, h: number): number {
  if (w <= 0 || h <= 0) return 0;
  const a = Math.floor(big.w / w) * Math.floor(big.h / h);
  const b = Math.floor(big.w / h) * Math.floor(big.h / w);
  return Math.max(0, a, b);
}

/**
 * Подбор лучшего промежуточного листа.
 *
 * Листы на тираж считаются ПО КАЖДОМУ ВИДУ (через computeCut), затем делятся на
 * число листов, выходящих с одного большого: bigSheets = ceil(sheets / piecesPerBig).
 *
 * Критерий выбора — как рассуждает печатник: бумаги меньше, но машину не гонять
 * дольше, чем сейчас. Поэтому сначала отсекаются варианты с бо́льшим числом прогонов
 * (maxPasses — прогоны текущего листа), внутри оставшихся — минимум больших листов,
 * затем меньше отхода и меньше полос.
 */
export function optimizeSheets(
  big: BigSheet,
  formats: CutFormat[],
  opts: OptimizeOptions,
): OptimizeResult {
  const problems: string[] = [];
  const active = formats.filter((f) => f.w > 0 && f.h > 0);
  if (!active.length) {
    return { candidates: [], best: null, problems: ['Укажите размер изделия — ширину и высоту в мм'] };
  }
  if (opts.maxWidth <= 0 || opts.minWidth > opts.maxWidth) {
    return { candidates: [], best: null, problems: ['Мин. ширина листа больше максимальной — проверьте поля'] };
  }
  if (opts.maxLength <= 0) {
    return { candidates: [], best: null, problems: ['Не задан лимит длины листа для машины'] };
  }

  const totalQty = formats.reduce((sum, f) => sum + Math.max(0, f.qty), 0);
  const minSide = Math.min(...active.map((f) => Math.min(f.w, f.h)));

  // Оба положения большого листа: полосы вдоль ширины и вдоль длины.
  const sizes = new Map<string, SizeGuess>();
  for (const orientation of [{ w: big.w, h: big.h }, { w: big.h, h: big.w }]) {
    for (const guess of sizeCandidates(orientation, opts, minSide)) {
      const key = `${guess.w}x${guess.h}`;
      const prev = sizes.get(key);
      // Одинаковый размер из двух положений — берём то, где больше листов.
      if (!prev || guess.strips * guess.rows > prev.strips * prev.rows) sizes.set(key, guess);
    }
  }

  const bigArea = big.w * big.h;
  const usefulArea = active.reduce((sum, f) => sum + Math.max(0, f.qty) * f.w * f.h, 0);
  const candidates: SheetCandidate[] = [];

  for (const guess of sizes.values()) {
    const sheet: SheetSpec = { w: guess.w, h: guess.h, gap: opts.gap, margin: opts.margin };
    const plan = computeCut(sheet, formats);
    if (!plan.layout.placements.length) continue;
    // Годен только лист, на который влезает КАЖДЫЙ вид: иначе заказ не напечатать.
    if (!active.every((f) => (plan.layout.counts[f.id] || 0) > 0)) continue;

    const piecesPerBig = Math.max(1, guess.strips * guess.rows);
    const bigSheets = totalQty > 0 ? Math.ceil(plan.sheets / piecesPerBig) : 0;
    const productsPerBig = plan.layout.placements.length * piecesPerBig;
    const overPasses = opts.maxPasses > 0 && plan.sheets > opts.maxPasses;
    const efficiency =
      totalQty > 0 && bigSheets > 0
        ? Math.round((usefulArea / (bigSheets * bigArea)) * 1000) / 10
        : Math.round((100 - plan.layout.wastePct) * 10) / 10;

    candidates.push({
      w: guess.w,
      h: guess.h,
      strips: guess.strips,
      rows: guess.rows,
      piecesPerBig,
      plan,
      sheets: plan.sheets,
      bigSheets,
      productsPerBig,
      efficiency,
      leftoverW: guess.leftoverW,
      leftoverH: guess.leftoverH,
      overPasses,
    });
  }

  if (!candidates.length) {
    problems.push(
      `Ни один лист не подошёл: при ширине ${opts.minWidth}–${opts.maxWidth} мм и длине ` +
        `до ${opts.maxLength} мм изделие ${active.map((f) => `${f.w}×${f.h}`).join(', ')} мм не влезает`,
    );
    return { candidates: [], best: null, problems };
  }

  candidates.sort((a, b) => {
    if (totalQty > 0) {
      // Сначала варианты, которые не гоняют машину дольше текущего листа,
      // и только внутри них — минимум бумаги.
      if (a.overPasses !== b.overPasses) return a.overPasses ? 1 : -1;
      if (a.bigSheets !== b.bigSheets) return a.bigSheets - b.bigSheets;
      if (Math.abs(a.efficiency - b.efficiency) > 0.05) return b.efficiency - a.efficiency;
      // Бумаги поровну — меньше прогонов: крупный лист вместо десятка полос.
      if (a.piecesPerBig !== b.piecesPerBig) return a.piecesPerBig - b.piecesPerBig;
      return b.productsPerBig - a.productsPerBig;
    }
    // Без тиража сравнивать нечего — показываем, где больше изделий с большого листа.
    if (a.productsPerBig !== b.productsPerBig) return b.productsPerBig - a.productsPerBig;
    if (a.piecesPerBig !== b.piecesPerBig) return a.piecesPerBig - b.piecesPerBig;
    return a.plan.layout.wastePct - b.plan.layout.wastePct;
  });

  return { candidates, best: candidates[0], problems };
}
