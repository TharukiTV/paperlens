from conftest import register


def test_register_signs_in(client):
    user = register(client)
    assert user["email"] == "ada@example.com"
    assert "password_hash" not in user
    assert client.get("/api/auth/me").json()["id"] == user["id"]


def test_email_is_case_insensitive_and_unique(client):
    register(client, email="Ada@Example.com")
    r = client.post("/api/auth/register", json={"email": "ada@example.com", "password": "another password"})
    assert r.status_code == 409


def test_rejects_short_password_and_bad_email(client):
    assert client.post("/api/auth/register", json={"email": "ada@example.com", "password": "short"}).status_code == 422
    assert client.post("/api/auth/register", json={"email": "not-an-email", "password": "long enough pw"}).status_code == 422


def test_login_logout(client, make_client):
    register(client)
    other = make_client()
    assert other.get("/api/auth/me").status_code == 401
    assert other.post("/api/auth/login", json={"email": "ada@example.com", "password": "wrong password"}).status_code == 401
    assert other.post("/api/auth/login", json={"email": "ADA@example.com", "password": "correct horse battery"}).status_code == 200
    assert other.get("/api/auth/me").status_code == 200

    assert other.post("/api/auth/logout").status_code == 204
    assert other.get("/api/auth/me").status_code == 401
    # signing out one browser leaves the other signed in
    assert client.get("/api/auth/me").status_code == 200


def test_session_token_is_not_stored_in_plain_text(client):
    from app.auth import COOKIE
    from app.db import AuthSession, SessionLocal

    register(client)
    token = client.cookies.get(COOKIE)
    with SessionLocal() as db:
        stored = [s.token_hash for s in db.query(AuthSession).all()]
    assert token and token not in stored


def test_failed_logins_are_throttled(client):
    register(client)
    for _ in range(10):
        client.post("/api/auth/login", json={"email": "ada@example.com", "password": "wrong password"})
    r = client.post("/api/auth/login", json={"email": "ada@example.com", "password": "correct horse battery"})
    assert r.status_code == 429
