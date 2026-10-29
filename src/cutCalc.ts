// src/cutCalc.ts
// Раскрой печатного листа: сколько изделий заданных форматов влезает на лист
// и сколько листов нужно на тираж.
//
// ЧЕМ ОТЛИЧАЕТСЯ ОТ paper-calc (andreykalenik) — там были ошибки:
//  1. Зазор между изделиями был жёстко зашит нулём, поэтому на SRA3 «влезало»
//     30 визиток 50×90 вместо реальных 24: без припуска на рез лист не разрежешь.
//  2. Листы считались как ceil(общий тираж / минимум на лист). Для «3 вида по
//     100» это давало ceil(300/10) = 30 листов вместо 10. Правильно — по каждому
//     виду отдельно: max(ceil(qty_i / count_i)).
//  3. Перебор раскладки (DFS с лимитом узлов) упирался в лимит и молча отдавал
//     первую найденную, не лучшую раскладку — «странно считает».
//
// Здесь модель гильотинного реза: лист делится вертикальными резами на колонки,
// внутри колонки — горизонтальными. Такой раскрой резчик может повторить ножом.

export interface SheetSpec {
  /** Ширина листа, мм */
  w: number;
  /** Высота листа, мм */
  h: number;
  /** Зазор между изделиями (припуск на рез), мм */
  gap: number;
  /** Поле по краю листа (клапан / непечатаемая зона), мм */
  margin: number;
}

export interface CutFormat {
  id: string;
  /** Подпись вида: «Визитки», «Вид 2» */
  label: string;
  w: number;
  h: number;
  /** Тираж этого вида, шт */
  qty: number;
  /** Можно ли поворачивать изделие на 90° */
  rotate: boolean;
}

export interface Placement {
  x: number;
  y: number;
  w: number;
  h: number;
  formatId: string;
  /** Изделие повёрнуто относительно исходного формата */
  rotated: boolean;
}

export interface SheetLayout {
  placements: Placement[];
  /** Сколько изделий каждого вида на листе */
  counts: Record<string, number>;
  /** Площадь под изделиями, мм² */
  usedArea: number;
  /** Отход, % от полезной площади листа */
  wastePct: number;
}

export interface CutPlan {
  layout: SheetLayout;
  /** Сколько листов нужно на весь тираж */
  sheets: number;
  /** По скольку листов нужно на каждый вид (для контроля) */
  sheetsByFormat: Record<string, number>;
  /** Вид, который задаёт число листов (у него больше всего листов) */
  limitingFormatId: string;
  /** Ошибки: вид не влезает на лист и т.п. */
  problems: string[];
}

const EPS = 1e-6;

/** Популярные форматы листа. SRA3 первым — на нём печатается основная масса. */
export const SHEET_PRESETS: Array<{ id: string; label: string; w: number; h: number }> = [
  { id: 'sra3', label: 'SRA3 320×450', w: 320, h: 450 },
  { id: '325x470', label: '325×470', w: 325, h: 470 },
  { id: 'sra3plus', label: 'SRA3+ 330×488', w: 330, h: 488 },
  { id: 'a3plus', label: 'A3+ 329×483', w: 329, h: 483 },
  { id: 'a3', label: 'A3 297×420', w: 297, h: 420 },
  { id: 'a4', label: 'A4 210×297', w: 210, h: 297 },
  { id: 'b3', label: 'B3 353×500', w: 353, h: 500 },
  { id: '72x104', label: '72×104', w: 720, h: 1040 },
  { id: '70x100', label: '70×100', w: 700, h: 1000 },
  { id: '64x90', label: '64×90', w: 640, h: 900 },
  { id: '84x119', label: '84×119', w: 840, h: 1190 },
];

interface PackItem {
  formatId: string;
  w: number;
  h: number;
  rotated: boolean;
}

interface Column {
  x: number;
  w: number;
  y: number;
}

/**
 * Укладка колонками (гильотинный рез).
 * Возвращает null, если хотя бы одно изделие не влезло.
 */
