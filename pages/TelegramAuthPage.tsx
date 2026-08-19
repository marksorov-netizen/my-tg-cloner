
import React, { useEffect } from 'react';
import { AppConfig, TelegramAuthState } from '../types';
import { apiService } from '../services/apiService';
import { Key, ShieldCheck, Smartphone, Send, Lock, Loader2, CheckCircle, AlertTriangle, ChevronRight, ServerOff } from 'lucide-react';

interface TelegramAuthPageProps {
  config: AppConfig;
  setConfig: (c: AppConfig) => void;
}

export const TelegramAuthPage: React.FC<TelegramAuthPageProps> = ({ config, setConfig }) => {
  const { telegramAuth } = config;

  const updateAuth = (updates: Partial<TelegramAuthState>) => {
    setConfig({
      ...config,
      telegramAuth: { ...config.telegramAuth, ...updates }
    });
  };

  // Проверка статуса при загрузке
  useEffect(() => {
    const checkBackend = async () => {
       const status = await apiService.checkStatus();
       if (status.status === 'authenticated') {
           updateAuth({ step: 'AUTHENTICATED', phoneNumber: status.user || 'User' });
       } else if (status.status === 'offline') {
           updateAuth({ error: "Сервер offline. Запустите 'python server.py'" });
       }
    };
    checkBackend();
  }, []);

  const handleSendCode = async () => {
    if (!telegramAuth.apiId || !telegramAuth.apiHash || !telegramAuth.phoneNumber) {
       updateAuth({ error: "Заполните все поля (API ID, Hash, Номер)" });
       return;
    }

    updateAuth({ isLoading: true, error: null });
    
    try {
      await apiService.requestAuthCode(telegramAuth.apiId, telegramAuth.apiHash, telegramAuth.phoneNumber);
      updateAuth({ isLoading: false, step: 'CODE_SENT' });
    } catch (e: any) {
      updateAuth({ isLoading: false, error: e.message });
    }
  };

  const handleLogin = async () => {
    if (!telegramAuth.verificationCode) {
      updateAuth({ error: "Введите код подтверждения" });
      return;
    }

    updateAuth({ isLoading: true, error: null });

    try {
      await apiService.login(telegramAuth.phoneNumber, telegramAuth.verificationCode);
      updateAuth({ isLoading: false, step: 'AUTHENTICATED' });
    } catch (e: any) {
      updateAuth({ isLoading: false, error: e.message });
    }
  };

  const handleLogout = async () => {
    if(window.confirm("Вы уверены, что хотите выйти из аккаунта?")) {
      try {
        await apiService.logout();
        updateAuth({ 
            step: 'IDLE', 
            verificationCode: '', 
            apiId: '', 
            apiHash: '', 
            phoneNumber: '' 
        });
      } catch (e) {
        alert("Ошибка выхода");
      }
    }
  };

  if (telegramAuth.step === 'AUTHENTICATED') {
    return (
      <div className="max-w-2xl mx-auto mt-12 animate-in fade-in zoom-in duration-500">
        <div className="bg-white rounded-[2rem] p-12 text-center shadow-[0_20px_60px_-15px_rgba(0,0,0,0.1)] border border-slate-100 relative overflow-hidden">
           <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-emerald-400 via-teal-500 to-emerald-600"></div>
           
           <div className="w-24 h-24 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-8 shadow-inner">
             <CheckCircle className="w-12 h-12 text-emerald-500" strokeWidth={3} />
           </div>
           
           <h2 className="text-3xl font-bold text-slate-900 mb-2">Аккаунт подключен</h2>
           <p className="text-slate-500 text-lg mb-8">
             Backend авторизован как <span className="font-mono font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg">{telegramAuth.phoneNumber}</span>
           </p>
           
           <button 
             onClick={handleLogout}
             className="text-sm text-red-500 hover:text-red-700 font-bold hover:bg-red-50 px-6 py-2 rounded-full transition-colors"
           >
             Отключить аккаунт
           </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
       <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
         
         {/* Info Column */}
         <div className="lg:col-span-5 space-y-6">
           <div className="bg-gradient-to-br from-indigo-600 to-violet-700 rounded-[2rem] p-8 text-white shadow-xl shadow-indigo-200 relative overflow-hidden">
             <div className="absolute top-0 right-0 -mr-8 -mt-8 w-32 h-32 bg-white opacity-10 rounded-full blur-2xl"></div>
             
             <h3 className="text-xl font-bold mb-4 flex items-center">
               <Key className="w-6 h-6 mr-3 opacity-80" /> API Credentials
             </h3>
             <p className="text-indigo-100 text-sm leading-relaxed mb-6">
               Чтобы это работало, убедитесь, что вы запустили <b>server.py</b> на своем компьютере.
             </p>
             
             <div className="p-4 bg-black/20 rounded-xl font-mono text-xs text-indigo-100 border border-white/10">
               pip install fastapi uvicorn telethon<br/>
               python server.py
             </div>
           </div>
         </div>

         {/* Form Column */}
         <div className="lg:col-span-7">
           <div className="bg-white rounded-[2rem] shadow-[0_10px_40px_-10px_rgba(0,0,0,0.05)] border border-slate-100 overflow-hidden">
             <div className="px-8 py-6 border-b border-slate-50 bg-slate-50/50">
               <h2 className="text-lg font-bold text-slate-900">Вход в аккаунт (Real)</h2>
               <p className="text-sm text-slate-500 mt-1">Подключение к python-backend</p>
             </div>
             
             <div className="p-8 space-y-8">
               
               {/* Step 1 */}
               <div className={`space-y-6 transition-all duration-500 ${telegramAuth.step === 'CODE_SENT' ? 'opacity-40 pointer-events-none grayscale' : ''}`}>
                 <div className="grid grid-cols-2 gap-5">
                   <div className="space-y-2">
                     <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">App api_id</label>
                     <input 
                        type="text" 
                        placeholder="12345678"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 focus:bg-white outline-none transition-all font-mono text-sm"
                        value={telegramAuth.apiId}
                        onChange={(e) => updateAuth({ apiId: e.target.value })}
                     />
                   </div>
                   <div className="space-y-2">
                     <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">App api_hash</label>
                     <input 
                        type="password" 
                        placeholder="••••••••••••••"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 focus:bg-white outline-none transition-all font-mono text-sm"
                        value={telegramAuth.apiHash}
                        onChange={(e) => updateAuth({ apiHash: e.target.value })}
                     />
                   </div>
                 </div>
                 
                 <div className="space-y-2">
                   <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">Номер телефона</label>
                   <div className="relative group">
                     <div className="absolute left-4 top-3.5 text-slate-400 group-focus-within:text-indigo-500 transition-colors">
                        <Smartphone size={20} />
                     </div>
                     <input 
                        type="text" 
                        placeholder="+7 900 123 45 67"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-12 pr-4 py-3 focus:ring-2 focus:ring-indigo-500 focus:bg-white outline-none transition-all font-mono text-lg font-medium text-slate-800"
                        value={telegramAuth.phoneNumber}
                        onChange={(e) => updateAuth({ phoneNumber: e.target.value })}
                     />
                   </div>
                 </div>

                 {telegramAuth.step === 'IDLE' && (
                   <button 
                     onClick={handleSendCode}
                     disabled={telegramAuth.isLoading}
                     className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-4 rounded-xl flex justify-center items-center transition-all shadow-lg hover:shadow-xl active:scale-[0.98]"
                   >
                     {telegramAuth.isLoading ? <Loader2 className="animate-spin w-5 h-5" /> : (
                       <>
                         Получить код <ChevronRight className="w-5 h-5 ml-2" />
                       </>
                     )}
                   </button>
                 )}
               </div>

               {/* Step 2 */}
               {telegramAuth.step === 'CODE_SENT' && (
                 <div className="pt-8 border-t border-slate-100 animate-in slide-in-from-bottom-6 fade-in duration-500">
                   <div className="space-y-6">
                     <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">Код подтверждения</label>
                        <button onClick={() => updateAuth({ step: 'IDLE' })} className="text-xs font-bold text-indigo-600 hover:text-indigo-700">← Изменить данные</button>
                     </div>
                     <div className="relative group">
                       <div className="absolute left-4 top-3.5 text-slate-400 group-focus-within:text-emerald-500 transition-colors">
                          <Lock size={20} />
                       </div>
                       <input 
                          type="text" 
                          placeholder="1 2 3 4 5"
                          className="w-full bg-white border-2 border-indigo-500 rounded-xl pl-12 pr-4 py-3 focus:outline-none font-mono text-xl font-bold tracking-[0.5em] text-center"
                          value={telegramAuth.verificationCode}
                          onChange={(e) => updateAuth({ verificationCode: e.target.value })}
                          autoFocus
                       />
                     </div>
                     
                     <button 
                       onClick={handleLogin}
                       disabled={telegramAuth.isLoading}
                       className="w-full bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white font-bold py-4 rounded-xl flex justify-center items-center transition-all shadow-lg"
                     >
                       {telegramAuth.isLoading ? <Loader2 className="animate-spin w-5 h-5" /> : (
                         <>
                           <ShieldCheck className="w-5 h-5 mr-2" /> Подтвердить вход
                         </>
                       )}
                     </button>
                   </div>
                 </div>
               )}

               {telegramAuth.error && (
                 <div className="p-4 bg-red-50 border border-red-100 text-red-600 text-sm font-medium rounded-xl flex items-center animate-in shake">
                   <AlertTriangle className="w-5 h-5 mr-3 flex-shrink-0" />
                   {telegramAuth.error}
                 </div>
               )}

             </div>
           </div>
         </div>
       </div>
    </div>
  );
};
