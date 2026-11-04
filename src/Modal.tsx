// ─────────────────────────────────────────────────────────────────────────────
// Общая оболочка модального окна: подложка + перетаскиваемое окно.
//
// Почему так, а не onClick на подложке: выделяя мышкой число в поле и отпуская
// кнопку за пределами окна, браузер присылает click уже по подложке — окно
// закрывалось прямо посреди работы. Теперь клик вне окна ничего не делает:
// закрыть можно только крестиком или кнопкой «Закрыть» (и Esc там, где он есть).
//
// Окно двигается за шапку: при первом нажатии оно переходит с центрирования
// на фиксированные координаты и дальше следует за курсором. За кнопки и поля
// в шапке не тащим — иначе крестик не нажать.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useRef, useState } from 'react';

interface ModalShellProps {
  /** Класс окна: kanban-modal, pc-modal, cut-modal, complete-modal, calendar-day-modal */
  className?: string;
  children: React.ReactNode;
}

/** Минимальный отступ от края экрана, чтобы окно нельзя было утащить целиком. */
const VIEWPORT_MARGIN = 8;

export default function ModalShell({ className = '', children }: ModalShellProps) {
  const winRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  // null — окно ещё центрировано флексом; после первого перетаскивания — координаты
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const startDrag = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    // Тянем только за шапку и не за элементы управления в ней
    if (!target.closest('.modal-header')) return;
    if (target.closest('button, a, input, select, textarea')) return;

    const el = winRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    setPos({ left: rect.left, top: rect.top });
    setDragging(true);
    e.preventDefault();
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      const el = winRef.current;
      if (!drag || !el) return;
      const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - el.offsetWidth - VIEWPORT_MARGIN);
      const maxTop = Math.max(VIEWPORT_MARGIN, window.innerHeight - el.offsetHeight - VIEWPORT_MARGIN);
      setPos({
        left: Math.min(Math.max(VIEWPORT_MARGIN, e.clientX - drag.dx), maxLeft),
        top: Math.min(Math.max(VIEWPORT_MARGIN, e.clientY - drag.dy), maxTop),
      });
    };
    const onUp = () => {
      dragRef.current = null;
      setDragging(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  return (
    <div className="modal-overlay">
      <div
        ref={winRef}
        className={`modal-window ${className} ${dragging ? 'modal-dragging' : ''}`.trim()}
        style={pos ? { position: 'fixed', left: pos.left, top: pos.top, margin: 0 } : undefined}
        onMouseDown={startDrag}
      >
        {children}
      </div>
    </div>
  );
}
