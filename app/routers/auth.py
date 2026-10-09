"""认证接口：注册、登录并签发 JWT。"""

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import write_audit
from app.config import settings
from app.db import get_db
from app.models import User
from app.schemas import LoginRequest, RegisterRequest, TokenResponse, UserOut
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


@router.post(
    "/register",
    response_model=UserOut,
    status_code=status.HTTP_201_CREATED,
    summary="注册家属账号（公开）",
    response_description="注册成功，返回新账号信息（不含 Token）",
    responses={
        409: {
            "description": "账号已存在",
            "content": {
                "application/json": {"example": {"detail": "账号已存在"}}
            },
        }
    },
)
def register(
    payload: RegisterRequest, request: Request, db: Session = Depends(get_db)
) -> User:
    """开放注册：固定创建 family 角色账号，用户名重复返回 409；注册后需再调用登录接口获取 JWT。"""
    user = User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        role="family",
        display_name=(payload.display_name or "").strip() or None,
        phone=(payload.phone or "").strip() or None,
    )
    db.add(user)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="账号已存在"
        ) from exc

    write_audit(
        db,
        user_id=user.id,
        action="register",
        target_type="user",
        target_id=user.id,
        ip=request.client.host if request.client else None,
        detail={"username": user.username},
    )
    db.commit()
    db.refresh(user)
    return user
