# mdictlib

`mdictlib` is a safe, library-first Rust reader for MDict `.mdx` text
dictionaries and `.mdd` resource dictionaries.

## Design

- MDX and MDD use one shared, file-backed parsing core.
- Opening reads bounded metadata and block indexes; key and record blocks stay
  lazy.
- Every physical key has a `KeyOrdinal`, so duplicates retain distinct
  identities and payloads.
- Lookup is global and deterministic: all raw-exact matches win before any
  header-normalized fallback.
- Public iterators are opaque and fused; wire-format modules remain private.
- MDD spans are source-bound and can stream without exposing raw offsets or
  materializing a whole resource.
- Per-open `Limits` and aggregate working-memory accounting bound untrusted
  reads, decompression, allocation, locator construction, and materialization;
  `Limits::new()` is finite and `Limits::large_dictionary()` is an explicit
  high-headroom preset for modern hosts.
- MDX callers can build and reopen a source-bound persistent key index without
  first retaining the complete process-lifetime locator. Construction uses a
  bounded external merge; runtime access verifies file chunks lazily.
- Unsafe code is forbidden.

## Supported Scope

Both MDict major versions are read through the same public API, the same
shared core, and the same limits. The wire version is detected once, from the
header, and never influences lookup, iteration, ordinal access, record
decoding, or MDD streaming.

Common to both versions:

- UTF-8, UTF-16LE, GBK/GB2312, GB18030, and Big5 text decoding
- lazy iteration, physical-ordinal access, and duplicate-aware lookup
- the shared eight-byte block envelope with big-endian ADLER32
- optional pure-Rust LZO through the `lzo` feature

### MDict major version 2

- MDX and MDD sections
- uncompressed, zlib, and LZO blocks
- keyword-index encryption
- passcode-protected keyword-header encryption
- a narrowly identified legacy v2 keyword-index layout: an exact
  little-endian keyword-header ADLER32 plus omitted summary terminators, used
  only when the canonical big-endian checksum fails

### MDict major version 1

- MDX and MDD sections with 32-bit geometry, raw keyword metadata, one-byte
  summary lengths, and unterminated summaries
- uncompressed and LZO blocks

Validated against 453 authorized real v1.2 MDX artifacts (407 fully validated,
43,185,052 entries) and 14 authorized real v1.2 MDD artifacts (77,863 entries).
A dictionary's MDX and MDD need not share a wire version; each file's version is
resolved on its own.

**Not supported for version 1**, and refused with a precise structured error
rather than a guess:

- encrypted version 1 files — no authorized artifact declares encryption and no
  framing has been established
- ISO8859-1 text, which real version 1.2 dictionaries declare but whose MDict
  byte semantics are unresolved
- zlib version 1 blocks are decoded by the shared envelope but have never been
  observed in an authorized artifact, so creator compatibility is untested

A version 1 file is never retried under the version 2 grammar, or the reverse,
and no code path rewrites one version's bytes into the other's shape.

Independent full-file tests cover every listed encoding and compression path,
both encryption modes, multi-block boundaries, duplicate keys, corruption, and
hostile declarations, for both wire versions. Future-major layouts, writing,
HTML/style processing, resource extraction policy, multi-volume discovery,
fuzzy search, mmap, and persistent MDD sidecars are out of scope.

## Using mdictlib

```toml
[dependencies]
mdictlib = "0.2.7"
```

Enable LZO when required by a dictionary:

```toml
[dependencies]
mdictlib = { version = "0.2.7", features = ["lzo"] }
```

`0.2.7` adds opt-in case-variant queries. Existing lookup methods retain their
raw-exact-first behavior. A `file://` URL is accepted wherever a dictionary path
is accepted, which is how a mobile file picker names a file.

## Writing And Editing

Plaintext MDict version 2 dictionaries and resource files can be created and
rebuilt in memory and written to any `std::io::Write` destination. Entries sort
under one fixed collation before emission, blocks never split an entry, and
every key block carries binary-search summaries, so the output reopens through
the same readers used above:

