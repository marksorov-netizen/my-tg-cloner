
import re
import hashlib
from simhash import Simhash
from PIL import Image
import imagehash
import io

def normalize_text(text: str) -> str:
    """Удаляет лишние пробелы, пунктуацию и приводит к нижнему регистру для стабильного хэша."""
    if not text:
        return ""
    text = text.lower()
    # Оставляем только буквы и цифры
    text = re.sub(r'[^\w\s]', '', text)
    # Схлопываем пробелы
    text = re.sub(r'\s+', ' ', text).strip()
    return text

def get_text_hash(text: str) -> str:
    """Генерирует SimHash для текста, устойчивый к мелким изменениям."""
    normalized = normalize_text(text)
    if not normalized:
        return "empty"
    # Simhash возвращает 64-битное число, приводим к строке
    return str(Simhash(normalized).value)

def get_media_hash(file_bytes: bytes, mime_type: str = "image/jpeg") -> str:
    """Генерирует pHash для изображений или SHA256 для других файлов."""
    if not file_bytes:
        return "no_media"
    
    try:
        if "image" in mime_type:
            img = Image.open(io.BytesIO(file_bytes))
            # Perceptual hash устойчив к ресайзу и сжатию
            return str(imagehash.phash(img))
        else:
            # Для видео и файлов используем обычный хеш содержимого
            return hashlib.sha256(file_bytes).hexdigest()
    except Exception as e:
        print(f"Hashing error: {e}")
        return hashlib.sha256(file_bytes).hexdigest()
