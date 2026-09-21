/**
 * services/taskExecutionService.ts
 *
 * Глобальный сервис выполнения парсинга и переноса постов.
 * Хранит состояние активного переноса в памяти приложения и синхронизирует его
 * с сервером через /api/tasks/* для полного кросс-девайс управления (ПК ↔ Телефон).
 *
 * Позволяет запустить перенос с ПК, уйти, зайти с телефона и остановить или отследить процесс!
 */

import { apiService } from './apiService';

export interface ActiveTaskState {
  isProcessing: boolean;
  isLiveMonitoring: boolean;
  module: 'store' | 'parser';
  donors: string[];
  targets: string[];  // Поддержка до 3-х каналов публикации одновременно
  current: number;
  total: number;
  countdownSec: number;
  statusMessage: string;
  logs: any[];
}

class TaskExecutionService {
  private storeTask: ActiveTaskState = {
    isProcessing: false,
    isLiveMonitoring: false,
    module: 'store',
    donors: ['@somoniyon1998'],
    targets: ['@my_store'],
    current: 0,
    total: 0,
    countdownSec: 0,
    statusMessage: '',
    logs: [],
  };

  private parserTask: ActiveTaskState = {
    isProcessing: false,
    isLiveMonitoring: false,
    module: 'parser',
    donors: ['@durov'],
    targets: ['@my_channel'],
    current: 0,
    total: 0,
    countdownSec: 0,
    statusMessage: '',
    logs: [],
  };

  private storeCancelled: boolean = false;
  private parserCancelled: boolean = false;
  private listeners: Set<() => void> = new Set();
  private pollIntervalId: any = null;
  private isMasterRunner: boolean = false; // true если именно этот браузер исполняет цикл постов

  constructor() {
    this.startStatusPolling();
  }

  public getStoreState(): ActiveTaskState {
    return this.storeTask;
  }

  public getParserState(): ActiveTaskState {
    return this.parserTask;
  }

  public startStoreTask() {
    this.storeCancelled = false;
    this.isMasterRunner = true;
    this.updateStoreState({
      isProcessing: true,
      isLiveMonitoring: false,
      countdownSec: 0,
    });
    this.syncWithServer('store');
  }

  public stopStore(remoteOnly: boolean = false) {
    this.storeCancelled = true;
    this.isMasterRunner = false;
    this.updateStoreState({
      isProcessing: false,
      isLiveMonitoring: false,
      countdownSec: 0,
      statusMessage: '⏹ Процесс переноса мгновенно остановлен'
    });
    if (!remoteOnly) {
      apiService.stopTask().catch(() => {});
    }
  }

  public isStoreCancelled(): boolean {
    return this.storeCancelled || !this.storeTask.isProcessing;
  }

  public startParserTask() {
    this.parserCancelled = false;
    this.isMasterRunner = true;
    this.updateParserState({
      isProcessing: true,
      isLiveMonitoring: false,
      countdownSec: 0,
    });
    this.syncWithServer('parser');
  }

  public stopParser(remoteOnly: boolean = false) {
    this.parserCancelled = true;
    this.isMasterRunner = false;
    this.updateParserState({
      isProcessing: false,
      isLiveMonitoring: false,
      countdownSec: 0,
      statusMessage: '⏹ Парсинг мгновенно остановлен пользователем'
    });
    if (!remoteOnly) {
      apiService.stopTask().catch(() => {});
    }
  }

  public isParserCancelled(): boolean {
    return this.parserCancelled || !this.parserTask.isProcessing;
  }

  public updateStoreState(partial: Partial<ActiveTaskState>) {
    this.storeTask = { ...this.storeTask, ...partial };
    this.notify();
    if (this.isMasterRunner && partial.isProcessing !== undefined || partial.current !== undefined) {
      this.syncWithServer('store');
    }
  }

  public updateParserState(partial: Partial<ActiveTaskState>) {
    this.parserTask = { ...this.parserTask, ...partial };
    this.notify();
    if (this.isMasterRunner && partial.isProcessing !== undefined || partial.current !== undefined) {
      this.syncWithServer('parser');
    }
  }

