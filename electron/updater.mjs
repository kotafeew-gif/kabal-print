// Автообновление через GitHub Releases (electron-updater).
// Схема как в ТЗаторе: релизы публикуются в публичный репозиторий,
// приложение при запуске проверяет latest.yml и предлагает обновиться.
//
// Диалоги не нативные — состояние уходит в окно приложения (канал update-status),
// чтобы показывать прогресс-бар загрузки. После скачивания установка
// и перезапуск происходят автоматически.

import electronUpdater from 'electron-updater';
import { app } from 'electron';

const { autoUpdater } = electronUpdater;

/** Задержка перед автоустановкой — чтобы пользователь увидел «100%». */
const AUTO_INSTALL_DELAY_MS = 2000;

let latestState = null;
let installTimer = null;

/**
 * Настраивает автообновление.
 * @param {{ getWindow: () => Electron.BrowserWindow | undefined }} options
 */
export function setupUpdater({ getWindow }) {
  function send(payload) {
    latestState = payload ? { ...payload } : null;
    const win = getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('update-status', latestState);
    }
  }

  function setProgress(value) {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.setProgressBar(value);
  }

  function attach() {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;

    autoUpdater.on('checking-for-update', () => send({ status: 'checking' }));

    autoUpdater.on('update-not-available', () => {
      send({ status: 'idle' });
      setProgress(-1);
    });

    autoUpdater.on('update-available', (info) => {
      send({ status: 'available', version: info.version });
    });

    autoUpdater.on('download-progress', (progress) => {
      setProgress(progress.percent > 0 && progress.percent < 100 ? progress.percent / 100 : -1);
      send({
        status: 'downloading',
        version: latestState?.version,
        percent: Math.round(progress.percent),
        transferred: progress.transferred,
        total: progress.total,
        bytesPerSecond: progress.bytesPerSecond,
      });
    });

    autoUpdater.on('update-downloaded', (info) => {
      setProgress(-1);
      send({ status: 'downloaded', version: info.version });

      // Автоматическая установка: пользователь уже нажал «Обновить»
      clearTimeout(installTimer);
      installTimer = setTimeout(() => {
        try {
          autoUpdater.quitAndInstall(false, true);
        } catch (error) {
          console.error('KabalPrint: ошибка установки обновления:', error);
          send({ status: 'error', error: error?.message || String(error) });
        }
      }, AUTO_INSTALL_DELAY_MS);
    });

    autoUpdater.on('error', (error) => {
      setProgress(-1);
      clearTimeout(installTimer);
      send({ status: 'error', error: error?.message || String(error) });
      console.error('KabalPrint autoUpdater error:', error);
    });
  }

  attach();

  return {
    /** Проверка обновлений. В dev-режиме ничего не делает. */
    async check(manual = false) {
      if (!app.isPackaged) {
        if (manual) send({ status: 'dev' });
        return;
      }
      try {
        await autoUpdater.checkForUpdates();
      } catch (error) {
        console.error('KabalPrint: ошибка проверки обновлений:', error);
        if (manual) send({ status: 'error', error: error?.message || String(error) });
      }
    },
    getState() {
      return latestState;
    },
    /** Начать загрузку — вызывается кнопкой «Обновить» в окне. */
    download() {
      const current = latestState?.status;
      if (current === 'downloading' || current === 'downloaded') return;
      send({ status: 'downloading', version: latestState?.version, percent: 0, transferred: 0, total: 0 });
      autoUpdater.downloadUpdate().catch((error) => {
        console.error('KabalPrint: ошибка загрузки обновления:', error);
        send({ status: 'error', error: error?.message || String(error) });
      });
    },
    /** Отложить обновление — закрыть окно до следующего запуска. */
    dismiss() {
      clearTimeout(installTimer);
      if (latestState?.status === 'available') send({ status: 'idle' });
    },
    install() {
      clearTimeout(installTimer);
      autoUpdater.quitAndInstall(false, true);
    },
  };
}
