// ─────────────────────────────────────────────────────────────────────────────
// Вкладка «Календарь»: сетка месяца, в каждой клетке — заявки на этот день
// сдачи. Показывает ВСЕ заявки (фильтры таблицы на календарь не влияют):
// начальнику и печатникам нужна общая картина по трём печатникам сразу.
// Клик по дню открывает список карточек; клик по карточке — окно ТЗ.
// ─────────────────────────────────────────────────────────────────────────────
import React, { Fragment, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight, X } from 'lucide-react';
import {
  NO_STATUS_COLOR,
  ORDER_STATUSES,
  PRINTERS_CONFIG,
  type Order,
} from './orderConfig';
import type { ParsedTz } from './parseTz';
import {
  MONTHS_NOM,
  buildMonthMatrix,
  dayKeyOfDate,
  formatDayTitle,
  getOrdersWithoutDeadline,
  groupOrdersByDay,
  summarizeMonth,
  type DayGroup,
} from './calendarUtils';
import { OrderCard, OrderTzModal, orderCardKey } from './OrderCard';
import ModalShell from './Modal';

interface CalendarBoardProps {
  orders: Order[];
  parsedOrdersMap: Map<number, ParsedTz>;
  currentPrinter: string;
  onStatusChange: (order: Order, status: string) => void;
  onClaim: (order: Order, e: React.MouseEvent) => void;
  onUnclaim: (order: Order, e: React.MouseEvent) => void;
  onComplete: (order: Order, e: React.MouseEvent) => void;
  onOpenFolder: (path: string, e: React.MouseEvent) => void;
  onPrint: (order: Order, e: React.MouseEvent) => void;
}

/** Окно дня: конкретная дата («2026-10-17») или полка «Без срока». */
type DayModalKey = string | 'no-deadline';

/** Просмотренный месяц запоминается: возврат на вкладку не сбрасывает его на текущий. */
const MONTH_STORAGE_KEY = 'kabal-calendar-month';

function readStoredMonth(): Date {
  try {
    const saved = localStorage.getItem(MONTH_STORAGE_KEY);
    const match = saved ? /^(\d{4})-(\d{1,2})$/.exec(saved) : null;
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]) - 1;
      if (month >= 0 && month <= 11) return new Date(year, month, 1);
    }
  } catch {}
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/** Полоска статусов: активные заявки дня по стадиям производства. */
function stripeSegments(group: DayGroup): Array<{ key: string; color: string; percent: number }> {
  const total = group.active || 1;
  const segments: Array<{ key: string; color: string; percent: number }> = [];
  for (const status of ORDER_STATUSES) {
    const count = group.statusCounts[status.id] || 0;
    if (count) segments.push({ key: status.id, color: status.color, percent: (count / total) * 100 });
  }
  const noStatus = group.statusCounts[''] || 0;
  if (noStatus) segments.push({ key: '__none', color: NO_STATUS_COLOR, percent: (noStatus / total) * 100 });
  return segments;
}

function stripeTitle(group: DayGroup): string {
  const parts: string[] = [];
  for (const status of ORDER_STATUSES) {
    const count = group.statusCounts[status.id] || 0;
    if (count) parts.push(`${status.label} ${count}`);
  }
  const noStatus = group.statusCounts[''] || 0;
  if (noStatus) parts.push(`Без статуса ${noStatus}`);
  return parts.join(' · ');
}

