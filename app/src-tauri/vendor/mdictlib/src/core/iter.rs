use std::iter::FusedIterator;
use std::sync::Arc;

use super::keys::DecodedKeyBlock;
use super::{MdictFile, RecordDescriptor};
use crate::error::{Error, Result};
use crate::limits::try_clone_string;
use crate::types::{KeyEntry, KeyOrdinal};

pub(crate) struct KeyIter<'a> {
    file: &'a MdictFile,
    block_index: usize,
    entry_index: usize,
    current_block: Option<Arc<DecodedKeyBlock>>,
    done: bool,
}

impl<'a> KeyIter<'a> {
    pub(super) fn new(file: &'a MdictFile) -> Self {
        Self {
            file,
            block_index: 0,
            entry_index: 0,
            current_block: None,
            done: false,
        }
    }
}

impl Iterator for KeyIter<'_> {
    type Item = Result<KeyEntry>;

    fn next(&mut self) -> Option<Self::Item> {
        if self.done {
            return None;
        }

        loop {
            if self.block_index >= self.file.key_block_count() {
                self.done = true;
                return None;
            }

            if self.current_block.is_none() {
                match self.file.decode_key_block(self.block_index) {
                    Ok(entries) => {
                        self.current_block = Some(entries);
                        self.entry_index = 0;
                    }
                    Err(error) => {
                        self.done = true;
                        return Some(Err(error));
                    }
                }
            }

            let Some(entries) = self.current_block.as_ref() else {
                continue;
            };
            if self.entry_index >= entries.len() {
                self.block_index += 1;
                self.current_block = None;
                continue;
            }

            let block = &self.file.layout.key_blocks[self.block_index];
            let result = u64::try_from(self.entry_index)
                .ok()
                .and_then(|local| block.entry_start_index.checked_add(local))
                .ok_or(Error::InvalidFormat("key ordinal overflow"))
                .and_then(|ordinal| {
                    Ok(KeyEntry::new(
                        KeyOrdinal::new(ordinal),
                        try_clone_string(&entries[self.entry_index].key, "iterated physical key")?,
                    ))
                });
            self.entry_index += 1;
            if result.is_err() {
                self.done = true;
            }
            return Some(result);
        }
    }
}

impl FusedIterator for KeyIter<'_> {}

pub(crate) struct RecordIter<'a> {
    file: &'a MdictFile,
    block_index: usize,
    entry_index: usize,
    current_block: Option<Arc<DecodedKeyBlock>>,
    done: bool,
}

impl<'a> RecordIter<'a> {
    pub(super) fn new(file: &'a MdictFile) -> Self {
        Self {
            file,
            block_index: 0,
            entry_index: 0,
            current_block: None,
            done: false,
        }
    }
}

impl Iterator for RecordIter<'_> {
    type Item = Result<RecordDescriptor>;

    fn next(&mut self) -> Option<Self::Item> {
        if self.done {
            return None;
        }

        loop {
            if self.block_index >= self.file.key_block_count() {
                self.done = true;
                return None;
            }

            if self.current_block.is_none() {
                match self.file.decode_key_block(self.block_index) {
                    Ok(entries) => {
                        self.current_block = Some(entries);
                        self.entry_index = 0;
                    }
                    Err(error) => {
                        self.done = true;
                        return Some(Err(error));
                    }
                }
            }

            let Some(entries) = self.current_block.as_ref() else {
                continue;
            };
            if self.entry_index >= entries.len() {
                self.block_index += 1;
                self.current_block = None;
                continue;
            }

            let block_index = self.block_index;
            let entry_index = self.entry_index;
            let is_last_in_block = entry_index + 1 == entries.len();
            let entries = if is_last_in_block {
                self.current_block
                    .take()
                    .expect("current key block was checked above")
            } else {
                Arc::clone(entries)
            };
            let result = self
                .file
                .record_descriptor_at_position(block_index, entry_index, entries);
            if is_last_in_block {
                self.block_index += 1;
                self.entry_index = 0;
            } else {
                self.entry_index += 1;
            }
            if result.is_err() {
                self.done = true;
            }
            return Some(result);
        }
    }
}

impl FusedIterator for RecordIter<'_> {}
