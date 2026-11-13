"""Email + password accounts with server-side sessions in an HttpOnly cookie.

- Passwords are hashed with bcrypt.
- The cookie holds a random token; the database stores only its SHA-256, so sessions can be
  revoked (sign out) and a leaked database can't be used to sign in.
- SameSite=Lax keeps other sites from sending the cookie on POST/DELETE requests (CSRF).
- Repeated failed sign-ins from one address are slowed down.
"""
import hashlib
import re
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .config import get_settings
from .db import AuthSession, User, get_db

settings = get_settings()
router = APIRouter(prefix="/api/auth", tags=["auth"])

COOKIE = "paperlens_session"
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
# Compared against when the email doesn't exist, so a wrong email takes as long as a wrong password.
_DUMMY_HASH = bcrypt.hashpw(b"not-a-real-password", bcrypt.gensalt()).decode()


# ---------------------------------------------------------------- passwords

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except ValueError:
        return False


def _check_password_rules(password: str) -> None:
    if len(password) < 8:
        raise HTTPException(422, "Use a password with at least 8 characters.")
    if len(password.encode()) > 72:
        raise HTTPException(422, "Use a password of 72 characters or fewer.")


def _normalize_email(email: str) -> str:
    email = email.strip().lower()
    if not _EMAIL.match(email):
        raise HTTPException(422, "Enter a valid email address, like name@example.com.")
    return email


# ---------------------------------------------------------------- rate limiting

class _Throttle:
    """In-memory limit on failed sign-ins per client address (per server process)."""

    def __init__(self, limit: int = 10, window_s: int = 900):
        self.limit, self.window = limit, window_s
        self.fails: dict[str, list[float]] = {}
        self.lock = threading.Lock()

    def _recent(self, key: str) -> list[float]:
        cutoff = time.time() - self.window
        hits = [t for t in self.fails.get(key, []) if t > cutoff]
        self.fails[key] = hits
        return hits

    def check(self, key: str) -> None:
        with self.lock:
            if len(self._recent(key)) >= self.limit:
                raise HTTPException(429, "Too many failed sign-in attempts. Wait 15 minutes and try again.")

    def fail(self, key: str) -> None:
        with self.lock:
            self._recent(key).append(time.time())

    def reset(self, key: str) -> None:
        with self.lock:
            self.fails.pop(key, None)


throttle = _Throttle()


def _client_key(request: Request) -> str:
    return request.client.host if request.client else "unknown"


# ---------------------------------------------------------------- sessions

def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _start_session(db: Session, user: User, response: Response) -> None:
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    db.add(AuthSession(token_hash=_hash_token(token), user_id=user.id,
                       expires_at=now + timedelta(days=settings.session_days)))
    db.execute(delete(AuthSession).where(AuthSession.user_id == user.id, AuthSession.expires_at < now))
    db.commit()
    response.set_cookie(COOKIE, token, max_age=settings.session_days * 86400, httponly=True,
                        secure=settings.cookie_secure, samesite="lax", path="/")


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    """FastAPI dependency: the signed-in user, or 401."""
    token = request.cookies.get(COOKIE)
    if token:
        session = db.get(AuthSession, _hash_token(token))
        if session and session.expires_at > datetime.now(timezone.utc):
            return session.user
    raise HTTPException(401, "Sign in to continue.")


# ---------------------------------------------------------------- routes

class RegisterBody(BaseModel):
    email: str = Field(max_length=320)
    password: str = Field(max_length=200)
    name: str = Field(default="", max_length=120)


class LoginBody(BaseModel):
    email: str = Field(max_length=320)
    password: str = Field(max_length=200)


@router.post("/register", status_code=201)
def register(body: RegisterBody, response: Response, db: Session = Depends(get_db)):
    email = _normalize_email(body.email)
    _check_password_rules(body.password)
    user = User(email=email, name=body.name.strip(), password_hash=hash_password(body.password))
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "An account with this email already exists. Sign in instead.")
    _start_session(db, user, response)
    return user.to_public()


@router.post("/login")
def login(body: LoginBody, request: Request, response: Response, db: Session = Depends(get_db)):
    key = _client_key(request)
    throttle.check(key)
    email = body.email.strip().lower()
    user = db.scalar(select(User).where(User.email == email))
    if not verify_password(body.password, user.password_hash if user else _DUMMY_HASH) or not user:
        throttle.fail(key)
        raise HTTPException(401, "That email and password don't match. Check them and try again.")
    throttle.reset(key)
    _start_session(db, user, response)
    return user.to_public()


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    token = request.cookies.get(COOKIE)
    if token:
        db.execute(delete(AuthSession).where(AuthSession.token_hash == _hash_token(token)))
        db.commit()
    response.delete_cookie(COOKIE, path="/")


@router.get("/me")
def me(user: User = Depends(current_user)):
    return user.to_public()