export default function CalendarBoard({
  orders,
  parsedOrdersMap,
  currentPrinter,
  onStatusChange,
  onClaim,
  onUnclaim,
  onComplete,
  onOpenFolder,
  onPrint,
}: CalendarBoardProps) {
  const [monthDate, setMonthDate] = useState<Date>(readStoredMonth);
  const [dayModal, setDayModal] = useState<DayModalKey | null>(null);
  const [openOrder, setOpenOrder] = useState<Order | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(
        MONTH_STORAGE_KEY,
        `${monthDate.getFullYear()}-${monthDate.getMonth() + 1}`,
      );
    } catch {}
  }, [monthDate]);

  const groups = useMemo(() => groupOrdersByDay(orders), [orders]);
  const matrix = useMemo(
    () => buildMonthMatrix(monthDate.getFullYear(), monthDate.getMonth()),
    [monthDate],
  );
  const summary = useMemo(() => summarizeMonth(matrix, groups), [matrix, groups]);
  const noDeadline = useMemo(() => getOrdersWithoutDeadline(orders), [orders]);

  const now = new Date();
  const todayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  // Открытая карточка должна оставаться актуальной после перечитывания таблицы
  useEffect(() => {
    if (!openOrder) return;
    const fresh = orders.find((o) => orderCardKey(o) === orderCardKey(openOrder));
    if (!fresh) {
      setOpenOrder(null);
      return;
    }
    if (fresh !== openOrder) setOpenOrder(fresh);
  }, [orders, openOrder]);

  // Esc: сначала закрываем окно ТЗ, затем — окно дня
  useEffect(() => {
    if (!openOrder && !dayModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (openOrder) {
        setOpenOrder(null);
        return;
      }
      setDayModal(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openOrder, dayModal]);

  const shiftMonth = (delta: number) => {
    setMonthDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  };

  const goToday = () => {
    const t = new Date();
    setMonthDate(new Date(t.getFullYear(), t.getMonth(), 1));
  };

  const dayModalOrders = useMemo(() => {
    if (!dayModal) return [];
    if (dayModal === 'no-deadline') return noDeadline;
    return groups.get(dayModal)?.orders || [];
  }, [dayModal, groups, noDeadline]);

  const dayModalDate = useMemo(() => {
    if (!dayModal || dayModal === 'no-deadline') return null;
    const [y, m, d] = dayModal.split('-').map(Number);
    return new Date(y, m - 1, d);
  }, [dayModal]);

  const activeList = dayModalOrders.filter((o) => !o.completed);
  const doneList = dayModalOrders.filter((o) => o.completed);
  const modalFree = activeList.filter((o) => !o.printer).length;

  const modalSub = dayModal === 'no-deadline'
    ? `Активных заявок без даты сдачи: ${dayModalOrders.length}`
    : [
        `Всего: ${dayModalOrders.length}`,
        modalFree > 0 ? `свободных: ${modalFree}` : '',
        doneList.length > 0 ? `сдано: ${doneList.length}` : '',
      ]
        .filter(Boolean)
        .join(' · ');

  const renderCell = (cell: { date: Date; inMonth: boolean }) => {
    const cellMs = cell.date.getTime();
    const isToday = cellMs === todayMs;
    const isPast = cellMs < todayMs;
    const group = cell.inMonth ? groups.get(dayKeyOfDate(cell.date)) : undefined;
    const has = Boolean(group && group.total > 0);

    return (
      <div
        key={cellMs}
        className={[
          'calendar-cell',
          cell.inMonth ? '' : 'outside',
          isToday ? 'today' : '',
          has ? 'has-orders' : '',
          has && isPast && group.active > 0 ? 'late' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={cell.inMonth && has ? () => setDayModal(dayKeyOfDate(cell.date)) : undefined}
      >
        <div className="calendar-cell-head">
          <span className="calendar-daynum">{cell.date.getDate()}</span>
        </div>

        {group && group.total > 0 && (
          <>
            <div className="calendar-cell-main">
              <span className="calendar-total">{group.total}</span>
              <span className="calendar-chips">
                {Object.entries(PRINTERS_CONFIG).map(([pkey, cfg]) => {
                  const count = group.byPrinter[pkey] || 0;
                  if (!count) return null;
                  return (
                    <span key={pkey} className="calendar-chip" title={`${cfg.label}: ${count}`}>
                      <i style={{ background: cfg.color }} />
                      {count}
                    </span>
                  );
                })}
              </span>
            </div>

            <div className="calendar-meta">
              {isPast
                ? group.active > 0 && <span className="calendar-late">не сдано {group.active}</span>
                : group.free > 0 && <span className="calendar-free">своб {group.free}</span>}
              {group.done > 0 && <span className="calendar-done">✓ {group.done}</span>}
            </div>

            {group.active > 0 && (
              <div className="calendar-stripe" title={stripeTitle(group)}>
                {stripeSegments(group).map((seg) => (
                  <i key={seg.key} style={{ width: `${seg.percent}%`, background: seg.color }} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="calendar-wrapper">
      <div className="calendar-toolbar">
        <div className="calendar-month-nav">
          <button className="calendar-nav-btn" onClick={() => shiftMonth(-1)} title="Предыдущий месяц">
            <ChevronLeft size={16} />
          </button>
          <span className="calendar-month-title">
            {MONTHS_NOM[monthDate.getMonth()]} {monthDate.getFullYear()}
          </span>
          <button className="calendar-nav-btn" onClick={() => shiftMonth(1)} title="Следующий месяц">
            <ChevronRight size={16} />
          </button>
          <button className="calendar-today-btn" onClick={goToday}>
            Сегодня
          </button>
        </div>

        <div className="calendar-legend">
          <span className="calendar-legend-label">Печатники:</span>
          {Object.entries(PRINTERS_CONFIG).map(([pkey, cfg]) => (
            <span key={pkey} className="calendar-legend-item">
              <i className="calendar-chip-dot" style={{ background: cfg.color }} />
              {cfg.label}
            </span>
          ))}
        </div>
      </div>

      <div className="calendar-summary">
        <span>
          В месяце: <strong>{summary.total}</strong>
        </span>
        <span>
          сдано: <strong>{summary.done}</strong>
        </span>
        <span>
          свободных: <strong>{summary.free}</strong>
        </span>
        {noDeadline.length > 0 && (
          <button
            className="calendar-nodeadline-btn"
            onClick={() => setDayModal('no-deadline')}
            title="Активные заявки без даты сдачи"
          >
            Без срока: {noDeadline.length}
          </button>
        )}
        <span className="calendar-summary-hint">Показаны все заявки — фильтры таблицы на календарь не влияют</span>
      </div>

      <div className="calendar-weekdays">
        {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>

      <div className="calendar-grid">{matrix.map(renderCell)}</div>

      {/* Окно дня: карточки заявок выбранной даты */}
      {dayModal && (
        <ModalShell className="calendar-day-modal">
            <div className="modal-header">
              <div>
                <h2>{dayModalDate ? formatDayTitle(dayModalDate) : 'Заявки без срока'}</h2>
                <p className="modal-sub">{modalSub}</p>
              </div>
              <button className="btn-modal-close" onClick={() => setDayModal(null)} title="Закрыть (Esc)">
                <X size={20} />
              </button>
            </div>

            <div className="modal-body">
              {activeList.length === 0 && doneList.length === 0 && (
                <div className="calendar-day-empty">На этот день заявок нет</div>
              )}

              {activeList.length > 0 && (
                <div className="calendar-day-grid">
                  {activeList.map((order) => (
                    <Fragment key={orderCardKey(order)}>
                      <OrderCard
                        order={order}
                        parsed={parsedOrdersMap.get(order.rowNumber)}
                        currentPrinter={currentPrinter}
                        statusWash
                        onOpen={(o) => setOpenOrder(o)}
                        onClaim={onClaim}
                        onComplete={onComplete}
                        onOpenFolder={onOpenFolder}
                        onPrint={onPrint}
                      />
                    </Fragment>
                  ))}
                </div>
              )}

              {doneList.length > 0 && (
                <>
                  <div className="calendar-day-section-title">Сдано: {doneList.length}</div>
                  <div className="calendar-day-grid">
                    {doneList.map((order) => (
                      <div
                        key={orderCardKey(order)}
                        className="calendar-done-row"
                        onClick={() => setOpenOrder(order)}
                        title="Открыть ТЗ"
                      >
                        <span className="calendar-done-check">
                          <CheckCircle2 size={14} />
                        </span>
                        <b>№ {order.orderNumber}</b>
                        <span className="calendar-done-client">{order.client || '—'}</span>
                        <span className="calendar-done-printer">
                          {PRINTERS_CONFIG[order.printer]?.label || ''}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="modal-footer">
              <span className="calendar-day-hint">Клик по карточке — ТЗ заявки</span>
              <button className="btn-secondary" onClick={() => setDayModal(null)}>
                Закрыть
              </button>
            </div>
        </ModalShell>
      )}

      {/* Окно ТЗ поверх списка дня */}
      {openOrder && (
        <OrderTzModal
          order={openOrder}
          parsed={parsedOrdersMap.get(openOrder.rowNumber)}
          currentPrinter={currentPrinter}
          onClose={() => setOpenOrder(null)}
          onStatusChange={onStatusChange}
          onClaim={onClaim}
          onUnclaim={onUnclaim}
          onComplete={onComplete}
          onOpenFolder={onOpenFolder}
          onPrint={onPrint}
        />
      )}
    </div>
  );
}
