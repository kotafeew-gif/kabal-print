import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  Copy,
  FolderOpen,
  Globe2,
  Printer as PrinterIcon,
  Undo2,
  User,
  X,
} from 'lucide-react';
import {
  ORDER_STATUSES,
  PRINTERS_CONFIG,
  STATUS_BY_ID,
  NO_STATUS_COLOR,
  hexToRgba,
  parseDeadlineMs,
  getDeadlineState,
  type Order,
} from './orderConfig';
import type { ParsedTz } from './parseTz';

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

function isRemoteResource(value: string): boolean {
  return /^https?:\/\//i.test(String(value || '').trim());
}

const cardKey = (order: Order) => `${order.rowNumber}-${order.orderNumber}`;

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
    for (const order of activeOrders) map.set(cardKey(order), order);
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
    const fresh = activeOrders.find((o) => cardKey(o) === cardKey(openOrder));
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
    const key = cardKey(order);
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

  const renderCard = (order: Order) => {
    const parsed = parsedOrdersMap.get(order.rowNumber);
    const printerConfig = PRINTERS_CONFIG[order.printer];
    const deadlineState = getDeadlineState(order.deadline);
    const key = cardKey(order);
    const isMine = Boolean(currentPrinter) && order.printer === currentPrinter;

    return (
      <article
        key={key}
        className={`kanban-card ${dragKey === key ? 'dragging' : ''} ${order.printer ? 'claimed' : 'free'}`}
        draggable
        onDragStart={(e) => startDrag(e, order)}
        onDragEnd={endDrag}
        onClick={() => openCard(order)}
        title="Нажмите, чтобы открыть ТЗ · перетащите в колонку, чтобы сменить статус"
      >
        <div className="kanban-card-head">
          <span className="kanban-card-num">№ {order.orderNumber}</span>
          {order.manager && <span className="kanban-card-manager">{order.manager}</span>}
        </div>

        <div className="kanban-card-client" title={order.client}>
          {order.client || '—'}
        </div>

        <div className="kanban-card-meta">
          <span className="kanban-card-product" title={parsed?.product || ''}>
            {parsed?.product || '—'}
          </span>
          <span className="kanban-card-qty" title={parsed?.quantity || ''}>
            {parsed?.quantity || '—'}
          </span>
        </div>

        <div className={`kanban-card-deadline ${deadlineState}`}>
          <Calendar size={12} />
          <span className="kanban-card-deadline-text">{order.deadline || 'без срока'}</span>
          {deadlineState === 'today' && <span className="kanban-flag today">сегодня</span>}
          {deadlineState === 'overdue' && <span className="kanban-flag overdue">просрочено</span>}
        </div>

        <div className="kanban-card-footer">
          {order.printer ? (
            <span className={`status-badge kanban-printer-chip ${printerConfig?.badgeClass || 'badge-claimed'}`}>
              <User size={12} />
              {printerConfig?.label || order.printer}
            </span>
          ) : (
            <span className="status-badge badge-free kanban-printer-chip">
              <span className="pulse-dot" />
              Свободна
            </span>
          )}

          <div className="kanban-card-actions">
            {parsed?.folderPath && (
              <button
                className="kanban-icon-btn"
                title={`Открыть папку: ${parsed.folderPath}`}
                onClick={(e) => onOpenFolder(parsed.folderPath, e)}
              >
                {isRemoteResource(parsed.folderPath) ? <Globe2 size={13} /> : <FolderOpen size={13} />}
              </button>
            )}
            <button className="kanban-icon-btn" title="Распечатать техкарту" onClick={(e) => onPrint(order, e)}>
              <PrinterIcon size={13} />
            </button>
            {!order.printer && (
              <button
                className="kanban-claim-btn"
                onClick={(e) => onClaim(order, e)}
                disabled={!currentPrinter}
                title={currentPrinter ? `Взять заказ на ${PRINTERS_CONFIG[currentPrinter]?.label}` : 'Выберите себя в меню «Печатник»'}
              >
                Взять
              </button>
            )}
            {isMine && (
              <button className="kanban-done-btn" title="Отметить заказ выполненным" onClick={(e) => onComplete(order, e)}>
                <CheckCircle2 size={13} />
                Готово
              </button>
            )}
          </div>
        </div>
      </article>
    );
  };

  // ── Окно с ТЗ открытой карточки ────────────────────────────────────────────
  const renderModal = () => {
    if (!openOrder) return null;
    const order = openOrder;
    const parsed = parsedOrdersMap.get(order.rowNumber);
    const printerConfig = PRINTERS_CONFIG[order.printer];
    const statusConfig = order.status ? STATUS_BY_ID[order.status] : undefined;
    const deadlineState = getDeadlineState(order.deadline);
    const isMine = Boolean(currentPrinter) && order.printer === currentPrinter;

    return (
      <div className="modal-overlay" onClick={() => setOpenOrder(null)}>
        <div className="modal-window kanban-modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <div>
              <h2>Заявка № {order.orderNumber}</h2>
              <p className="modal-sub">
                {order.client || '—'}
                {order.manager ? ` · менеджер: ${order.manager}` : ''}
              </p>
            </div>
            <button className="btn-modal-close" onClick={() => setOpenOrder(null)} title="Закрыть (Esc)">
              <X size={20} />
            </button>
          </div>

          <div className="modal-body">
            <div className="kanban-modal-status-row">
              <label className="kanban-modal-status-label">
                <span>Статус:</span>
                <select
                  className={`status-select ${statusConfig ? statusConfig.badgeClass : 'status-empty'}`}
                  value={order.status || ''}
                  onChange={(e) => onStatusChange(order, e.target.value)}
                >
                  <option value="">— статус —</option>
                  {ORDER_STATUSES.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>

              <span className="kanban-modal-printer">
                <span>Печатник:</span>
                {order.printer ? (
                  <span className={`status-badge ${printerConfig?.badgeClass || 'badge-claimed'}`}>
                    <User size={12} />
                    {printerConfig?.label || order.printer}
                  </span>
                ) : (
                  <span className="status-badge badge-free">
                    <span className="pulse-dot" />
                    Свободна
                  </span>
                )}
              </span>
            </div>

            <div className="modal-fact-grid">
              <div className="modal-fact-card">
                <span className="fact-title">Срок сдачи</span>
                <span
                  className={`fact-data ${deadlineState === 'overdue' ? 'fact-danger' : ''} ${
                    deadlineState === 'today' ? 'fact-warn' : ''
                  }`}
                >
                  {order.deadline || '—'}
                </span>
              </div>
              <div className="modal-fact-card">
                <span className="fact-title">Дата постановки</span>
                <span className="fact-data">{order.created || '—'}</span>
              </div>
              <div className="modal-fact-card">
                <span className="fact-title">Вид продукции</span>
                <span className="fact-data">{parsed?.product || '—'}</span>
              </div>
              <div className="modal-fact-card">
                <span className="fact-title">Тираж</span>
                <span className="fact-data">{parsed?.quantity || '—'}</span>
              </div>
              <div className="modal-fact-card">
                <span className="fact-title">Материал</span>
                <span className="fact-data">{parsed?.paper || '—'}</span>
              </div>
              <div className="modal-fact-card">
                <span className="fact-title">Цветность</span>
                <span className="fact-data">{order.colorMode || parsed?.color || '—'}</span>
              </div>
            </div>

            {parsed?.lamination && parsed.lamination !== '—' && (
              <div className="modal-note-box">
                {/^ламинац/i.test(parsed.lamination) ? parsed.lamination : `Ламинация: ${parsed.lamination}`}
              </div>
            )}
            {order.note && <div className="modal-note-box">Примечание: {order.note}</div>}

            <div className="modal-tz-section">
              <h3>ТЗ из ячейки</h3>
              <pre>{order.tz}</pre>
            </div>
          </div>

          <div className="modal-footer">
            <div className="kanban-modal-footer-left">
              {parsed?.folderPath && (
                <button className="btn-print" onClick={(e) => onOpenFolder(parsed.folderPath, e)}>
                  {isRemoteResource(parsed.folderPath) ? <Globe2 size={14} /> : <FolderOpen size={14} />}
                  Папка
                </button>
              )}
              <button className="btn-print" onClick={(e) => onPrint(order, e)}>
                <PrinterIcon size={14} />
                Распечатать
              </button>
              <button
                className="btn-print"
                onClick={() => navigator.clipboard?.writeText(order.tz)}
                title="Скопировать текст ТЗ"
              >
                <Copy size={14} />
                Копировать ТЗ
              </button>
            </div>

            <div className="kanban-modal-footer-right">
              {!order.printer && (
                <button
                  className="btn-claim-large"
                  onClick={(e) => onClaim(order, e)}
                  disabled={!currentPrinter}
                  title={currentPrinter ? '' : 'Выберите себя в меню «Печатник»'}
                >
                  Взять в работу{currentPrinter ? ` (${PRINTERS_CONFIG[currentPrinter]?.label})` : ''}
                </button>
              )}
              {isMine && (
                <>
                  <button className="btn-done-large" onClick={(e) => onComplete(order, e)}>
                    <CheckCircle2 size={15} /> Завершить
                  </button>
                  <button className="btn-unclaim-large" onClick={(e) => onUnclaim(order, e)}>
                    <Undo2 size={15} /> Отказаться
                  </button>
                </>
              )}
              <button className="btn-secondary" onClick={() => setOpenOrder(null)}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      </div>
    );
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
                  items.map(renderCard)
                )}
              </div>
            </section>
          );
        })}
      </div>

      {renderModal()}
    </div>
  );
}