```rust,no_run
use mdictlib::{EditSet, MdxBuilder, MdxFile, WriteEncoding, WriteOptions, rebuild_mdx};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let options = WriteOptions::new().with_encoding(WriteEncoding::Utf8);
    let mut builder = MdxBuilder::with_options(options.clone());
    builder.header_attribute("Title", "My dictionary")?;
    builder.add_entry("hello", "<p>used as a greeting</p>")?;

    let mut bytes = Vec::new();
    let summary = builder.finish(&mut bytes)?;
    println!("wrote {} entries, {} bytes", summary.entries, summary.total_bytes);

    // Editing is read-modify-rebuild: MDict files have no in-place entry
    // mutation. Deleting, replacing a body, and inserting rebuild a complete
    // replacement file from an open MdxFile.
    let source = MdxFile::open("dictionary.mdx")?;
    let ordinal = source.lookup("hello")?.unwrap().key_entry().ordinal();
    let mut edits = EditSet::new();
    edits.replace_body(ordinal, "<p>edited body</p>").insert("new", "<p>added</p>");

    let mut rebuilt = Vec::new();
    rebuild_mdx(&source, &edits, options, &mut rebuilt)?;
    Ok(())
}
```

`MddBuilder` mirrors the same shape for `.mdd` resources (`add_resource` with
raw bytes). Unencodable text, NUL inside keys, oversized entries, and reserved
or duplicate header attributes are refused with structured errors; there is no
lossy fallback.

## Decoding And Re-Encoding

`reencode_mdx` and `reencode_mdd` decode every block of an open version 2
file and re-emit the whole file with the same structure and compression tags:
the header framing is re-encoded from the parsed raw XML, keyword-index rows
are re-emitted with updated block sizes, and each decompressed block payload
is re-wrapped unchanged.

Files whose blocks are all uncompressed come back **byte-identical**. Files
with zlib blocks can differ inside the compressed streams only, because
deflate output depends on the compressor implementation; keys, payloads,
order, summaries, and record separators are preserved either way. Version 1
sources, encrypted keyword sections, and LZO blocks are refused with
structured errors.

```rust,no_run
use mdictlib::{MdxFile, reencode_mdx};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let dictionary = MdxFile::open("dictionary.mdx")?;
    let mut reencoded = Vec::new();
    let summary = reencode_mdx(&dictionary, &mut reencoded)?;
    println!("re-encoded {} entries, {} bytes", summary.entries, summary.total_bytes);
    Ok(())
}
```

Run `cargo run --example reencode_demo -- [--dump DIR] path/to/dict.mdx
path/to/resources.mdd` to unpack arbitrary files, re-encode them, and verify
the result byte-for-byte against the originals (with a logical-equivalence
fallback for zlib streams). `--dump DIR` additionally writes the unpacked
content for debugging: each `.mdx` becomes one MDict-source-format
`DIR/<stem>.txt` (key, `</>`, definition, `</>` per entry), and each `.mdd`
becomes a `DIR/<stem>/` directory holding every resource under its resource
path. Without file arguments the demo builds synthetic samples and verifies
those.

## MDX

```rust,no_run
use mdictlib::{KeyOrdinal, MatchBasis, MdxFile};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let dictionary = MdxFile::open("dictionary.mdx")?;

    if let Some(matches) = dictionary.locate("apple")? {
        println!("basis: {:?}, duplicates: {}", matches.basis(), matches.len());
        assert!(matches.basis() == MatchBasis::RawExact || !matches.is_empty());

        for ordinal in matches.iter() {
            let entry = dictionary.entry_at(ordinal)?.unwrap();
            println!("{}: {}", entry.ordinal().get(), entry.text());
        }
    }

    // Large homograph groups can be pulled without allocating every ordinal.
    if let Some(page) = dictionary.locate_page("apple", 100, 20)? {
        println!("{} total matches", page.total());
        for ordinal in page.iter() {
            println!("page ordinal {}", ordinal.get());
        }
    }

    if let Some(entry) = dictionary.entry_at(KeyOrdinal::new(42))? {
        println!("physical entry 42 is {}", entry.key());
    }

    // Convenience lookup chooses the lowest matching physical ordinal.
    if let Some(entry) = dictionary.lookup("apple")? {
        println!("{}: {}", entry.key(), entry.text());
    }

    Ok(())
}
```

