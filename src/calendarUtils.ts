// ─────────────────────────────────────────────────────────────────────────────
// Логика вкладки «Календарь»: раскладка заявок по дням срока сдачи.
// Чистые функции без DOM и React — проверяются пробой (node + esbuild).
// Сроки разбирает ТОЛЬКО parseDeadlineMs из orderConfig: реальный формат
// ячейки — «12.01.26\n15.00», второй разборщик дат не заводить.
// ─────────────────────────────────────────────────────────────────────────────
import { parseDeadlineMs, type Order } from './orderConfig';

export const MONTHS_NOM = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

export const MONTHS_GEN = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

export interface DayGroup {
  /** Ключ «2026-10-17» (локальная дата) */
  key: string;
  /** Заявки дня, отсортированные по времени срока */
  orders: Order[];
  /** Всего заявок с этим сроком (включая сданные) */
  total: number;
  /** Уже сданы */
  done: number;
  /** Ещё не сданы */
  active: number;
  /** Свободные: активные и никем не взятые */
  free: number;
  /** Сколько закреплено за каждым печатником (ключи PRINTERS_CONFIG, включая сданные) */
  byPrinter: Record<string, number>;
  /** Активные по статусам производства: id → количество ('' — без статуса) */
  statusCounts: Record<string, number>;
}

export function dayKeyOfDate(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

export function dayKeyFromMs(ms: number): string {
  return dayKeyOfDate(new Date(ms));
}

export function formatDayTitle(date: Date): string {
  return `${date.getDate()} ${MONTHS_GEN[date.getMonth()]} ${date.getFullYear()}`;
}

/** Матрица месяца: 6 недель × 7 дней, неделя начинается с понедельника. */
export function buildMonthMatrix(year: number, month: number): Array<{ date: Date; inMonth: boolean }> {
  const first = new Date(year, month, 1);
  // getDay(): 0 — воскресенье; сдвиг до понедельника: пн = 0 … вс = 6
  const shift = (first.getDay() + 6) % 7;
  const cells: Array<{ date: Date; inMonth: boolean }> = [];
  for (let i = 0; i < 42; i += 1) {
    const date = new Date(year, month, 1 - shift + i);
    cells.push({ date, inMonth: date.getMonth() === month && date.getFullYear() === year });
  }
  return cells;
}

/** Разложить заявки по дням срока сдачи. Заявки с неразобранной датой пропускаются. */
export function groupOrdersByDay(orders: Order[]): Map<string, DayGroup> {
  const map = new Map<string, DayGroup>();
  for (const order of orders) {
    const ms = parseDeadlineMs(order.deadline);
    if (Number.isNaN(ms)) continue;
    const key = dayKeyFromMs(ms);
    let group = map.get(key);
    if (!group) {
      group = { key, orders: [], total: 0, done: 0, active: 0, free: 0, byPrinter: {}, statusCounts: {} };
      map.set(key, group);
    }
    group.orders.push(order);
    group.total += 1;
    if (order.completed) {
      group.done += 1;
    } else {
      group.active += 1;
      if (!order.printer) group.free += 1;
      const statusKey = order.status || '';
      group.statusCounts[statusKey] = (group.statusCounts[statusKey] || 0) + 1;
    }
    if (order.printer) {
      group.byPrinter[order.printer] = (group.byPrinter[order.printer] || 0) + 1;
    }
  }
  // Внутри дня — по времени срока, затем по номеру заявки
  for (const group of map.values()) {
    group.orders.sort((a, b) => {
      const da = parseDeadlineMs(a.deadline);
      const db = parseDeadlineMs(b.deadline);
      if (da !== db) return da - db;
      return (Number(a.orderNumber) || 0) - (Number(b.orderNumber) || 0);
    });
  }
  return map;
}

/** Активные заявки без разобранной даты сдачи — полка «Без срока». */
export function getOrdersWithoutDeadline(orders: Order[]): Order[] {
  return orders.filter((o) => {
    if (o.completed) return false;
    return Number.isNaN(parseDeadlineMs(o.deadline));
  });
}

/** Итоги месяца: считаем только ячейки самого месяца. */
export function summarizeMonth(
  cells: Array<{ date: Date; inMonth: boolean }>,
  groups: Map<string, DayGroup>,
): { total: number; done: number; active: number; free: number } {
  let total = 0;
  let done = 0;
  let active = 0;
  let free = 0;
  for (const cell of cells) {
    if (!cell.inMonth) continue;
    const group = groups.get(dayKeyOfDate(cell.date));
    if (!group) continue;
    total += group.total;
    done += group.done;
    active += group.active;
    free += group.free;
  }
  return { total, done, active, free };
}
