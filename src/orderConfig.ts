// ─────────────────────────────────────────────────────────────────────────────
// Общая конфигурация заявок: печатники, статусы производства, цвета.
// Вынесено из App.tsx в отдельный модуль, чтобы Канбан-доска брала те же
// настройки без циклического импорта (App → KanbanBoard → App).
// ─────────────────────────────────────────────────────────────────────────────

export interface Order {
  rowNumber: number;
  orderNumber: string;
  client: string;
  created: string;
  deadline: string;
  tz: string;
  paperQuantity: string;
  paperType: string;
  colorMode: string;
  note: string;
  printer: string;
  manager: string;
  completed: boolean;
  /** Статус производства: «Монтаж», «Печать», «Сборка», «Согласование», «Подряд», «Пока стоп» */
  status?: string;
  sheetId?: number;
}

export const PRINTERS_CONFIG: Record<string, { label: string; color: string; badgeClass: string }> = {
  в: { label: 'Валера', color: '#c27ba0', badgeClass: 'badge-valera' },
  к: { label: 'Андрей', color: '#00ffff', badgeClass: 'badge-andrey' },
  m: { label: 'Коля', color: '#4a86e8', badgeClass: 'badge-kolya' },
};

export interface OrderStatusConfig {
  /** Значение, которое уходит в лист статусов */
  id: string;
  label: string;
  /** Насыщенный цвет статуса — подкраска первых ячеек строки и колонки доски */
  color: string;
  badgeClass: string;
}

/** Статусы производства: порядок = порядок в выпадающем списке, на доске и при сортировке.
 *  Последовательность производственная: монтаж → печать → сборка → согласование → подряд,
 *  «Пока стоп» — последним, как исключение из потока. */
export const ORDER_STATUSES: OrderStatusConfig[] = [
  { id: 'Монтаж', label: 'Монтаж', color: '#22c55e', badgeClass: 'status-montazh' },
  { id: 'Печать', label: 'Печать', color: '#3b82f6', badgeClass: 'status-pechat' },
  { id: 'Сборка', label: 'Сборка', color: '#8b5cf6', badgeClass: 'status-sborka' },
  { id: 'Согласование', label: 'Согласование', color: '#eab308', badgeClass: 'status-soglasovanie' },
  { id: 'Подряд', label: 'Подряд', color: '#f97316', badgeClass: 'status-podryad' },
  { id: 'Пока стоп', label: 'Пока стоп', color: '#ef4444', badgeClass: 'status-stop' },
];

export const STATUS_BY_ID: Record<string, OrderStatusConfig> = ORDER_STATUSES.reduce(
  (acc, item) => {
    acc[item.id] = item;
    return acc;
  },
  {} as Record<string, OrderStatusConfig>,
);

export const STATUS_SORT_INDEX = new Map(ORDER_STATUSES.map((item, index) => [item.id, index]));

/** Колонка «Без статуса» на доске: заявки, которым статус ещё не назначен. */
export const NO_STATUS_COLOR = '#94a3b8';

/** #rrggbb → rgba(r, g, b, alpha) — для мягкой подкраски строк и колонок. */
export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Срок сдачи из ячейки таблицы → timestamp. NaN, если даты нет.
 *
 * ВАЖНО: реальный формат ячеек — «12.01.26\n15.00»: год ДВУЗНАЧНЫЙ, а время
 * отделено переводом строки и пишется через точку. Старый regex ждал
 * `\d{4}` и `[ \t]+`, поэтому не парсил почти ни одну живую дату — сортировка
 * по сроку молча не работала, а карточки на доске шли «вразнобой».
 *
 * Допускаем: DD.MM.YYYY и DD.MM.YY, время через пробел/табуляцию/перевод
 * строки, разделитель времени «:» или «.», час из одной цифры («8.06»).
 * Берём ПЕРВУЮ дату в ячейке: в дедлайнах бывает несколько вех
 * («06.01.2026 образец / 23.01.26 готовность / 05.02.26»).
 */
const DEADLINE_RE = /(\d{1,2})\.(\d{1,2})\.(\d{2,4})(?:[ \t\n]*(\d{1,2})[:.](\d{2}))?/;

export function parseDeadlineMs(value: string): number {
  const m = String(value || '').match(DEADLINE_RE);
  if (!m) return Number.NaN;
  let year = Number(m[3]);
  if (m[3].length === 2) year += 2000;
  const day = Number(m[1]);
  const month = Number(m[2]) - 1;
  const hour = Number(m[4] || 0);
  const minute = Number(m[5] || 0);
  if (month < 0 || month > 11 || day < 1 || day > 31) return Number.NaN;
  return new Date(year, month, day, hour, minute).getTime();
}

export type DeadlineState = 'none' | 'future' | 'today' | 'overdue';

/** Состояние срока: сегодня / просрочено / впереди / нет даты. */
export function getDeadlineState(deadline: string): DeadlineState {
  const ms = parseDeadlineMs(deadline);
  if (Number.isNaN(ms)) return 'none';
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const todayEnd = todayStart + 24 * 60 * 60 * 1000 - 1;
  if (ms >= todayStart && ms <= todayEnd) return 'today';
  if (ms < todayStart) return 'overdue';
  return 'future';
}
