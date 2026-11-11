use std::mem::size_of;
use std::ops::ControlFlow;

use super::MdictFile;
use super::cache::PersistentKeyIndex;
use super::format::reject;
use crate::core::locator::{LocatedKeyPage, LocatedKeys, LocatorBasis, raw_digest};
use crate::error::{Error, Result};
use crate::index::{KeyIndexRejection, KeyIndexSourceIdentity};
use crate::limits::{
    checked_usize, ensure_usize_limit, try_reserve_vec, try_reserve_vec_amortized,
};
use crate::types::{KeyEntry, KeyOrdinal};

pub(crate) fn locate_case_variants(
    dictionary: &MdictFile,
    index: &PersistentKeyIndex,
    query: &str,
    offset: usize,
    limit: usize,
) -> Result<Option<LocatedKeyPage>> {
    validate_dictionary_identity(dictionary, &index.source_identity())?;
    let normalized_len = dictionary.normalizer.normalized_len(query)?;
    ensure_usize_limit(
        "normalized_query_bytes",
        normalized_len,
        dictionary.limits.locator_bytes,
    )?;
    let _query_memory = dictionary
        .memory
        .reserve(normalized_len, "persistent case-variant query")?;
    let normalized = dictionary.normalizer.normalize(query)?;
    let Some((start, end)) = index.equal_range(&normalized)? else {
        return Ok(None);
    };
    let count = checked_usize(
        end.checked_sub(start)
            .ok_or_else(|| reject(KeyIndexRejection::InvalidLayout("order range is inverted")))?,
        "persistent case-variant count",
    )?;
    super::super::case_variants::select_page(dictionary, query, count, offset, limit, |position| {
        let position = u64::try_from(position)
            .map_err(|_| Error::InvalidFormat("case-variant position exceeds u64"))?;
        let ordinal = index.order_at(start + position)?;
        let key = verified_source_key(dictionary, index, ordinal, &normalized)?;
        Ok((ordinal, key))
    })
}

pub(crate) fn locate(
    dictionary: &MdictFile,
    index: &PersistentKeyIndex,
    query: &str,
) -> Result<Option<LocatedKeys>> {
    validate_dictionary_identity(dictionary, &index.source_identity())?;
    let normalized_len = dictionary.normalizer.normalized_len(query)?;
    ensure_usize_limit(
        "normalized_query_bytes",
        normalized_len,
        dictionary.limits.locator_bytes,
    )?;
    let _query_memory = dictionary
        .memory
        .reserve(normalized_len, "persistent key-index query")?;
    let normalized = dictionary.normalizer.normalize(query)?;
    let Some((start, end)) = index.equal_range(&normalized)? else {
        return Ok(None);
    };
    let match_count = checked_usize(
        end.checked_sub(start)
            .ok_or_else(|| reject(KeyIndexRejection::InvalidLayout("order range is inverted")))?,
        "persistent key-index match count",
    )?;
    let match_bytes = match_count
        .checked_mul(size_of::<u32>())
        .ok_or(Error::InvalidFormat(
            "persistent key-index match size overflow",
        ))?;
    ensure_usize_limit(
        "key_index_match_bytes",
        match_bytes,
        dictionary.limits.locator_bytes,
    )?;
    let match_memory = dictionary
        .memory
        .reserve(match_bytes, "persistent key-index matches")?;
    let mut ordinals = index.ordinals_in(start, end)?;
    let digest = raw_digest(query);
    let mut exact_count = 0usize;
    for position in 0..ordinals.len() {
        let ordinal = ordinals[position];
        if index.raw_digest_at(ordinal)? != digest {
            continue;
        }
        let key = verified_source_key(dictionary, index, ordinal, &normalized)?;
        if key.key() == query {
            ordinals[exact_count] = ordinal;
            exact_count += 1;
        }
    }
    if exact_count != 0 {
        ordinals.truncate(exact_count);
        return Ok(LocatedKeys::from_owned_with_reservation(
            LocatorBasis::RawExact,
            ordinals,
            Some(match_memory),
        ));
    }
    for ordinal in &ordinals {
        let _ = verified_source_key(dictionary, index, *ordinal, &normalized)?;
    }
    Ok(LocatedKeys::from_owned_with_reservation(
        LocatorBasis::HeaderNormalized,
        ordinals,
        Some(match_memory),
    ))
}

