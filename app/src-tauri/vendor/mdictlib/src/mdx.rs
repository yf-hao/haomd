use std::fmt;
use std::io::{Seek, Write};
use std::iter::FusedIterator;
use std::ops::ControlFlow;
use std::path::Path;

use crate::core::{MdictFile, RecordDescriptor, RecordIter};
use crate::error::Result;
use crate::format::TextEncoding;
use crate::index::{KeyIndex, KeyIndexBuild, KeyIndexOptions, KeyIndexSourceIdentity};
use crate::lookup::{KeyMatchPage, KeyMatches, MatchMode};
use crate::types::{ContainerKind, Header, KeyEntry, KeyOrdinal, MemoryUsage, OpenOptions};

/// An opened MDX text dictionary.
pub struct MdxFile {
    inner: MdictFile,
}

impl fmt::Debug for MdxFile {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("MdxFile")
            .field("len", &self.len())
            .field("title", &self.header().title())
            .finish_non_exhaustive()
    }
}

/// One decoded MDX entry with its physical identity.
#[derive(PartialEq, Eq)]
pub struct MdxEntry {
    key: KeyEntry,
    text: String,
}

impl fmt::Debug for MdxEntry {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("MdxEntry")
            .field("ordinal", &self.ordinal())
            .field("key", &self.key())
            .field("text_len", &self.text.len())
            .finish()
    }
}

impl MdxEntry {
    fn new(key: KeyEntry, text: String) -> Self {
        Self { key, text }
    }

    /// Returns the entry's physical ordinal.
    pub const fn ordinal(&self) -> KeyOrdinal {
        self.key.ordinal()
    }

    /// Returns the original decoded key.
    pub fn key(&self) -> &str {
        self.key.key()
    }

    /// Returns the physical key row.
    pub fn key_entry(&self) -> &KeyEntry {
        &self.key
    }

    /// Returns the decoded MDX record text.
    pub fn text(&self) -> &str {
        &self.text
    }

    /// Consumes the entry into its key row and decoded text.
    pub fn into_parts(self) -> (KeyEntry, String) {
        (self.key, self.text)
    }
}

impl MdxFile {
    /// The shared core state, for crate-internal structural work.
    pub(crate) fn core(&self) -> &MdictFile {
        &self.inner
    }

