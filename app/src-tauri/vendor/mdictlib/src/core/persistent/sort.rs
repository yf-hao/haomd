use std::cmp::Ordering;
use std::collections::BinaryHeap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};
use std::mem::size_of;
use std::path::Path;

use super::build::{BufferedScratchWriter, SectionScratchWriter, scratch_write_buffer_bytes};
use super::format::{check_cancelled, read_u64_file, scratch_file, write_u32, write_u64};
use super::{MAX_MERGE_FAN_IN, RUN_READ_BUFFER_BYTES, SectionFile, SectionKind};
use crate::error::{Error, Result};
use crate::index::KeyIndexOptions;
use crate::limits::{
    checked_usize, ensure_usize_limit, try_reserve_vec, try_reserve_vec_amortized,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ArenaRecord {
    pub(super) start: usize,
    pub(super) len: usize,
    pub(super) ordinal: u32,
}

#[derive(Debug, Default)]
pub(crate) struct SortBuffer {
    pub(super) normalized: Vec<u8>,
    pub(super) records: Vec<ArenaRecord>,
}

impl SortBuffer {
    pub(super) fn is_empty(&self) -> bool {
        self.records.is_empty()
    }

    pub(super) fn clear(&mut self) {
        self.normalized.clear();
        self.records.clear();
    }

    pub(super) fn allocated_bytes(&self) -> Result<usize> {
        self.records
            .capacity()
            .checked_mul(size_of::<ArenaRecord>())
            .and_then(|bytes| bytes.checked_add(self.normalized.capacity()))
            .ok_or(Error::InvalidFormat("key-index sort capacity overflow"))
    }

    pub(super) fn reserve_record(&mut self, normalized_upper: usize, maximum: usize) -> Result<()> {
        try_reserve_vec_amortized(
            &mut self.normalized,
            normalized_upper,
            "key-index normalized sort arena",
        )?;
        try_reserve_vec_amortized(&mut self.records, 1, "key-index sort rows")?;
        let allocated_bytes = self.allocated_bytes()?;
        if allocated_bytes > maximum {
            return Err(Error::LimitExceeded {
                limit: "key_index_build_memory_bytes",
                value: u64::try_from(allocated_bytes).unwrap_or(u64::MAX),
                max: u64::try_from(maximum).unwrap_or(u64::MAX),
            });
        }
        Ok(())
    }

    pub(super) fn key(&self, record: ArenaRecord) -> &[u8] {
        &self.normalized[record.start..record.start + record.len]
    }
}

pub(super) fn sort_records(buffer: &mut SortBuffer) {
    let normalized = &buffer.normalized;
    buffer.records.sort_unstable_by(|left, right| {
        normalized[left.start..left.start + left.len]
            .cmp(&normalized[right.start..right.start + right.len])
            .then_with(|| left.ordinal.cmp(&right.ordinal))
    });
}

pub(crate) fn write_sorted_order<W>(file: &mut W, buffer: &mut SortBuffer) -> Result<()>
where
    W: Write + ?Sized,
{
    sort_records(buffer);
    for record in &buffer.records {
        write_u32(file, record.ordinal)?;
    }
    Ok(())
}

pub(crate) fn write_sorted_run<W>(file: &mut W, buffer: &mut SortBuffer) -> Result<()>
where
    W: Write + ?Sized,
{
    sort_records(buffer);
    let mut body_len = 0u64;
    for record in &buffer.records {
        body_len = body_len
            .checked_add(12)
            .and_then(|len| len.checked_add(u64::try_from(record.len).ok()?))
            .ok_or(Error::InvalidFormat("key-index run length overflow"))?;
    }
    write_u64(file, body_len)?;
    write_u64(
        file,
        u64::try_from(buffer.records.len())
            .map_err(|_| Error::InvalidFormat("key-index run count exceeds u64"))?,
    )?;
    for record in &buffer.records {
        write_u64(
            file,
            u64::try_from(record.len)
                .map_err(|_| Error::InvalidFormat("normalized key length exceeds u64"))?,
        )?;
        file.write_all(buffer.key(*record))?;
        write_u32(file, record.ordinal)?;
    }
    Ok(())
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct RunRecord {
    pub(super) normalized: Vec<u8>,
    pub(super) ordinal: u32,
}

fn write_run_record<W>(file: &mut W, record: &RunRecord) -> Result<()>
where
    W: Write + ?Sized,
{
    write_u64(
        file,
        u64::try_from(record.normalized.len())
            .map_err(|_| Error::InvalidFormat("normalized key length exceeds u64"))?,
    )?;
    file.write_all(&record.normalized)?;
    write_u32(file, record.ordinal)
}

#[derive(Debug)]
pub(super) struct RunCursor {
    pub(super) cursor: u64,
    pub(super) end: u64,
    pub(super) remaining: u64,
    pub(super) body_len: u64,
    pub(super) buffer: Vec<u8>,
    pub(super) buffer_position: usize,
    pub(super) buffer_capacity: usize,
}

impl RunCursor {
    pub(super) fn reserve_buffer(&mut self, capacity: usize) -> Result<()> {
        try_reserve_vec(&mut self.buffer, capacity, "key-index scratch read buffer")?;
        self.buffer_capacity = capacity;
        Ok(())
    }

    pub(super) fn read_exact(&mut self, file: &mut File, mut output: &mut [u8]) -> Result<()> {
        while !output.is_empty() {
            if self.buffer_position == self.buffer.len() {
                if self.cursor >= self.end {
                    return Err(Error::InvalidFormat(
                        "key-index scratch record is truncated",
                    ));
                }
                let read_len = checked_usize(
                    (self.end - self.cursor)
                        .min(u64::try_from(self.buffer_capacity).unwrap_or(u64::MAX)),
                    "key-index scratch read length",
                )?;
                self.buffer.clear();
                self.buffer.resize(read_len, 0);
                file.seek(SeekFrom::Start(self.cursor))?;
                file.read_exact(&mut self.buffer)?;
                self.buffer_position = 0;
            }
            let available = self.buffer.len() - self.buffer_position;
            let copied = available.min(output.len());
            output[..copied]
                .copy_from_slice(&self.buffer[self.buffer_position..self.buffer_position + copied]);
            self.buffer_position += copied;
            self.cursor = self
                .cursor
                .checked_add(u64::try_from(copied).map_err(|_| {
                    Error::InvalidFormat("key-index scratch read length exceeds u64")
                })?)
                .ok_or(Error::InvalidFormat("key-index scratch cursor overflow"))?;
            output = &mut output[copied..];
        }
        Ok(())
    }
}

pub(super) fn read_run_header(file: &mut File, offset: u64) -> Result<(RunCursor, u64)> {
    file.seek(SeekFrom::Start(offset))?;
    let body_len = read_u64_file(file)?;
    let count = read_u64_file(file)?;
    let body_start = offset
        .checked_add(16)
        .ok_or(Error::InvalidFormat("key-index run offset overflow"))?;
    let end = body_start
        .checked_add(body_len)
        .ok_or(Error::InvalidFormat("key-index run end overflow"))?;
    if end > file.metadata()?.len() {
        return Err(Error::InvalidFormat("key-index scratch run is truncated"));
    }
    Ok((
        RunCursor {
            cursor: body_start,
            end,
            remaining: count,
            body_len,
            buffer: Vec::new(),
            buffer_position: 0,
            buffer_capacity: 0,
        },
        end,
    ))
}

pub(super) fn read_sort_record(
    file: &mut File,
    run: &mut RunCursor,
    maximum: usize,
    mut normalized: Vec<u8>,
) -> Result<Option<RunRecord>> {
    if run.remaining == 0 {
        if run.cursor != run.end {
            return Err(Error::InvalidFormat(
                "key-index scratch run has trailing bytes",
            ));
        }
        return Ok(None);
    }
    let record_start = run.cursor;
    let mut len_bytes = [0u8; 8];
    run.read_exact(file, &mut len_bytes)?;
    let len = u64::from_le_bytes(len_bytes);
    let len_usize = checked_usize(len, "key-index scratch key length")?;
    ensure_usize_limit("key_index_build_memory_bytes", len_usize, maximum)?;
    let record_end = record_start
        .checked_add(12)
        .and_then(|offset| offset.checked_add(len))
        .ok_or(Error::InvalidFormat("key-index scratch record overflow"))?;
    if record_end > run.end {
        return Err(Error::InvalidFormat(
            "key-index scratch record is truncated",
        ));
    }
    normalized.clear();
    try_reserve_vec(&mut normalized, len_usize, "key-index scratch key")?;
    normalized.resize(len_usize, 0);
    run.read_exact(file, &mut normalized)?;
    let mut ordinal_bytes = [0u8; 4];
    run.read_exact(file, &mut ordinal_bytes)?;
    let ordinal = u32::from_le_bytes(ordinal_bytes);
    if run.cursor != record_end {
        return Err(Error::InvalidFormat(
            "key-index scratch record length mismatch",
        ));
    }
    run.remaining -= 1;
    std::str::from_utf8(&normalized)
        .map_err(|_| Error::InvalidFormat("key-index scratch key is not UTF-8"))?;
    Ok(Some(RunRecord {
        normalized,
        ordinal,
    }))
}

#[derive(Debug, Eq)]
pub(super) struct HeapRecord {
    pub(super) record: RunRecord,
    pub(super) run: usize,
}

impl PartialEq for HeapRecord {
    fn eq(&self, other: &Self) -> bool {
        self.record.normalized == other.record.normalized
            && self.record.ordinal == other.record.ordinal
            && self.run == other.run
    }
}

impl Ord for HeapRecord {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .record
            .normalized
            .cmp(&self.record.normalized)
            .then_with(|| other.record.ordinal.cmp(&self.record.ordinal))
            .then_with(|| other.run.cmp(&self.run))
    }
}

impl PartialOrd for HeapRecord {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

pub(super) enum MergeOutput {
    Runs(BufferedScratchWriter),
    Order(SectionScratchWriter),
}

impl MergeOutput {
    pub(super) fn into_runs(self) -> Result<File> {
        match self {
            Self::Runs(writer) => writer.into_file(),
            Self::Order(_) => Err(Error::InvalidFormat(
                "final order writer used for intermediate runs",
            )),
        }
    }

    pub(super) fn into_order(self) -> Result<SectionFile> {
        match self {
            Self::Order(writer) => writer.into_section(SectionKind::Order),
            Self::Runs(_) => Err(Error::InvalidFormat(
                "intermediate run writer used for final order",
            )),
        }
    }
}

impl Write for MergeOutput {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        match self {
            Self::Runs(writer) => writer.write(bytes),
            Self::Order(writer) => writer.write(bytes),
        }
    }

    fn flush(&mut self) -> std::io::Result<()> {
        match self {
            Self::Runs(writer) => writer.flush(),
            Self::Order(writer) => writer.flush(),
        }
    }
}

pub(crate) fn merge_runs<C>(
    mut input: File,
    mut run_count: u64,
    expected_rows: u64,
    maximum_record_bytes: usize,
    options: &KeyIndexOptions,
    fallback_scratch: Option<&Path>,
    cancelled: &mut C,
) -> Result<SectionFile>
where
    C: FnMut() -> bool,
{
    if run_count == 0 {
        if expected_rows != 0 {
            return Err(Error::InvalidFormat("missing key-index sort runs"));
        }
        return SectionScratchWriter::new(
            scratch_file(options, fallback_scratch)?,
            scratch_write_buffer_bytes(options),
            options.chunk_bytes,
            options.checksum_policy,
        )?
        .into_section(SectionKind::Order);
    }
    let base_per_run = maximum_record_bytes
        .checked_add(size_of::<RunCursor>() + size_of::<HeapRecord>() + 64)
        .ok_or(Error::InvalidFormat("key-index merge memory size overflow"))?;
    let minimum_per_run = base_per_run
        .checked_add(1)
        .ok_or(Error::InvalidFormat("key-index merge memory size overflow"))?;
    let fan_in = (options.build_memory_bytes / minimum_per_run).min(MAX_MERGE_FAN_IN);
    if run_count > 1 && fan_in < 2 {
        return Err(Error::LimitExceeded {
            limit: "key_index_build_memory_bytes",
            value: u64::try_from(minimum_per_run.saturating_mul(2)).unwrap_or(u64::MAX),
            max: u64::try_from(options.build_memory_bytes).unwrap_or(u64::MAX),
        });
    }
    let active_buffers = usize::try_from(run_count)
        .unwrap_or(usize::MAX)
        .min(fan_in.max(1));
    let buffer_budget = options
        .build_memory_bytes
        .saturating_sub(base_per_run.saturating_mul(active_buffers));
    let maximum_run_read_buffer = options.chunk_bytes.min(RUN_READ_BUFFER_BYTES);
    let run_read_buffer_bytes = (buffer_budget / active_buffers).clamp(1, maximum_run_read_buffer);

    while run_count > 1 {
        let final_pass = run_count
            <= u64::try_from(fan_in)
                .map_err(|_| Error::InvalidFormat("key-index merge fan-in exceeds u64"))?;
        let mut output = if final_pass {
            MergeOutput::Order(SectionScratchWriter::new(
                scratch_file(options, fallback_scratch)?,
                scratch_write_buffer_bytes(options),
                options.chunk_bytes,
                options.checksum_policy,
            )?)
        } else {
            MergeOutput::Runs(BufferedScratchWriter::new(
                scratch_file(options, fallback_scratch)?,
                scratch_write_buffer_bytes(options),
            )?)
        };
        let mut input_offset = 0u64;
        let mut remaining_runs = run_count;
        let mut next_run_count = 0u64;
        while remaining_runs > 0 {
            check_cancelled(cancelled, "merging persistent key-index runs")?;
            let fan_in = u64::try_from(fan_in)
                .map_err(|_| Error::InvalidFormat("key-index merge fan-in exceeds u64"))?;
            let group_len = usize::try_from(remaining_runs.min(fan_in))
                .map_err(|_| Error::InvalidFormat("key-index merge fan-in exceeds usize"))?;
            let mut cursors = Vec::new();
            try_reserve_vec(&mut cursors, group_len, "key-index merge cursors")?;
            let mut body_len = 0u64;
            let mut row_count = 0u64;
            for _ in 0..group_len {
                let (mut cursor, next) = read_run_header(&mut input, input_offset)?;
                cursor.reserve_buffer(run_read_buffer_bytes)?;
                body_len = body_len
                    .checked_add(cursor.body_len)
                    .ok_or(Error::InvalidFormat("merged run length overflow"))?;
                row_count = row_count
                    .checked_add(cursor.remaining)
                    .ok_or(Error::InvalidFormat("merged run count overflow"))?;
                cursors.push(cursor);
                input_offset = next;
            }
            if !final_pass {
                write_u64(&mut output, body_len)?;
                write_u64(&mut output, row_count)?;
            }
            let mut heap = BinaryHeap::new();
            heap.try_reserve(group_len)
                .map_err(|_| Error::AllocationFailed {
                    context: "key-index merge heap",
                    requested: u64::try_from(group_len.saturating_mul(size_of::<HeapRecord>()))
                        .unwrap_or(u64::MAX),
                })?;
            for (run, cursor) in cursors.iter_mut().enumerate() {
                if let Some(record) =
                    read_sort_record(&mut input, cursor, options.build_memory_bytes, Vec::new())?
                {
                    heap.push(HeapRecord { record, run });
                }
            }
            let mut written = 0u64;
            while let Some(item) = heap.pop() {
                check_cancelled(cancelled, "merging persistent key-index runs")?;
                if final_pass {
                    write_u32(&mut output, item.record.ordinal)?;
                } else {
                    write_run_record(&mut output, &item.record)?;
                }
                written = written
                    .checked_add(1)
                    .ok_or(Error::InvalidFormat("merged run count overflow"))?;
                let run = item.run;
                let reusable = item.record.normalized;
                if let Some(record) = read_sort_record(
                    &mut input,
                    cursors
                        .get_mut(run)
                        .ok_or(Error::InvalidFormat("merge run index out of range"))?,
                    options.build_memory_bytes,
                    reusable,
                )? {
                    heap.push(HeapRecord { record, run });
                }
            }
            if written != row_count {
                return Err(Error::InvalidFormat("merged run row-count mismatch"));
            }
            let group_len = u64::try_from(group_len)
                .map_err(|_| Error::InvalidFormat("key-index merge group exceeds u64"))?;
            remaining_runs = remaining_runs
                .checked_sub(group_len)
                .ok_or(Error::InvalidFormat("key-index merge run underflow"))?;
            next_run_count = next_run_count
                .checked_add(1)
                .ok_or(Error::InvalidFormat("key-index merge run count overflow"))?;
        }
        if final_pass {
            let order = output.into_order()?;
            if next_run_count != 1
                || order.len
                    != expected_rows
                        .checked_mul(4)
                        .ok_or(Error::InvalidFormat("key-index order length overflow"))?
            {
                return Err(Error::InvalidFormat("key-index order length mismatch"));
            }
            return Ok(order);
        }
        input = output.into_runs()?;
        run_count = next_run_count;
    }

    let (mut run, next) = read_run_header(&mut input, 0)?;
    if next != input.metadata()?.len() || run.remaining != expected_rows {
        return Err(Error::InvalidFormat("final key-index run shape mismatch"));
    }
    let mut order = SectionScratchWriter::new(
        scratch_file(options, fallback_scratch)?,
        scratch_write_buffer_bytes(options),
        options.chunk_bytes,
        options.checksum_policy,
    )?;
    run.reserve_buffer(run_read_buffer_bytes)?;
    let mut reusable = Vec::new();
    while let Some(record) =
        read_sort_record(&mut input, &mut run, options.build_memory_bytes, reusable)?
    {
        check_cancelled(cancelled, "writing persistent key-index order")?;
        write_u32(&mut order, record.ordinal)?;
        reusable = record.normalized;
    }
    let order = order.into_section(SectionKind::Order)?;
    if order.len
        != expected_rows
            .checked_mul(4)
            .ok_or(Error::InvalidFormat("key-index order length overflow"))?
    {
        return Err(Error::InvalidFormat("key-index order length mismatch"));
    }
    Ok(order)
}
