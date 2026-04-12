from pathlib import Path
import json
import shutil
import uuid
from datetime import datetime, timedelta, timezone
from fastapi import FastAPI, File, Request, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import uvicorn
import os
from dotenv import load_dotenv

load_dotenv()

EXPIRY_HOURS = 0.0166667
EXPIRY_DURATION = timedelta(hours=EXPIRY_HOURS)
EXPIRED_MESSAGE = "this file is gone"
UPLOAD_DIR = Path("uploads")
METADATA_DIR = Path("uploads_meta")


def metadata_path(file_id: str) -> Path:
    return METADATA_DIR / f"{file_id}.json"


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def cleanup_file(file_id: str) -> None:
    file_path = UPLOAD_DIR / file_id
    metadata_file = metadata_path(file_id)

    if file_path.exists():
        file_path.unlink()
    if metadata_file.exists():
        metadata_file.unlink()


def write_metadata(file_id: str, original_name: str) -> None:
    metadata = {
        "original_name": original_name,
        "expires_at": (utc_now() + EXPIRY_DURATION).isoformat(),
    }
    metadata_path(file_id).write_text(json.dumps(metadata), encoding="utf-8")


def load_metadata(file_id: str) -> dict | None:
    path = metadata_path(file_id)
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def is_expired(metadata: dict) -> bool:
    return utc_now() >= datetime.fromisoformat(metadata["expires_at"])


def cleanup_expired_files() -> None:
    for path in METADATA_DIR.glob("*.json"):
        metadata = json.loads(path.read_text(encoding="utf-8"))
        if is_expired(metadata):
            cleanup_file(path.stem)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup logic (replaces @app.on_event("startup"))
    UPLOAD_DIR.mkdir(exist_ok=True)
    METADATA_DIR.mkdir(exist_ok=True)
    cleanup_expired_files()
    print("Starting up...")
    yield
    # Shutdown logic (replaces @app.on_event("shutdown"))
    print("Shutting down...")


version = os.getenv("APP_VERSION")

app = FastAPI(
    title="ghostdrop",
    version=version,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],       # tighten in production
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.detail},
    )


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error"},
    )


@app.get("/")
async def index():
    return {"message": "you are not supposed to be here"}


@app.post("/upload/")
async def upload_file(file: UploadFile = File(...)):
    cleanup_expired_files()

    file_id = str(uuid.uuid4())
    file_path = UPLOAD_DIR / file_id

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    write_metadata(file_id, file.filename or file_id)

    return {
        "id": file_id,
        "original_name": file.filename,
        "expires_in_hours": EXPIRY_HOURS,
    }


@app.get("/file/{file_id}")
async def get_file(file_id: str):
    metadata = load_metadata(file_id)
    if metadata and is_expired(metadata):
        cleanup_file(file_id)
        return JSONResponse(
            status_code=410,
            content={"error": EXPIRED_MESSAGE},
        )

    file_path = UPLOAD_DIR / file_id
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    filename = metadata["original_name"] if metadata else file_path.name
    return FileResponse(path=file_path, filename=filename)


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
