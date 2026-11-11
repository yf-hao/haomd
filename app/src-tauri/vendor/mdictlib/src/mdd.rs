use std::fmt;
use std::io::Write;
use std::iter::FusedIterator;
use std::path::Path;
use std::sync::Arc;

use crate::core::{MdictFile, RecordDescriptor, RecordIter};
use crate::error::{Error, Result};
use crate::lookup::{KeyMatchPage, KeyMatches};
use crate::types::{ContainerKind, Header, KeyEntry, KeyOrdinal, MemoryUsage, OpenOptions};

/// An opened MDD resource dictionary.
pub struct MddFile {
    inner: Arc<MdictFile>,
}

impl fmt::Debug for MddFile {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("MddFile")
            .field("len", &self.len())
            .field("title", &self.header().title())
            .finish_non_exhaustive()
    }
}

/// One materialized MDD resource with its physical identity.
#[derive(PartialEq, Eq)]
pub struct MddResource {
    key: KeyEntry,
    bytes: Vec<u8>,
}

impl fmt::Debug for MddResource {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("MddResource")
            .field("ordinal", &self.ordinal())
            .field("key", &self.key())
            .field("len", &self.bytes.len())
            .finish()
    }
}

impl MddResource {
    fn new(key: KeyEntry, bytes: Vec<u8>) -> Self {
        Self { key, bytes }
    }

    /// Returns the resource's physical ordinal.
    pub const fn ordinal(&self) -> KeyOrdinal {
        self.key.ordinal()
    }

    /// Returns the original decoded resource key.
    pub fn key(&self) -> &str {
        self.key.key()
    }

    /// Returns the physical key row.
    pub fn key_entry(&self) -> &KeyEntry {
        &self.key
    }

    /// Returns the materialized resource bytes.
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    /// Consumes the resource into its key row and bytes.
    pub fn into_parts(self) -> (KeyEntry, Vec<u8>) {
        (self.key, self.bytes)
    }
}

/// A source-bound, lazily readable MDD resource span.
///
/// The span retains its originating open file, so it cannot accidentally be
/// read against a different MDD file. It is valid while that file snapshot is
/// unchanged.
#[derive(Clone)]
pub struct MddResourceSpan {
    source: Arc<MdictFile>,
    key: KeyEntry,
    start: u64,
    end: u64,
    len: u64,
}

impl fmt::Debug for MddResourceSpan {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("MddResourceSpan")
            .field("ordinal", &self.ordinal())
            .field("key", &self.key())
            .field("len", &self.len)
            .finish_non_exhaustive()
    }
}

impl MddResourceSpan {
    fn new(source: Arc<MdictFile>, descriptor: RecordDescriptor) -> Result<Self> {
        let len = source.validate_record_span(descriptor.start, descriptor.end)?;
        Ok(Self {
            source,
            key: descriptor.key,
            start: descriptor.start,
            end: descriptor.end,
            len,
        })
    }

    /// Returns the resource's physical ordinal.
    pub const fn ordinal(&self) -> KeyOrdinal {
        self.key.ordinal()
    }

    /// Returns the original decoded resource key.
    pub fn key(&self) -> &str {
        self.key.key()
    }

    /// Returns the physical key row.
    pub fn key_entry(&self) -> &KeyEntry {
        &self.key
    }

    /// Returns the decoded resource length without materializing it.
    pub const fn len(&self) -> u64 {
        self.len
    }

    /// Returns whether this resource is empty.
    pub const fn is_empty(&self) -> bool {
        self.len == 0
    }

    /// Materializes this resource into memory.
    ///
    /// # Errors
    ///
    /// Returns an error if the span is invalid, exceeds the materialization
    /// limit, cannot be decoded, or cannot be read from its source.
    pub fn read(&self) -> Result<MddResource> {
        let bytes = self.source.read_record_span(self.start, self.end)?;
        Ok(MddResource::new(self.key.try_clone()?, bytes))
    }

