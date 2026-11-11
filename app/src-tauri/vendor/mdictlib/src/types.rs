use std::fmt;

use crate::error::{Error, Result};
use crate::limits::try_clone_string;

/// Distinguishes text dictionaries (`.mdx`) from resource dictionaries
/// (`.mdd`) inside the shared parser.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ContainerKind {
    Mdx,
    Mdd,
}

/// Zero-based physical key ordinal within one unchanged dictionary file.
///
/// Ordinals identify duplicate keys without merging them. They are only stable
/// while the underlying dictionary file remains unchanged.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct KeyOrdinal(u64);

impl KeyOrdinal {
    /// Creates a zero-based key ordinal.
    pub const fn new(value: u64) -> Self {
        Self(value)
    }

    /// Returns the underlying zero-based value.
    pub const fn get(self) -> u64 {
        self.0
    }
}

impl From<u64> for KeyOrdinal {
    fn from(value: u64) -> Self {
        Self::new(value)
    }
}

impl From<KeyOrdinal> for u64 {
    fn from(value: KeyOrdinal) -> Self {
        value.get()
    }
}

/// An original decoded key paired with its physical ordinal.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeyEntry {
    ordinal: KeyOrdinal,
    key: String,
}

impl KeyEntry {
    pub(crate) fn new(ordinal: KeyOrdinal, key: String) -> Self {
        Self { ordinal, key }
    }

    pub(crate) fn try_clone(&self) -> Result<Self> {
        Ok(Self {
            ordinal: self.ordinal,
            key: try_clone_string(&self.key, "public key row")?,
        })
    }

    /// Returns the key's physical ordinal.
    pub const fn ordinal(&self) -> KeyOrdinal {
        self.ordinal
    }

    /// Returns the decoded key exactly as stored in the dictionary.
    pub fn key(&self) -> &str {
        &self.key
    }

    /// Consumes this value and returns the decoded key.
    pub fn into_key(self) -> String {
        self.key
    }
}

/// Interpreted MDict encryption flags used inside the parser.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct EncryptionMode(u8);

impl EncryptionMode {
    pub(crate) const fn new(bits: u8) -> Self {
        Self(bits)
    }

    /// Returns whether the keyword-section header is encrypted.
    pub(crate) const fn has_keyword_header(self) -> bool {
        self.0 & 0b01 != 0
    }

    /// Returns whether the keyword index is encrypted.
    pub(crate) const fn has_keyword_index(self) -> bool {
        self.0 & 0b10 != 0
    }
}

/// Parsed top-level XML metadata from an MDict file.
#[derive(Clone, PartialEq, Eq)]
pub struct Header {
    pub(crate) raw_xml: String,
    pub(crate) tag_name: String,
    pub(crate) attributes: Vec<(String, String)>,
    pub(crate) generated_by_engine_version: String,
    pub(crate) required_engine_version: String,
    pub(crate) encoding_label: Option<String>,
    pub(crate) format: Option<String>,
    pub(crate) key_case_sensitive: bool,
    pub(crate) strip_key: bool,
    pub(crate) encrypted: u8,
    pub(crate) register_by: Option<String>,
    pub(crate) reg_code: Option<String>,
    pub(crate) description: Option<String>,
    pub(crate) title: Option<String>,
    pub(crate) creation_date: Option<String>,
}

impl fmt::Debug for Header {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("Header")
            .field("tag_name", &self.tag_name)
            .field("raw_xml_len", &self.raw_xml.len())
            .field("attribute_count", &self.attributes.len())
            .field(
                "generated_by_engine_version",
                &self.generated_by_engine_version,
            )
            .field("required_engine_version", &self.required_engine_version)
            .field("encoding_label", &self.encoding_label)
            .field("format", &self.format)
            .field("key_case_sensitive", &self.key_case_sensitive)
            .field("strip_key", &self.strip_key)
            .field("encrypted", &self.encrypted)
            .field("title", &self.title)
            .field("creation_date", &self.creation_date)
            .finish_non_exhaustive()
    }
}

impl Header {
    /// Returns the original decoded XML header.
    pub fn raw_xml(&self) -> &str {
        &self.raw_xml
    }

    /// Returns the top-level XML tag name.
    pub fn tag_name(&self) -> &str {
        &self.tag_name
    }

    /// Iterates over raw XML attributes without normalizing their names.
    pub fn attributes(&self) -> impl ExactSizeIterator<Item = (&str, &str)> {
        self.attributes
            .iter()
            .map(|(name, value)| (name.as_str(), value.as_str()))
    }