`locate()` searches every raw key first. Only a global raw miss enables the
header-controlled normalized index. `KeyMatches` preserves every matching
ordinal in physical order and reports `RawExact` or `HeaderNormalized`.
`locate_page()` preserves the same global basis, total, duplicate identity, and
order while retaining only the requested ordinal window. `MddFile` exposes the
same paged locator for resource keys.

## Including Case Variants

A merged dictionary can store `Make`, `make`, and `MAKE` as independent entries.
Use `MatchMode::IncludeCaseVariants` when browsing should include all of them:

```rust,no_run
use mdictlib::{MatchMode, MdxFile};

let dictionary = MdxFile::open("dictionary.mdx")?;
if let Some(page) = dictionary.locate_page_with_mode(
    "make", 0, 20, MatchMode::IncludeCaseVariants,
)? {
    for ordinal in page.iter() {
        let entry = dictionary.entry_at(ordinal)?.unwrap();
        println!("{}: {}", entry.key(), entry.text());
    }
}
# Ok::<(), mdictlib::Error>(())
```

- Raw-exact rows come first; case variants follow. Each group retains physical
  order and every duplicate ordinal. `MatchBasis::CaseVariants` describes the
  entire result when at least one non-exact spelling exists, even when a page
  contains only exact rows or is empty. Exact-only results remain `RawExact`.
- `KeyCaseSensitive=Yes` keeps ordinary matching. Otherwise comparison uses
  the index's Unicode scalar lowercase, without removing punctuation or spaces.
  This is not full Unicode case folding: `Straße` and `STRASSE`, and Greek
  final/non-final sigma, do not become new equivalents.
- When no case-only match exists, the existing header-normalized fallback
  remains available (including `StripKey` if the publisher enabled it).
- `locate_with_mode` returns the complete set. Its paged counterpart retains
  only a bounded ordinal window. `MatchMode::PreferExact`, the default mode,
  reproduces the original methods, which are unchanged.
- `locate_with_key_index_and_mode` and `locate_page_with_key_index_and_mode`
  offer identical results through an existing persistent index. They never
  construct the in-memory locator.

Case selection reuses the normalized equal range and checks its source keys;
no record bodies, full-dictionary scan after indexing, new content hashes, or
second key-space index are involved. One pass classifies the equal range and
counts matches; pages that reach variants make a second bounded-range pass
until their window is full. Retained ordinals are bounded by the page limit;
complete-set queries are subject to the same locator/aggregate memory limits.
As with ordinary exact pagination, cache a bounded window for sequential reads
instead of repeating a one-row query. `KEY_INDEX_REVISION` stays `f3-p1-n1`:
index bytes and normalization are unchanged, so existing indexes need no rebuild.

A host should keep its primary-entry selection separate from expanded browsing
when history, explanations, or study state depend on the chosen headword. The
library returns physical entries; it does not resolve `@@@LINK` redirects or
choose a contextual meaning.

## Persistent MDX Key Indexes

Applications managing many large dictionaries can keep normalized key data in
a caller-owned sidecar instead of rebuilding and retaining one full locator per
open process. mdictlib owns the binary format, normalization, matching
semantics, bounded construction, and lazy integrity checks. The application
owns the cache namespace, scratch-space preflight, atomic publication, leases,
quotas, and garbage collection.

```rust,no_run
use mdictlib::{KeyIndexOptions, MdxFile, KEY_INDEX_REVISION};
use std::fs;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let dictionary = MdxFile::open("dictionary.mdx")?;
    let cache_dir = format!("cache/{KEY_INDEX_REVISION}");
    fs::create_dir_all(&cache_dir)?;
    let options = KeyIndexOptions::new()
        .with_build_memory_bytes(32 * 1024 * 1024)
        .with_chunk_bytes(64 * 1024)
        .with_scratch_directory(&cache_dir);

    // Put this below a namespace derived from the stable source location. The
    // partial and final path must share a filesystem for an atomic rename.
    let partial = format!(
        "{cache_dir}/dictionary-42.{}.pending.aaidx",
        std::process::id(),
    );
    let final_path = format!("{cache_dir}/dictionary-42.aaidx");
    let build = dictionary.build_key_index_to_path(&partial, &options, || false)?;
    fs::rename(&partial, &final_path)?;
    let index = dictionary.open_key_index(&final_path, &build.source_identity(), &options)?;

    if let Some(matches) = dictionary.locate_with_key_index(&index, "apple")? {
        println!("{:?}: {} rows", matches.basis(), matches.len());
    }
    if let Some(page) = dictionary.locate_page_with_key_index(&index, "apple", 0, 20)? {
        println!("first {} of {} rows", page.len(), page.total());
    }
    Ok(())
}
```