    /// Streams the resource into an `std::io::Write` destination.
    ///
    /// Streaming is not subject to the whole-resource materialization limit;
    /// individual record blocks remain bounded.
    ///
    /// # Errors
    ///
    /// Returns an error if the span or a record block is invalid, the source
    /// cannot be read, or the destination cannot be written.
    pub fn copy_to<W: Write + ?Sized>(&self, destination: &mut W) -> Result<u64> {
        let mut written = 0u64;
        self.source
            .visit_record_span(self.start, self.end, |chunk| {
                destination.write_all(chunk)?;
                let chunk_len = u64::try_from(chunk.len())
                    .map_err(|_| Error::InvalidFormat("resource chunk length exceeds u64"))?;
                written = written
                    .checked_add(chunk_len)
                    .ok_or(Error::InvalidFormat("resource write length overflow"))?;
                Ok(())
            })?;
        Ok(written)
    }
}

impl MddFile {
    /// The shared core state, for crate-internal structural work.
    pub(crate) fn core(&self) -> &MdictFile {
        &self.inner
    }

    /// Opens an MDD file with default options.
    ///
    /// As with [`MdxFile::open`](crate::MdxFile::open), the path may be a
    /// `file://` URL from a mobile file picker.
    ///
    /// # Errors
    ///
    /// Returns an error if the file cannot be read, requests an unsupported
    /// format path, exceeds a safety limit, or contains malformed metadata or
    /// indexes.
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        Self::open_with_options(path, &OpenOptions::new())
    }

    /// Opens an MDD file with reusable explicit options.
    ///
    /// # Errors
    ///
    /// Returns an error under the same conditions as [`Self::open`], including
    /// when an encrypted header cannot be opened with the supplied options.
    pub fn open_with_options(path: impl AsRef<Path>, options: &OpenOptions) -> Result<Self> {
        Ok(Self {
            inner: Arc::new(MdictFile::open(path, ContainerKind::Mdd, options)?),
        })
    }

    /// Returns parsed top-level header metadata.
    pub fn header(&self) -> &Header {
        self.inner.header()
    }

    /// Returns the number of physical resource entries.
    pub fn len(&self) -> u64 {
        self.inner.len()
    }

    /// Returns whether the resource dictionary declares no entries.
    pub fn is_empty(&self) -> bool {
        self.inner.is_empty()
    }

    /// Reports parser memory charged to this open handle's safety budget.
    ///
    /// # Errors
    ///
    /// Returns an error if an internal cache mutex was poisoned by a panic in
    /// another thread.
    pub fn memory_usage(&self) -> Result<MemoryUsage> {
        self.inner.memory_usage()
    }

    /// Iterates over original keys in physical file order without reading
    /// resource payloads.
    ///
    /// Block read and decode failures are yielded as an item; after yielding
    /// an error, the iterator is exhausted.
    pub fn keys(&self) -> impl FusedIterator<Item = Result<KeyEntry>> + '_ {
        self.inner.keys()
    }

    /// Returns one physical key row by ordinal without reading its resource.
    ///
    /// # Errors
    ///
    /// Returns an error if the corresponding key block cannot be read or is
    /// malformed.
    pub fn key_at(&self, ordinal: KeyOrdinal) -> Result<Option<KeyEntry>> {
        self.inner.key_at_ordinal(ordinal)
    }

    /// Resolves physical key rows for the supplied ordinals in input order.
    ///
    /// # Errors
    ///
    /// Returns an error if any requested key block cannot be read or is
    /// malformed.
    pub fn keys_at(&self, ordinals: &[KeyOrdinal]) -> Result<Vec<Option<KeyEntry>>> {
        self.inner.keys_at_ordinals(ordinals)
    }

    /// Resolves one resource to a source-bound span without reading its bytes.
    ///
    /// # Errors
    ///
    /// Returns an error if its key block is malformed or its record offsets do
    /// not describe a valid span.
    pub fn span_at(&self, ordinal: KeyOrdinal) -> Result<Option<MddResourceSpan>> {
        self.inner
            .record_at_ordinal(ordinal)?
            .map(|descriptor| MddResourceSpan::new(Arc::clone(&self.inner), descriptor))
            .transpose()
    }

    /// Materializes one resource by physical ordinal.
    ///
    /// # Errors
    ///
    /// Returns an error if the resource cannot be resolved, exceeds the
    /// materialization limit, or its record blocks cannot be read and decoded.
    pub fn resource_at(&self, ordinal: KeyOrdinal) -> Result<Option<MddResource>> {
        self.span_at(ordinal)?.map(|span| span.read()).transpose()
    }

    /// Locates every physical resource matching a query without reading bytes.
    ///
    /// Raw-exact matches across the entire file always win. Header-normalized
    /// fallback is considered only when no raw key matches, and duplicates are
    /// returned in ascending physical order.
    ///
    /// # Errors
    ///
    /// Returns an error if the global locator cannot be built because key data
    /// is malformed, unreadable, or exceeds a safety limit.
    pub fn locate(&self, query: &str) -> Result<Option<KeyMatches>> {
        self.inner
            .locate_keys(query)
            .map(|matches| matches.map(KeyMatches::from_located))
    }

    /// Locates a bounded window of matching physical resources without
    /// reading bytes or materializing the complete duplicate set.
    ///
    /// Ordering, duplicate identity, total-count reporting, and global
    /// raw-exact precedence are identical to [`Self::locate`]. A page beyond
    /// the complete match set is `Some` but empty.
    ///
    /// # Errors
    ///
    /// Returns an error if the global locator cannot be built, source key data
    /// is malformed or unreadable, or the requested page exceeds a configured
    /// safety or aggregate-memory limit.
    pub fn locate_page(
        &self,
        query: &str,
        offset: usize,
        limit: usize,
    ) -> Result<Option<KeyMatchPage>> {
        self.inner
            .locate_key_page(query, offset, limit)
            .map(|page| page.map(KeyMatchPage::from_located))
    }

    /// Resolves a query to a source-bound resource span without reading its
    /// bytes.
    ///
    /// # Errors
    ///
    /// Returns an error if lookup encounters malformed key data or the matched
    /// record offsets do not describe a valid span.
    pub fn lookup_span(&self, query: &str) -> Result<Option<MddResourceSpan>> {
        let Some(matches) = self.locate(query)? else {
            return Ok(None);
        };
        self.span_at(matches.first())
    }

    /// Looks up and materializes one resource.
    ///
    /// # Errors
    ///
    /// Returns an error if lookup fails structurally or the matched resource
    /// cannot be read within the materialization limit.
    pub fn lookup(&self, query: &str) -> Result<Option<MddResource>> {
        self.lookup_span(query)?.map(|span| span.read()).transpose()
    }

    /// Iterates lazily over materialized resources in physical file order.
    ///
    /// Block read and decode failures are yielded as an item; after yielding
    /// an error, the iterator is exhausted.
    pub fn resources(&self) -> impl FusedIterator<Item = Result<MddResource>> + '_ {
        MddResourceIter {
            file: self,
            records: self.inner.records(),
            done: false,
        }
    }

    fn read_resource(&self, descriptor: RecordDescriptor) -> Result<MddResource> {
        let bytes = self
            .inner
            .read_record_span(descriptor.start, descriptor.end)?;
        Ok(MddResource::new(descriptor.key, bytes))
    }
}

struct MddResourceIter<'a> {
    file: &'a MddFile,
    records: RecordIter<'a>,
    done: bool,
}

impl Iterator for MddResourceIter<'_> {
    type Item = Result<MddResource>;

    fn next(&mut self) -> Option<Self::Item> {
        if self.done {
            return None;
        }
        let result = self
            .records
            .next()
            .map(|result| result.and_then(|descriptor| self.file.read_resource(descriptor)));
        if result.as_ref().is_some_and(Result::is_err) {
            self.done = true;
        }
        result
    }
}

impl FusedIterator for MddResourceIter<'_> {}
