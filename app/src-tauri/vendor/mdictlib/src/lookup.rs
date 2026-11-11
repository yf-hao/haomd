use std::fmt;

use crate::core::{LocatedKeyPage, LocatedKeys, LocatorBasis};
use crate::types::KeyOrdinal;

/// Controls whether an MDX query also returns differently cased headwords.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum MatchMode {
    /// Return raw-exact matches, falling back to header normalization on a miss.
    #[default]
    PreferExact,
    /// Include case variants, with raw-exact matches first and physical order
    /// within each group. Respect `KeyCaseSensitive`; preserve punctuation and
    /// whitespace when comparing case variants. If no case-only match exists,
    /// retain the ordinary header-normalized fallback.
    ///
    /// Comparison uses Unicode scalar lowercase, as the existing MDX index
    /// does, rather than locale-specific or full Unicode case folding.
    IncludeCaseVariants,
}

/// Describes why a key query matched physical dictionary entries.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum MatchBasis {
    /// The decoded key was exactly equal to the query.
    RawExact,
    /// No raw key matched globally, so header-controlled normalization was used.
    HeaderNormalized,
    /// Case-only matches, including at least one non-exact spelling. Raw-exact
    /// rows precede variants; each group retains ascending physical order.
    CaseVariants,
}

/// A non-empty, duplicate-preserving set of physical key matches.
///
/// Matches are ordered by [`KeyOrdinal`], except that
/// [`MatchMode::IncludeCaseVariants`] places raw-exact rows before variants.
/// Cloning this value does not copy the underlying keys or locator indices.
#[derive(Clone)]
pub struct KeyMatches {
    inner: LocatedKeys,
}

/// A bounded, duplicate-preserving window of physical key matches.
///
/// The page may be empty when `offset` is at or beyond [`Self::total`]. Its
/// basis and total still describe the complete match set. Ordering follows
/// [`KeyMatches`], and the allocation retained by this value is
/// proportional to [`Self::len`], not [`Self::total`].
pub struct KeyMatchPage {
    inner: LocatedKeyPage,
}

impl KeyMatchPage {
    pub(crate) fn from_located(inner: LocatedKeyPage) -> Self {
        Self { inner }
    }

    /// Returns the matching basis of the complete query, not just this page.
    pub const fn basis(&self) -> MatchBasis {
        match self.inner.basis() {
            LocatorBasis::RawExact => MatchBasis::RawExact,
            LocatorBasis::HeaderNormalized => MatchBasis::HeaderNormalized,
            LocatorBasis::CaseVariants => MatchBasis::CaseVariants,
        }
    }

    /// Returns the number of physical entries in the complete match set.
    pub const fn total(&self) -> usize {
        self.inner.total()
    }

    /// Returns the number of ordinals materialized in this page.
    pub fn len(&self) -> usize {
        self.inner.len()
    }

    /// Returns whether this page contains no materialized ordinals.
    pub fn is_empty(&self) -> bool {
        self.inner.is_empty()
    }

    /// Returns one page ordinal by position in the selected match order.
    pub fn get(&self, index: usize) -> Option<KeyOrdinal> {
        self.inner.ordinal_at(index)
    }

    /// Iterates over this page's ordinals in the selected match order.
    pub fn iter(&self) -> impl ExactSizeIterator<Item = KeyOrdinal> + '_ {
        (0..self.len()).map(|index| {
            self.inner
                .ordinal_at(index)
                .expect("iterator indices stay inside the key match page")
        })
    }
}

impl KeyMatches {
    pub(crate) fn from_located(inner: LocatedKeys) -> Self {
        debug_assert!(!inner.is_empty());
        Self { inner }
    }

    /// Returns whether the query used raw equality, case variants, or header fallback.
    pub const fn basis(&self) -> MatchBasis {
        match self.inner.basis() {
            LocatorBasis::RawExact => MatchBasis::RawExact,
            LocatorBasis::HeaderNormalized => MatchBasis::HeaderNormalized,
            LocatorBasis::CaseVariants => MatchBasis::CaseVariants,
        }
    }

    /// Returns the number of matching physical entries.
    pub fn len(&self) -> usize {
        self.inner.len()
    }

    /// Returns whether this set is empty.
    ///
    /// Values returned by `locate()` are always non-empty.
    pub fn is_empty(&self) -> bool {
        self.inner.is_empty()
    }

    /// Returns the first ordinal in the selected match order.
    pub fn first(&self) -> KeyOrdinal {
        self.inner
            .ordinal_at(0)
            .expect("KeyMatches always contains at least one ordinal")
    }

    /// Returns one matching ordinal by position in the selected match order.
    pub fn get(&self, index: usize) -> Option<KeyOrdinal> {
        self.inner.ordinal_at(index)
    }

    /// Iterates over matching ordinals in the selected match order.
    pub fn iter(&self) -> impl ExactSizeIterator<Item = KeyOrdinal> + '_ {
        (0..self.len()).map(|index| {
            self.inner
                .ordinal_at(index)
                .expect("iterator indices stay inside the locator range")
        })
    }
}

impl fmt::Debug for KeyMatches {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("KeyMatches")
            .field("basis", &self.basis())
            .field("ordinals", &DebugOrdinals(self))
            .finish()
    }
}

impl fmt::Debug for KeyMatchPage {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("KeyMatchPage")
            .field("basis", &self.basis())
            .field("total", &self.total())
            .field("ordinals", &DebugPageOrdinals(self))
            .finish()
    }
}

struct DebugOrdinals<'a>(&'a KeyMatches);

struct DebugPageOrdinals<'a>(&'a KeyMatchPage);

impl fmt::Debug for DebugOrdinals<'_> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.debug_list().entries(self.0.iter()).finish()
    }
}

impl fmt::Debug for DebugPageOrdinals<'_> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.debug_list().entries(self.0.iter()).finish()
    }
}
