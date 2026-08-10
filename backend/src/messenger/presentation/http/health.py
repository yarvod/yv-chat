"""Service health endpoint."""

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/api", tags=["system"])


class HealthResponse(BaseModel):
    """Public healthcheck response."""

    status: Literal["ok"]


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """Report that the API process is accepting requests."""
    return HealthResponse(status="ok")
