//! Checked arithmetic and width promotion shared by every wire grammar.
//!
//! Version 1 declares its geometry in 32-bit fields and version 2 in 64-bit
//! fields, but the core only ever sees `u64`. Routing every limit check,
//! promotion, and platform conversion through one module keeps those
//! operations named and greppable instead of scattered as inline casts.

use crate::error::{Error, Result};

pub(crate) use crate::limits::{
    checked_usize, ensure_u64_ceiling, ensure_u64_limit, ensure_usize_limit,
};

/// Widens a 32-bit wire field to the internal 64-bit descriptor width.
///
/// Infallible by construction — every `u32` fits in a `u64` — but named so
/// that width promotion is a greppable operation rather than an inline cast.
pub(crate) const fn widen_u32(value: u32) -> u64 {
    value as u64
}

/// Adds two file-derived `u64` values, rejecting overflow.
///
/// # Errors
///
/// Returns an error if the sum overflows `u64`.
pub(crate) fn add_u64(left: u64, right: u64, context: &'static str) -> Result<u64> {
    left.checked_add(right).ok_or(Error::InvalidFormat(context))
}

/// Multiplies two file-derived `u64` values, rejecting overflow.
///
/// # Errors
///
/// Returns an error if the product overflows `u64`.
pub(crate) fn mul_u64(left: u64, right: u64, context: &'static str) -> Result<u64> {
    left.checked_mul(right).ok_or(Error::InvalidFormat(context))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn widening_preserves_every_u32_boundary() {
        assert_eq!(widen_u32(0), 0);
        assert_eq!(widen_u32(u32::MAX), 4_294_967_295);
    }

    #[test]
    fn rejects_overflowing_section_arithmetic() {
        assert!(add_u64(u64::MAX, 1, "test overflow").is_err());
        assert!(mul_u64(u64::MAX, 2, "test overflow").is_err());
        assert_eq!(add_u64(2, 3, "test").unwrap(), 5);
        assert_eq!(mul_u64(2, 3, "test").unwrap(), 6);
    }
}
