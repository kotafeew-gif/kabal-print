// Автообновление через GitHub Releases (electron-updater).
// Схема как в ТЗаторе: релизы публикуются в публичный репозиторий,
// приложение при запуске проверяет latest.yml и предлагает обновиться.

import electronUpdater from 'electron-updater';
import { app, dialog } from 'electron';

const { autoUpdater } = electronUpdater;

let latestState = null;
let downloadPromptOpen = false;
let restartPromptOpen = false;

/**
 * Настраивает автообновление.
 * @param {{ getWindow: () => Electron.BrowserWindow | undefined }} options
 * @returns {{ check: (manual?: boolean) => Promise<void>, getState: () => object | null, download: () => void, install: () => void }}
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

  async function askToDownload(info) {
    if (downloadPromptOpen) return;
    downloadPromptOpen = true;
    try {
      const result = await dialog.showMessageBox(getWindow(), {
        type: 'info',
        buttons: ['Загрузить', 'Позже'],
        defaultId: 0,
        cancelId: 1,
        title: 'Доступно обновление',
        message: `Доступна новая версия ${info.version}.`,
        detail: 'Загрузить обновление сейчас? После загрузки потребуется перезапуск.',
      });
      if (result.response === 0) {
        autoUpdater.downloadUpdate();
      }
    } finally {
      downloadPromptOpen = false;
    }
  }

  async function askToRestart(info) {
    if (restartPromptOpen) return;
    restartPromptOpen = true;
    try {
      const result = await dialog.showMessageBox(getWindow(), {
        type: 'info',
        buttons: ['Перезапустить сейчас', 'Позже'],
        defaultId: 0,
        cancelId: 1,
        title: 'Обновление загружено',
        message: `Версия ${info.version} готова к установке.`,
        detail: 'Перезапустить приложение, чтобы завершить установку?',
      });
      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    } finally {
      restartPromptOpen = false;
    }
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
      askToDownload(info).catch((error) => console.error('KabalPrint update dialog:', error));
    });

    autoUpdater.on('download-progress', (progress) => {
      setProgress(progress.percent > 0 && progress.percent < 100 ? progress.percent / 100 : -1);
      send({
        status: 'downloading',
        percent: Math.round(progress.percent),
        transferred: progress.transferred,
        total: progress.total,
      });
    });

    autoUpdater.on('update-downloaded', (info) => {
      setProgress(-1);
      send({ status: 'downloaded', version: info.version });
      askToRestart(info).catch((error) => console.error('KabalPrint update restart dialog:', error));
    });

    autoUpdater.on('error', (error) => {
      setProgress(-1);
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
    download() {
      autoUpdater.downloadUpdate();
    },
    install() {
      autoUpdater.quitAndInstall();
    },
  };
}