pub(crate) fn locate_page(
    dictionary: &MdictFile,
    index: &PersistentKeyIndex,
    query: &str,
    offset: usize,
    limit: usize,
) -> Result<Option<LocatedKeyPage>> {
    validate_dictionary_identity(dictionary, &index.source_identity())?;
    let normalized_len = dictionary.normalizer.normalized_len(query)?;
    ensure_usize_limit(
        "normalized_query_bytes",
        normalized_len,
        dictionary.limits.locator_bytes,
    )?;
    let _query_memory = dictionary
        .memory
        .reserve(normalized_len, "persistent paged key-index query")?;
    let normalized = dictionary.normalizer.normalize(query)?;
    let Some((start, end)) = index.equal_range(&normalized)? else {
        return Ok(None);
    };
    let total = checked_usize(
        end.checked_sub(start)
            .ok_or_else(|| reject(KeyIndexRejection::InvalidLayout("order range is inverted")))?,
        "persistent key-index match count",
    )?;
    let page_capacity = limit.min(total.saturating_sub(offset));
    let page_bytes = page_capacity
        .checked_mul(size_of::<u32>())
        .ok_or(Error::InvalidFormat(
            "persistent key-index page size overflow",
        ))?;
    ensure_usize_limit(
        "key_match_page_bytes",
        page_bytes,
        dictionary.limits.locator_bytes,
    )?;
    let page_memory = dictionary
        .memory
        .reserve(page_bytes, "persistent key-index match page")?;
    let mut ordinals = Vec::new();
    try_reserve_vec(
        &mut ordinals,
        page_capacity,
        "persistent key-index match page",
    )?;

    let digest = raw_digest(query);
    let mut exact_count = 0usize;
    for position in start..end {
        let ordinal = index.order_at(position)?;
        if index.raw_digest_at(ordinal)? != digest {
            continue;
        }
        let key = verified_source_key(dictionary, index, ordinal, &normalized)?;
        if key.key() == query {
            let match_index = exact_count;
            exact_count = exact_count
                .checked_add(1)
                .ok_or(Error::InvalidFormat("raw-exact match count overflow"))?;
            if match_index >= offset && ordinals.len() < limit {
                ordinals.push(ordinal);
            }
        }
    }
    if exact_count != 0 {
        return Ok(Some(LocatedKeyPage::from_owned_with_reservation(
            LocatorBasis::RawExact,
            exact_count,
            ordinals,
            Some(page_memory),
        )));
    }

    ordinals.clear();
    for (match_index, position) in (start..end).enumerate() {
        let ordinal = index.order_at(position)?;
        let _ = verified_source_key(dictionary, index, ordinal, &normalized)?;
        if match_index >= offset && ordinals.len() < limit {
            ordinals.push(ordinal);
        }
    }
    Ok(Some(LocatedKeyPage::from_owned_with_reservation(
        LocatorBasis::HeaderNormalized,
        total,
        ordinals,
        Some(page_memory),
    )))
}

pub(crate) fn prefix(
    dictionary: &MdictFile,
    index: &PersistentKeyIndex,
    prefix: &str,
    limit: usize,
) -> Result<Vec<KeyEntry>> {
    let mut found = Vec::new();
    if limit == 0 {
        return Ok(found);
    }
    validate_dictionary_identity(dictionary, &index.source_identity())?;
    let normalized_len = dictionary.normalizer.normalized_len(prefix)?;
    ensure_usize_limit(
        "normalized_query_bytes",
        normalized_len,
        dictionary.limits.locator_bytes,
    )?;
    let _query_memory = dictionary
        .memory
        .reserve(normalized_len, "persistent key-index prefix query")?;
    let normalized = dictionary.normalizer.normalize(prefix)?;
    let mut position = index.lower_bound(&normalized, false)?;
    while position < index.len() && found.len() < limit {
        let ordinal = index.order_at(position)?;
        let row = index.row_text(ordinal)?;
        if !row.starts_with(&normalized) {
            break;
        }
        let key = verified_source_key(dictionary, index, ordinal, &row)?;
        try_reserve_vec_amortized(&mut found, 1, "persistent prefix matches")?;
        found.push(key);
        position += 1;
    }
    Ok(found)
}

pub(crate) fn scan<F>(
    dictionary: &MdictFile,
    index: &PersistentKeyIndex,
    mut visit: F,
) -> Result<()>
where
    F: FnMut(KeyOrdinal, &str) -> ControlFlow<()>,
{
    validate_dictionary_identity(dictionary, &index.source_identity())?;
    for row in 0..index.len() {
        let ordinal = u32::try_from(row).map_err(|_| {
            reject(KeyIndexRejection::InvalidLayout(
                "key count exceeds ordinal representation",
            ))
        })?;
        let text = index.row_text(ordinal)?;
        let _ = verified_source_key(dictionary, index, ordinal, &text)?;
        if visit(KeyOrdinal::new(row), &text).is_break() {
            break;
        }
    }
    Ok(())
}

pub(super) fn validate_dictionary_identity(
    dictionary: &MdictFile,
    identity: &KeyIndexSourceIdentity,
) -> Result<()> {
    let current = dictionary.source.current_identity()?;
    if dictionary.source.len() != identity.source_bytes || current.len != identity.source_bytes {
        return Err(reject(KeyIndexRejection::SourceLengthMismatch {
            expected: identity.source_bytes,
            actual: current.len,
        }));
    }
    if current.modified_unix_nanos != identity.source_modified_unix_nanos {
        return Err(reject(KeyIndexRejection::SourceModifiedMismatch {
            expected: identity.source_modified_unix_nanos,
            actual: current.modified_unix_nanos,
        }));
    }
    if dictionary.len() != identity.key_count {
        return Err(reject(KeyIndexRejection::KeyCountMismatch {
            expected: identity.key_count,
            actual: dictionary.len(),
        }));
    }
    Ok(())
}

pub(super) fn verified_source_key(
    dictionary: &MdictFile,
    index: &PersistentKeyIndex,
    ordinal: u32,
    expected_normalized: &str,
) -> Result<KeyEntry> {
    let row = ordinal;
    let ordinal = KeyOrdinal::new(u64::from(row));
    let entry = dictionary
        .key_at_ordinal(ordinal)?
        .ok_or_else(|| reject(KeyIndexRejection::SourceKeyMismatch { ordinal }))?;
    let normalized = dictionary.normalizer.normalize(entry.key())?;
    if normalized != expected_normalized
        || *index.row_text(row)? != normalized
        || index.raw_digest_at(row)? != raw_digest(entry.key())
    {
        return Err(reject(KeyIndexRejection::SourceKeyMismatch { ordinal }));
    }
    Ok(entry)
}
