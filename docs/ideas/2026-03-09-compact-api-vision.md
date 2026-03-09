# Compact API Vision

## The Idea

Transform the Compact Playground from a simple compile-and-check backend into a general-purpose, self-hostable **Compact-as-a-Service API** — a hosted compiler, formatter, analyzer, and differ that any tool can consume. The mdBook widget becomes just the first client of a much richer API surface.

## Problem Space

**Setup friction is the #1 barrier to Compact adoption.** Installing the Compact CLI, managing compiler versions, configuring toolchains — all of this stands between a developer and their first successful compilation. Every tool that wants to work with Compact (editors, CI systems, documentation sites, learning platforms) has to solve this independently.

There is no shared infrastructure for Compact compilation. Every integration reinvents the wheel: install the compiler, manage versions, parse errors, handle timeouts. This fragmentation slows down the ecosystem.

## Core Value Proposition

**Zero-install Compact compilation, formatting, and analysis — available as an API call.** Any tool that can make an HTTP request can compile, format, analyze, and diff Compact contracts without installing anything.

## Key Features (v1 Scope)

### Format Endpoint (`POST /format`)
- Send Compact source code, receive formatted code back
- Option to return a diff showing what changed (before/after)
- Supports the same formatting rules as `compact format`
- Foundation for smart caching (normalization step)

### Analysis Tiers (`POST /analyze`)
- **Fast lint mode**: Parse source code to extract structure without compilation — exported circuits with signatures, ledger declarations, import dependencies, type usage. Near-instant response.
- **Deep analysis mode**: Full compilation to get accurate type information, circuit details, warnings, and estimated complexity. Slower but comprehensive.
- Consumers choose the tier based on their latency/depth tradeoff

### Multi-Version Compilation (`POST /compile`)
- Compile against a specific compiler version via request parameter
- **Compatibility matrix**: Send a contract, get back pass/fail/warnings across all installed compiler versions simultaneously
- Essential for library authors supporting multiple Compact versions and CI pipelines testing upgrade safety

### Semantic Contract Diffing (`POST /diff`)
- Send two versions of a contract, receive a structural diff
- Goes beyond line-level changes: identifies added/removed circuits, changed signatures, modified ledger state, altered type definitions
- Critical for security audits, upgrade safety, and code review of smart contracts

### Smart Compilation Caching
- Normalize input through the formatter before hashing to ensure whitespace/formatting differences that don't affect compilation produce the same cache key
- Cache key: `hash(formatted_code + compiler_version + options)`
- Cached results returned instantly — massive speedup for tutorial sites (everyone running the same examples) and CI (repeated compilations)
- Cache invalidation is clean: exact compiler version pinning means no ambiguity

### Self-Hosted Deployment (First-Class Path)
- Docker deployment documented and tested as a primary use case, not an afterthought
- Teams with proprietary contracts can run their own instance
- Multi-version compiler management within the container
- Clear documentation for: Docker standalone, Docker Compose, and production deployment patterns

## Deferred Features

- **Async webhooks / callback URLs** — Submit compilation jobs and receive results via webhook instead of blocking. Important for CI pipeline integration but not essential for v1.
- **Contract fingerprinting as standalone feature** — Deterministic structural hashing exposed as its own endpoint (the normalization logic exists in v1 for caching, but not as a user-facing feature).
- **Snippet registry** — Named, verified contract templates served from the API.
- **Standalone playground web UI** — A full browser-based editor (Monaco/CodeMirror) at its own URL. The mdBook widget remains the primary UI for now.

## Out of Scope / Anti-Goals

- **Not an IDE** — This is an API, not an editor. UI features belong to consumers of the API.
- **Not a package manager** — No dependency resolution, no package publishing, no versioned artifact hosting.
- **Not a deployment tool** — No interaction with the Midnight network, no contract deployment, no transaction submission.
- **Not an on-chain explorer** — No blockchain state queries, no transaction history, no contract state inspection.

## Open Questions

1. **Sandboxing strategy** — As a general-purpose API, compilation is effectively remote code execution. Current approach (temp directories + cleanup) works but may need containerized sandboxing (per-request isolation) for a production-grade public API.

2. **Compiler version lifecycle** — When offering multi-version compilation, how long do old compiler versions stay available? What's the retirement policy? This becomes a compatibility guarantee.

3. **Cache storage** — In-memory caching is simple but lost on restart. Should v1 include persistent caching (Redis, SQLite, filesystem), or is in-memory sufficient?

4. **Rate limiting for different tiers** — Deep analysis and compatibility matrix are expensive. Should they have stricter rate limits than simple compile or format requests?

5. **API versioning** — As the API surface grows, how do we version it? URL path (`/v1/compile`), headers, or query params?

6. **Semantic diff depth** — How much structural understanding can we extract from compiler output vs. needing our own parser? The fast lint tier's parser could power surface-level diffing, while compiler output powers deep semantic diffing.

## Inspirations & Analogies

- **Go Playground / Rust Playground** — Proving that a hosted compiler API is table-stakes for language adoption. But this vision goes further with analysis, diffing, and multi-version support.
- **Dry cleaner (formatting)** — Drop off wrinkled code, pick it up pressed. The diff option is like the tailor showing chalk marks before cutting.
- **X-ray machine (analysis)** — Put a contract in, get its skeleton out. Tools build on the results without needing the equipment.
- **Wine flight (multi-version)** — Same contract, different compiler vintages, see which one suits.
- **Crash test at multiple speeds (compatibility matrix)** — Test structural integrity across all versions simultaneously.
- **Library catalog (caching)** — The book has already been indexed; no need to re-read it.
