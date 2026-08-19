
import React, { useState } from 'react';
import { AppConfig, ProcessedPost } from '../types';
import { processSinglePost } from '../services/postProcessor';
import { apiService, TelegramMessage } from '../services/apiService';
import { Play, Square, CheckCircle2, Loader2, DownloadCloud, Lock, UserCheck, Zap, AlertTriangle } from 'lucide-react';

interface BatchImportPageProps {
  config: AppConfig;
  onNavigateToAuth: () => void;
}

export const BatchImportPage: React.FC<BatchImportPageProps> = ({ config, onNavigateToAuth }) => {
  const [count, setCount] = useState(10);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<ProcessedPost[]>([]);
  const [statusMessage, setStatusMessage] = useState("");

  const isUserAuth = config.telegramAuth.step === 'AUTHENTICATED';

  const startBatch = async () => {
    if (!isUserAuth && !config.isSimulationMode) {
      alert("Для реальной работы подключите аккаунт!");
      return;
    }

    if (!config.sourceUrl || (!config.destinationChannel && !config.isSimulationMode)) {
       alert("Укажите источник и целевой канал в настройках!");
       return;
    }

    setIsProcessing(true);
    setProgress(0);
    setLogs([]);
    setStatusMessage("Подключение к каналу...");

    try {
        let messages: TelegramMessage[] = [];

        if (config.isSimulationMode) {
             // Fake logic for simulation
             for(let i=0; i<count; i++) messages.push({id: i, text: `Fake post ${i} 1000 RUB`, date: '', media_type: 'text', url: ''});
        } else {
             // REAL BACKEND CALL
             setStatusMessage(`Загрузка ${count} постов из ${config.sourceUrl}...`);
             messages = await apiService.fetchHistory(config.sourceUrl, count);
        }

        setStatusMessage("Обработка и публикация...");
        let pendingRetryCount = 0;

        // Process sequentially
        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];

            // 1. Process AI & Pricing
            const result = await processSinglePost(msg.text, config, false);

            // Check if AI failed and post is postponed
            if (result.status === 'pending_retry' || (config.useAI && result.errorMessage && !config.useOriginalOnError)) {
                pendingRetryCount++;
                result.status = 'pending_retry';
                setLogs(prev => [result, ...prev]);
                setProgress(i + 1);
                continue; // DO NOT PUBLISH TO TELEGRAM
            }

            // 2. Send using User API (Backend) if not simulation
            if (!config.isSimulationMode && config.destinationChannel) {
                try {
                    await apiService.sendPost(config.destinationChannel, result.processedContent);
                    result.status = 'success';
                } catch (e: any) {
                    result.status = 'error';
                    result.errorMessage = e.message;
                }
            } else {
                result.status = 'success'; // Sim mode assumed success
            }

            setLogs(prev => [result, ...prev]);
            setProgress(i + 1);
        }

        if (pendingRetryCount > 0) {
            setStatusMessage(`⚠️ AI перегружен, ${pendingRetryCount} постов отложены на повторную обработку`);
        } else {
            setStatusMessage("Обработка завершена!");
        }

    } catch (e: any) {
        alert(`Ошибка пакетной обработки: ${e.message}`);
    } finally {
        setIsProcessing(false);
    }
  };

  if (!isUserAuth && !config.isSimulationMode) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-center max-w-lg mx-auto animate-in fade-in slide-in-from-bottom-4">
        <div className="w-24 h-24 bg-slate-100 rounded-[2rem] flex items-center justify-center mb-8 shadow-inner">
          <Lock className="w-10 h-10 text-slate-300" />
        </div>
        <h2 className="text-3xl font-bold text-slate-900 mb-4 tracking-tight">Доступ ограничен</h2>
        <p className="text-slate-500 mb-10 text-lg leading-relaxed">
           Запустите <code>server.py</code> и авторизуйтесь во вкладке "Аккаунт", чтобы начать реальный импорт.
        </p>
        <button 
          onClick={onNavigateToAuth}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-10 py-4 rounded-2xl font-bold shadow-xl shadow-indigo-200 transition-all hover:-translate-y-1 flex items-center"
        >
          <UserCheck className="w-5 h-5 mr-3" />
          Подключить аккаунт
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      
      <div className="bg-white rounded-[2rem] shadow-[0_10px_40px_-15px_rgba(0,0,0,0.05)] border border-slate-100 p-8 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-indigo-50 to-blue-50 rounded-full blur-3xl -mr-16 -mt-16 opacity-50 pointer-events-none"></div>

        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 relative z-10">
           <div className="flex-1 w-full">
              <h3 className="text-xl font-bold text-slate-900 mb-6 flex items-center">
                 <div className="p-2 bg-blue-50 rounded-lg mr-3 text-blue-600">
                   <DownloadCloud size={20} />
                 </div>
                 Параметры импорта
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                 <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">Откуда (Источник)</label>
                    <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-600 font-medium font-mono text-sm">
                       {config.sourceUrl || '@не_указан'}
                    </div>
                 </div>
                 <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">Сколько постов</label>
                    <input 
                      type="number" 
                      min="1" max="50"
                      value={count}
                      onChange={(e) => setCount(parseInt(e.target.value))}
                      disabled={isProcessing}
                      className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-bold text-slate-800"
                    />
                 </div>
              </div>
           </div>

           <div className="flex flex-col space-y-2 w-full md:w-auto">
                <button
                    onClick={startBatch}
                    disabled={isProcessing}
                    className={`w-full md:w-auto flex items-center justify-center space-x-3 px-10 py-4 rounded-2xl text-white font-bold transition-all ${
                    isProcessing 
                        ? 'bg-slate-800 cursor-not-allowed' 
                        : 'bg-gradient-to-r from-indigo-600 to-blue-600 hover:shadow-lg hover:shadow-indigo-500/30 hover:-translate-y-1'
                    }`}
                >
                    {isProcessing ? <Loader2 className="animate-spin" /> : <Play fill="currentColor" />}
                    <span>{isProcessing ? 'В работе...' : 'Начать перенос'}</span>
                </button>
                {config.isSimulationMode && (
                    <span className="text-[10px] text-amber-600 text-center font-bold uppercase tracking-wider bg-amber-50 rounded py-1">Режим симуляции</span>
                )}
           </div>
        </div>
        
        {isUserAuth && (
           <div className="mt-8 pt-6 border-t border-slate-50 flex items-center text-sm text-emerald-600 font-medium">
             <UserCheck className="w-4 h-4 mr-2" />
             Работает через: {config.telegramAuth.phoneNumber}
           </div>
        )}
      </div>

      {(isProcessing || logs.length > 0) && (
        <div className="bg-white rounded-[2rem] shadow-[0_10px_40px_-15px_rgba(0,0,0,0.05)] border border-slate-100 overflow-hidden animate-in slide-in-from-bottom-8 duration-700">
          <div className="p-8 border-b border-slate-100 bg-slate-50/30">
             <div className="flex justify-between items-center mb-4">
               <div>
                   <h4 className="font-bold text-slate-800 flex items-center">
                    <Zap className="w-4 h-4 text-amber-500 mr-2" fill="currentColor" />
                    Процесс выполнения
                   </h4>
                   {statusMessage && <p className="text-xs text-slate-500 mt-1 animate-pulse">{statusMessage}</p>}
               </div>
               <span className="text-xs font-bold bg-slate-200 text-slate-600 px-3 py-1 rounded-full">{progress} / {count}</span>
             </div>
             
             {/* Progress Bar */}
             <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
               <div 
                 className="bg-gradient-to-r from-blue-500 to-indigo-600 h-full rounded-full transition-all duration-300 ease-out shadow-[0_0_10px_rgba(79,70,229,0.4)]" 
                 style={{ width: `${(progress / count) * 100}%` }}
               >
                 <div className="w-full h-full opacity-30 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9InAiIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTTAgMjBMMjAgMEgwTTAgMjBWMjBMMjAgMjBWMCIgZmlsbD0id2hpdGUiLz48L3BhdHRlcm4+PC9kZWZzPjxyZWN0IHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgZmlsbD0idXJsKCNwKSIvPjwvc3ZnPg==')] animate-[spin_1s_linear_infinite]" />
               </div>
             </div>
          </div>
          
          <div className="max-h-[500px] overflow-y-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-white sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="px-8 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">#</th>
                  <th className="px-8 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Пост (Source)</th>
                  <th className="px-8 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Цены (Calc)</th>
                  <th className="px-8 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider text-right">Статус</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {logs.map((log, idx) => (
                  <tr key={log.id} className="group hover:bg-slate-50/80 transition-colors">
                    <td className="px-8 py-4 text-xs font-mono text-slate-400">{logs.length - idx}</td>
                    <td className="px-8 py-4">
                      <div className="font-medium text-slate-700 truncate max-w-sm">{log.originalContent}</div>
                    </td>
                    <td className="px-8 py-4">
                      {log.calculatedPrices ? (
                         <div className="flex space-x-2 text-xs font-mono">
                           <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded">Opt: {log.calculatedPrices.opt}</span>
                           <span className="bg-violet-50 text-violet-700 px-2 py-1 rounded">Ret: {log.calculatedPrices.retail}</span>
                         </div>
                      ) : <span className="text-slate-300">-</span>}
                    </td>
                    <td className="px-8 py-4 text-right">
                      {log.status === 'success' ? (
                        <span className="inline-flex items-center justify-end text-emerald-600 text-xs font-bold bg-emerald-50 px-3 py-1 rounded-full">
                          <CheckCircle2 className="w-3 h-3 mr-1.5" /> Sent
                        </span>
                      ) : log.status === 'pending_retry' ? (
                        <span className="inline-flex items-center justify-end text-amber-600 text-xs font-bold bg-amber-50 px-3 py-1 rounded-full" title={log.errorMessage || "Отложен из-за ошибки AI"}>
                          <AlertTriangle className="w-3 h-3 mr-1.5" /> Pending Retry
                        </span>
                      ) : (
                        <span className="inline-flex items-center justify-end text-red-500 text-xs font-bold bg-red-50 px-3 py-1 rounded-full" title={log.errorMessage}>
                          <Square className="w-3 h-3 mr-1.5 fill-current" /> Error
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
