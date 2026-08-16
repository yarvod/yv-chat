"""Authenticated streaming transport for bounded attachment blobs."""

from datetime import datetime
from typing import Annotated
from uuid import UUID

from dishka.integrations.fastapi import DishkaRoute, FromDishka
from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from messenger.application.attachments.download import (
    DownloadGroupAttachment,
    DownloadGroupAttachmentQuery,
)
from messenger.application.attachments.upload import (
    UploadGroupAttachment,
    UploadGroupAttachmentCommand,
)
from messenger.application.errors import (
    AttachmentConflictError,
    AttachmentNotFoundError,
    AttachmentTooLargeError,
    AuthorizationDeniedError,
    ConversationNotFoundError,
    InvalidAttachmentError,
)
from messenger.application.sessions.authenticate import AuthenticateSession
from messenger.bootstrap.settings import AppSettings
from messenger.domain.entities import AttachmentMediaKind
from messenger.presentation.http.auth import authenticate_request
from messenger.presentation.http.security import require_csrf

router = APIRouter(
    prefix="/api/v1/conversations/{conversation_id}/attachments",
    tags=["attachments"],
    route_class=DishkaRoute,
)

INLINE_MEDIA_KINDS = frozenset({AttachmentMediaKind.IMAGE, AttachmentMediaKind.VIDEO})


class UploadGroupAttachmentResponse(BaseModel):
    attachment_id: UUID
    client_attachment_id: UUID
    conversation_id: UUID
    media_kind: AttachmentMediaKind
    byte_size: int
    sha256_digest: str
    content_type: str
    created_at: datetime
    expires_at: datetime


@router.put(
    "/{client_attachment_id}",
    response_model=UploadGroupAttachmentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_group_attachment(
    conversation_id: UUID,
    client_attachment_id: UUID,
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[UploadGroupAttachment],
    media_kind: Annotated[AttachmentMediaKind, Query()],
    byte_size: Annotated[int, Query(gt=0)],
    sha256: Annotated[
        str,
        Query(min_length=64, max_length=64, pattern=r"^[0-9a-f]{64}$"),
    ],
    content_type: Annotated[str, Query(min_length=3, max_length=100)],
) -> UploadGroupAttachmentResponse:
    require_csrf(request, settings)
    if request.headers.get("content-type", "").split(";", 1)[0] != "application/octet-stream":
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="attachment body must be application/octet-stream",
        )
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        result = await use_case.execute(
            UploadGroupAttachmentCommand(
                actor_user_id=principal.user_id,
                actor_device_id=principal.device_id,
                conversation_id=conversation_id,
                client_attachment_id=client_attachment_id,
                media_kind=media_kind,
                byte_size=byte_size,
                sha256_digest=sha256,
                content_type=content_type,
                chunks=request.stream(),
            )
        )
    except ConversationNotFoundError as error:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "conversation not found") from error
    except AuthorizationDeniedError as error:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "forbidden") from error
    except AttachmentTooLargeError as error:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "attachment too large") from error
    except InvalidAttachmentError as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "invalid attachment") from error
    except AttachmentConflictError as error:
        raise HTTPException(status.HTTP_409_CONFLICT, "attachment id conflict") from error
    return UploadGroupAttachmentResponse.model_validate(result, from_attributes=True)


@router.get("/{attachment_id}", response_class=StreamingResponse)
async def download_group_attachment(
    conversation_id: UUID,
    attachment_id: UUID,
    request: Request,
    response: Response,
    settings: FromDishka[AppSettings],
    authenticate_session: FromDishka[AuthenticateSession],
    use_case: FromDishka[DownloadGroupAttachment],
) -> StreamingResponse:
    principal = await authenticate_request(request, response, settings, authenticate_session)
    try:
        result = await use_case.execute(
            DownloadGroupAttachmentQuery(
                actor_user_id=principal.user_id,
                conversation_id=conversation_id,
                attachment_id=attachment_id,
            )
        )
    except (ConversationNotFoundError, AttachmentNotFoundError) as error:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "attachment not found") from error
    except AuthorizationDeniedError as error:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "forbidden") from error
    streaming_response = StreamingResponse(
        result.chunks,
        media_type=(
            result.content_type
            if result.media_kind in INLINE_MEDIA_KINDS
            else "application/octet-stream"
        ),
        headers={
            "Cache-Control": "private, no-store",
            "Content-Disposition": (
                "inline" if result.media_kind in INLINE_MEDIA_KINDS else "attachment"
            ),
            "Content-Length": str(result.byte_size),
            "X-Content-Type-Options": "nosniff",
        },
    )
    streaming_response.raw_headers.extend(
        (name, value) for name, value in response.raw_headers if name.lower() == b"set-cookie"
    )
    return streaming_response