function packColumns(
  areaW: number,
  areaH: number,
  items: PackItem[],
  gap: number,
): Placement[] | null {
  // Высокие изделия первыми — так колонки получаются ровными,
  // а низкие дозаполняют остаток сверху вниз.
  const sorted = [...items].sort((a, b) => b.h - a.h || b.w - a.w);

  const cols: Column[] = [];
  const out: Placement[] = [];
  let nextX = 0;

  for (const item of sorted) {
    let target: Column | null = null;
    let bestScore = Infinity;

    for (const col of cols) {
      if (item.w > col.w + EPS) continue;
      if (col.y + item.h > areaH + EPS) continue;
      // Приоритет — колонка с точно такой же шириной, иначе минимальный обрезок.
      const score = (col.w - item.w) * 10000 + col.y;
      if (score < bestScore) {
        bestScore = score;
        target = col;
      }
    }

    if (!target) {
      if (nextX + item.w > areaW + EPS) return null;
      target = { x: nextX, w: item.w, y: 0 };
      cols.push(target);
      nextX += item.w + gap;
    }

    out.push({
      x: target.x,
      y: target.y,
      w: item.w,
      h: item.h,
      formatId: item.formatId,
      rotated: item.rotated,
    });
    target.y += item.h + gap;
  }

  return out;
}

function countByFormat(placements: Placement[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const p of placements) counts[p.formatId] = (counts[p.formatId] || 0) + 1;
  return counts;
}

function makeLayout(
  placements: Placement[],
  areaW: number,
  areaH: number,
  offset: number,
): SheetLayout {
  const shifted = placements.map((p) => ({ ...p, x: p.x + offset, y: p.y + offset }));
  const usedArea = shifted.reduce((sum, p) => sum + p.w * p.h, 0);
  const totalArea = areaW * areaH;
  return {
    placements: shifted,
    counts: countByFormat(shifted),
    usedArea,
    wastePct: totalArea > 0 ? Math.round(((totalArea - usedArea) / totalArea) * 1000) / 10 : 0,
  };
}

/** Ориентации изделия: исходная и (если разрешено) повёрнутая. */
function orientationsOf(fmt: CutFormat): Array<{ w: number; h: number; rotated: boolean }> {
  const list = [{ w: fmt.w, h: fmt.h, rotated: false }];
  if (fmt.rotate && fmt.w !== fmt.h) list.push({ w: fmt.h, h: fmt.w, rotated: true });
  return list;
}

/**
 * Максимум изделий одного формата на листе (при лучшей ориентации).
 */
export function maxPerSheet(sheet: SheetSpec, fmt: CutFormat): number {
  const areaW = sheet.w - 2 * sheet.margin;
  const areaH = sheet.h - 2 * sheet.margin;
  if (areaW <= 0 || areaH <= 0 || fmt.w <= 0 || fmt.h <= 0) return 0;

  let best = 0;
  for (const o of orientationsOf(fmt)) {
    const cols = Math.floor((areaW + sheet.gap) / (o.w + sheet.gap));
    const rows = Math.floor((areaH + sheet.gap) / (o.h + sheet.gap));
    best = Math.max(best, Math.max(0, cols) * Math.max(0, rows));
  }
  return best;
}

/** Раскладка заданного количества изделий каждого вида. */
function layoutForCounts(
  sheet: SheetSpec,
  formats: CutFormat[],
  counts: number[],
): SheetLayout | null {
  const areaW = sheet.w - 2 * sheet.margin;
  const areaH = sheet.h - 2 * sheet.margin;
  if (areaW <= 0 || areaH <= 0) return null;

  // Перебираем ориентации каждого вида. До 4 видов — полный перебор (≤16),
  // больше — по лучшей одиночной ориентации (иначе 2^n взрывается).
  const orientationSets: Array<Array<{ w: number; h: number; rotated: boolean }>> = [];
  if (formats.length <= 4) {
    const total = 1 << formats.length;
    for (let mask = 0; mask < total; mask++) {
      orientationSets.push(
        formats.map((f, i) => {
          const list = orientationsOf(f);
          const wantRotated = (mask & (1 << i)) !== 0;
          return list.find((o) => o.rotated === wantRotated) || list[0];
        }),
      );
    }
  } else {
    orientationSets.push(
      formats.map((f) => {
        const list = orientationsOf(f);
        if (list.length === 1) return list[0];
        const fitsA = list[0].w <= areaW && list[0].h <= areaH;
        const fitsB = list[1].w <= areaW && list[1].h <= areaH;
        if (fitsA && !fitsB) return list[0];
        if (fitsB && !fitsA) return list[1];
        // Обе влезают — берём ту, что даёт больше по сетке.
        const a = Math.floor(areaW / list[0].w) * Math.floor(areaH / list[0].h);
        const b = Math.floor(areaW / list[1].w) * Math.floor(areaH / list[1].h);
        return b > a ? list[1] : list[0];
      }),
    );
  }

  let best: SheetLayout | null = null;
  for (const set of orientationSets) {
    const items: PackItem[] = [];
    formats.forEach((f, i) => {
      const o = set[i];
      for (let k = 0; k < counts[i]; k++) {
        items.push({ formatId: f.id, w: o.w, h: o.h, rotated: o.rotated });
      }
    });
    if (!items.length) continue;

    const placements = packColumns(areaW, areaH, items, sheet.gap);
    if (!placements || placements.length !== items.length) continue;

    const layout = makeLayout(placements, areaW, areaH, sheet.margin);
    if (!best || layout.usedArea > best.usedArea) best = layout;
  }

  return best;
}

