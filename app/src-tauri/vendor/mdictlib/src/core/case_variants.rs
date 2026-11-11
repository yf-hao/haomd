//! Case-only selection inside an existing normalized equal range. Both index
//! backends supply source keys; no second key-space index or record read is needed.

use std::mem::size_of;

use super::{LocatedKeyPage, LocatorBasis, MdictFile};
use crate::error::{Error, Result};
use crate::limits::{ensure_usize_limit, try_reserve_vec};
use crate::types::KeyEntry;

pub(super) fn select_page<F>(
    dictionary: &MdictFile,
    query: &str,
    candidate_count: usize,
    offset: usize,
    limit: usize,
    mut source_key: F,
) -> Result<Option<LocatedKeyPage>>
where
    F: FnMut(usize) -> Result<(u32, KeyEntry)>,
{
    let capacity = limit.min(candidate_count.saturating_sub(offset));
    let bytes = capacity
        .checked_mul(size_of::<u32>())
        .ok_or(Error::InvalidFormat("case-variant page size overflow"))?;
    ensure_usize_limit(
        "key_match_page_bytes",
        bytes,
        dictionary.limits.locator_bytes,
    )?;
    let reservation = dictionary
        .memory
        .reserve(bytes, "case-variant match page")?;
    let mut ordinals = Vec::new();
    try_reserve_vec(&mut ordinals, capacity, "case-variant match page")?;
    let mut exact_count = 0usize;
    let mut variant_count = 0usize;

    // The complete equal range decides totals and the position of the exact /
    // variant boundary, even for an empty or out-of-range requested page.
    for position in 0..candidate_count {
        let (ordinal, key) = source_key(position)?;
        if key.key() == query {
            if exact_count >= offset && ordinals.len() < limit {
                ordinals.push(ordinal);
            }
            exact_count += 1;
        } else if equal_ignoring_case(key.key(), query) {
            variant_count += 1;
        }
    }
    let total = exact_count + variant_count;
    if total == 0 {
        return Ok(None);
    }

    // Only the requested page is retained. Revisit keys when its tail reaches
    // variants instead of keeping an unbounded classification/ordinal buffer.
    let wanted = limit.min(total.saturating_sub(offset));
    if ordinals.len() < wanted {
        let variant_offset = offset.saturating_sub(exact_count);
        let mut variant_position = 0usize;
        for position in 0..candidate_count {
            let (ordinal, key) = source_key(position)?;
            if key.key() != query && equal_ignoring_case(key.key(), query) {
                if variant_position >= variant_offset {
                    ordinals.push(ordinal);
                    if ordinals.len() == wanted {
                        break;
                    }
                }
                variant_position += 1;
            }
        }
    }
    Ok(Some(LocatedKeyPage::from_owned_with_reservation(
        if variant_count == 0 {
            LocatorBasis::RawExact
        } else {
            LocatorBasis::CaseVariants
        },
        total,
        ordinals,
        Some(reservation),
    )))
}

fn equal_ignoring_case(left: &str, right: &str) -> bool {
    if left.is_ascii() && right.is_ascii() {
        left.eq_ignore_ascii_case(right)
    } else {
        left.chars()
            .flat_map(char::to_lowercase)
            .eq(right.chars().flat_map(char::to_lowercase))
    }
}
