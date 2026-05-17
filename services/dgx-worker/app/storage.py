"""Supabase Storage client.

Uploads rendered audio to the private `tracks` bucket via the Storage REST
API. Authenticated with the service-role key (the only credential the
worker has with Storage write permission).

Path convention is `tracks/<job_id>/<attempt_id>.<ext>` so that the RLS
policy on storage.objects (`tracks_storage_select_via_job`) can authorize
end-user reads against the parent job ownership.
"""

from __future__ import annotations

import httpx


class StorageClient:
    def __init__(
        self,
        *,
        supabase_url: str,
        service_role_key: str,
        bucket: str,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._base = supabase_url.rstrip("/")
        self._bucket = bucket
        self._key = service_role_key
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(120.0), transport=transport)

    async def aclose(self) -> None:
        await self._client.aclose()

    def object_path(
        self,
        job_id: str,
        attempt_id: str,
        ext: str,
        *,
        candidate_index: int = 0,
    ) -> str:
        # bucket-relative path, no leading slash.
        # candidate_index>0 only changes the suffix so legacy single-candidate
        # jobs keep writing to the canonical path the RLS policy already
        # authorizes; multi-candidate (v1.4 Sprint 16) writes go to
        # `<job_id>/<attempt_id>__c<k>.<ext>`.
        if candidate_index > 0:
            return f"{job_id}/{attempt_id}__c{candidate_index}.{ext}"
        return f"{job_id}/{attempt_id}.{ext}"

    def storage_url(self, object_path: str) -> str:
        """Full Storage URL written to `tracks.url` (signed at read time)."""
        return f"{self._bucket}/{object_path}"

    async def put_object(
        self,
        *,
        object_path: str,
        content: bytes,
        content_type: str,
    ) -> None:
        """Upload bytes to the bucket. Idempotent: upsert=true so retries are safe.

        Requires INSERT + SELECT + UPDATE on storage.objects (the upsert path).
        For the worker that's service_role; user-facing access uses signed URLs.
        """
        url = f"{self._base}/storage/v1/object/{self._bucket}/{object_path}"
        # Supabase's new "sb_secret_*" / "sb_publishable_*" keys are opaque
        # (not JWTs) and require BOTH the `apikey` header and a matching
        # `Authorization: Bearer` header. Sending only `Authorization` makes
        # the gateway try to parse the bearer as a Compact JWS and return
        # 400 "Invalid Compact JWS" (which is what blocked the first
        # smoke-test upload). The legacy `eyJ...` JWT format also tolerates
        # this shape, so sending both works for both key generations.
        headers = {
            "apikey": self._key,
            "authorization": f"Bearer {self._key}",
            "content-type": content_type,
            "x-upsert": "true",
        }
        response = await self._client.post(url, headers=headers, content=content)
        if response.status_code >= 300:
            raise RuntimeError(
                f"Storage upload failed for {object_path}: "
                f"{response.status_code} {response.text}",
            )
