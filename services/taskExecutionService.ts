/**
 * services/taskExecutionService.ts
 *
 * Глобальный сервис выполнения парсинга и переноса постов.
 * Хранит состояние активного переноса в памяти приложения,
 * управляет мгновенной отменой (cancellation tokens) и гарантирует,
 * что остановка работает мгновенно из любой вкладки и любого состояния.
 */

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
    donors: ['@breakingnews_ru'],
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

  public getStoreState(): ActiveTaskState {
    return this.storeTask;
  }

  public getParserState(): ActiveTaskState {
    return this.parserTask;
  }

  public startStoreTask() {
    this.storeCancelled = false;
    this.updateStoreState({
      isProcessing: true,
      isLiveMonitoring: false,
      countdownSec: 0,
    });
  }

  public stopStore() {
    this.storeCancelled = true;
    this.updateStoreState({
      isProcessing: false,
      isLiveMonitoring: false,
      countdownSec: 0,
      statusMessage: '⏹ Процесс переноса мгновенно остановлен'
    });
  }

  public isStoreCancelled(): boolean {
    return this.storeCancelled || !this.storeTask.isProcessing;
  }

  public startParserTask() {
    this.parserCancelled = false;
    this.updateParserState({
      isProcessing: true,
      isLiveMonitoring: false,
      countdownSec: 0,
    });
  }

  public stopParser() {
    this.parserCancelled = true;
    this.updateParserState({
      isProcessing: false,
      isLiveMonitoring: false,
      countdownSec: 0,
      statusMessage: '⏹ Парсинг мгновенно остановлен пользователем'
    });
  }

  public isParserCancelled(): boolean {
    return this.parserCancelled || !this.parserTask.isProcessing;
  }

  public updateStoreState(partial: Partial<ActiveTaskState>) {
    this.storeTask = { ...this.storeTask, ...partial };
    this.notify();
  }

  public updateParserState(partial: Partial<ActiveTaskState>) {
    this.parserTask = { ...this.parserTask, ...partial };
    this.notify();
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
}

export const taskExecutionService = new TaskExecutionService();
