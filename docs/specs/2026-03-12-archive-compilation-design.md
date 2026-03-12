# Archive Compilation Endpoint Design

## Problem

The `/compile` endpoint accepts a single code string. Compact contracts that use `import` statements reference other `.compact` files on the filesystem. The compiler resolves these relative to the source file's directory. There is currently no way to compile multi-file contracts through the API.

## Solution

A new `POST /compile/archive` endpoint that accepts a `.tar.gz` archive containing the main contract and all its imports, preserving the directory structure the compiler expects.

## API Surface

**Endpoint:** `POST /compile/archive`

**Content-Type:** `multipart/form-data`

**Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `archive` | file | yes | The `.tar.gz` archive containing all `.compact` files |
| `entryPoint` | string | yes | Relative path to the main contract within the archive, e.g., `"MyContract.compact"` or `"src/MyContract.compact"` |
| `options` | JSON string | no | `{ skipZk?: boolean, timeout?: number }` |

- The language version pragma in the entry point is used to select a compatible installed compiler version via the existing `detectVersionFromPragma` logic. Manual compiler version override (`version`) is not supported.
- No code wrapping is performed.
- Multi-version compilation (`versions` parameter) is not supported in the initial implementation.
- `options.timeout` overrides only the compilation timeout (matching existing behavior). The extraction timeout is not user-configurable.

**Response:** Same shape as the existing single-version `/compile` response:

```json
{
  "success": boolean,
  "output": string,
  "errors": [...],
  "warnings": [...],
  "originalCode": string,
  "executionTime": number,
  "compiledAt": string
}
```

`originalCode` contains the content of the entry point file. `wrappedCode` is always omitted since no wrapping occurs.

## Archive Validation & Extraction

### Upload limits (before extraction)

- Max compressed archive size: 1 MB (enforced at the multipart parser level)
- Archive format validation: validate the gzip magic bytes (`1f 8b`) of the uploaded stream rather than trusting the Content-Type header, since browsers and clients are inconsistent with MIME types for `.tar.gz` files

### Extraction limits (enforced per-entry during streaming)

- Max total uncompressed size: 2 MB (running counter, abort if exceeded)
- Max file count: 50 files
- Max individual filename length: 255 characters
- Max path depth: 10 levels

### Per-entry rejection rules (abort immediately if any fail)

- Entry resolves outside the extraction directory (path traversal / zip slip)
- Entry has an absolute path
- Entry is a symlink, hardlink, device, or anything other than a regular file or directory
- Filename contains null bytes, non-printable characters, or `..` path segments
- File extension is not `.compact` (this rule applies only to regular file entries, not directory entries)

### Extraction flow

1. Stream the `.tar.gz` through `zlib.createGunzip()` piped to a tar parser
2. For each entry, validate name/type/size against the rules above before writing to disk
3. Write validated entries to `/tmp/compact-playground/{uuid}/`
4. Validate the `entryPoint` field for path traversal: verify that `path.resolve(extractDir, entryPoint)` starts with `extractDir`. Reject with 400 if not.
5. After extraction, verify the `entryPoint` exists within the extracted tree
6. If any validation fails, clean up partial extraction and return 400

## Compilation Flow

1. **Extract archive** to `/tmp/compact-playground/{uuid}/` (per validation rules above)
2. **Read the entry point file** from the extracted directory
3. **Detect compiler version** from the pragma in the entry point (existing `detectVersionFromPragma` logic)
4. **Check cache** — SHA256 key from the raw archive bytes + resolved version + options
5. **Spawn compiler** — pass the entry point's full path to `compact compile`. The compiler's `find-source-pathname` resolves imports relative to the entry point's directory, so all imported files are already in place.
6. **Parse output** — reuse existing error parsing. No line adjustment (no wrapping).
7. **Cache result** if caching is enabled
8. **Cleanup** temp directory in `finally` block

## Security Hardening

### Rate limiting

Stricter limits for archive compilation: 10 requests per 60 seconds per IP (vs 20 for `/compile`).

### Timeouts

- Archive extraction: 10-second timeout
- Compilation: same 30-second default

### Cache key integrity

Hash the raw archive bytes (before extraction), not the extracted files. Simpler, deterministic, avoids TOCTOU issues. Use cache namespace `"compile-archive"` to distinguish from single-file compile results. A new `generateArchiveCacheKey(archiveBuffer: Buffer, version: string, options: object)` function is needed since the existing `generateCacheKey` normalizes string input, which would corrupt binary data.

### Cleanup guarantees

Same `finally` block pattern as existing compilation. Partial extractions cleaned up before returning errors.

### No compiler path escape

The compiler's `find-source-pathname` searches `relative-path` (the entry point's directory) and `compact-path`. We don't set `compact-path` to anything sensitive, and the compiler appends `.compact` to import names. The compiler can only find files within the extraction directory or its standard library paths.

### Multipart parser limits

Configure the multipart parser with explicit limits: max fields (3), max files (1), max file size (1 MB). Prevents abuse at the HTTP parsing layer.

## Error Handling

### Validation errors (400)

| Condition | Message |
|-----------|---------|
| Archive too large | `"Archive exceeds maximum compressed size of 1MB"` |
| Invalid format | `"Invalid archive format. Expected a .tar.gz file"` |
| Entry point missing from request | `"entryPoint field is required"` |
| Entry point not found in archive | `"Entry point 'src/Foo.compact' not found in archive"` |
| Path traversal detected | `"Archive contains invalid path: entry attempts to escape extraction directory"` |
| Symlink detected | `"Archive contains unsupported entry type: symlinks are not allowed"` |
| Disallowed extension | `"Archive contains file with disallowed extension: 'foo.js'. Only .compact files are permitted"` |
| Too many files | `"Archive exceeds maximum file count of 50"` |
| Uncompressed size exceeded | `"Archive exceeds maximum uncompressed size of 2MB"` |
| Extraction timeout | `"Archive extraction timed out"` |
| No pragma detected | `"Could not detect language version from pragma in entry point"` |
| No compatible compiler version | `"No installed compiler version satisfies the pragma constraint '<constraint>' in the entry point"` |
| Entry point path traversal | `"entryPoint path must not escape the archive root"` |
| Archive contains no files | `"Archive contains no .compact files"` |

### Compilation errors (200 with `success: false`)

Same behavior as existing endpoint — compiler errors/warnings returned in the response body.

### Server errors (500)

Generic message for unexpected failures. Details logged server-side.

## Testing Strategy

### Unit tests

- Archive validation: path traversal attempts, symlinks, absolute paths, null bytes, oversized archives, too many files, non-`.compact` extensions
- Entry point validation: missing field, file not in archive, nested paths
- Cache key generation from archive bytes

### Integration tests

- Happy path: valid archive with imports, compiles successfully
- Multi-level imports: `A.compact` imports `B.compact` which imports `lib/C.compact`
- Compiler errors in imported files: verify error messages reference the correct file/line
- Rate limiting on the new endpoint

### Security tests

- tar.gz with `../../etc/passwd` entry — verify rejection
- tar.gz with symlink entry — verify rejection
- tar.gz with absolute path entry — verify rejection
- Large archive (over 1 MB compressed) — verify rejection at upload
- Archive expanding beyond 2 MB — verify rejection mid-extraction
- Archive with 51+ files — verify rejection
- Archive containing a `.js` file alongside `.compact` files — verify rejection

### Test fixtures

- Small set of valid multi-file Compact contracts (main contract importing a library module)
- Malicious archives created programmatically in tests