`KEY_INDEX_REVISION` is a filesystem-safe aggregate of the format,
parser/layout, and normalization revisions. Cache entries must be namespaced by
the source's stable location plus this revision. `KeyIndexSourceIdentity`
contains the length, filesystem modification time, and physical key count for
that location; it is an inexpensive freshness stamp, not a content hash and not
a cross-path deduplication key. Moving or copying a dictionary therefore gives
it a different host namespace even when its length and timestamps happen to
match.

`build_key_index_to_path()` is deliberately a low-level, non-atomic create-new
operation. It flushes and syncs the new file, but the caller must build at a
unique temporary path and publish with a same-filesystem atomic rename. Discard
the partial path after any error. `build_key_index()` accepts `Write + Seek` and
never reads the final destination; `KeyIndexBuild::bytes_written()` reports its
length. The source's metadata stamp is checked before and after construction.

The index stores normalized text and bounds in physical order, a second ordinal
array sorted by normalized text then physical ordinal, and one raw-text digest
per physical row. Digests only filter candidates: source key blocks prove every
positive raw match. Raw-exact precedence, normalized fallback, duplicates,
prefix order, and physical scan order therefore match `locate()`,
`prefix_keys()`, and `scan_normalized_keys()`. `locate_page_with_key_index()`
retains only `min(limit, total - offset)` ordinals and charges that bounded
window to aggregate memory; the complete-set API still materializes and caps
the equal range while its `KeyMatches` is alive.

Every independent page call scans the complete normalized equal range to prove
the global raw-exact basis and exact total. This work is necessary: a raw match
outside the requested window must suppress normalized fallback inside it.
Sequential hosts should therefore request and cache a bounded ordinal window
rather than issue a one-row parser call for every rendered row. Persistent
physical scans source-verify each visited normalized row and raw digest before
calling the visitor, so an unchanged-layout source-key mutation rejects the
index instead of returning stale index text.

Normal open validates the expected metadata identity, revisions, file length,
and checked section geometry. Format revision 3 performs two fixed reads
totalling 248 bytes; it does not load the checksum directory or any data
section. In `Verify` mode, the first use of a section chunk reads the
corresponding bounded checksum page and exact chunk bytes. The verified bytes
stay in the bounded per-section cache and are the bytes interpreted. A positive
lookup or prefix result is additionally checked against the corresponding
current MDX source row. Invalid sidecars return `Error::KeyIndexRejected` and
never make the MDX itself unreadable.

Header buffers, the optional 4 KiB Verify-mode checksum page, section chunk
caches, and transient read results are charged to the originating dictionary's
aggregate memory budget and reflected in `MemoryUsage` current/peak. Build-only sort arenas,
scratch files, and artifact disk bytes are not steady-state parser heap.
Construction decodes the source once, appends normalized bytes to a shared
arena, writes one-batch ordering directly, and otherwise uses bounded buffered
external-merge runs. No source row is individually allocated or sought during
multi-run sorting.

Section and header checksums are unkeyed corruption detection, not a security
proof against an attacker who can rewrite the sidecar and its checksums. The
metadata stamp likewise does not defend against timestamp spoofing. Persistent
indexes are local, rebuildable caches; delete and rebuild one after any
rejection.

