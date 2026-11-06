# Booksource Fixer · 源序

[简体中文](README.md) · **English**

A browser-local JSON book source inspector and repair tool for the HarmonyOS edition of Legado. Select files, review diagnostics and changes, then download repaired sources or split batches.

**Files never leave your browser.** The server only serves the application. No database, external service, Node.js, Python, or Go installation is required at runtime.

## Features

- Recognize individual sources, source arrays, ordinary JSON, and mixed arrays; process multiple files independently.
- Repair BOMs, comments outside strings, trailing commas, and known empty extension fields.
- Diagnose required fields, types, ranges, duplicate identifiers, and unknown fields, with before/after changes.
- Preserve unknown fields, non-empty extraction rules, and numeric lexemes without losing integer precision.
- Export BOM-free UTF-8 JSON, configurable batches, excluded records, reports, and ZIP archives.
- Run as a Windows EXE, Linux command-line program, or Docker container, with a responsive Chinese interface.

## Quick start

### Docker Compose

With Docker Engine and Compose installed:

```sh
git clone https://github.com/Corgi-02/booksource-fixer.git
cd booksource-fixer
docker compose up -d --build
```

Open `http://localhost:8080`, or use the server's IP from another device.

```sh
docker compose logs -f
docker compose down
```

Change the host port in `compose.yaml`, for example `"8088:8080"`. No volumes are needed. The image runs as a non-root user; Compose enables a read-only root filesystem and drops additional capabilities.

### Windows

When using a prebuilt archive, extract the Windows amd64 ZIP and run `booksource-fixer.exe`. It listens on `127.0.0.1:8080` and opens a browser automatically. Press Ctrl+C to stop.

```powershell
.\booksource-fixer.exe --port 8088
.\booksource-fixer.exe --host 0.0.0.0 --port 8080 --no-open
```

Prebuilt archives are generated with `npm run release`; binaries are not committed to the source repository.

### Linux

Use `linux-amd64` for x86_64 or `linux-arm64` for aarch64:

```sh
chmod +x booksource-fixer
./booksource-fixer --host 0.0.0.0 --port 8080
```

Linux does not open a browser automatically. Visit `http://SERVER_IP:8080`.

| Flag | Default | Purpose |
| --- | --- | --- |
| `--host` | `127.0.0.1` | Listen address; use `0.0.0.0` for LAN access |
| `--port` | `8080` | Listen port; an occupied port produces an error |
| `--no-open` | `false` | Disable automatic browser opening on Windows |
| `--version` | — | Print application and compatibility profile versions |
| `--help` | — | Show available flags |

### systemd

The repository includes `deploy/booksource-fixer.service`:

```sh
sudo mkdir -p /opt/booksource-fixer
sudo install -m 755 booksource-fixer /opt/booksource-fixer/booksource-fixer
sudo cp deploy/booksource-fixer.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now booksource-fixer
journalctl -u booksource-fixer -f
```

### Build an image from a precompiled program

`Dockerfile.prebuilt` avoids downloading build tools or base images. Place the matching Linux executable in the indicated directory:

```sh
mkdir -p bin/linux-amd64
cp /path/to/booksource-fixer bin/linux-amd64/
docker build -f Dockerfile.prebuilt --build-arg TARGETARCH=amd64 -t booksource-fixer:1.0.0 .
docker run -d --name booksource-fixer -p 8080:8080 \
  --restart unless-stopped --read-only --cap-drop ALL booksource-fixer:1.0.0
```

For ARM64, use the `linux-arm64` directory and `TARGETARCH=arm64`. The default `Dockerfile` instead builds the complete application from source in multiple stages.

## Workflow

1. Select or drop JSON files. Limits are **50 MiB per file** and **100 MiB per queue**. Files are processed sequentially; processing can be cancelled or cleared.
2. Review valid sources, records requiring attention, non-source records, and empty placeholders. Filter by name, identifier, or issue, and open details to inspect changes.
3. Mixed arrays require confirmation before extracting only valid sources. Other records remain available as a separate exclusions download.
4. Download repaired JSON or a result ZIP. Batches default to **500 records**, configurable from 1 to 10000. Reports include versions, input digests, and changes.
5. After importing into the reader, optionally enter the reader version and actual test result before exporting a report. This is a user record, not automated device verification.

Ordinary JSON, empty arrays, and irrecoverable files are not converted into fake book sources. Truncation, broken strings or escapes, and duplicate JSON keys stop file repair and report a position. Reports and excluded records can still be downloaded for non-source files. A direct save link is provided if automatic downloading does not start.

Supported encodings are UTF-8 and BOM-marked UTF-16LE/BE. Clearing or refreshing releases in-memory files and results. Original files are not overwritten, and no processing history is stored.

## Compatibility and limits

The target reader is [mgz0227/legado-Harmony](https://github.com/mgz0227/legado-Harmony). The compatibility profile combines its linked [Legado 3 rule documentation](https://mgz0227.github.io/The-tutorial-of-Legado/Rule/source.html) with validated samples. Field types are defined in `src/compatibility.json`.

**This is not a complete official schema. Passing format validation does not guarantee successful device import or a currently working source.**

- Only top-level source objects and arrays are recognized. `bookSourceName` and `bookSourceUrl` must be non-empty strings. Identifiers need not be HTTP URLs; missing search or content rules alone do not disqualify a source.
- Missing, null, or empty-string groups become “未分组” (Ungrouped). Only empty `ruleReview`, `exploreScreen`, and `ruleToc.formatJs` extensions are removed. Meaningful extensions and unknown fields are preserved with notices.
- Known boolean fields only convert `"true"` and `"false"`. Integer conversions require decimal integer strings within range: source type 0–3, signed int32 order/weight, and non-negative int64 response/update times. Other type conflicts require manual attention.
- Duplicate source identifiers produce warnings without deduplication or reordering. Nesting deeper than 128 levels stops processing.
- Source JavaScript is never executed, and source websites are never requested. The tool does not repair unavailable websites, authentication, or anti-bot behavior, or convert legacy formats, other readers' formats, or arbitrary nested backups.

## Development

Requirements: **Node.js 24** and **Go 1.24+**. Dependency versions are fixed in the lockfile.

```sh
npm ci
npm run dev
```

Build the frontend before running the embedded Go server:

```sh
npm test
npm run build
go test ./server
go run ./server --no-open
```

`server/web/` is generated and ignored by Git. Run `npm run build` before building Go or running server tests.

### Packaging

```sh
npm run build
npm run release
```

`release/` receives Windows amd64 and Linux amd64/arm64 ZIPs plus `SHA256SUMS.txt`. Archives include both README languages and third-party notices. Set `GO_BINARY` to the Go executable's full path if it is not on PATH.

Focused regression tests cover classification, bounded repair, rule preservation, numeric precision, encodings, consistent exports, the Worker ZIP protocol, and HTTP behavior. They use synthetic data and do not depend on personal desktop files or live sources.

## HTTP endpoints

| Request | Purpose |
| --- | --- |
| `GET /` | Application assets |
| `GET /healthz` | Health check returning `ok` |
| `GET /api/version` | Application/profile versions and processing mode |

There are no upload, server-side repair, or source proxy APIs. POST requests return 405. The page CSP restricts network connections, and assets are bundled with the program. Nginx or Caddy can reverse-proxy the service; deployment at the site root is recommended.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and `licenses/` for third-party licenses.
