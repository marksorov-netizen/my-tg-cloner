import sys
import os
import shutil
import asyncio

try:
    if sys.platform == "win32":
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

from core.vton_engine import vton_engine

async def main():
    if len(sys.argv) > 1 and os.path.exists(sys.argv[1]):
        garment_path = os.path.abspath(sys.argv[1])
    else:
        garment_path = os.path.abspath("temp_media/bot_preview/photo_2026-08-14_20-26-49 (1).jpg")

    if not os.path.exists(garment_path):
        print(f"[!] Файл не найден: {garment_path}")
        return

    print("========================================================")
    print("[VTON] Запуск виртуальной примерки на фирменную модель...")
    print(f"[FILE] Исходный файл: {garment_path}")
    print("[WAIT] Отправляем запрос на сервер IDM-VTON (20-30 сек)...")
    print("========================================================")

    res = await vton_engine.try_on_garment(garment_path)
    if res and os.path.exists(res):
        desktop = os.path.join(os.path.expanduser("~"), "Desktop")
        dest = os.path.join(desktop, "РЕЗУЛЬТАТ_ПРИМЕРКИ.jpg")
        shutil.copy(res, dest)
        print("\n[SUCCESS] ГОТОВО! Успешная примерка!")
        print(f"[SAVED] Результат сохранён: {dest}")
        try:
            os.system(f'start "" "{dest}"')
        except Exception:
            pass
    else:
        print("\n[ERROR] Ошибка примерки. Проверьте подключение.")

if __name__ == "__main__":
    asyncio.run(main())
