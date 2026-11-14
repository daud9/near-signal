"""Shared provider batch types for the NEAR SIGNAL ingestion adapters."""
from dataclasses import dataclass, field
from typing import Any

from ..normalization import NormalizedRecord


@dataclass(frozen=True)
class ProviderBatch:
    source_id: str
    provider: str
    request_url: str
    final_url: str
    started_at: str
    fetched_at: str
    http_status: int
    provider_observed_at: str | None
    response_sha256: str
    records: list[NormalizedRecord]
    completeness: str = 'complete_for_returned_response'
    warnings: list[str] = field(default_factory=list)
    request_metadata: dict[str, Any] = field(default_factory=dict)


class ProviderError(RuntimeError):
    def __init__(self, source_id: str, message: str, *, http_status: int | None = None):
        super().__init__(message)
        self.source_id = source_id
        self.http_status = http_status
