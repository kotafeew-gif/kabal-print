import React, { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  NO_STATUS_COLOR,
  ORDER_STATUSES,
  hexToRgba,
  parseDeadlineMs,
  getDeadlineState,
  type Order,
} from './orderConfig';
import type { ParsedTz } from './parseTz';
import { OrderCard, OrderTzModal, orderCardKey } from './OrderCard';

interface KanbanBoardProps {
  orders: Order[];
  parsedOrdersMap: Map<number, ParsedTz>;
  currentPrinter: string;
  onStatusChange: (order: Order, status: string) => void;
  onClaim: (order: Order, e: React.MouseEvent) => void;
  onUnclaim: (order: Order, e: React.MouseEvent) => void;
  onComplete: (order: Order, e: React.MouseEvent) => void;
  onOpenFolder: (path: string, e: React.MouseEvent) => void;
  onPrint: (order: Order, e: React.MouseEvent) => void;
  /** Опрос таблицы приостанавливается, пока карточку тащат */
  onDragStateChange?: (dragging: boolean) => void;
}

/** Сортировка карточек внутри колонки. Значение хранится в localStorage. */
type SortKey = 'deadline-asc' | 'deadline-desc' | 'number-asc' | 'number-desc' | 'client-asc' | 'manager-asc';

const SORT_OPTIONS: Array<{ id: SortKey; label: string }> = [
  { id: 'deadline-asc', label: 'Срок сдачи: ближайшие' },
  { id: 'deadline-desc', label: 'Срок сдачи: дальние' },
  { id: 'number-asc', label: '№ заявки: по возрастанию' },
  { id: 'number-desc', label: '№ заявки: по убыванию' },
  { id: 'client-asc', label: 'Заказчик: А–Я' },
  { id: 'manager-asc', label: 'Менеджер: А–Я' },
];

const SORT_STORAGE_KEY = 'kabal-kanban-sort';

/** Сортировка карточек в колонке. Заявки без срока всегда в конце. */
function compareOrders(a: Order, b: Order, sortKey: SortKey): number {
  if (sortKey === 'deadline-asc' || sortKey === 'deadline-desc') {
    const da = parseDeadlineMs(a.deadline);
    const db = parseDeadlineMs(b.deadline);
    const aNone = Number.isNaN(da);
    const bNone = Number.isNaN(db);
    if (aNone && bNone) return 0;
    if (aNone) return 1;
    if (bNone) return -1;
    return sortKey === 'deadline-asc' ? da - db : db - da;
  }
  if (sortKey === 'number-asc' || sortKey === 'number-desc') {
    const na = Number(a.orderNumber) || 0;
    const nb = Number(b.orderNumber) || 0;
    return sortKey === 'number-asc' ? na - nb : nb - na;
  }
  if (sortKey === 'client-asc') return (a.client || '').localeCompare(b.client || '', 'ru');
  return (a.manager || '').localeCompare(b.manager || '', 'ru');
}

