"""认证接口：登录并签发 JWT。"""

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import write_audit
from app.config import settings
from app.db import get_db
from app.models import User
from app.schemas import LoginRequest, TokenResponse
from app.security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/api/v1/auth", tags=["认证"])

# 用户不存在时也执行一次 bcrypt，降低用户名枚举的时序差异
_DUMMY_PASSWORD_HASH = hash_password("timing-equalization-dummy-password")


@router.post("/login", response_model=TokenResponse, summary="登录并获取 JWT")
def login(
    payload: LoginRequest, request: Request, db: Session = Depends(get_db)
) -> TokenResponse:
    """校验用户名密码，成功签发 JWT，并写入审计日志。"""
    user = db.execute(
        select(User).where(User.username == payload.username)
    ).scalar_one_or_none()
    client_ip = request.client.host if request.client else None

    if user is None:
        verify_password(payload.password, _DUMMY_PASSWORD_HASH)
        password_ok = False
    else:
        password_ok = verify_password(payload.password, user.password_hash)

    if not password_ok:
        write_audit(
            db,
            user_id=user.id if user else None,
            action="login_failed",
            target_type="user",
            target_id=user.id if user else None,
            ip=client_ip,
            detail={"username": payload.username},
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = create_access_token(user.id, user.role)
    write_audit(
        db,
        user_id=user.id,
        action="login",
        target_type="user",
        target_id=user.id,
        ip=client_ip,
        detail={"role": user.role},
    )
    db.commit()

    return TokenResponse(
        access_token=token,
        expires_in=settings.jwt_expire_minutes * 60,
        role=user.role,
    )
