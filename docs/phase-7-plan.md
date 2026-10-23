# Phase 7 implementation plan

Goal: replace whole-buffer archive conversions with bounded streaming, while retaining existing format/UI contracts. Execute inline, no new dependencies, push or deploy.

1. Audit: archive currently retains encoded input, expanded entries, encoded output and verification copies; all worker inputs are rejected above 64 MiB. Images and PCM/libav still need bounded full-frame/full-PCM allocations.
2. Add a backpressured output sink: OPFS when available in the disposable Worker, bounded Blob fallback otherwise. Track temporary files before creation; scheduler removes intermediates on success and all files on cancel/error, ResultManager removes retained output on clear. Test quota failure, cancellation and fallback.
3. Stream archive metadata/data: range-read TAR/ZIP, lazy entry streams, native gzip/deflate streams, incremental CRC and exact output verification. Reuse existing path/USTAR safety rules. Bound metadata, expansion/disk use separately from RAM. Test malformed headers, bombs, large files, integrity and stream cancellation before implementation.
4. Scope worker limits per engine; give genuinely streaming jobs a longer bounded deadline with inactivity timeout and measured byte progress. Keep full-buffer codec limits. Remove redundant typed-array copies where Blob already snapshots the bytes.
5. Browser verification: small/medium/large archives, OPFS unavailable/quota errors, actual Cancel/retry and cleanup; high-resolution images and existing audio regression. Compare old/current archive paths on identical inputs. Report observed elapsed time, I/O size and only instrumentable memory values (not invented process peak RSS).
6. Run all Node/browser suites, check/build/static checks, document supported streaming paths and remaining full-buffer image/audio/video limits. Commit each tested increment.