    /// Returns one raw XML attribute by its exact name.
    pub fn attribute(&self, name: &str) -> Option<&str> {
        self.attributes
            .iter()
            .find_map(|(candidate, value)| (candidate == name).then_some(value.as_str()))
    }

    /// Returns the declared builder engine version.
    pub fn generated_by_engine_version(&self) -> &str {
        &self.generated_by_engine_version
    }

    /// Returns the declared minimum reader engine version.
    pub fn required_engine_version(&self) -> &str {
        &self.required_engine_version
    }

    /// Returns the declared text-encoding label, when present.
    pub fn encoding_label(&self) -> Option<&str> {
        self.encoding_label.as_deref()
    }

    /// Returns the declared record format, when present.
    pub fn format(&self) -> Option<&str> {
        self.format.as_deref()
    }

    /// Returns whether key matching is declared case-sensitive.
    ///
    /// When the header omits `KeyCaseSensitive`, MDX uses the historical
    /// case-insensitive default and MDD uses the sibling `mdx` metadata
    /// reader's case-sensitive resource-path default. An explicit header
    /// value overrides either.
    pub const fn key_case_sensitive(&self) -> bool {
        self.key_case_sensitive
    }

    /// Returns whether the header declares `StripKey` behavior.
    pub const fn strip_key(&self) -> bool {
        self.strip_key
    }

    pub(crate) const fn encryption_mode(&self) -> EncryptionMode {
        EncryptionMode::new(self.encrypted)
    }

    /// Returns the raw encryption flag bits declared by the file.
    pub const fn encryption_bits(&self) -> u8 {
        self.encrypted
    }

    /// Returns whether the keyword-section header is encrypted.
    pub const fn has_encrypted_keyword_header(&self) -> bool {
        EncryptionMode::new(self.encrypted).has_keyword_header()
    }

    /// Returns whether the keyword index is encrypted.
    pub const fn has_encrypted_keyword_index(&self) -> bool {
        EncryptionMode::new(self.encrypted).has_keyword_index()
    }

    /// Returns the registration identity mode, when present.
    pub fn register_by(&self) -> Option<&str> {
        self.register_by.as_deref()
    }

    /// Returns the registration code embedded in the header, when present.
    pub fn registration_code(&self) -> Option<&str> {
        self.reg_code.as_deref()
    }

    /// Returns the dictionary description, when present.
    pub fn description(&self) -> Option<&str> {
        self.description.as_deref()
    }

    /// Returns the dictionary title, when present.
    pub fn title(&self) -> Option<&str> {
        self.title.as_deref()
    }

    /// Returns the declared creation date, when present.
    pub fn creation_date(&self) -> Option<&str> {
        self.creation_date.as_deref()
    }
}

/// Passcode material for dictionaries with an encrypted keyword header.
#[derive(Clone, PartialEq, Eq)]
pub struct Passcode {
    pub(crate) reg_code_hex: String,
    pub(crate) user_id: String,
}

impl Passcode {
    /// Creates passcode material from a hexadecimal registration code and user
    /// identity.
    ///
    /// # Errors
    ///
    /// Returns [`Error::InvalidPasscode`] unless the registration code is
    /// exactly 32 ASCII hexadecimal digits and the user identity is at most
    /// 4096 UTF-8 bytes.
    pub fn new(reg_code_hex: impl AsRef<str>, user_id: impl AsRef<str>) -> Result<Self> {
        let reg_code_hex = reg_code_hex.as_ref();
        if reg_code_hex.len() != 32 || !reg_code_hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(Error::InvalidPasscode(
                "registration code must contain exactly 32 hex digits",
            ));
        }
        let user_id = user_id.as_ref();
        if user_id.len() > 4 * 1024 {
            return Err(Error::InvalidPasscode(
                "user identity must not exceed 4096 UTF-8 bytes",
            ));
        }
        Ok(Self {
            reg_code_hex: try_clone_string(reg_code_hex, "passcode registration code")?,
            user_id: try_clone_string(user_id, "passcode user identity")?,
        })
    }
}

impl fmt::Debug for Passcode {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("Passcode")
            .field("reg_code_hex", &"[REDACTED]")
            .field("user_id", &"[REDACTED]")
            .finish()
    }
}

/// Controls whether MDict wire checksums are calculated and compared.
///
/// [`ChecksumPolicy::Skip`] is the default for throughput. It does not skip
/// size, range, decompression, or structural validation. A small checksum may
/// still be calculated when it is needed to distinguish wire layouts. Use
/// [`ChecksumPolicy::Verify`] when checksum mismatch detection is required.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ChecksumPolicy {
    /// Skip optional MDict wire checksum comparisons.
    #[default]
    Skip,
    /// Calculate and compare MDict wire checksums.
    Verify,
}

