"""
core/donor_sanitizer.py

Многоуровневая система абсолютной очистки текста донора:
1. Удаление любых номеров телефонов (+7, 8, WhatsApp, международные).
2. Удаление ссылок на соцсети, мессенджеры и сторонние сайты (t.me, wa.me, vk.me, max.ru, instagram).
3. Удаление чужих упоминаний менеджеров и каналов (@...).
4. Удаление рыночных адресов, павильонов, корпусов и линий (Садовод, ТЯК, Люблино, Б-2А-49).
5. Удаление призывов донора к оформлению заказа и реквизитов поставщика.
6. Удаление донорских хэштегов и висячих символов/эмодзи.
"""

import re
from typing import Optional

# Регулярные выражения для телефонов
RE_PHONE_RU = re.compile(r'(?:\+?7|8)[\s\-\(]*\d{3}[\s\-\)]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}')
RE_PHONE_INTL = re.compile(r'\+?\d{1,3}[\s\-\(]*\d{2,4}[\s\-\)]*[\d\s\-]{5,10}\d')
RE_PHONE_KEYWORDS = re.compile(
    r'(?:тел(?:ефон)?|сот(?:овый)?|моб(?:ильный)?|ва(?:т|тс)?апп?|whatsapp|wa|viber|вайбер|tg|контакт[ы]?|номер|связь|звон[ок]?|заказ[ы]?)[\s\:\-—\.\(]*\+?[\d\s\-\(\)]{7,}\d',
    re.I
)

# Регулярные выражения для рынков, павильонов и поставщиков
RE_MARKET_KEYWORDS = re.compile(
    r'(?:садовод|тк\s*садовод|тяк(?:\s*москва)?|люблино|дубровка|южные\s*ворота|апрашка|апраксин|таганский\s*ряд|линия\s*\d+|корпус\s*[а-яё\d]+|павильон\s*[\w\-]+|место\s*[\w\-]+|этаж\s*\d+|контейнер\s*[\w\-]+)',
    re.I
)
# Паттерн номеров павильонов типа Б-2А-49, СТ-7-35, АН-2-15
RE_PAVILION_CODE = re.compile(r'\b[А-Яа-яA-Za-z]{1,3}\s*[-–—]\s*\d+[А-Яа-яA-Za-z]?\s*[-–—]\s*\d+\b')

# Призывы донора к заказу и условия опта/доставки рынка
RE_DONOR_CTA = re.compile(
    r'^(?:[🛍️🛒👉👆📞📲☎️✅▪️•\*\s]*)(?:для\s*(?:оформления\s*)?заказа|оформить\s*заказ|заказ[ы]?\s*принимает|менеджер|по\s*вопросам\s*заказа|связаться|написать|бронь(?:\s*от)?|сборка|минималк[а-я]*|прямой\s*поставщик|поставщик|рынок|садовод|отправка\s*(?:по\s*всей\s*россии|автобусами|тк)|самовывоз|штучно\s*(?:от|по))[\s\:\-—\.\*]*$',
    re.I
)

# Донорские цены поставщика в исходном формате (например, "Штучно: 1700 ₽ | опт: 1600 ₽")
RE_SUPPLIER_RAW_PRICE = re.compile(r'^(?:[▪️•\*\s]*)(?:штучно|опт(?:ом)?)\s*[:\-—]?\s*\d+.*$', re.I)

# Донорские хэштеги
RE_DONOR_HASHTAGS = re.compile(
    r'#(?:садовод|velvet|тяк|рынок|поставщик|люблино|дубровка|женскаяодежда_садовод|мужскаяодежда_садовод|тксадовод|вещисадовод|одеждасадовод)[\w]*',
    re.I
)

# Висячие эмодзи и служебные знаки
RE_DANGLING_ICONS = re.compile(r'^[🛍️🛒👉👆📞📲☎️✅▪️•\-–—\s\*\#]+$')


def sanitize_donor_text(text: str, allowed_bot: Optional[str] = None) -> str:
    """
    Полная зачистка текста донора от любых контактов, телефонов, ссылок и рыночных маркеров.
    - allowed_bot: ник нашего бота или ссылка, которую разрешено оставить в тексте.
    """
    if not text or not text.strip():
        return ""

    bot_clean = allowed_bot.strip().lstrip('@').lower() if allowed_bot else None

    lines = text.split('\n')
    cleaned_lines = []

    for line in lines:
        stripped = line.strip()
        if not stripped:
            cleaned_lines.append('')
            continue

        # 1. Проверка на телефоны
        if RE_PHONE_RU.search(stripped) or RE_PHONE_KEYWORDS.search(stripped) or RE_PHONE_INTL.search(stripped):
            continue

        # 2. Проверка на призывы донора к заказу
        if RE_DONOR_CTA.match(stripped):
            continue

        # 3. Проверка на сырые строки цен поставщика (если остались)
        if RE_SUPPLIER_RAW_PRICE.match(stripped):
            continue

        # 4. Проверка на рынки и павильоны (Садовод, Б-2А-49 и т.д.)
        if RE_MARKET_KEYWORDS.search(stripped) or RE_PAVILION_CODE.search(stripped):
            continue

        # 5. Очистка Markdown-ссылок [Текст](http://...)
        def replace_md_link(m):
            link_text = m.group(1)
            url = m.group(2)
            if bot_clean and bot_clean in url.lower():
                return m.group(0)
            return ''

        line_clean = re.sub(r'\[([^\]]*)\]\((https?://[^\)]+)\)', replace_md_link, line)

        # 6. Очистка прямых URL (кроме нашего бота)
        def replace_raw_url(m):
            url = m.group(0)
            if bot_clean and bot_clean in url.lower():
                return url
            return ''

        line_clean = re.sub(r'https?://\S+', replace_raw_url, line_clean)

        # 7. Очистка чужих упоминаний @username
        def replace_username(m):
            uname = m.group(0).lstrip('@').lower()
            if bot_clean and bot_clean == uname:
                return m.group(0)
            return ''

        line_clean = re.sub(r'@[\w_]+', replace_username, line_clean)

        # 8. Удаление донорских хэштегов
        line_clean = RE_DONOR_HASHTAGS.sub('', line_clean)

        # 9. Проверка на остаточный висячий заголовок/иконку (например, "🛍️ **Для оформления заказа:**")
        line_sub = re.sub(r'[\*\_\`]', '', line_clean).strip()
        if RE_DONOR_CTA.match(line_sub) or RE_DANGLING_ICONS.match(line_clean):
            continue

        if line_clean.strip():
            cleaned_lines.append(line_clean.rstrip())
        else:
            cleaned_lines.append('')

    # Схлопываем множественные пустые строки (максимум 2)
    result = re.sub(r'\n{3,}', '\n\n', '\n'.join(cleaned_lines)).strip()
    return result
