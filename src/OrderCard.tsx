// ─────────────────────────────────────────────────────────────────────────────
// Карточка заявки и окно ТЗ — общие для Канбан-доски и вкладки «Календарь».
// Вынесены из KanbanBoard.tsx без изменения разметки и классов (CSS не менялся).
// ─────────────────────────────────────────────────────────────────────────────
import React from 'react';
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
  getDeadlineState,
  hexToRgba,
  type Order,
} from './orderConfig';
import type { ParsedTz } from './parseTz';
import ModalShell from './Modal';

/** Ширина сплошной части градиента статуса на карточке (аналог «№ + срок» в строке таблицы). */
const CARD_STATUS_STOP = 34;
/** Длина плавного перехода от цвета статуса к цвету печатника.
 *  Карточка ~280px: переход 140px оставляет справа чистую зону цвета печатника,
 *  как в строке таблицы. При 200px градиент заливал почти всю карточку. */
const CARD_STATUS_FADE = 140;

export function isRemoteResource(value: string): boolean {
  return /^https?:\/\//i.test(String(value || '').trim());
}

/** Ключ карточки: строка листа + номер заявки (переиспользованная строка не «прилипает»). */
export function orderCardKey(order: Order): string {
  return `${order.rowNumber}-${order.orderNumber}`;
}

interface OrderCardProps {
  order: Order;
  parsed?: ParsedTz;
  currentPrinter: string;
  dragging?: boolean;
  draggable?: boolean;
  /** Градиент статуса слева. Нужен там, где статус не виден иначе (календарь).
   *  На Канбан-доске не включать: колонки уже разбиты по статусам. */
  statusWash?: boolean;
  onDragStart?: (e: React.DragEvent, order: Order) => void;
  onDragEnd?: () => void;
  onOpen: (order: Order) => void;
  onClaim: (order: Order, e: React.MouseEvent) => void;
  onComplete: (order: Order, e: React.MouseEvent) => void;
  onOpenFolder: (path: string, e: React.MouseEvent) => void;
  onPrint: (order: Order, e: React.MouseEvent) => void;
}

export function OrderCard({
  order,
  parsed,
  currentPrinter,
  dragging,
  draggable,
  statusWash,
  onDragStart,
  onDragEnd,
  onOpen,
  onClaim,
  onComplete,
  onOpenFolder,
  onPrint,
}: OrderCardProps) {
  const printerConfig = PRINTERS_CONFIG[order.printer];
  const statusConfig = order.status ? STATUS_BY_ID[order.status] : undefined;
  const deadlineState = getDeadlineState(order.deadline);
  const isMine = Boolean(currentPrinter) && order.printer === currentPrinter;

  // Подкраска как в строке таблицы: фон — цвет печатника, градиент слева — цвет статуса.
  // Одна карточка несёт оба слоя: background-color (печатник) и background-image (статус),
  // поэтому дополнительный div и z-index не нужны.
  // Градиент статуса — только по запросу (statusWash): на доске статус задаёт сама колонка,
  // и подкраска там читается как лишний шум.
  const cardStyle: React.CSSProperties = {};
  if (!order.completed && printerConfig) {
    cardStyle.backgroundColor = hexToRgba(printerConfig.color, 0.13);
    cardStyle.borderLeftColor = printerConfig.color;
  }
  if (statusWash && !order.completed && statusConfig) {
    const solid = hexToRgba(statusConfig.color, 0.5);
    const clear = hexToRgba(statusConfig.color, 0);
    cardStyle.backgroundImage =
      `linear-gradient(90deg, ${solid} 0px, ${solid} ${CARD_STATUS_STOP}px, ${clear} ${CARD_STATUS_STOP + CARD_STATUS_FADE}px)`;
  }

  return (
    <article
      className={`kanban-card ${dragging ? 'dragging' : ''} ${order.printer ? 'claimed' : 'free'}`}
      style={cardStyle}
      draggable={Boolean(draggable)}
      onDragStart={onDragStart ? (e) => onDragStart(e, order) : undefined}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(order)}
      title={
        draggable
          ? 'Нажмите, чтобы открыть ТЗ · перетащите в колонку, чтобы сменить статус'
          : 'Нажмите, чтобы открыть ТЗ'
      }
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
          {!order.printer && !order.completed && (
            <button
              className="kanban-claim-btn"
              onClick={(e) => onClaim(order, e)}
              disabled={!currentPrinter}
              title={currentPrinter ? `Взять заказ на ${PRINTERS_CONFIG[currentPrinter]?.label}` : 'Выберите себя в меню «Печатник»'}
            >
              Взять
            </button>
          )}
          {isMine && !order.completed && (
            <button className="kanban-done-btn" title="Отметить заказ выполненным" onClick={(e) => onComplete(order, e)}>
              <CheckCircle2 size={13} />
              Готово
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

interface OrderTzModalProps {
  order: Order;
  parsed?: ParsedTz;
  currentPrinter: string;
  onClose: () => void;
  onStatusChange: (order: Order, status: string) => void;
  onClaim: (order: Order, e: React.MouseEvent) => void;
  onUnclaim: (order: Order, e: React.MouseEvent) => void;
  onComplete: (order: Order, e: React.MouseEvent) => void;
  onOpenFolder: (path: string, e: React.MouseEvent) => void;
  onPrint: (order: Order, e: React.MouseEvent) => void;
}

/** Окно ТЗ открытой карточки — разметка та же, что была на Канбан-доске. */
export function OrderTzModal({
  order,
  parsed,
  currentPrinter,
  onClose,
  onStatusChange,
  onClaim,
  onUnclaim,
  onComplete,
  onOpenFolder,
  onPrint,
}: OrderTzModalProps) {
  const printerConfig = PRINTERS_CONFIG[order.printer];
  const statusConfig = order.status ? STATUS_BY_ID[order.status] : undefined;
  const deadlineState = getDeadlineState(order.deadline);
  const isMine = Boolean(currentPrinter) && order.printer === currentPrinter;

  return (
    <ModalShell className="kanban-modal">
        <div className="modal-header">
          <div>
            <h2>Заявка № {order.orderNumber}</h2>
            <p className="modal-sub">
              {order.client || '—'}
              {order.manager ? ` · менеджер: ${order.manager}` : ''}
              {order.completed ? ' · сдано' : ''}
            </p>
          </div>
          <button className="btn-modal-close" onClick={onClose} title="Закрыть (Esc)">
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
            {!order.printer && !order.completed && (
              <button
                className="btn-claim-large"
                onClick={(e) => onClaim(order, e)}
                disabled={!currentPrinter}
                title={currentPrinter ? '' : 'Выберите себя в меню «Печатник»'}
              >
                Взять в работу{currentPrinter ? ` (${PRINTERS_CONFIG[currentPrinter]?.label})` : ''}
              </button>
            )}
            {isMine && !order.completed && (
              <>
                <button className="btn-done-large" onClick={(e) => onComplete(order, e)}>
                  <CheckCircle2 size={15} /> Завершить
                </button>
                <button className="btn-unclaim-large" onClick={(e) => onUnclaim(order, e)}>
                  <Undo2 size={15} /> Отказаться
                </button>
              </>
            )}
            <button className="btn-secondary" onClick={onClose}>
              Закрыть
            </button>
          </div>
        </div>
    </ModalShell>
  );
}
