import { useEffect, useRef, useState } from 'react';
import { apiService } from '../services/apiService';
import { ImageProviderSettingsPanel } from './ImageProviderSettingsPanel';

type Preview = { source: string; output?: string; error?: string };

export function ProductImagePilot() {
  const [products, setProducts] = useState<File[]>([]);
  const [avatar, setAvatar] = useState<File | null>(null);
  const [subject, setSubject] = useState('Сумка');
  const [scene, setScene] = useState('Светлая фотостудия, мягкий свет, спокойная поза анфас. Сумка полностью видна.');
  const [quality, setQuality] = useState<'medium' | 'high'>('high');
  const [status, setStatus] = useState<{ provider: 'openai' | 'zapro'; ready: boolean; remaining: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [previews, setPreviews] = useState<Preview[]>([]);
  const urls = useRef<string[]>([]);
  const requestId = useRef<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const refresh = () => {
      requestId.current = null; setPreviews([]); setError('');
      urls.current.forEach(URL.revokeObjectURL); urls.current = [];
      apiService.productImageStatus().then(value => { if (mounted.current) setStatus(value); })
        .catch(() => { if (mounted.current) setError('Не удалось проверить доступность генерации.'); });
    };
    refresh();
    window.addEventListener('product-image-settings-updated', refresh);
    return () => {
      mounted.current = false; window.removeEventListener('product-image-settings-updated', refresh);
      urls.current.forEach(URL.revokeObjectURL); urls.current = [];
    };
  }, []);

  const changed = () => {
    requestId.current = null; setError(''); setPreviews([]);
    urls.current.forEach(URL.revokeObjectURL); urls.current = [];
  };
  const refreshSettings = () => {
    changed();
    apiService.productImageStatus().then(value => { if (mounted.current) setStatus(value); })
      .catch(exc => { if (mounted.current) setError(exc instanceof Error ? exc.message : 'Ошибка настроек.'); });
  };
  const generate = async () => {
    if (!avatar || busy) return;
    if (products.length < 1 || products.length > 5 || !scene.trim()) {
      setError('Выберите 1–5 фото товара и заполните описание сцены.'); return;
    }
    if ([avatar, ...products].some(file => file.size > 10 * 1024 * 1024)) {
      setError('Каждый файл должен быть не больше 10 МБ.'); return;
    }
    setBusy(true); setError('');
    urls.current.forEach(URL.revokeObjectURL); urls.current = [];
    const objectURL = (blob: Blob) => { const url = URL.createObjectURL(blob); urls.current.push(url); return url; };
    const initial = products.map(file => ({ source: objectURL(file) }));
    setPreviews(initial);
    requestId.current ??= crypto.randomUUID();
    try {
      const result = await apiService.generateProductImages(products, avatar, scene, quality, requestId.current, subject);
      if (!mounted.current) return;
      const next: Preview[] = [...initial];
      for (const item of result.results) {
        if (item.filename) {
          try {
            const blob = await apiService.productImageBlob(item.filename);
            if (!mounted.current) return;
            next[item.index] = { ...initial[item.index], output: objectURL(blob) };
          } catch { next[item.index] = { ...initial[item.index], error: 'Фото создано, но загрузка не удалась. Повторное нажатие вернёт тот же результат.' }; }
        } else next[item.index] = { ...initial[item.index], error: item.error || 'Нет результата.' };
      }
      setPreviews(next);
      if (result.status !== 'success') setError('Часть изображений не создана. См. причину под соответствующим фото.');
      const currentStatus = await apiService.productImageStatus();
      if (mounted.current) setStatus(currentStatus);
      // Keep this ID for recovery/download: changing an input starts a new paid request.
    } catch (exc) {
      if (mounted.current) setError(exc instanceof Error ? exc.message : 'Ошибка генерации.');
    } finally { if (mounted.current) setBusy(false); }
  };

  return <section className="bg-white text-slate-900 rounded-3xl border border-slate-200 p-6 space-y-4">
    <h2 className="text-xl font-bold text-slate-900">Фото товара на нашей модели · GPT Image 2</h2>
    <ImageProviderSettingsPanel onSaved={refreshSettings} disabled={busy} />
    <p className="text-sm text-slate-600">Тест по референсам: отдельный результат для каждого фото. В Telegram результаты отправляются после ручной проверки и скачивания.</p>
    {status && <p className="text-sm text-slate-600">{status.ready ? `${status.provider === 'zapro' ? 'Zapro' : 'OpenAI'} · доступно попыток сегодня: ${status.remaining}` : 'Генерация выключена. Сохраните личный ключ выше и включите генерацию.'}</p>}
    <fieldset disabled={busy} className="grid gap-4 md:grid-cols-2 disabled:opacity-60">
      <label className="text-sm font-medium">Фото нашей виртуальной модели
        <input type="file" accept="image/jpeg,image/png,image/webp" className="block mt-2 w-full" onChange={e => { setAvatar(e.target.files?.[0] || null); changed(); }} />
      </label>
      <label className="text-sm font-medium">Фото товара: 1–5 расцветок, по одному фото на вариант
        <input type="file" multiple accept="image/jpeg,image/png,image/webp" className="block mt-2 w-full" onChange={e => { setProducts(Array.from(e.target.files || [])); changed(); }} />
      </label>
      <label className="text-sm font-medium md:col-span-2">Что продаём на фото донора
        <input value={subject} maxLength={500} onChange={e => { setSubject(e.target.value); changed(); }} placeholder="Например: кожаная сумка в руке человека; переносим только сумку" className="block w-full mt-2 border rounded-xl p-3" />
      </label>
      <label className="text-sm font-medium md:col-span-2">Фон, свет и поза
        <textarea value={scene} maxLength={1500} onChange={e => { setScene(e.target.value); changed(); }} className="block w-full mt-2 border rounded-xl p-3" />
      </label>
      <label className="text-sm font-medium">Качество
        <select value={quality} onChange={e => { setQuality(e.target.value as 'medium' | 'high'); changed(); }} className="block mt-2 border rounded-lg p-2">
          <option value="high">Высокое</option><option value="medium">Среднее — для первых проб</option>
        </select>
      </label>
    </fieldset>
    <p className="text-sm text-slate-600">Запуск использует платный API-баланс, подписка Plus его не оплачивает. Автоповторы отключены. Перед публикацией проверьте цвет, форму, фурнитуру и лицо.</p>
    <button type="button" disabled={busy || !status?.ready || !avatar || !products.length} onClick={generate} className="bg-indigo-600 text-white px-5 py-3 rounded-xl disabled:opacity-50">
      {busy ? 'Генерация… Не закрывайте страницу' : requestId.current ? 'Получить результат этого запроса' : `Создать ${products.length || ''} фото через платный API`}
    </button>
    {error && <p role="alert" className="text-red-700 text-sm">{error}</p>}
    <div className="grid gap-4 md:grid-cols-2">{previews.map((item, index) => <article key={index} className="border rounded-xl p-3 space-y-2">
      <p className="font-medium">Вариант {index + 1}: {products[index]?.name}</p>
      <div className="grid grid-cols-2 gap-2"><img src={item.source} alt={`Исходное фото ${index + 1}`} className="w-full rounded-lg" />
        {item.output && <img src={item.output} alt={`Сгенерированное фото ${index + 1}`} className="w-full rounded-lg" />}</div>
      {item.output && <a href={item.output} download={`product-variant-${index + 1}.png`} className="text-indigo-600 underline">Скачать результат</a>}
      {item.error && <p className="text-red-700 text-sm">{item.error}</p>}
    </article>)}</div>
  </section>;
}
