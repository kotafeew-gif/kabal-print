// src/cutWorker.ts
// Тяжёлый расчёт ПРО-режима в отдельном потоке: интерфейс не замирает,
// спиннер честно крутится, а не изображает загрузку поверх зависшего потока.

import { computeProLayout, type ProFormat } from './paperCut';

interface Request {
  id: number;
  cW: number;
  cH: number;
  formats: ProFormat[];
  gap: number;
}

self.onmessage = (event: MessageEvent<Request>) => {
  const { id, cW, cH, formats, gap } = event.data;
  try {
    const result = computeProLayout(cW, cH, formats, gap);
    (self as unknown as Worker).postMessage({ id, result });
  } catch (error) {
    (self as unknown as Worker).postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