MDict source decoding uses [`ChecksumPolicy`](https://docs.rs/mdictlib/latest/mdictlib/enum.ChecksumPolicy.html).
The default `ChecksumPolicy::Skip` avoids optional header, block-envelope, and
zlib checksum comparisons for throughput while retaining size, range,
decompression, complete-stream, and structural validation. Select
`ChecksumPolicy::Verify` when checksum mismatch errors are required:

```rust,no_run
use mdictlib::{ChecksumPolicy, MdxFile, OpenOptions};

fn main() -> mdictlib::Result<()> {
    let options = OpenOptions::new().with_checksum_policy(ChecksumPolicy::Verify);
    let dictionary = MdxFile::open_with_options("dictionary.mdx", &options)?;
    println!("{} entries", dictionary.len());
    Ok(())
}
```

Persistent `.aaidx` uses its own `KeyIndexOptions::with_checksum_policy` and
also defaults to `Skip`, so chunk checksum work is omitted during construction
and reads unless `Verify` is selected.

The sidecar contains plaintext normalized headwords. Every readable MDX source,
including version 2 keyword-index encryption, uses the same ordinary index
path; there is no encrypted-source policy gate. Callers own storage and
lifecycle policy for this derived artifact. A passcode-protected source must
still be opened successfully before it can be indexed. Persistent MDD indexing
is intentionally deferred.

## MDD

Materialize a bounded resource:

```rust,no_run
use mdictlib::MddFile;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let resources = MddFile::open("dictionary.mdd")?;

    if let Some(resource) = resources.lookup("\\image.png")? {
        println!("{} bytes", resource.bytes().len());
    }

    Ok(())
}
```

Or resolve a source-bound span and stream it:

```rust,no_run
use mdictlib::MddFile;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let resources = MddFile::open("dictionary.mdd")?;

    if let Some(span) = resources.lookup_span("\\audio.mp3")? {
        let mut bytes = Vec::new();
        let written = span.copy_to(&mut bytes)?;
        assert_eq!(written, span.len());
    }

    Ok(())
}
```

Streaming is not subject to the whole-resource materialization ceiling;
individual decoded record blocks and aggregate parser work remain bounded.

## Physical Keys And Ordinals

`keys()` returns original keys in physical file order without reading record
payloads:

```rust,no_run
use mdictlib::{KeyOrdinal, MdxFile};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let dictionary = MdxFile::open("dictionary.mdx")?;

    for key in dictionary.keys().take(10) {
        let key = key?;
        println!("{}: {}", key.ordinal().get(), key.key());
    }

    let keys = dictionary.keys_at(&[
        KeyOrdinal::new(7),
        KeyOrdinal::new(42),
        KeyOrdinal::new(7),
    ])?;
    println!("{keys:?}");

    Ok(())
}
```

Ordinals are stable only for the same unchanged dictionary file snapshot.

## Limits And Memory Diagnostics

```rust,no_run
use mdictlib::{Limits, MdxFile, OpenOptions};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let limits = Limits::large_dictionary()
        .with_materialized_record_bytes(16 * 1024 * 1024)
        .with_locator_bytes(256 * 1024 * 1024)
        .with_working_memory_bytes(512 * 1024 * 1024);
    let options = OpenOptions::new().with_limits(limits);
    let dictionary = MdxFile::open_with_options("dictionary.mdx", &options)?;

    let usage = dictionary.memory_usage()?;
    println!(
        "accounted current={} peak={} locator={}",
        usage.current_bytes(),
        usage.peak_bytes(),
        usage.locator_bytes(),
    );
    Ok(())
}
```

`Limits::new()` provides the finite defensive policy used by default. The
optional large-dictionary preset is still a set of ceilings, not a
preallocation: it is sized from a measured 4,362,467-entry, 190 MB MDX that
retained about 121 MB after lookup indexing. Ten comparable dictionaries need
about 1.21 GB of retained memory before application overhead, so an application
opening many files should add its own aggregate budget as AALookup does. The
preset is an additive API available to registry consumers since `0.2.3`.

`MemoryUsage` values are conservative parser budget estimates, not allocator or
operating-system RSS. Payloads already returned to the caller are excluded.

## Encrypted Keyword Headers

```rust,no_run
use mdictlib::{MdxFile, OpenOptions, Passcode};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let passcode = Passcode::new(
        "0123456789abcdef0123456789abcdef",
        "user@example.com",
    )?;
    let options = OpenOptions::new().with_passcode(passcode);
    let dictionary = MdxFile::open_with_options("encrypted.mdx", &options)?;
    println!("{} entries", dictionary.len());
    Ok(())
}
```

Passcode inputs are validated before cloning and `Debug` output is redacted.
Independent tests generate and open header-encrypted, index-encrypted, and
combined encrypted dictionaries end to end.

## Development Checks

```sh
cargo fmt --all -- --check
node --test scripts/corpus/*.test.mjs scripts/corpus/test/*.test.mjs
cargo test --locked --all-targets
cargo test --locked --all-targets --all-features
cargo test --locked --test conformance_v2 --no-default-features
cargo clippy --locked --all-targets --all-features -- -D warnings
cargo test --locked --doc --all-features
RUSTDOCFLAGS='-D warnings -D missing_docs -D rustdoc::broken_intra_doc_links' \
  cargo doc --locked --all-features --no-deps
cargo fetch --locked --manifest-path fuzz/Cargo.toml
CARGO_NET_OFFLINE=true cargo +nightly-2026-08-09 fuzz build
cargo package --locked --offline
```

The Node corpus-tooling check is repository-checkout-only. `scripts/corpus/`
and the tracked corpus metadata are intentionally excluded from the published
Rust package.

The committed workflow runs default/all-feature tests on Linux, macOS, and
Windows. Linux also runs formatting, Clippy, strict rustdoc, all seven bounded
AddressSanitizer/coverage-guided fuzz smoke targets, and offline package
verification. It pins cargo-fuzz 0.13.2 and nightly-2026-08-09.

## Corpus Discovery And Local Storage

Dictionary payloads are not stored in this Git repository or Git LFS. A public
download URL does not grant redistribution rights, and the audited direct-file
inventory is too large for a normal source checkout. The repository instead
tracks reviewable metadata and bounded tooling; authorized downloads live under
the ignored `.corpus/` directory.

Discovery is not validation. The referenced AALookup generator intentionally
samples a "reasonable set" in a bounded model-driven browsing run and says it
need not visit every file; the referenced checkout currently has no generated
draft. A deterministic metadata-only audit of `https://mdx.mdict.org/` on
2026-08-10 found 1,254 direct MDX links advertising 40,084,630,153 bytes. Its
sorted directory-listing fingerprint is
`cfa8cdc0e3b1579280398a295e45b7b56fb7c5ee856aa138492cbc72e6eac77d`;
that fingerprint does not authenticate any downloaded payload. In this
context, "all direct MDX files" means only those links in that named source
snapshot—not all dictionaries on the Internet or files hidden in archives.
The corrected row-bounded metadata snapshot is tracked as
[`corpus/mdict-org-2026-08-10.inventory.json`](https://github.com/lonelam/mdictlib/blob/master/corpus/mdict-org-2026-08-10.inventory.json);
the crawl started at `2026-08-10T04:06:35.081Z`, and the file contains no
dictionary payloads.

The complete review, inventory, acquisition, and validation workflow is in
[`corpus/README.md`](https://github.com/lonelam/mdictlib/blob/master/corpus/README.md).
It requires unapproved entries to remain visible and unsupported, encrypted,
corrupt, unavailable, and successfully validated artifacts to be classified
instead of silently treating only parser successes as the corpus.

The repository tooling binds a canonical reviewed selection to the exact
inventory bytes and complete selected source-path/type/URL/size set.
Acquisition accepts only reviewed, credential/query-free HTTPS targets with
connections pinned to validated public DNS answers and same-origin redirects.
Its binary-identity-pinned bootstrap observation is an isolated metadata-open
and entry-count check, not payload validation. Promotion binds the reviewed
lock and complete selection outcome report as a verifiable pair. Canonical full
validation later audits one locked artifact per bounded subprocess and writes
an exact catalog-, denominator-, and runner-bound outcome set; a logical-audit
TSV is produced only if every locked artifact succeeds. Recording self-observed
logical baselines requires that matching successful ledger and TSV; a separate
chain check exactly re-derives the logical lock from the pre-baseline lock and
those two evidence files.

The 2026-08-10 acquisition downloaded all 1,254 selected MDX objects, exactly
40,084,630,153 bytes, with no acquisition error. The reviewed bootstrap lock
contains the 792 files that completed metadata open/count: 37,377,272,230 bytes
and 89,051,220 declared physical entries. Its complete outcome report retains
the other 462 files: 453 non-v2 files, six v2 files rejected while decoding key
summaries, and three truncated record sections. The exact tracked evidence is
the [reviewed lock](https://github.com/lonelam/mdictlib/blob/master/corpus/catalog.lock.json)
and [acquisition outcomes](https://github.com/lonelam/mdictlib/blob/master/corpus/mdict-org-2026-08-10.acquisition-outcomes.json).

The isolated exhaustive run completed 757 whole artifacts, covering
27,098,834,819 bytes and 78,368,836 entries. The other 35 artifacts stopped at
their first recorded error; they contain 10,278,437,411 bytes and declare
10,682,384 entries, which were therefore not all traversed. The failures were
17 GBK and ten UTF-8 record-decode errors, two GBK and one UTF-8 key-decode
errors, two zlib stream errors, two zlib ADLER32 mismatches, and one key-summary
boundary mismatch. The tracked
[exhaustive outcome ledger](https://github.com/lonelam/mdictlib/blob/master/corpus/mdict-org-2026-08-10.exhaustive-outcomes.json)
is complete for the 792-artifact denominator. Because the run was not a
complete success, it produced no logical-audit TSV or logical-baseline lock.
One coherent real dictionary using the narrowly supported legacy v2
keyword-index layout completed all 213,587 entries.
These are source-data failures at the strict parser boundary; follow-up
forensics identified no parser change warranted. The results are
`mdictlib`-self-observed regression evidence, not independent proof of parser
correctness.

## Reproducible Authorized-Corpus Checks

Set `MDICT_CORPUS_DIR` to an authorized corpus directory and put
`mdictlib-corpus.tsv` at its root. Start from
[`tests/corpus-manifest.example.tsv`](tests/corpus-manifest.example.tsv).
Version 1 rows contain:

```text
path    kind    bytes    sha256    entries
```

Version 2 adds two independently optional logical baselines:

```text
path    kind    bytes    sha256    entries    key_sha256    payload_sha256
```

Paths are normalized `/`-separated paths relative to the corpus root. `kind` is
`mdx` or `mdd`. Record byte counts, SHA-256 values, and entry counts
independently of the parser under test where possible. `key_sha256` and
`payload_sha256` are exact hashes emitted by the exhaustive regression route;
when present, subsequent runs must match them. A self-observed entry count or
logical hash is a reproducibility snapshot, not independent proof of parser
correctness, and its basis must remain documented in the reviewed catalog.

```sh
export MDICT_CORPUS_DIR=/absolute/path/to/authorized-corpus
cargo test --locked --release --all-features --test local_corpus -- --ignored --nocapture
cargo test --locked --release --all-features --test local_sample -- --ignored --nocapture
cargo test --locked --release --all-features --test local_lookup_regression -- --ignored --nocapture
```

Explicit runs fail with setup instructions if the environment, manifest, or a
declared asset is absent or wrong. The lookup regression checks every physical
row, raw lookup, duplicate ordering, ordinal identity, and payload/span route.
It checks every per-row logical hash supplied by a version 2 manifest. For the
recorded version 1 release manifest, it also retains the deidentified exact key
and record/resource fallback hashes keyed by that manifest digest.

Those direct tests remain useful for an authorized corpus, but the canonical
repository-checkout full workflow linked above additionally provides
per-artifact process isolation, timeouts, executable identity checks, and a
lock-denominator-bound outcome report.

CI tests the corpus tooling against bounded local fixtures and keeps the Rust
corpus suites ignored by default. Full remote acquisition and exhaustive
validation are deliberate manual or self-hosted operations because they need
authorization review and substantial network, disk, and runtime budgets.

## Measurements

The release harness consumes the same verified manifest:

```sh
export MDICT_CORPUS_DIR=/absolute/path/to/authorized-corpus
cargo run --locked --release --all-features --example bench_local > benchmark.tsv
```

It reports open-to-first-lookup, metadata open, locator construction, warm
lookup distributions, full key scans, sequential and ordinal MDX payloads, MDD
streaming and materialization, concurrent first lookup, deterministic hashes,
and accounted memory. Optional controls are `MDICT_BENCH_FILTER`,
`MDICT_BENCH_WARM_RUNS`, and `MDICT_BENCH_THREADS`.

The checked-in `0.1.0` release evidence covers seven private v2 files,
3.61 GB, and 804,572 physical entries, including exhaustive raw lookup and
ordinal/payload round trips. Exact commands, hashes, timings, memory accounting,
and externally measured peak RSS are recorded in the repository at
`.codex/benchmarks/2026-08-10-macos-arm64.md`.

## License

MIT. See [LICENSE](LICENSE).
