use std::mem;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use crate::error::{Error, Result};

/// Aggregate accounting for memory retained or transiently used by one open
/// dictionary. The counter is deliberately independent of the allocator: each
/// parser path reserves its conservative upper-bound estimate before it reads
/// or allocates file-derived data.
#[derive(Debug)]
pub(crate) struct MemoryBudget {
    max: usize,
    used: AtomicUsize,
    peak: AtomicUsize,
}

impl MemoryBudget {
    pub(crate) const fn new(max: usize) -> Self {
        Self {
            max,
            used: AtomicUsize::new(0),
            peak: AtomicUsize::new(0),
        }
    }

    pub(crate) fn reserve(
        self: &Arc<Self>,
        bytes: usize,
        _context: &'static str,
    ) -> Result<MemoryReservation> {
        self.claim(bytes)?;
        Ok(MemoryReservation {
            budget: Arc::clone(self),
            bytes,
        })
    }

    fn claim(&self, bytes: usize) -> Result<()> {
        let mut current = self.used.load(Ordering::Acquire);
        loop {
            let next = current.checked_add(bytes).ok_or(Error::LimitExceeded {
                limit: "working_memory_bytes",
                value: u64::MAX,
                max: u64::try_from(self.max).unwrap_or(u64::MAX),
            })?;
            if next > self.max {
                return Err(Error::LimitExceeded {
                    limit: "working_memory_bytes",
                    value: u64::try_from(next).unwrap_or(u64::MAX),
                    max: u64::try_from(self.max).unwrap_or(u64::MAX),
                });
            }
            match self.used.compare_exchange_weak(
                current,
                next,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => {
                    self.peak.fetch_max(next, Ordering::Relaxed);
                    return Ok(());
                }
                Err(observed) => current = observed,
            }
        }
    }

    pub(crate) fn used(&self) -> usize {
        self.used.load(Ordering::Acquire)
    }

    pub(crate) fn peak(&self) -> usize {
        self.peak.load(Ordering::Relaxed)
    }
}

/// RAII token that returns an aggregate memory reservation when dropped.
#[derive(Debug)]
pub(crate) struct MemoryReservation {
    budget: Arc<MemoryBudget>,
    bytes: usize,
}

impl MemoryReservation {
    pub(crate) const fn bytes(&self) -> usize {
        self.bytes
    }

    pub(crate) fn grow(&mut self, additional: usize) -> Result<()> {
        let next = self
            .bytes
            .checked_add(additional)
            .ok_or(Error::InvalidFormat("memory reservation size overflow"))?;
        self.budget.claim(additional)?;
        self.bytes = next;
        Ok(())
    }
}

impl Drop for MemoryReservation {
    fn drop(&mut self) {
        let previous = self.budget.used.fetch_sub(self.bytes, Ordering::AcqRel);
        debug_assert!(previous >= self.bytes, "memory budget underflow");
    }
}

pub(crate) fn ensure_u64_limit(limit: &'static str, value: u64, max: usize) -> Result<()> {
    let max = u64::try_from(max).map_err(|_| Error::InvalidFormat("limit exceeds u64"))?;
    ensure_u64_ceiling(limit, value, max)
}

pub(crate) fn ensure_u64_ceiling(limit: &'static str, value: u64, max: u64) -> Result<()> {
    if value > max {
        return Err(Error::LimitExceeded { limit, value, max });
    }
    Ok(())
}

pub(crate) fn ensure_usize_limit(limit: &'static str, value: usize, max: usize) -> Result<()> {
    if value > max {
        return Err(Error::LimitExceeded {
            limit,
            value: u64::try_from(value).unwrap_or(u64::MAX),
            max: u64::try_from(max).unwrap_or(u64::MAX),
        });
    }
    Ok(())
}

pub(crate) fn checked_usize(value: u64, context: &'static str) -> Result<usize> {
    usize::try_from(value).map_err(|_| {
        Error::InvalidData(format!(
            "{context} value {value} exceeds the platform address space"
        ))
    })
}

pub(crate) fn checked_u64(value: usize, context: &'static str) -> Result<u64> {
    u64::try_from(value).map_err(|_| {
        Error::InvalidData(format!(
            "{context} value {value} cannot be represented as u64"
        ))
    })
}

pub(crate) fn try_reserve_vec<T>(
    values: &mut Vec<T>,
    additional: usize,
    context: &'static str,
) -> Result<()> {
    let requested = values
        .len()
        .checked_add(additional)
        .and_then(|count| count.checked_mul(mem::size_of::<T>()))
        .and_then(|bytes| u64::try_from(bytes).ok())
        .unwrap_or(u64::MAX);
    values
        .try_reserve_exact(additional)
        .map_err(|_| Error::AllocationFailed { context, requested })
}

pub(crate) fn try_reserve_string(
    value: &mut String,
    additional: usize,
    context: &'static str,
) -> Result<()> {
    let requested = value
        .len()
        .checked_add(additional)
        .and_then(|bytes| u64::try_from(bytes).ok())
        .unwrap_or(u64::MAX);
    value
        .try_reserve_exact(additional)
        .map_err(|_| Error::AllocationFailed { context, requested })
}

/// Reserves with amortized growth, for a buffer appended to many times.
///
/// The exact variants above are right when the final size is known up front.
/// Using one of them per appended item instead reallocates the whole buffer
/// every time, which is quadratic over a multi-million-entry file.
pub(crate) fn try_reserve_string_amortized(
    value: &mut String,
    additional: usize,
    context: &'static str,
) -> Result<()> {
    let requested = value
        .len()
        .checked_add(additional)
        .and_then(|bytes| u64::try_from(bytes).ok())
        .unwrap_or(u64::MAX);
    value
        .try_reserve(additional)
        .map_err(|_| Error::AllocationFailed { context, requested })
}

/// The [`try_reserve_string_amortized`] counterpart for a growing vector.
pub(crate) fn try_reserve_vec_amortized<T>(
    values: &mut Vec<T>,
    additional: usize,
    context: &'static str,
) -> Result<()> {
    let requested = values
        .len()
        .checked_add(additional)
        .and_then(|count| count.checked_mul(mem::size_of::<T>()))
        .and_then(|bytes| u64::try_from(bytes).ok())
        .unwrap_or(u64::MAX);
    values
        .try_reserve(additional)
        .map_err(|_| Error::AllocationFailed { context, requested })
}

pub(crate) fn try_clone_string(value: &str, context: &'static str) -> Result<String> {
    let mut output = String::new();
    try_reserve_string(&mut output, value.len(), context)?;
    output.push_str(value);
    Ok(output)
}
