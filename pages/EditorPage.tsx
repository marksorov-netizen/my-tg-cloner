import React, { useState } from 'react';
import { AppConfig, ProcessedPost } from '../types';
import { processSinglePost } from '../services/postProcessor';
import { ArrowRight, Play, Loader2, Sparkles, AlertCircle, Send, Edit3, Copy, Check } from 'lucide-react';

interface EditorPageProps {
  config: AppConfig;
}

export const EditorPage: React.FC<EditorPageProps> = ({ config }) => {
  const [inputText, setInputText] = useState("Новая коллекция! Футболки лето. Цена: 1500 RUB. Заходи к нам https://myshop.com @channel");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ProcessedPost | null>(null);
  const [copied, setCopied] = useState(false);

  const handleProcess = async () => {
    setLoading(true);
    try {
      await new Promise(r => setTimeout(r, 800));
      const processed = await processSinglePost(inputText, config, true);
      setResult(processed);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = () => {
    if (result) {
        navigator.clipboard.writeText(result.processedContent);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 h-[calc(100vh-180px)] min-h-[500px]">
      {/* Input Section */}
      <div className="flex flex-col bg-white rounded-3xl shadow-[0_10px_30px_-10px_rgba(0,0,0,0.05)] border border-slate-100 overflow-hidden group focus-within:ring-2 focus-within:ring-indigo-500/20 transition-all">
        <div className="px-6 py-4 border-b border-slate-50 flex justify-between items-center bg-slate-50/50">
          <h3 className="font-bold text-slate-700 flex items-center">
            <Edit3 className="w-4 h-4 mr-2 text-slate-400" /> Исходный пост
          </h3>
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-white px-2 py-1 rounded border border-slate-100">Draft</span>
        </div>
        <textarea
          className="flex-1 p-6 resize-none focus:outline-none text-slate-700 font-mono text-sm leading-relaxed"
          placeholder="Вставьте сюда сырой текст или перешлите сообщение..."
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
        />
        <div className="p-5 border-t border-slate-50 bg-slate-50/30 flex justify-between items-center">
          <div className="flex items-center space-x-2 text-xs font-medium text-slate-500">
             <span className="bg-slate-200 px-2 py-1 rounded">Base: {config.pricing.currencySymbol}</span>
          </div>
          
          <button
            onClick={handleProcess}
            disabled={loading || !inputText}
            className="flex items-center space-x-2 bg-slate-900 text-white px-6 py-3 rounded-xl hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg hover:shadow-xl active:scale-95"
          >
            {loading ? <Loader2 className="animate-spin" size={18} /> : (config.telegramBotToken ? <Send size={18} /> : <Play size={18} fill="currentColor" />)}
            <span className="font-bold">{config.telegramBotToken ? "Обработать и отправить" : "Запуск обработки"}</span>
          </button>
        </div>
      </div>

      {/* Output Section */}
      <div className="flex flex-col bg-slate-900 rounded-3xl shadow-2xl overflow-hidden text-slate-300 relative border border-slate-700/50">
        <div className="px-6 py-4 border-b border-slate-700/50 bg-slate-800/50 flex justify-between items-center backdrop-blur-md">
          <h3 className="font-bold text-white flex items-center">
            <Sparkles className="w-4 h-4 text-amber-400 mr-2" fill="currentColor" />
            Результат AI
          </h3>
          {result && (
             <div className="flex items-center space-x-3">
                <div className={`flex items-center px-2.5 py-1 rounded-lg text-xs font-bold ${result.status === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                   {result.status === 'success' ? 'Sent to Channel' : 'Not Sent'}
                </div>
                <button onClick={copyToClipboard} className="text-slate-400 hover:text-white transition-colors">
                    {copied ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} />}
                </button>
             </div>
          )}
        </div>
        
        <div className="flex-1 p-8 font-mono text-sm leading-relaxed whitespace-pre-wrap overflow-auto scrollbar-thin scrollbar-thumb-slate-700">
          {loading ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 space-y-6">
              <div className="relative">
                <div className="absolute inset-0 bg-indigo-500 blur-xl opacity-20 animate-pulse"></div>
                <Loader2 className="w-12 h-12 animate-spin text-indigo-400 relative z-10" />
              </div>
              <div className="text-center">
                <p className="text-indigo-200 font-medium">Анализ контента...</p>
                <p className="text-xs text-slate-500 mt-2">Gemini генерирует описание и считает цены</p>
              </div>
            </div>
          ) : result ? (
            <div className="animate-in fade-in duration-500">
              {result.errorMessage && (
                <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 text-red-200 rounded-xl text-xs flex items-start">
                   <AlertCircle className="w-4 h-4 mr-2 flex-shrink-0 mt-0.5" />
                   <span>{result.errorMessage}</span>
                </div>
              )}
              {result.processedContent}
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-600">
              <div className="w-16 h-16 rounded-2xl bg-slate-800 flex items-center justify-center mb-4 border border-slate-700">
                 <ArrowRight className="w-6 h-6 opacity-40" />
              </div>
              <p className="font-medium">Результат появится здесь</p>
            </div>
          )}
        </div>
        
        {/* AI недоступен: показываем подсказку когда backend не отвечает */}
        <div className="absolute bottom-6 left-6 right-6 bg-slate-800/90 backdrop-blur border border-slate-600 text-slate-300 p-4 rounded-xl flex items-center text-xs shadow-lg opacity-0 pointer-events-none">
           <AlertCircle className="w-4 h-4 mr-3 text-amber-400 flex-shrink-0" />
           <p>Убедитесь, что запущен <code>run_backend.bat</code> и в .env указан GEMINI_API_KEY.</p>
        </div>

      </div>
    </div>
  );
};