use crate::error::{Error, Result};
use crate::format::common::checked::widen_u32;

#[derive(Clone, Copy, Debug)]
pub struct Cursor<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> Cursor<'a> {
    pub fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }

    pub fn offset(&self) -> usize {
        self.offset
    }

    pub fn remaining(&self) -> usize {
        self.bytes.len().saturating_sub(self.offset)
    }

    pub fn is_empty(&self) -> bool {
        self.remaining() == 0
    }

    pub fn read_u8(&mut self, context: &'static str) -> Result<u8> {
        Ok(self.read_array::<1>(context)?[0])
    }

    pub fn read_u16_be(&mut self, context: &'static str) -> Result<u16> {
        Ok(u16::from_be_bytes(self.read_array::<2>(context)?))
    }

    pub fn read_u32_be(&mut self, context: &'static str) -> Result<u32> {
        Ok(u32::from_be_bytes(self.read_array::<4>(context)?))
    }

    pub fn read_u32_le(&mut self, context: &'static str) -> Result<u32> {
        Ok(u32::from_le_bytes(self.read_array::<4>(context)?))
    }

    pub fn read_u64_be(&mut self, context: &'static str) -> Result<u64> {
        Ok(u64::from_be_bytes(self.read_array::<8>(context)?))
    }

    /// Reads a 32-bit big-endian wire field and widens it to the internal
    /// descriptor width.
    ///
    /// Version 1 declares its geometry in 32-bit fields. Promoting at the read
    /// site means no `u32` value ever participates in section arithmetic.
    pub fn read_u32_be_widened(&mut self, context: &'static str) -> Result<u64> {
        Ok(widen_u32(u32::from_be_bytes(
            self.read_array::<4>(context)?,
        )))
    }

    pub fn read_bytes(&mut self, len: usize, context: &'static str) -> Result<&'a [u8]> {
        let end = self
            .offset
            .checked_add(len)
            .ok_or(Error::InvalidFormat("cursor offset overflow"))?;
        let bytes = self
            .bytes
            .get(self.offset..end)
            .ok_or_else(|| Error::truncated(context, len, self.remaining()))?;
        self.offset = end;
        Ok(bytes)
    }

    fn read_array<const N: usize>(&mut self, context: &'static str) -> Result<[u8; N]> {
        let bytes = self.read_bytes(N, context)?;
        let mut out = [0; N];
        out.copy_from_slice(bytes);
        Ok(out)
    }
}
