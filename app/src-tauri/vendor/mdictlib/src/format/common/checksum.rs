use crate::error::{Error, Result};

const MOD_ADLER: u32 = 65_521;
const REDUCTION_BLOCK_BYTES: usize = 5_552;

pub fn adler32(bytes: &[u8]) -> u32 {
    let mut a = 1u32;
    let mut b = 0u32;

    for block in bytes.chunks(REDUCTION_BLOCK_BYTES) {
        for byte in block {
            a += u32::from(*byte);
            b += a;
        }
        a %= MOD_ADLER;
        b %= MOD_ADLER;
    }

    (b << 16) | a
}

pub fn verify_adler32(context: &'static str, bytes: &[u8], expected: u32) -> Result<()> {
    let actual = adler32(bytes);
    if actual == expected {
        Ok(())
    } else {
        Err(Error::ChecksumMismatch {
            context,
            expected,
            actual,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{MOD_ADLER, REDUCTION_BLOCK_BYTES, adler32};

    fn bytewise_adler32(bytes: &[u8]) -> u32 {
        let mut a = 1u32;
        let mut b = 0u32;
        for byte in bytes {
            a = (a + u32::from(*byte)) % MOD_ADLER;
            b = (b + a) % MOD_ADLER;
        }
        (b << 16) | a
    }

    #[test]
    fn block_reduction_matches_bytewise_adler32() {
        for len in [
            0,
            1,
            REDUCTION_BLOCK_BYTES - 1,
            REDUCTION_BLOCK_BYTES,
            REDUCTION_BLOCK_BYTES + 1,
            REDUCTION_BLOCK_BYTES * 2 + 17,
        ] {
            let bytes = (0..len)
                .map(|index| u8::try_from(index.wrapping_mul(37) % 256).unwrap())
                .collect::<Vec<_>>();
            assert_eq!(adler32(&bytes), bytewise_adler32(&bytes));
        }
    }
}
