
import asyncio
import uuid
import sys
import os

# Добавляем путь к проекту, чтобы импорты работали
sys.path.append(os.getcwd())

from telegram_service.editorial_memory.service import editorial_memory

async def worker(project_id, user_id, text, results):
    res = await editorial_memory.check_and_register(project_id, user_id, text)
    results.append(res)

async def run_test():
    project_id = str(uuid.uuid4())
    user_id = str(uuid.uuid4())
    text = "Уникальный текст новости для проверки конкуренции. Биткоин вырос!"
    
    tasks = []
    results = []
    
    print(f"Starting 10 parallel requests for the same content...")
    
    for _ in range(10):
        tasks.append(worker(project_id, user_id, text, results))
    
    await asyncio.gather(*tasks)
    
    successful_inserts = [r for r in results if r is not None]
    duplicates = [r for r in results if r is None]
    
    print("-" * 30)
    print(f"Total requests: {len(results)}")
    print(f"Successful inserts: {len(successful_inserts)}")
    print(f"Duplicates rejected: {len(duplicates)}")
    
    if len(successful_inserts) == 1:
        print("✅ SUCCESS: Only one entry created!")
    else:
        print(f"❌ FAILURE: Created {len(successful_inserts)} entries!")

if __name__ == "__main__":
    asyncio.run(run_test())
