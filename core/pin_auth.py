"""PIN validation and salted password hashing; no plaintext credentials in responses."""
import hashlib
import hmac
import re
import secrets


def normalize_phone(phone: str) -> str:
    value = phone.strip()
    if not re.fullmatch(r"\+?[0-9 ()-]+", value):
        raise ValueError("Введите полный номер телефона в международном формате")
    digits = re.sub(r"[^0-9]", "", value)
    if not 10 <= len(digits) <= 15:
        raise ValueError("Введите полный номер телефона в международном формате")
    return digits


def validate_pin(pin: str) -> str:
    if not re.fullmatch(r"[0-9]{4,12}", pin) or pin == "1234":
        raise ValueError("PIN должен содержать от 4 до 12 цифр и отличаться от 1234")
    return pin


def hash_pin(pin: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.scrypt(pin.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()
    return f"scrypt${salt}${digest}"


def verify_pin(pin: str, stored: str | None) -> bool:
    if not stored or not pin or len(pin) > 128:
        return False
    try:
        algorithm, salt, expected = stored.split("$")
        if algorithm != "scrypt" or len(salt) != 32 or len(expected) != 128:
            return False
        actual = hashlib.scrypt(pin.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False