/** Сколько листов нужно, если на листе counts_i изделий каждого вида. */
function sheetsFor(counts: Record<string, number>, formats: CutFormat[]): {
  sheets: number;
  byFormat: Record<string, number>;
  limiting: string;
} {
  let sheets = 0;
  let limiting = '';
  const byFormat: Record<string, number> = {};

  for (const f of formats) {
    if (f.qty <= 0) continue;
    const per = counts[f.id] || 0;
    // Вид с нулём на листе не напечатать вовсе — считаем как «не влезает».
    const need = per > 0 ? Math.ceil(f.qty / per) : Infinity;
    byFormat[f.id] = per > 0 ? need : 0;
    if (need > sheets) {
      sheets = need;
      limiting = f.id;
    }
  }

  return { sheets: Number.isFinite(sheets) ? sheets : 0, byFormat, limiting };
}

/**
 * Главный расчёт: раскладка + количество листов на тираж.
 *
 * Количество листов считается ПО КАЖДОМУ ВИДУ (max ceil(qty/count)),
 * а не делением общего тиража: «3 вида по 100» — это 100 каждого, а не 300
 * одного, иначе листов выходит втрое больше, чем нужно.
 */
export function computeCut(sheet: SheetSpec, formats: CutFormat[]): CutPlan {
  const problems: string[] = [];
  const active = formats.filter((f) => f.w > 0 && f.h > 0);

  const emptyPlan: CutPlan = {
    layout: { placements: [], counts: {}, usedArea: 0, wastePct: 0 },
    sheets: 0,
    sheetsByFormat: {},
    limitingFormatId: '',
    problems,
  };

  if (!active.length) {
    problems.push('Укажите размер изделия — ширину и высоту в мм');
    return emptyPlan;
  }
  // Вид без размера в расчёт не идёт — но и молчать о нём нельзя.
  for (const f of formats) {
    if (f.w <= 0 || f.h <= 0) problems.push(`«${f.label}»: не указан размер`);
  }
  if (sheet.w - 2 * sheet.margin <= 0 || sheet.h - 2 * sheet.margin <= 0) {
    problems.push('Поля съедают весь лист — уменьшите поле по краю');
    return emptyPlan;
  }

  // Виды, которые физически не влезают на лист, из раскладки исключаем.
  const usable = active.filter((f) => maxPerSheet(sheet, f) > 0);
  for (const f of active) {
    if (!usable.includes(f)) {
      problems.push(`«${f.label}» (${f.w}×${f.h}) не влезает на лист ${sheet.w}×${sheet.h}`);
    }
  }
  if (!usable.length) return emptyPlan;

  const maxAlone = usable.map((f) => maxPerSheet(sheet, f));
  const minMax = Math.min(...maxAlone);

  // ── Кандидаты раскладки ────────────────────────────────────────────────────
  const candidates: number[][] = [];
  const seen = new Set<string>();
  const push = (counts: number[]) => {
    const key = counts.join(',');
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(counts);
  };

  // A. Поровну каждому виду — то, как печатники и раскладывают: по столбцу на вид.
  const equalLimit = usable.length === 1 ? 1 : minMax;
  for (let k = equalLimit; k >= 1; k--) push(usable.map(() => k));

  // B. Пропорционально тиражу — когда тиражи видов сильно разные,
  //    «поровну» печатает лишнее, а листов столько же.
  const hasQty = usable.some((f) => f.qty > 0);
  if (hasQty) {
    const maxQty = Math.max(...usable.map((f) => f.qty));
    for (let k = minMax; k >= 1; k--) {
      const counts = usable.map((f, i) => {
        const share = maxQty > 0 ? Math.round((k * f.qty) / maxQty) : k;
        return Math.max(1, Math.min(maxAlone[i], share));
      });
      push(counts);
    }
  }

  // ── Выбор лучшего кандидата ───────────────────────────────────────────────
  let best: { layout: SheetLayout; sheets: number; byFormat: Record<string, number>; limiting: string } | null = null;

  for (const counts of candidates) {
    const layout = layoutForCounts(sheet, usable, counts);
    if (!layout) continue;

    const { sheets, byFormat, limiting } = sheetsFor(layout.counts, usable);

    const better =
      !best ||
      // Меньше листов — главный критерий.
      sheets < best.sheets ||
      // При равных листах — меньше отхода.
      (sheets === best.sheets && layout.wastePct < best.layout.wastePct) ||
      // И при прочих равных — больше изделий на листе (меньше приладок).
      (sheets === best.sheets &&
        layout.wastePct === best.layout.wastePct &&
        layout.placements.length > best.layout.placements.length);

    if (better) best = { layout, sheets, byFormat, limiting };
  }

  if (!best) {
    problems.push('Не удалось разложить изделия на листе — проверьте размеры и зазор');
    return { ...emptyPlan, problems };
  }

  return {
    layout: best.layout,
    sheets: best.sheets,
    sheetsByFormat: best.byFormat,
    limitingFormatId: best.limiting,
    problems,
  };
}

