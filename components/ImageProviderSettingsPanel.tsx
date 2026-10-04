import { useEffect, useState } from 'react';
import { apiService, ImageProviderSettings } from '../services/apiService';

export function ImageProviderSettingsPanel({ onSaved, disabled = false }: { onSaved?: () => void; disabled?: boolean }) {
  const [provider, setProvider] = useState<'openai' | 'zapro'>('zapro');
  const [key, setKey] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [limit, setLimit] = useState(5);
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const apply = (value: ImageProviderSettings) => {
    setProvider(value.provider); setEnabled(value.enabled); setLimit(value.daily_limit);
    setConfigured(value.key_configured); setKey('');
  };
  useEffect(() => {
    let active = true;
    const refresh = () => {
      apiService.imageProviderSettings().then(value => { if (active) { apply(value); setLoaded(true); } })
        .catch(exc => { if (active) setError(exc instanceof Error ? exc.message : 'Не удалось загрузить настройки.'); });
    };
    refresh();
    window.addEventListener('product-image-settings-updated', refresh);
    return () => { active = false; window.removeEventListener('product-image-settings-updated', refresh); };
  }, []);

  const run = async (action: 'save' | 'check' | 'clear') => {
    if (busy || disabled) return;
    setBusy(true); setError(''); setMessage('');
    try {
      if (action === 'check') {
        const value = await apiService.checkImageProvider();
        if (value.available) setMessage(value.message); else setError(value.message);
      } else {
        const value = action === 'clear' ? await apiService.clearImageProviderSettings()
          : await apiService.saveImageProviderSettings({ provider, enabled, daily_limit: limit, ...(key.trim() ? { api_key: key.trim() } : {}) });
        apply(value); setMessage(action === 'clear' ? 'Ключ удалён, генерация выключена.' : 'Личные настройки сохранены.');
        onSaved?.();
      }
    } catch (exc) { setError(exc instanceof Error ? exc.message : 'Ошибка настройки провайдера.'); }
    finally { setBusy(false); }
  };

  return <section className="bg-white text-slate-900 border border-slate-200 rounded-2xl p-4 space-y-3">
    <h3 className="font-bold">Мой API для изображений</h3>
    <p className="text-sm text-slate-600">GPT Image 2 · личный баланс выбранного провайдера. Настройки относятся только к вашему аккаунту.</p>
    <fieldset disabled={busy || disabled || !loaded} className="space-y-3 disabled:opacity-60">
      <label className="block text-sm">Провайдер
        <select value={provider} onChange={e => { setProvider(e.target.value as 'openai' | 'zapro'); setConfigured(false); setKey(''); setEnabled(false); setMessage('Для другого провайдера сохраните его ключ.'); }} className="block w-full border rounded-lg p-2 mt-1">
          <option value="zapro">Zapro — po.zapro.su</option><option value="openai">OpenAI — прямой API</option>
        </select>
      </label>
      <label className="block text-sm">API-ключ {configured ? '(уже сохранён; оставьте пустым, чтобы сохранить прежний)' : ''}
        <input type="password" autoComplete="new-password" value={key} maxLength={512} onChange={e => setKey(e.target.value)} placeholder="Вставьте ключ провайдера" className="block w-full border rounded-lg p-2 mt-1" />
      </label>
      <label className="block text-sm"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} /> Включить генерацию с моим ключом</label>
      <label className="block text-sm">Лимит попыток за день (UTC)
        <input type="number" min={1} max={100} value={limit} onChange={e => setLimit(Number(e.target.value))} className="block border rounded-lg p-2 mt-1 w-24" />
      </label>
    </fieldset>
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => run('save')} disabled={busy || disabled || !loaded} className="bg-indigo-600 text-white rounded-lg px-3 py-2 disabled:opacity-50">Сохранить API</button>
      <button type="button" onClick={() => run('check')} disabled={busy || disabled || !configured || !enabled} className="border rounded-lg px-3 py-2 disabled:opacity-50">Проверить доступ без генерации</button>
      <button type="button" onClick={() => run('clear')} disabled={busy || disabled || !loaded} className="text-red-700 border rounded-lg px-3 py-2 disabled:opacity-50">Удалить ключ и выключить</button>
    </div>
    {message && <p role="status" className="text-sm text-emerald-700">{message}</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <details className="text-sm text-slate-600">
      <summary className="cursor-pointer font-medium">Как настроить Zapro</summary>
      <ol className="list-decimal pl-5 mt-2 space-y-1">
        <li>На <a href="https://po.zapro.su/keys" target="_blank" rel="noreferrer" className="underline">Zapro создайте API-ключ</a> с группой AUTO. Убедитесь, что у ключа разрешена модель gpt-image-2.</li>
        <li>Выберите Zapro, вставьте ключ, включите генерацию и сохраните API. Поле адреса не требуется.</li>
        <li>Нажмите проверку доступа: она запрашивает каталог моделей, фото не создаёт.</li>
        <li>Откройте «Редактор», выберите фото нашей модели и одно фото товара для первой пробы. Затем можно обработать до пяти расцветок.</li>
      </ol>
      <p className="mt-2">Ключ шифруется на сервере и не хранится в localStorage. Фото и промпт передаются выбранному провайдеру. Первая генерация платная; каталог не доказывает работоспособность редактирования. Лимит попыток сбрасывается при перезапуске сервера. Тариф и списания смотрите в кабинете Zapro.</p>
    </details>
  </section>;
}