    /// Opens an MDX file with default options.
    ///
    /// The path may also be a `file://` URL, which is what a mobile file
    /// picker answers with — iOS hands back `NSURL`s and Android's Storage
    /// Access Framework does the same — including percent-escaped names. Only
    /// local URLs are accepted; one naming another host is refused.
    ///
    /// # Errors
    ///
    /// Returns an error if the file cannot be read, requests an unsupported
    /// format path, exceeds a safety limit, or contains malformed metadata or
    /// indexes, or if a `file://` URL is remote or malformed.
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        Self::open_with_options(path, &OpenOptions::new())
    }

    /// Opens an MDX file with reusable explicit options.
    ///
    /// # Errors
    ///
    /// Returns an error under the same conditions as [`Self::open`], including
    /// when an encrypted header cannot be opened with the supplied options.
    pub fn open_with_options(path: impl AsRef<Path>, options: &OpenOptions) -> Result<Self> {
        Ok(Self {
            inner: MdictFile::open(path, ContainerKind::Mdx, options)?,
        })
    }

    /// Returns parsed top-level header metadata.
    pub fn header(&self) -> &Header {
        self.inner.header()
    }

    /// Returns the number of physical dictionary entries.
    pub fn len(&self) -> u64 {
        self.inner.len()
    }

    /// Returns whether the dictionary declares no entries.
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
    /// record payloads.
    ///
    /// Block read and decode failures are yielded as an item; after yielding
    /// an error, the iterator is exhausted.
    pub fn keys(&self) -> impl FusedIterator<Item = Result<KeyEntry>> + '_ {
        self.inner.keys()
    }

    /// Returns one physical key row by ordinal without reading its record.
    ///
    /// # Errors
    ///
    /// Returns an error if the corresponding key block cannot be read or is
    /// malformed.
    pub fn key_at(&self, ordinal: KeyOrdinal) -> Result<Option<KeyEntry>> {
        self.inner.key_at_ordinal(ordinal)
    }

    /// Resolves physical key rows for the supplied ordinals in input order.
    /// Repeated and out-of-range ordinals are preserved as repeated values and
    /// `None`, respectively.
    ///
    /// # Errors
    ///
    /// Returns an error if any requested key block cannot be read or is
    /// malformed.
    pub fn keys_at(&self, ordinals: &[KeyOrdinal]) -> Result<Vec<Option<KeyEntry>>> {
        self.inner.keys_at_ordinals(ordinals)
    }

    /// Reads and decodes one MDX entry by physical ordinal.
    ///
    /// # Errors
    ///
    /// Returns an error if its key or record blocks cannot be read, are
    /// malformed, exceed a materialization limit, or contain invalid text.
    pub fn entry_at(&self, ordinal: KeyOrdinal) -> Result<Option<MdxEntry>> {
        self.inner
            .record_at_ordinal(ordinal)?
            .map(|descriptor| self.read_entry(descriptor))
            .transpose()
    }

    /// Locates every physical entry matching a query without reading records.
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

    /// Locates entries using an explicit matching policy without reading records.
    ///
    /// [`MatchMode::PreferExact`] is identical to [`Self::locate`].
    /// [`MatchMode::IncludeCaseVariants`] returns raw-exact rows followed by
    /// case-only variants, in physical order within each group. It respects
    /// `KeyCaseSensitive` and retains the ordinary header-normalized fallback
    /// when no case-only match exists. See [`MatchMode`] for Unicode semantics.
    ///
    /// # Errors
    ///
    /// Returns an error if keys cannot be read or validated, or the locator or
    /// complete match window exceeds its configured memory limits.
    pub fn locate_with_mode(&self, query: &str, mode: MatchMode) -> Result<Option<KeyMatches>> {
        if self.includes_case_variants(mode)
            && let Some(page) = self.inner.locate_case_variants(query, 0, usize::MAX)?
        {
            return Ok(page.into_matches().map(KeyMatches::from_located));
        }
        self.locate(query)
    }

    /// Locates a bounded window of matching physical entries without reading
    /// records or materializing the complete duplicate set.
    ///
    /// `offset` and `limit` address the same ascending physical order returned
    /// by [`Self::locate`]. Raw-exact precedence is decided across the complete
    /// normalized equal range before the page is returned. Consequently a
    /// page beyond the end is `Some` but empty and still reports the complete
    /// match count and basis.
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

    /// Returns a bounded window in the order defined by [`Self::locate_with_mode`].
    ///
    /// Totals and match basis describe the complete result, including when
    /// `limit` is zero or `offset` is beyond the end. Case-variant selection
    /// visits source keys in the normalized equal range, never record bodies,
    /// and retains at most `limit` ordinals. Sequential callers can cache a
    /// bounded window to avoid repeating classification for each individual row.
    ///
    /// # Errors
    ///
    /// Returns an error if keys cannot be read or validated, or the locator or
    /// requested page exceeds its configured memory limits.
    pub fn locate_page_with_mode(
        &self,
        query: &str,
        offset: usize,
        limit: usize,
        mode: MatchMode,
    ) -> Result<Option<KeyMatchPage>> {
        if self.includes_case_variants(mode)
            && let Some(page) = self.inner.locate_case_variants(query, offset, limit)?
        {
            return Ok(Some(KeyMatchPage::from_located(page)));
        }
        self.locate_page(query, offset, limit)
    }

    fn includes_case_variants(&self, mode: MatchMode) -> bool {
        mode == MatchMode::IncludeCaseVariants && !self.header().key_case_sensitive()
    }

    /// Locates physical entries whose key starts with `prefix` under the
    /// header's own normalization, in normalized order, stopping after `limit`.
    ///
    /// Duplicates are preserved, so a caller presenting completions to a person
    /// should ask for more than it intends to show and collapse repeats itself.
    ///
    /// # Errors
    ///
    /// Returns an error if the global locator cannot be built because key data
    /// is malformed, unreadable, or exceeds a safety limit.
    pub fn prefix_keys(&self, prefix: &str, limit: usize) -> Result<Vec<KeyEntry>> {
        let ordinals = self.inner.locate_prefix(prefix, limit)?;
        Ok(self
            .inner
            .keys_at_ordinals(&ordinals)?
            .into_iter()
            .flatten()
            .collect())
    }

    /// Visits every entry's normalized key in physical order, without copying
    /// it, until the callback breaks.
    ///
    /// This exists so a caller can apply its own search policy — completion
    /// ranking, edit distance, transliteration — across the whole key space
    /// without building and retaining a second copy of it. Resolve a chosen
    /// [`KeyOrdinal`] back to its original key with [`Self::key_at`].
    ///
    /// # Errors
    ///
    /// Returns an error if the global locator cannot be built because key data
    /// is malformed, unreadable, or exceeds a safety limit.
    pub fn scan_normalized_keys<F>(&self, visit: F) -> Result<()>
    where
        F: FnMut(KeyOrdinal, &str) -> ControlFlow<()>,
    {
        self.inner.scan_normalized_keys(visit)
    }

    /// Reads the lightweight source identity used to bind a persistent key
    /// index.
    ///
    /// This reads metadata from the parser-owned file handle without scanning
    /// source contents. The modification time retains the filesystem's native
    /// precision and is represented as signed Unix nanoseconds.
    ///
    /// # Errors
    ///
    /// Returns an error if file length or modification-time metadata cannot be
    /// read, or if the current length differs from the parsed source length.
    pub fn key_index_source_identity(&self) -> Result<KeyIndexSourceIdentity> {
        crate::core::persistent::source_identity(&self.inner)
    }

    /// Builds a complete persistent key index into a caller-owned sink with
    /// bounded sort memory and cancellation checkpoints.
    ///
    /// Does not initialize the global locator used by [`Self::locate`]. The
    /// destination is never read back and must be discarded on any error.
    ///
    /// # Errors
    ///
    /// Returns an error if source data is malformed or changes, a configured
    /// bound is exceeded, scratch or destination I/O fails, or cancellation is
    /// requested.
    pub fn build_key_index<W, C>(
        &self,
        destination: &mut W,
        options: &KeyIndexOptions,
        cancelled: C,
    ) -> Result<KeyIndexBuild>
    where
        W: Write + Seek + ?Sized,
        C: FnMut() -> bool,
    {
        crate::core::persistent::build_to_writer(&self.inner, destination, options, cancelled)
    }

    /// Builds a complete persistent key index at a caller-selected new path.
    ///
    /// The destination is opened with create-new semantics. After streaming the
    /// generated sections, this method flushes and syncs it without rereading it.
    /// Publication or atomic rename of that path remains the application's
    /// responsibility; the create-new file must be discarded whenever this
    /// method returns an error.
    ///
    /// # Errors
    ///
    /// Returns an error under the same conditions as [`Self::build_key_index`],
    /// or when the destination already exists or cannot be synced.
    pub fn build_key_index_to_path<P, C>(
        &self,
        path: P,
        options: &KeyIndexOptions,
        cancelled: C,
    ) -> Result<KeyIndexBuild>
    where
        P: AsRef<Path>,
        C: FnMut() -> bool,
    {
        crate::core::persistent::build_to_path(&self.inner, path, options, cancelled)
    }

    /// Opens a caller-selected persistent key index bound to `expected` and
    /// this dictionary's current source metadata.
    ///
    /// Validates the fixed header at open; section data is checked lazily when
    /// [`KeyIndexOptions::checksum_policy`](crate::KeyIndexOptions::checksum_policy)
    /// is [`ChecksumPolicy::Verify`](crate::ChecksumPolicy::Verify).
    ///
    /// # Errors
    ///
    /// Returns a structured [`crate::KeyIndexRejection`] through
    /// [`crate::Error::KeyIndexRejected`] for an incompatible, stale, corrupt,
    /// or malformed artifact, and an I/O error when it cannot be read.
    pub fn open_key_index(
        &self,
        path: impl AsRef<Path>,
        expected: &KeyIndexSourceIdentity,
        options: &KeyIndexOptions,
    ) -> Result<KeyIndex> {
        crate::core::persistent::open(&self.inner, path, expected, options).map(KeyIndex::new)
    }

    /// Locates every matching physical row through a persistent key index.
    ///
    /// Raw-exact matches win over header-normalized matches, raw digests are
    /// only filters, and every positive row is proved against source key data.
    /// Duplicates retain ascending physical order. Materialized match ordinals
    /// are bounded by [`crate::Limits::locator_bytes`] and remain charged to
    /// the dictionary's aggregate memory budget while the result is alive.
    ///
    /// # Errors
    ///
    /// Returns an error if the index or corresponding source key data fails
    /// validation or cannot be read, or the complete match set exceeds its
    /// configured byte or aggregate-memory ceiling.
    pub fn locate_with_key_index(
        &self,
        index: &KeyIndex,
        query: &str,
    ) -> Result<Option<KeyMatches>> {
        crate::core::persistent::locate(&self.inner, &index.inner, query)
            .map(|matches| matches.map(KeyMatches::from_located))
    }

    /// Applies [`Self::locate_with_mode`] through an existing persistent index.
    ///
    /// No additional index or format revision is needed. Case-variant selection
    /// verifies source keys throughout the candidate equal range, including
    /// candidates excluded by punctuation or whitespace differences.
    ///
    /// # Errors
    ///
    /// Returns an error if the index or source fails validation or cannot be
    /// read, or the complete match window exceeds its configured memory limits.
    pub fn locate_with_key_index_and_mode(
        &self,
        index: &KeyIndex,
        query: &str,
        mode: MatchMode,
    ) -> Result<Option<KeyMatches>> {
        if self.includes_case_variants(mode)
            && let Some(page) = crate::core::persistent::locate_case_variants(
                &self.inner,
                &index.inner,
                query,
                0,
                usize::MAX,
            )?
        {
            return Ok(page.into_matches().map(KeyMatches::from_located));
        }
        self.locate_with_key_index(index, query)
    }

    /// Locates a bounded window of matching physical rows through a persistent
    /// key index without allocating the complete duplicate set.
    ///
    /// `offset`, ordering, global raw-exact precedence, duplicate identity,
    /// and total-count semantics are identical to [`Self::locate_page`]. Every
    /// row used to decide or populate the result is proved against current
    /// source key data.
    ///
    /// # Errors
    ///
    /// Returns an error if the index or corresponding source key data fails
    /// validation or cannot be read, or the requested page exceeds a
    /// configured safety or aggregate-memory limit.
    pub fn locate_page_with_key_index(
        &self,
        index: &KeyIndex,
        query: &str,
        offset: usize,
        limit: usize,
    ) -> Result<Option<KeyMatchPage>> {
        crate::core::persistent::locate_page(&self.inner, &index.inner, query, offset, limit)
            .map(|page| page.map(KeyMatchPage::from_located))
    }

    /// Applies [`Self::locate_page_with_mode`] through an existing persistent index.
    ///
    /// Ordering, totals, and match basis are identical to the in-memory query.
    /// Source validation and bounded allocation follow
    /// [`Self::locate_with_key_index_and_mode`] and [`Self::locate_page_with_mode`].
    ///
    /// # Errors
    ///
    /// Returns an error if the index or source fails validation or cannot be
    /// read, or the requested page exceeds its configured memory limits.
    pub fn locate_page_with_key_index_and_mode(
        &self,
        index: &KeyIndex,
        query: &str,
        offset: usize,
        limit: usize,
        mode: MatchMode,
    ) -> Result<Option<KeyMatchPage>> {
        if self.includes_case_variants(mode)
            && let Some(page) = crate::core::persistent::locate_case_variants(
                &self.inner,
                &index.inner,
                query,
                offset,
                limit,
            )?
        {
            return Ok(Some(KeyMatchPage::from_located(page)));
        }
        self.locate_page_with_key_index(index, query, offset, limit)
    }

    /// Locates normalized-prefix rows through a persistent key index.
    ///
    /// Results use normalized order with physical ordinal as the duplicate
    /// tie-break, and each returned row is proved against source key data.
    ///
    /// # Errors
    ///
    /// Returns an error if the index or corresponding source key data fails
    /// validation or cannot be read.
    pub fn prefix_keys_with_index(
        &self,
        index: &KeyIndex,
        prefix: &str,
        limit: usize,
    ) -> Result<Vec<KeyEntry>> {
        crate::core::persistent::prefix(&self.inner, &index.inner, prefix, limit)
    }

    /// Visits normalized keys in physical source order through a persistent
    /// index until `visit` breaks.
    ///
    /// # Errors
    ///
    /// Returns an error if the index fails validation or cannot be read.
    pub fn scan_normalized_keys_with_index<F>(&self, index: &KeyIndex, visit: F) -> Result<()>
    where
        F: FnMut(KeyOrdinal, &str) -> ControlFlow<()>,
    {
        crate::core::persistent::scan(&self.inner, &index.inner, visit)
    }

    /// Looks up and decodes one entry using the dictionary's current key
    /// matching behavior.
    ///
    /// # Errors
    ///
    /// Returns an error if lookup encounters malformed key data or the matched
    /// record cannot be read and decoded.
    pub fn lookup(&self, query: &str) -> Result<Option<MdxEntry>> {
        let Some(matches) = self.locate(query)? else {
            return Ok(None);
        };
        self.entry_at(matches.first())
    }

    /// Iterates lazily over decoded entries in physical file order.
    ///
    /// Block read and decode failures are yielded as an item; after yielding
    /// an error, the iterator is exhausted.
    pub fn entries(&self) -> impl FusedIterator<Item = Result<MdxEntry>> + '_ {
        MdxEntryIter {
            file: self,
            records: self.inner.records(),
            done: false,
        }
    }

    fn read_entry(&self, descriptor: RecordDescriptor) -> Result<MdxEntry> {
        let encoded_len = descriptor
            .end
            .checked_sub(descriptor.start)
            .ok_or(crate::Error::InvalidFormat("record range is inverted"))?;
        let _memory = self.inner.reserve_decoded_record_text(encoded_len)?;
        let bytes = self
            .inner
            .read_record_span(descriptor.start, descriptor.end)?;
        let text = decode_record_text(self.inner.record_text_encoding()?, &bytes)?;
        Ok(MdxEntry::new(descriptor.key, text))
    }
}

struct MdxEntryIter<'a> {
    file: &'a MdxFile,
    records: RecordIter<'a>,
    done: bool,
}

impl Iterator for MdxEntryIter<'_> {
    type Item = Result<MdxEntry>;

    fn next(&mut self) -> Option<Self::Item> {
        if self.done {
            return None;
        }
        let result = self
            .records
            .next()
            .map(|result| result.and_then(|descriptor| self.file.read_entry(descriptor)));
        if result.as_ref().is_some_and(Result::is_err) {
            self.done = true;
        }
        result
    }
}

impl FusedIterator for MdxEntryIter<'_> {}

fn decode_record_text(encoding: TextEncoding, bytes: &[u8]) -> Result<String> {
    let mut text = encoding.decode(bytes, "mdx record")?;
    let trimmed_len = text.trim_end_matches('\0').len();
    text.truncate(trimmed_len);
    Ok(text)
}
