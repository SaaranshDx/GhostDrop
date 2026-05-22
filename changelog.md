This update focuses on custom upload identifiers, password-protected files, QR code scanning, Docker support, and a completely reworked download page experience.

## Features

- **Custom Slugs** - Upload files with a user-chosen identifier instead of a random string, with format validation and reserved slug protection
- **Password Protection** - Optionally protect uploaded files with a password, stored securely using Argon2 hashing
- **File Metadata on Download Page** - Displays original name, size, view count, and remaining expiry time with Discord embed support
- **Client Page & Installers** - New client download page with Windows install script (`install.ps1`) and Android APK support
- **Debug Overlay** - Developer debug panel (`GHOSTDROP_DEBUG_UI`) with real-time frontend event logging
- **Docker Support** - Official Dockerfile for easy self-hosted deployment

## Improvements

- **Download Page Overhaul** - Complete redesign showing file metadata (name, size, views, expiry) with smoother animations
- **Slug Validation** - Real-time input validation with inline error messages and reserved slug list
- **Error Handling** - Granular HTTP error codes (400, 409, 413) with frontend-specific error toasts and inline feedback
- **Metadata Structure** - Updated with views counter and size bytes for rich embed descriptions
- **API Robustness** - Fixed slug header/form mismatch and server URL resolution for reliable operation behind proxies

## Fixes

- **Slug Upload** - Fixed slug not being received by backend (Header → Form data migration)
- **File Overwrite** - Uploading with an existing slug now returns HTTP 409 instead of silently overwriting
- **Dev Server Leak** - Fixed backend resolving to dev server URL in production builds
- **Docker Build** - Fixed broken dependency file path in Docker image
- **Slug Validation Edge Cases** - Added format, length, and reserved word checks for robust slug handling

Note: all mobile apps would be automatically updated
