from pathlib import Path
from html import escape
import json
import logging
import shutil
import uuid
from urllib.parse import quote
from datetime import datetime, time, timedelta, timezone
from fastapi import FastAPI, File, Request, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import uvicorn
import os
import time
from dotenv import load_dotenv
from pyngrok import ngrok
import psutil

load_dotenv()

start_time = time.time()

def configure_logging() -> logging.Logger:
    log_level_name = os.getenv("LOG_LEVEL", "INFO").upper()
    log_level = getattr(logging, log_level_name, logging.INFO)
    root_logger = logging.getLogger()

    if not root_logger.handlers:
        logging.basicConfig(
            level=log_level,
            format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
        )

    logger = logging.getLogger("ghostdrop")
    logger.setLevel(log_level)
    return logger


logger = configure_logging()

EXPIRY_HOURS = 6 # 6 hours 
EXPIRY_DURATION = timedelta(hours=EXPIRY_HOURS)
EXPIRED_MESSAGE = "this file is gone"
SRC_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = Path("uploads")
METADATA_DIR = Path("uploads_meta")
DOWNLOAD_TEMPLATE_PATH = SRC_DIR / "public" / "download.html"
DOWNLOAD_STYLES_PATH = SRC_DIR / "public" / "download.css"
MAX_SIZE = 100 * 1024 * 1024  # 100MB
service_port = os.getenv("PORT")
ngrok_status = os.getenv("NGROK_STATUS", "false").lower() == "true"
file_count = "0000" 

def start_ngrok_tunnel():
    if ngrok_status == True:
        ngrok.set_auth_token(os.getenv("NGROK_TOKEN"))
        tunnel = ngrok.connect(service_port, "http")
        logger.info("Ngrok tunnel established at %s", tunnel.public_url)
    else:
        logger.info("Ngrok tunneling is disabled. Running on port %s", service_port)
        print("server is running without ngrok tunneling")


def metadata_path(file_id: str) -> Path:
    return METADATA_DIR / f"{file_id}.json"


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def cleanup_file(file_id: str) -> None:
    file_path = UPLOAD_DIR / file_id
    metadata_file = metadata_path(file_id)

    if file_path.exists():
        file_path.unlink()
        logger.info("Deleted uploaded file %s", file_id)
    if metadata_file.exists():
        metadata_file.unlink()
        logger.info("Deleted metadata for %s", file_id)


def write_metadata(file_id: str, original_name: str) -> None:
    metadata = {
        "original_name": original_name,
        "expires_at": (utc_now() + EXPIRY_DURATION).isoformat(),
    }
    metadata_path(file_id).write_text(json.dumps(metadata), encoding="utf-8")
    logger.info("Stored metadata for %s (%s)", file_id, original_name)


def load_metadata(file_id: str) -> dict | None:
    path = metadata_path(file_id)
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def is_expired(metadata: dict) -> bool:
    return utc_now() >= datetime.fromisoformat(metadata["expires_at"])


def cleanup_expired_files() -> None:
    deleted_files = 0
    for path in METADATA_DIR.glob("*.json"):
        metadata = json.loads(path.read_text(encoding="utf-8"))
        if is_expired(metadata):
            cleanup_file(path.stem)
            deleted_files += 1

    if deleted_files:
        logger.info("Cleaned up %s expired file(s)", deleted_files)


def render_download_page(file_id: str) -> str:
    quoted_file_id = quote(file_id, safe="")
    return DOWNLOAD_TEMPLATE_PATH.read_text(encoding="utf-8").replace(
        "__FILE_ID_URL__",
        quoted_file_id,
    ).replace(
        "__FILE_ID__",
        escape(file_id),
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup logic (replaces @app.on_event("startup"))
    UPLOAD_DIR.mkdir(exist_ok=True)
    METADATA_DIR.mkdir(exist_ok=True)
    cleanup_expired_files()
    logger.info("Starting GhostDrop backend")
    yield
    # Shutdown logic (replaces @app.on_event("shutdown"))
    logger.info("Shutting down GhostDrop backend")


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



@app.middleware("http")
async def log_requests(request: Request, call_next):
    start_time = utc_now()
    status_code = 500

    try:
        response = await call_next(request)
        status_code = response.status_code
        return response
    finally:
        duration_ms = (utc_now() - start_time).total_seconds() * 1000
        logger.info(
            "%s %s -> %s (%.2f ms)",
            request.method,
            request.url.path,
            status_code,
            duration_ms,
        )


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    logger.warning(
        "HTTP %s on %s %s: %s",
        exc.status_code,
        request.method,
        request.url.path,
        exc.detail,
    )
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.detail},
    )


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    logger.exception(
        "Unhandled error during %s %s",
        request.method,
        request.url.path,
        exc_info=(type(exc), exc, exc.__traceback__),
    )
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error"},
    )



@app.get("/")
async def index():
    return RedirectResponse(url="https://ghostdrop.qzz.io/")

@app.get("/health")
async def health_check():
    
    cpu_usage = psutil.cpu_percent(interval=1)
    memory_usage = psutil.virtual_memory().percent
    uptime = round(time.time() - start_time, 2)

    return {
        "files_stored": len(list(UPLOAD_DIR.glob("*"))),
        "cpu_usage": f"{cpu_usage}%",
        "memory_usage": f"{memory_usage}%",
        "uptime": f"{uptime} seconds",
    }


@app.post("/upload/")
async def upload_file(file: UploadFile = File(...)):

    if file.size > MAX_SIZE:
        logger.warning("Rejected upload for %s: file too large", file.filename)
        raise HTTPException(status_code=413, detail="File too large")

    cleanup_expired_files()

    file_id = str(uuid.uuid4())
    file_path = UPLOAD_DIR / file_id

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    write_metadata(file_id, file.filename or file_id)
    logger.info("Stored upload %s as %s", file.filename, file_id)

    return {
        "id": file_id,
        "original_name": file.filename,
        "expires_in_hours": EXPIRY_HOURS,
    }


@app.get("/download.css")
async def download_styles():
    return FileResponse(DOWNLOAD_STYLES_PATH)


@app.get("/{file_id}", response_class=HTMLResponse)
async def read_items(file_id: str):
    logger.info("Rendering download page for %s", file_id)
    return HTMLResponse(content=render_download_page(file_id))

@app.get("/files/{file_id}")
async def get_file(file_id: str):
    metadata = load_metadata(file_id)
    if metadata and is_expired(metadata):
        logger.info("Download requested for expired file %s", file_id)
        cleanup_file(file_id)
        return JSONResponse(
            status_code=410,
            content={"error": EXPIRED_MESSAGE},
        )

    file_path = UPLOAD_DIR / file_id
    if not file_path.exists():
        logger.warning("Download requested for missing file %s", file_id)
        raise HTTPException(status_code=404, detail="File not found")

    filename = metadata["original_name"] if metadata else file_path.name
    logger.info("Serving file %s as %s", file_id, filename)
    return FileResponse(path=file_path, filename=filename)


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