/// Options used when opening an MDX or MDD file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenOptions {
    pub(crate) passcode: Option<Passcode>,
    pub(crate) limits: Limits,
    pub(crate) checksum_policy: ChecksumPolicy,
}

impl OpenOptions {
    /// Creates default open options.
    pub const fn new() -> Self {
        Self {
            passcode: None,
            limits: Limits::new(),
            checksum_policy: ChecksumPolicy::Skip,
        }
    }

    /// Supplies passcode material for an encrypted keyword header.
    #[must_use]
    pub fn with_passcode(mut self, passcode: Passcode) -> Self {
        self.passcode = Some(passcode);
        self
    }

    /// Replaces the safety limits used while opening and reading the file.
    #[must_use]
    pub const fn with_limits(mut self, limits: Limits) -> Self {
        self.limits = limits;
        self
    }

    /// Selects whether MDict wire checksums are verified while decoding.
    #[must_use]
    pub const fn with_checksum_policy(mut self, checksum_policy: ChecksumPolicy) -> Self {
        self.checksum_policy = checksum_policy;
        self
    }

    /// Returns the configured safety limits.
    pub const fn limits(&self) -> &Limits {
        &self.limits
    }

    /// Returns the configured MDict wire checksum policy.
    pub const fn checksum_policy(&self) -> ChecksumPolicy {
        self.checksum_policy
    }
}

impl Default for OpenOptions {
    fn default() -> Self {
        Self::new()
    }
}

/// Per-open ceilings for file-derived reads, allocations, and retained work.
///
/// Each value is a hard upper bound, not a preallocation target. Lower limits
/// are useful when dictionaries come from especially constrained or
/// untrusted environments. A zero value disables the corresponding operation
/// rather than disabling the limit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Limits {
    pub(crate) header_xml_bytes: usize,
    pub(crate) header_attributes: usize,
    pub(crate) key_index_bytes: usize,
    pub(crate) record_index_bytes: usize,
    pub(crate) compressed_block_bytes: usize,
    pub(crate) decompressed_block_bytes: usize,
    pub(crate) block_metadata_bytes: usize,
    pub(crate) key_block_entries: u64,
    pub(crate) materialized_record_bytes: usize,
    pub(crate) locator_entries: u64,
    pub(crate) locator_bytes: usize,
    pub(crate) working_memory_bytes: usize,
}

impl Limits {
    /// Creates the default defensive limit policy.
    ///
    /// These ceilings are intentionally generous for ordinary dictionaries,
    /// but still reject hostile file declarations before their corresponding
    /// read or allocation. Applications that intentionally admit unusually
    /// large dictionaries can opt into [`Self::large_dictionary`].
    pub const fn new() -> Self {
        Self {
            header_xml_bytes: 16 * 1024 * 1024,
            header_attributes: 4 * 1024,
            key_index_bytes: 64 * 1024 * 1024,
            record_index_bytes: 64 * 1024 * 1024,
            compressed_block_bytes: 256 * 1024 * 1024,
            decompressed_block_bytes: 512 * 1024 * 1024,
            block_metadata_bytes: 64 * 1024 * 1024,
            key_block_entries: 2_000_000,
            materialized_record_bytes: 64 * 1024 * 1024,
            locator_entries: 10_000_000,
            locator_bytes: 512 * 1024 * 1024,
            working_memory_bytes: 1024 * 1024 * 1024,
        }
    }

    /// Creates a finite policy for unusually large dictionaries on modern
    /// 64-bit hosts.
    ///
    /// Limits are ceilings rather than preallocations. This preset is based on
    /// a measured 4,362,467-entry, 190 MB MDX whose populated locator retains
    /// about 121 MB; it leaves substantial per-section and working-memory
    /// headroom while preserving limit-before-read and limit-before-allocation
    /// behavior. Host applications should still apply an aggregate budget when
    /// opening many files.
    pub const fn large_dictionary() -> Self {
        Self {
            header_xml_bytes: 64 * 1024 * 1024,
            header_attributes: 16 * 1024,
            key_index_bytes: 512 * 1024 * 1024,
            record_index_bytes: 512 * 1024 * 1024,
            compressed_block_bytes: 1024 * 1024 * 1024,
            decompressed_block_bytes: 2 * 1024 * 1024 * 1024,
            block_metadata_bytes: 512 * 1024 * 1024,
            key_block_entries: 16_000_000,
            materialized_record_bytes: 512 * 1024 * 1024,
            locator_entries: u32::MAX as u64,
            locator_bytes: 1024 * 1024 * 1024,
            working_memory_bytes: 2 * 1024 * 1024 * 1024,
        }
    }

