"""Canonical binary encoding helpers for public cryptographic transport data."""

import base64
import binascii

from fastapi import HTTPException, status


def decode_canonical_base64(encoded: str, *, detail: str) -> bytes:
    """Decode strict RFC 4648 base64 and reject alternative representations."""
    try:
        decoded = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=detail,
        ) from error
    if base64.b64encode(decoded).decode("ascii") != encoded:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=detail,
        )
    return decoded