  public subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    this.listeners.forEach(l => l());
  }

  // Синхронизация с сервером
  private async syncWithServer(module: 'store' | 'parser') {
    const task = module === 'store' ? this.storeTask : this.parserTask;
    try {
      await apiService.syncTaskProgress({
        is_running: task.isProcessing,
        is_live_monitoring: task.isLiveMonitoring,
        module: module,
        donor: task.donors[0] || '',
        targets: task.targets,
        current: task.current,
        total: task.total,
        status_message: task.statusMessage,
        countdown_sec: task.countdownSec,
      });
    } catch {
      // Игнорируем сетевые сбои в фоне
    }
  }

  // Фоновый поллинг для синхронизации ПК и телефона
  private startStatusPolling() {
    if (this.pollIntervalId) return;
    this.pollIntervalId = setInterval(async () => {
      try {
        const token = typeof localStorage !== 'undefined' ? localStorage.getItem('auth_token') : null;
        if (!token && typeof localStorage !== 'undefined' && !localStorage.getItem('ghostpost_auth')) {
          return;
        }

        const serverStatus = await apiService.getTaskStatus();
        if (!serverStatus) return;

        // Если сервер сигнализирует should_stop, а мы локально выполняли задачу — останавливаем
        if (serverStatus.should_stop) {
          if (this.storeTask.isProcessing) {
            this.storeCancelled = true;
            this.updateStoreState({
              isProcessing: false,
              isLiveMonitoring: false,
              statusMessage: '⏹ Остановлено удаленно через телефон'
            });
          }
          if (this.parserTask.isProcessing) {
            this.parserCancelled = true;
            this.updateParserState({
              isProcessing: false,
              isLiveMonitoring: false,
              statusMessage: '⏹ Остановлено удаленно через телефон'
            });
          }
          return;
        }

        // Если мы НЕ исполняем задачу на этом устройстве (например, открыли на телефоне),
        // а сервер сообщает, что задача запущена (на ПК) — подтягиваем прогресс!
        if (!this.isMasterRunner) {
          if (serverStatus.is_running) {
            if (serverStatus.module === 'store') {
              this.storeTask = {
                ...this.storeTask,
                isProcessing: true,
                isLiveMonitoring: serverStatus.is_live_monitoring,
                current: serverStatus.current,
                total: serverStatus.total,
                statusMessage: serverStatus.status_message,
                countdownSec: serverStatus.countdown_sec,
                donors: serverStatus.donor ? [serverStatus.donor] : this.storeTask.donors,
                targets: serverStatus.targets?.length ? serverStatus.targets : this.storeTask.targets,
              };
              this.notify();
            } else if (serverStatus.module === 'parser') {
              this.parserTask = {
                ...this.parserTask,
                isProcessing: true,
                isLiveMonitoring: serverStatus.is_live_monitoring,
                current: serverStatus.current,
                total: serverStatus.total,
                statusMessage: serverStatus.status_message,
                countdownSec: serverStatus.countdown_sec,
                donors: serverStatus.donor ? [serverStatus.donor] : this.parserTask.donors,
                targets: serverStatus.targets?.length ? serverStatus.targets : this.parserTask.targets,
              };
              this.notify();
            }
          } else if (this.storeTask.isProcessing || this.parserTask.isProcessing) {
            // Задача на сервере завершилась
            if (this.storeTask.isProcessing) {
              this.storeTask = { ...this.storeTask, isProcessing: false, statusMessage: serverStatus.status_message || 'Завершено' };
              this.notify();
            }
            if (this.parserTask.isProcessing) {
              this.parserTask = { ...this.parserTask, isProcessing: false, statusMessage: serverStatus.status_message || 'Завершено' };
              this.notify();
            }
          }
        }
      } catch {
        // Фоновая ошибка поллинга — не мешает работе
      }
    }, 2000);
  }
}

export const taskExecutionService = new TaskExecutionService();
