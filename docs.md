# GhostDrop API Documentation

## Overview

GhostDrop is a small file drop API built with FastAPI. It allows clients to:

- upload a single file
- fetch a file by its generated ID until it expires

## Base URL

Local development server:

```text
http://localhost:8000
```

The app starts with:

```bash
python src/main.py
```

## API Metadata

- App title: `ghostdrop`
- App version: read from the `APP_VERSION` environment variable
- Authentication: none
- CORS: open to all origins, methods, and headers

## File Retention

Uploaded files expire after `0.0166667` hours, which is approximately 1 minute.

When expired files are detected, the API deletes both:

- the uploaded file from `uploads/`
- its metadata file from `uploads_meta/`

Expired files are cleaned up:

- on application startup
- before every upload request
- when an expired file is requested directly

## Endpoints

### `GET /`

Health-style placeholder endpoint.

#### Response

Status: `200 OK`

```json
{
  "message": "you are not supposed to be here"
}
```

### `POST /upload/`

Uploads a single file as multipart form data.

#### Request

Content type:

```text
multipart/form-data
```

Form field:

- `file` (required): the file to upload

#### Example

```bash
curl -X POST "http://localhost:8000/upload/" \
  -F "file=@example.txt"
```

#### Success Response

Status: `200 OK`

```json
{
  "id": "2b8c5f4c-0f1b-4d8e-8d3c-1f3a4d6b7e9f",
  "original_name": "example.txt",
  "expires_in_hours": 0.0166667
}
```

#### Response Fields

- `id`: generated UUID used to retrieve the file later
- `original_name`: original uploaded filename
- `expires_in_hours`: retention window in hours

#### Notes

- The stored filename on disk is the generated UUID, not the original filename.
- Original filename is preserved in metadata and used when serving the file back.

### `GET /file/{file_id}`

Downloads a file by its generated ID.

#### Path Parameters

- `file_id`: UUID-like string returned from `POST /upload/`

#### Example

```bash
curl -O -J "http://localhost:8000/file/2b8c5f4c-0f1b-4d8e-8d3c-1f3a4d6b7e9f"
```

#### Success Response

Status: `200 OK`

Returns the file as a binary response. The response uses the original uploaded filename when metadata is available.

#### Error Responses

Status: `404 Not Found`

```json
{
  "error": "File not found"
}
```

Returned when:

- the file does not exist
- the file has already been cleaned up

Status: `410 Gone`

```json
{
  "error": "this file is gone"
}
```

Returned when:

- metadata exists
- the file has passed its expiry time

In this case, the API deletes the expired file and metadata before responding.

## Error Format

HTTP exceptions are returned as:

```json
{
  "error": "message"
}
```

Unhandled server errors are returned as:

Status: `500 Internal Server Error`

```json
{
  "error": "Internal server error"
}
```

## OpenAPI / Interactive Docs

Because this is a FastAPI app and the default docs are enabled, the following are available unless disabled elsewhere:

- Swagger UI: `GET /docs`
- ReDoc: `GET /redoc`
- OpenAPI schema: `GET /openapi.json`

## Environment

The application loads environment variables using `.env`.

Recognized variable:

- `APP_VERSION`: exposed as the FastAPI application version

## Implementation Notes

- Uploads are stored in `uploads/`
- Metadata is stored in `uploads_meta/`
- Metadata contains:
  - `original_name`
  - `expires_at` in ISO 8601 format
- The server runs on `0.0.0.0:8000` when started directly from `src/main.py`
- Development startup uses `reload=True`