    /// Sets the maximum decoded XML-header size.
    #[must_use]
    pub const fn with_header_xml_bytes(mut self, value: usize) -> Self {
        self.header_xml_bytes = value;
        self
    }

    /// Sets the maximum number of XML-header attributes.
    #[must_use]
    pub const fn with_header_attributes(mut self, value: usize) -> Self {
        self.header_attributes = value;
        self
    }

    /// Sets the maximum compressed or decoded keyword-index size.
    #[must_use]
    pub const fn with_key_index_bytes(mut self, value: usize) -> Self {
        self.key_index_bytes = value;
        self
    }

    /// Sets the maximum record-index size.
    #[must_use]
    pub const fn with_record_index_bytes(mut self, value: usize) -> Self {
        self.record_index_bytes = value;
        self
    }

    /// Sets the maximum compressed size of one key or record block.
    #[must_use]
    pub const fn with_compressed_block_bytes(mut self, value: usize) -> Self {
        self.compressed_block_bytes = value;
        self
    }

    /// Sets the maximum decoded size of one key or record block.
    #[must_use]
    pub const fn with_decompressed_block_bytes(mut self, value: usize) -> Self {
        self.decompressed_block_bytes = value;
        self
    }

    /// Sets the maximum retained block-index metadata size.
    #[must_use]
    pub const fn with_block_metadata_bytes(mut self, value: usize) -> Self {
        self.block_metadata_bytes = value;
        self
    }

    /// Sets the maximum number of entries declared by one key block.
    #[must_use]
    pub const fn with_key_block_entries(mut self, value: u64) -> Self {
        self.key_block_entries = value;
        self
    }

    /// Sets the maximum byte length of a materialized MDX entry or MDD resource.
    #[must_use]
    pub const fn with_materialized_record_bytes(mut self, value: usize) -> Self {
        self.materialized_record_bytes = value;
        self
    }

    /// Sets the maximum number of physical rows retained by the lookup locator.
    /// The effective upper bound is also limited by the locator index width.
    #[must_use]
    pub const fn with_locator_entries(mut self, value: u64) -> Self {
        self.locator_entries = value;
        self
    }

    /// Removes locator row-count limiting so lookups are only bounded by the
    /// locator index width (u32).
    #[must_use]
    pub const fn with_unlimited_locator_entries(mut self) -> Self {
        self.locator_entries = u64::MAX;
        self
    }

    /// Sets the maximum estimated retained size of the lookup locator and the
    /// maximum ordinal bytes materialized for one persistent-index match set.
    #[must_use]
    pub const fn with_locator_bytes(mut self, value: usize) -> Self {
        self.locator_bytes = value;
        self
    }

    /// Sets the aggregate per-open budget for active and cached parser work.
    #[must_use]
    pub const fn with_working_memory_bytes(mut self, value: usize) -> Self {
        self.working_memory_bytes = value;
        self
    }

    /// Returns the maximum decoded XML-header size.
    pub const fn header_xml_bytes(&self) -> usize {
        self.header_xml_bytes
    }

    /// Returns the maximum number of XML-header attributes.
    pub const fn header_attributes(&self) -> usize {
        self.header_attributes
    }

    /// Returns the maximum compressed or decoded keyword-index size.
    pub const fn key_index_bytes(&self) -> usize {
        self.key_index_bytes
    }

    /// Returns the maximum record-index size.
    pub const fn record_index_bytes(&self) -> usize {
        self.record_index_bytes
    }

    /// Returns the maximum compressed size of one key or record block.
    pub const fn compressed_block_bytes(&self) -> usize {
        self.compressed_block_bytes
    }

    /// Returns the maximum decoded size of one key or record block.
    pub const fn decompressed_block_bytes(&self) -> usize {
        self.decompressed_block_bytes
    }

    /// Returns the maximum retained block-index metadata size.
    pub const fn block_metadata_bytes(&self) -> usize {
        self.block_metadata_bytes
    }

    /// Returns the maximum number of entries declared by one key block.
    pub const fn key_block_entries(&self) -> u64 {
        self.key_block_entries
    }

    /// Returns the maximum byte length of a materialized record or resource.
    pub const fn materialized_record_bytes(&self) -> usize {
        self.materialized_record_bytes
    }

    /// Returns the maximum number of physical rows retained by the locator.
    pub const fn locator_entries(&self) -> u64 {
        self.locator_entries
    }

