import { useEffect, useRef, useState } from 'react';
import { apiService } from '../services/apiService';

export function ProductParserSettings({enabled, onChange, disabled}: {enabled: boolean; onChange: (value: boolean) => void; disabled: boolean}) {
  const [models, setModels] = useState<File[]>([]);
  const [subject, setSubject] = useState('Сумка');
  const [scene, setScene] = useState('Светлая студия, мягкий свет. Товар полностью виден.');
  const [configured, setConfigured] = useState(false);
  const [modelCount, setModelCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [job, setJob] = useState<Awaited<ReturnType<typeof apiService.getProductParserStatus>> | null>(null);
  const [outputs, setOutputs] = useState<{name: string; url: string}[]>([]);
  const urls = useRef<Map<string, string>>(new Map());
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let active = true;
    apiService.getProductParserModel().then(value => {
      if (!active) return;
      setSubject(value.subject); setScene(value.scene); setConfigured(value.configured); setModelCount(value.model_count);
    }).catch(() => { if (active) setMessage('Не удалось загрузить настройки модели.'); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    let polling = false;
    const refresh = async () => {
      if (polling) return;
      polling = true;
      try {
        const value = await apiService.getProductParserStatus();
        if (!active) return;
        setJob(value);
        const files = value.generated_files || [];
        for (const name of files) {
          if (urls.current.has(name)) continue;
          const blob = await apiService.productImageBlob(name);
          if (!active) return;
          urls.current.set(name, URL.createObjectURL(blob));
        }
        if (active) setOutputs(files.map(name => ({name, url: urls.current.get(name)!})));
      } catch { /* Keep the last known result when polling is temporarily unavailable. */ }
      finally { polling = false; }
    };
    void refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => {
      active = false; clearInterval(timer);
      urls.current.forEach(URL.revokeObjectURL); urls.current.clear();
    };
  }, []);
  const save = async () => {
    setBusy(true); setMessage('');
    try {
      const value = await apiService.saveProductParserModel(models, subject, scene);
      setConfigured(value.configured); setModelCount(value.model_count); setModels([]);
      if (fileInput.current) fileInput.current.value = '';
      setMessage('Модель и описание сохранены. При запуске будут использованы эти настройки.');
    } catch (exc) { setMessage(exc instanceof Error ? exc.message : 'Ошибка сохранения.'); }
    finally { setBusy(false); }
  };
  return <section className="bg-white text-slate-900 rounded-2xl p-5 space-y-3 my-4">
    <label className="flex items-center gap-3 font-semibold"><input type="checkbox" checked={enabled} disabled={disabled || busy} onChange={e => onChange(e.target.checked)} />
      Переносить товары на нашу модель через GPT Image 2 в фоне
    </label>
    {enabled && <>
      <p className="text-sm text-slate-600">Платная генерация: бот перенесёт товар из донорских фото на вашу модель и отправит готовый альбом в ваши каналы. Работает после закрытия вкладки.</p>
      <fieldset disabled={disabled || busy} className="space-y-3" style={{minWidth: 0, width: '100%'}}>
        <label className="block text-sm">Фото одной взрослой виртуальной модели — 1–3 ракурса
          <input ref={fileInput} type="file" multiple accept="image/jpeg,image/png,image/webp" className="block mt-2 w-full" onChange={e => setModels(Array.from(e.target.files || []))} />
        </label>
        <p className="text-sm">{configured ? `Сохранено фото модели: ${modelCount}. Без новых файлов сохранятся прежние.` : 'Фото модели ещё не сохранено.'} Начните с чёткого анфаса в полный рост.</p>
        <label className="block text-sm">Что продаём на фото
          <input value={subject} maxLength={500} onChange={e => setSubject(e.target.value)} className="block mt-1 border rounded-lg p-2 w-full" placeholder="Сумка в руке человека. Перенести только сумку." />
        </label>
        <label className="block text-sm">Фон, свет и поза
          <textarea value={scene} maxLength={1500} onChange={e => setScene(e.target.value)} className="block mt-1 border rounded-lg p-2 w-full" />
        </label>
        <button type="button" onClick={save} disabled={!subject.trim() || !scene.trim() || models.length > 3 || (!models.length && !configured)} className="bg-indigo-600 text-white rounded-lg px-4 py-2 disabled:opacity-50">{busy ? 'Сохранение…' : 'Сохранить модель и описание'}</button>
      </fieldset>
      <p className="text-sm text-slate-600">Сохраните модель и настройте API в профиле. Для первого теста: 1 пост, мониторинг выключен. Пять фото требуют дневной лимит не меньше 5.</p>
      <details className="text-sm text-slate-600"><summary className="cursor-pointer">Ракурсы, расходы и мониторинг</summary>
        <p className="mt-2">Можно добавить профиль и вид сзади той же модели. Бот использует все фото альбома (до 10) и создаёт отдельный результат по каждому исходнику: один исходник — один платный запрос. Фото донора задаёт товар и цвет, ракурсы нашей модели — внешность. Несколько исходных ракурсов одного цвета тоже обрабатываются отдельно.</p>
        <p className="mt-2">Если мониторинг включён, после импорта бот ждёт новые альбомы донора. При ошибке перенос останавливается. Видео и очистка водяных знаков в этом режиме не запускаются. После перезапуска сервера задача не продолжается автоматически.</p>
      </details>
    </>}
    {message && <p role="status" className="text-sm">{message}</p>}
    {job && job.status !== 'idle' && <div className="border-t pt-3 space-y-2">
      <p role="status">{job.message} {job.current || 0}/{job.total || 0}</p>
      {job.logs?.map((log, index) => <p key={index} className={log.status === 'error' ? 'text-red-700 text-sm' : 'text-sm'}>{log.text}</p>)}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">{outputs.map(item => <a key={item.name} href={item.url} download={item.name}><img src={item.url} alt="Результат переноса товара на нашу модель" className="rounded-lg w-full" /><span className="text-sm underline">Скачать фото</span></a>)}</div>
      <p className="text-xs text-slate-600">Остановка запрещает следующие запросы и публикацию. Уже отправленный генератору запрос может завершиться и быть оплачен.</p>
    </div>}
  </section>;
}
