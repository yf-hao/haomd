//! Rebuilding MDX dictionaries with an edit set applied.
//!
//! MDict files admit no in-place entry mutation: key and record blocks are
//! compressed and absolutely offset, so editing is a read-modify-rebuild.
//! [`rebuild_mdx`] streams one source dictionary through
//! [`MdxBuilder`](crate::MdxBuilder), applies an [`EditSet`], and emits a
//! complete replacement file. Replacement and deletion target physical
//! ordinals obtained from lookups or `entries()` iteration; inserted entries
//! merge in at their sorted position during emission.
//!
//! # Examples
//!
//! ```
//! use mdictlib::{rebuild_mdx, EditSet, MdxBuilder, MdxFile, WriteOptions};
//! use std::fs;
//!
//! # fn main() -> mdictlib::Result<()> {
//! let mut builder = MdxBuilder::new();
//! builder.add_entry("hello", "old body")?;
//! builder.add_entry("world", "kept body")?;
//! let mut bytes = Vec::new();
//! builder.finish(&mut bytes)?;
//!
//! let dir = std::env::temp_dir();
//! let path = dir.join(format!("mdictlib-edit-doc-{}.mdx", std::process::id()));
//! fs::write(&path, bytes)?;
//! let source = MdxFile::open(&path)?;
//!
//! let ordinal = source.lookup("hello")?.unwrap().key_entry().ordinal();
//! let mut edits = EditSet::new();
//! edits.replace_body(ordinal, "new body");
//! edits.insert("added", "added body");
//!
//! let mut rebuilt = Vec::new();
//! rebuild_mdx(&source, &edits, WriteOptions::new(), &mut rebuilt)?;
//! let rebuilt_path = dir.join(format!("mdictlib-edit-doc-{}.rebuilt.mdx", std::process::id()));
//! fs::write(&rebuilt_path, rebuilt)?;
//! let edited = MdxFile::open(&rebuilt_path)?;
//! assert_eq!(edited.lookup("hello")?.unwrap().text(), "new body");
//! assert_eq!(edited.lookup("added")?.unwrap().text(), "added body");
//!
//! let _ = fs::remove_file(&path);
//! let _ = fs::remove_file(&rebuilt_path);
//! # Ok(())
//! # }
//! ```

use std::io::Write;

use crate::mdx::MdxFile;
use crate::write::{MdxBuilder, WriteOptions, WriteSummary};
use crate::{Error, KeyOrdinal, Result};

/// A set of edits to apply while rebuilding one MDX dictionary.
///
/// Edits identify existing entries by physical ordinal. Replacing and
/// deleting the same ordinal, or replacing it twice, is refused by
/// [`rebuild_mdx`].
#[derive(Debug, Clone, Default)]
pub struct EditSet {
    deletions: Vec<KeyOrdinal>,
    replacements: Vec<(KeyOrdinal, String)>,
    insertions: Vec<(String, String)>,
}

impl EditSet {
    /// Creates an empty edit set.
    pub fn new() -> Self {
        Self::default()
    }

    /// Marks the entry at `ordinal` for deletion.
    pub fn delete(&mut self, ordinal: KeyOrdinal) -> &mut Self {
        self.deletions.push(ordinal);
        self
    }

    /// Replaces the body of the entry at `ordinal`, keeping its key.
    /// Renaming is delete-plus-insert.
    pub fn replace_body(&mut self, ordinal: KeyOrdinal, body: impl Into<String>) -> &mut Self {
        self.replacements.push((ordinal, body.into()));
        self
    }

    /// Adds a new entry that merges in at its sorted position.
    pub fn insert(&mut self, key: impl Into<String>, body: impl Into<String>) -> &mut Self {
        self.insertions.push((key.into(), body.into()));
        self
    }
}

/// Rebuilds `source` with `edits` applied and emits the replacement
/// dictionary to `out`.
///
/// Existing entries stream through unchanged unless deleted or replaced;
/// peak builder memory follows the builder's in-memory entry storage.
/// Publishing the rebuilt file over the source (same-filesystem rename) is a
/// host decision, exactly as it is for persistent key indexes.
///
/// # Errors
///
/// Returns [`Error::InvalidData`] for conflicting edits or entry text the
/// write options refuse, and propagates source-read and destination-write
/// failures unchanged.
pub fn rebuild_mdx<W: Write>(
    source: &MdxFile,
    edits: &EditSet,
    options: WriteOptions,
    out: W,
) -> Result<WriteSummary> {
    validate(edits)?;
    let mut builder = MdxBuilder::with_options(options);
    for entry in source.entries() {
        let entry = entry?;
        let ordinal = entry.key_entry().ordinal();
        if edits.deletions.contains(&ordinal) {
            continue;
        }
        let body = edits
            .replacements
            .iter()
            .find(|(edited, _)| *edited == ordinal)
            .map_or_else(|| entry.text(), |(_, body)| body.as_str());
        builder.add_entry(entry.key(), body)?;
    }
    for (key, body) in &edits.insertions {
        builder.add_entry(key, body)?;
    }
    builder.finish(out)
}

fn validate(edits: &EditSet) -> Result<()> {
    for (index, ordinal) in edits.deletions.iter().enumerate() {
        if edits.deletions[..index].contains(ordinal) {
            return Err(Error::InvalidData(format!(
                "entry {ordinal:?} is deleted more than once"
            )));
        }
        if edits
            .replacements
            .iter()
            .any(|(edited, _)| edited == ordinal)
        {
            return Err(Error::InvalidData(format!(
                "entry {ordinal:?} is both deleted and replaced"
            )));
        }
    }
    for (index, (ordinal, _)) in edits.replacements.iter().enumerate() {
        if edits.replacements[..index]
            .iter()
            .any(|(edited, _)| edited == ordinal)
        {
            return Err(Error::InvalidData(format!(
                "entry {ordinal:?} is replaced more than once"
            )));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conflicting_edits_are_refused() {
        let ordinal = KeyOrdinal::from(0u64);
        let mut edits = EditSet::new();
        edits.delete(ordinal).replace_body(ordinal, "body");
        assert!(validate(&edits).is_err());

        let mut edits = EditSet::new();
        edits.delete(ordinal).delete(ordinal);
        assert!(validate(&edits).is_err());

        let mut edits = EditSet::new();
        edits
            .replace_body(ordinal, "one")
            .replace_body(ordinal, "two");
        assert!(validate(&edits).is_err());
    }

    #[test]
    fn disjoint_edits_are_accepted() {
        let mut edits = EditSet::new();
        edits
            .delete(KeyOrdinal::from(0u64))
            .replace_body(KeyOrdinal::from(1u64), "body")
            .insert("key", "body");
        assert!(validate(&edits).is_ok());
    }
}