    /// Returns the maximum estimated retained locator size.
    pub const fn locator_bytes(&self) -> usize {
        self.locator_bytes
    }

    /// Returns the aggregate per-open parser working-memory budget.
    pub const fn working_memory_bytes(&self) -> usize {
        self.working_memory_bytes
    }
}

impl Default for Limits {
    fn default() -> Self {
        Self::new()
    }
}

/// Accounted parser memory for one open dictionary at a point in time.
///
/// Values are conservative allocation estimates used by the safety budget,
/// not allocator or operating-system RSS measurements. Materialized entries
/// and resources already returned to the caller are not retained parser work
/// and are therefore excluded.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MemoryUsage {
    current_bytes: usize,
    peak_bytes: usize,
    metadata_bytes: usize,
    locator_bytes: usize,
    key_cache_bytes: usize,
    record_cache_bytes: usize,
}

impl MemoryUsage {
    pub(crate) const fn new(
        current_bytes: usize,
        peak_bytes: usize,
        metadata_bytes: usize,
        locator_bytes: usize,
        key_cache_bytes: usize,
        record_cache_bytes: usize,
    ) -> Self {
        Self {
            current_bytes,
            peak_bytes,
            metadata_bytes,
            locator_bytes,
            key_cache_bytes,
            record_cache_bytes,
        }
    }

    /// Returns all memory currently charged to the per-open budget.
    pub const fn current_bytes(self) -> usize {
        self.current_bytes
    }

    /// Returns the highest aggregate charge observed by this open handle.
    pub const fn peak_bytes(self) -> usize {
        self.peak_bytes
    }

    /// Returns retained header and block-index metadata bytes.
    pub const fn metadata_bytes(self) -> usize {
        self.metadata_bytes
    }

    /// Returns retained global key-locator bytes, or zero before first lookup.
    pub const fn locator_bytes(self) -> usize {
        self.locator_bytes
    }

    /// Returns the currently cached decoded key-block estimate.
    pub const fn key_cache_bytes(self) -> usize {
        self.key_cache_bytes
    }

    /// Returns the currently cached decoded record-block estimate.
    pub const fn record_cache_bytes(self) -> usize {
        self.record_cache_bytes
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_ordinal_round_trips() {
        let ordinal = KeyOrdinal::new(u64::MAX);
        assert_eq!(ordinal.get(), u64::MAX);
        assert_eq!(u64::from(ordinal), u64::MAX);
    }

    #[test]
    fn passcode_debug_output_is_redacted() {
        let debug = format!(
            "{:?}",
            Passcode::new("0123456789abcdef0123456789abcdef", "secret-user").unwrap()
        );
        assert!(!debug.contains("0123456789abcdef0123456789abcdef"));
        assert!(!debug.contains("secret-user"));
    }

    #[test]
    fn passcode_rejects_invalid_registration_code() {
        let error = Passcode::new("not-hex", "user").unwrap_err();
        assert!(matches!(error, Error::InvalidPasscode(_)));
    }

    #[test]
    fn passcode_rejects_oversized_user_identity() {
        let user_id = "x".repeat(4097);
        let error = Passcode::new("0123456789abcdef0123456789abcdef", &user_id).unwrap_err();
        assert!(matches!(error, Error::InvalidPasscode(_)));
    }

    #[test]
    fn unlimited_locator_entries_overrides_row_cap() {
        let limits = Limits::new()
            .with_locator_entries(1)
            .with_unlimited_locator_entries();
        assert_eq!(limits.locator_entries(), u64::MAX);
    }

    #[test]
    fn large_dictionary_policy_is_finite_and_looser_than_default() {
        let default = Limits::new();
        let large = Limits::large_dictionary();

        assert!(large.header_xml_bytes() > default.header_xml_bytes());
        assert!(large.key_index_bytes() > default.key_index_bytes());
        assert!(large.materialized_record_bytes() > default.materialized_record_bytes());
        assert!(large.locator_bytes() > default.locator_bytes());
        assert!(large.working_memory_bytes() > default.working_memory_bytes());
        assert!(large.locator_entries() > default.locator_entries());
        for value in [
            large.header_xml_bytes(),
            large.header_attributes(),
            large.key_index_bytes(),
            large.record_index_bytes(),
            large.compressed_block_bytes(),
            large.decompressed_block_bytes(),
            large.block_metadata_bytes(),
            large.materialized_record_bytes(),
            large.locator_bytes(),
            large.working_memory_bytes(),
        ] {
            assert_ne!(value, usize::MAX);
        }
        assert_ne!(large.key_block_entries(), u64::MAX);
        assert_ne!(large.locator_entries(), u64::MAX);
    }
}