/** Сколько листов посчитал «Предрасчёт» — чтобы «Раскрой» взял это число. */
const PRECALC_KEY = (orderNumber: string) => `kabal-precalc-sheets-${orderNumber}`;

export function savePrecalcSheets(orderNumber: string, sheets: number): void {
  try {
    if (sheets > 0) localStorage.setItem(PRECALC_KEY(orderNumber), String(sheets));
    else localStorage.removeItem(PRECALC_KEY(orderNumber));
  } catch {
    /* приватный режим — не критично */
  }
}

export function readPrecalcSheets(orderNumber: string): number | null {
  try {
    const raw = localStorage.getItem(PRECALC_KEY(orderNumber));
    if (!raw) return null;
    const value = parseInt(raw, 10);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * Размер изделия из текста ТЗ: «90х50», «50×90 мм», «А5 148х210», «блокноты / A5».
 * Возвращает мм или null. Ищем только в первых строках — дальше идут примечания.
 */
export function guessFormatSizeFromTz(tz: string): { w: number; h: number } | null {
  const lines = String(tz || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 5);

  // Стандартные форматы: в живых ТЗ чаще пишут «A4», чем «210х297».
  const STANDARD: Record<string, { w: number; h: number }> = {
    A6: { w: 105, h: 148 },
    A5: { w: 148, h: 210 },
    A4: { w: 210, h: 297 },
    A3: { w: 297, h: 420 },
    A2: { w: 420, h: 594 },
    B6: { w: 125, h: 176 },
    B5: { w: 176, h: 250 },
    B4: { w: 250, h: 353 },
  };

  let standard: { w: number; h: number } | null = null;

  for (const line of lines) {
    // Путь к папке и ссылки не разбираем.
    if (/^(?:[A-Za-z]:[\\/]|\\\\|https?:)/i.test(line)) continue;

    // Размер в мм: ровно ДВЕ стороны. Три стороны («300×300×150» — пакет) означают
    // объёмный предмет, плоский раскрой к нему не применим: строку пропускаем целиком.
    const threeDims = /(\d{2,4})\s*[хx×]\s*(\d{2,4})\s*[хx×]\s*(\d{2,4})/i.test(line);
    if (!threeDims) {
      const m = line.match(/(\d{2,4})\s*[хx×]\s*(\d{2,4})(?!\d)/i);
      if (m) {
        const a = parseInt(m[1], 10);
        const b = parseInt(m[2], 10);
        // Отсекаем «4х4» (цветность) и прочие не-размеры.
        if (a >= 20 && b >= 20 && a <= 1200 && b <= 1200) return { w: a, h: b };
      }
    }

    if (!standard) {
      // Кириллические А/В/С — обычные опечатки-гомоглифы в ТЗ.
      const normalized = line
        .toUpperCase()
        .replace(/А/g, 'A')
        .replace(/В/g, 'B')
        .replace(/С/g, 'C')
        .replace(/Е/g, 'E');
      const f = normalized.match(/(?<![A-Z0-9])([AB])([2-6])(?![0-9A-Z])/);
      if (f) {
        const key = f[1] + f[2];
        if (STANDARD[key]) standard = STANDARD[key];
      }
    }
  }

  return standard;
}
