"""Artifact storage shared by the engine transports."""
from __future__ import annotations

import gzip
import json
import re
import shutil
from contextlib import AbstractContextManager, contextmanager
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import BinaryIO, Protocol


class Storage(Protocol):
    def open(self, key: str) -> AbstractContextManager[BinaryIO]: ...
    def exists(self, key: str) -> bool: ...
    def get_bytes(self, key: str) -> bytes: ...
    def put_bytes(self, key: str, data: bytes) -> None: ...
    def put_file(self, key: str, source: Path) -> None: ...


def validate_key(key: str) -> None:
    if not all(re.fullmatch(r"[a-zA-Z0-9._-]+", part) and part not in {".", ".."}
               for part in key.split("/")):
        raise ValueError("Invalid storage key")


class LocalStorage:
    def __init__(self, root: Path):
        self.root = root.resolve()

    def _path(self, key: str) -> Path:
        validate_key(key)
        target = (self.root / key).resolve()
        if not target.is_relative_to(self.root):
            raise ValueError("Storage key leaves the configured root")
        return target

    def open(self, key: str):
        return self._path(key).open("rb")

    def exists(self, key: str) -> bool:
        return self._path(key).is_file()

    def get_bytes(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    @contextmanager
    def _writer(self, key: str):
        target = self._path(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        with NamedTemporaryFile(dir=target.parent, delete=False) as stream:
            temp = Path(stream.name)
            try:
                with stream:
                    yield stream
                temp.replace(target)
            finally:
                temp.unlink(missing_ok=True)

    def put_bytes(self, key: str, data: bytes) -> None:
        with self._writer(key) as stream:
            stream.write(data)

    def put_file(self, key: str, source: Path) -> None:
        with source.open("rb") as src, self._writer(key) as dst:
            shutil.copyfileobj(src, dst)


class S3Storage:
    def __init__(self, bucket: str, *, endpoint_url: str | None = None):
        import boto3

        self.bucket = bucket
        self.client = boto3.client("s3", endpoint_url=endpoint_url)

    @contextmanager
    def open(self, key: str):
        validate_key(key)
        stream = self.client.get_object(Bucket=self.bucket, Key=key)["Body"]
        try:
            yield stream
        finally:
            stream.close()

    def exists(self, key: str) -> bool:
        from botocore.exceptions import ClientError

        validate_key(key)
        try:
            self.client.head_object(Bucket=self.bucket, Key=key)
        except ClientError as exc:
            if exc.response["ResponseMetadata"]["HTTPStatusCode"] == 404:
                return False
            raise
        return True

    def get_bytes(self, key: str) -> bytes:
        with self.open(key) as stream:
            return stream.read()

    def put_bytes(self, key: str, data: bytes) -> None:
        validate_key(key)
        self.client.put_object(Bucket=self.bucket, Key=key, Body=data)

    def put_file(self, key: str, source: Path) -> None:
        validate_key(key)
        self.client.upload_file(str(source), self.bucket, key)


def read_json_gzip(storage: Storage, key: str) -> dict:
    with storage.open(key) as stream, gzip.GzipFile(fileobj=stream) as decoded:
        return json.load(decoded)


def write_json_gzip(storage: Storage, key: str, doc: dict) -> None:
    with NamedTemporaryFile(delete=False) as stream:
        temp = Path(stream.name)
    try:
        # Level 6: a third of level 9's time for a few percent more bytes (TF-134).
        with gzip.open(temp, "wt", encoding="utf-8", compresslevel=6) as stream:
            json.dump(doc, stream, ensure_ascii=False, allow_nan=False)
        storage.put_file(key, temp)
    finally:
        temp.unlink(missing_ok=True)