export default function KanbanBoard({
  orders,
  parsedOrdersMap,
  currentPrinter,
  onStatusChange,
  onClaim,
  onUnclaim,
  onComplete,
  onOpenFolder,
  onPrint,
  onDragStateChange,
}: KanbanBoardProps) {
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [hoverColumn, setHoverColumn] = useState<string | null>(null);
  const [openOrder, setOpenOrder] = useState<Order | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    try {
      const saved = localStorage.getItem(SORT_STORAGE_KEY) as SortKey | null;
      return saved && SORT_OPTIONS.some((o) => o.id === saved) ? saved : 'deadline-asc';
    } catch {
      return 'deadline-asc';
    }
  });
  // После перетаскивания браузер может прислать click по карточке — окно ТЗ не открываем
  const justDraggedRef = useRef(false);

  const activeOrders = useMemo(() => orders.filter((o) => !o.completed), [orders]);

  const byKey = useMemo(() => {
    const map = new Map<string, Order>();
    for (const order of activeOrders) map.set(orderCardKey(order), order);
    return map;
  }, [activeOrders]);

  // Колонки: шесть статусов производства + «Без статуса» для новых заявок
  const columns = useMemo(
    () => [
      ...ORDER_STATUSES.map((s) => ({ key: s.id, label: s.label, color: s.color, badgeClass: s.badgeClass })),
      { key: '', label: 'Без статуса', color: NO_STATUS_COLOR, badgeClass: 'status-empty' },
    ],
    [],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, Order[]>();
    for (const col of columns) map.set(col.key, []);
    for (const order of activeOrders) {
      const key = order.status && map.has(order.status) ? order.status : '';
      map.get(key)!.push(order);
    }
    for (const list of map.values()) list.sort((a, b) => compareOrders(a, b, sortKey));
    return map;
  }, [activeOrders, columns, sortKey]);

  const overdueCount = useMemo(
    () => activeOrders.filter((o) => getDeadlineState(o.deadline) === 'overdue').length,
    [activeOrders],
  );
  const noStatusCount = (grouped.get('') || []).length;

  // Открытая карточка должна оставаться актуальной после перечитывания таблицы
  useEffect(() => {
    if (!openOrder) return;
    const fresh = activeOrders.find((o) => orderCardKey(o) === orderCardKey(openOrder));
    if (!fresh) {
      setOpenOrder(null);
      return;
    }
    if (fresh !== openOrder) setOpenOrder(fresh);
  }, [activeOrders, openOrder]);

  // Esc закрывает окно ТЗ
  useEffect(() => {
    if (!openOrder) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenOrder(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openOrder]);

  const changeSort = (value: SortKey) => {
    setSortKey(value);
    try {
      localStorage.setItem(SORT_STORAGE_KEY, value);
    } catch {}
  };

  const startDrag = (e: React.DragEvent, order: Order) => {
    const key = orderCardKey(order);
    setDragKey(key);
    justDraggedRef.current = true;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', key);
    onDragStateChange?.(true);
  };

  const endDrag = () => {
    setDragKey(null);
    setHoverColumn(null);
    onDragStateChange?.(false);
    // click после drag приходит сразу — снимаем защиту чуть позже
    window.setTimeout(() => {
      justDraggedRef.current = false;
    }, 250);
  };

  const dropOnColumn = (e: React.DragEvent, statusKey: string) => {
    e.preventDefault();
    const key = e.dataTransfer.getData('text/plain') || dragKey;
    const order = key ? byKey.get(key) : undefined;
    endDrag();
    if (!order) return;
    if ((order.status || '') === statusKey) return;
    onStatusChange(order, statusKey);
  };

  const openCard = (order: Order) => {
    if (justDraggedRef.current) return;
    setOpenOrder(order);
  };

  return (
    <div className="kanban-wrapper">
      <div className="kanban-summary">
        <span className="kanban-summary-item">
          В работе: <strong>{activeOrders.length}</strong>
        </span>
        <span className="kanban-summary-item">
          Без статуса: <strong>{noStatusCount}</strong>
        </span>
        <span className={`kanban-summary-item ${overdueCount ? 'danger' : ''}`}>
          Просрочено: <strong>{overdueCount}</strong>
        </span>

        <label className="kanban-sort">
          <span className="kanban-sort-label">Сортировка в колонках:</span>
          <select value={sortKey} onChange={(e) => changeSort(e.target.value as SortKey)}>
            {SORT_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <span className="kanban-summary-hint">Клик по карточке открывает ТЗ · перетаскивание меняет статус</span>
      </div>

      <div className="kanban-board">
        {columns.map((col) => {
          const items = grouped.get(col.key) || [];
          const isDropTarget = hoverColumn === col.key && dragKey !== null;
          return (
            <section
              key={col.key || 'no-status'}
              className={`kanban-column ${isDropTarget ? 'drop-target' : ''} ${dragKey !== null ? 'dragging-active' : ''}`}
              style={
                {
                  '--col-accent': col.color,
                  '--col-tint': hexToRgba(col.color, 0.08),
                  '--col-tint-strong': hexToRgba(col.color, 0.16),
                } as React.CSSProperties
              }
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (hoverColumn !== col.key) setHoverColumn(col.key);
              }}
              onDragLeave={(e) => {
                if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                setHoverColumn((prev) => (prev === col.key ? null : prev));
              }}
              onDrop={(e) => dropOnColumn(e, col.key)}
            >
              <header className="kanban-column-head">
                <span className="kanban-column-dot" />
                <span className="kanban-column-title">{col.label}</span>
                <span className="kanban-column-count">{items.length}</span>
              </header>

              <div className="kanban-column-body">
                {items.length === 0 ? (
                  <div className="kanban-column-empty">
                    {col.key === '' ? 'Все заявки распределены' : 'Перетащите заявку сюда'}
                  </div>
                ) : (
                  items.map((order) => (
                    <Fragment key={orderCardKey(order)}>
                      <OrderCard
                        order={order}
                        parsed={parsedOrdersMap.get(order.rowNumber)}
                        currentPrinter={currentPrinter}
                        dragging={dragKey === orderCardKey(order)}
                        draggable
                        onDragStart={startDrag}
                        onDragEnd={endDrag}
                        onOpen={openCard}
                        onClaim={onClaim}
                        onComplete={onComplete}
                        onOpenFolder={onOpenFolder}
                        onPrint={onPrint}
                      />
                    </Fragment>
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>

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
