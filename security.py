from cryptography.fernet import Fernet, InvalidToken

from config import APP_SECRET_KEY


fernet = Fernet(APP_SECRET_KEY.encode("utf-8"))


def is_encrypted_secret(value: str | None) -> bool:
    return bool(value and value.startswith("enc:"))


def encrypt_secret(value: str | None) -> str | None:
    if value is None:
        return None
    if is_encrypted_secret(value):
        return value
    return "enc:" + fernet.encrypt(value.encode("utf-8")).decode("utf-8")


def decrypt_secret(value: str | None) -> str | None:
    if value is None:
        return None
    if not is_encrypted_secret(value):
        return value

    token = value[4:]
    try:
        return fernet.decrypt(token.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        return value
