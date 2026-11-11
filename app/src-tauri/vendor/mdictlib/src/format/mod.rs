//! Wire-format parsing and one-time grammar dispatch.

pub(crate) mod common;
mod v1;
mod v2;

use std::sync::Arc;

use crate::error::{Error, Result};
use crate::limits::MemoryBudget;
use crate::types::{ContainerKind, OpenOptions};

use self::common::descriptors::ValidatedLayout;
use self::common::header::{HeaderSection, parse_header};
use self::common::source::FileSource;

pub(crate) use self::common::encoding::TextEncoding;

/// The major wire version a file declares.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WireVersion {
    V1,
    V2,
}

/// Shared input to each wire grammar's `parse_layout`.
pub(crate) struct LayoutRequest<'a> {
    pub(crate) source: &'a FileSource,
    pub(crate) header_section: HeaderSection,
    pub(crate) kind: ContainerKind,
    pub(crate) options: &'a OpenOptions,
    pub(crate) memory: &'a Arc<MemoryBudget>,
}

/// Parses one dictionary file into a version-neutral validated layout.
///
/// # Errors
///
/// Returns an error if the common header is malformed or exceeds a limit, the
/// declared version is unsupported or ambiguous, or the selected grammar
/// rejects the file's geometry.
pub(crate) fn open_layout(
    source: &FileSource,
    kind: ContainerKind,
    options: &OpenOptions,
    memory: &Arc<MemoryBudget>,
) -> Result<ValidatedLayout> {
    let header_section = parse_header(
        source,
        kind,
        &options.limits,
        options.checksum_policy,
        memory,
    )?;
    let generated_major = declared_major_version(
        header_section.header.generated_by_engine_version(),
        "malformed GeneratedByEngineVersion",
    )?;
    // Resolve the generated grammar first to preserve error precedence over
    // malformed compatibility metadata.
    let version = resolve_wire_version(generated_major)?;
    let required_major = declared_major_version(
        header_section.header.required_engine_version(),
        "malformed RequiredEngineVersion",
    )?;
    validate_version_relationship(generated_major, required_major)?;
    let request = LayoutRequest {
        source,
        header_section,
        kind,
        options,
        memory,
    };

    let layout = match version {
        WireVersion::V1 => v1::parse_layout(request),
        WireVersion::V2 => v2::parse_layout(request),
    }?;

    layout.verify()?;
    Ok(layout)
}

/// Validates every numeric component and returns the declared major version.
fn declared_major_version(version: &str, malformed: &'static str) -> Result<u32> {
    let mut components = version.split('.');
    let major = components
        .next()
        .filter(|component| {
            !component.is_empty() && component.bytes().all(|byte| byte.is_ascii_digit())
        })
        .and_then(|component| component.parse::<u32>().ok())
        .ok_or(Error::InvalidFormat(malformed))?;
    if components.any(|component| {
        component.is_empty() || !component.bytes().all(|byte| byte.is_ascii_digit())
    }) {
        return Err(Error::InvalidFormat(malformed));
    }
    Ok(major)
}

/// Validates compatibility metadata without changing the dispatch authority.
fn validate_version_relationship(generated_major: u32, required_major: u32) -> Result<()> {
    if required_major == 0 {
        return Err(Error::InvalidFormat(
            "RequiredEngineVersion must have a non-zero major version",
        ));
    }
    if required_major > 2 {
        return Err(Error::Unsupported(
            "required MDict engine major version other than 1 or 2",
        ));
    }
    if generated_major == 1 && required_major != 1 {
        return Err(Error::InvalidFormat(
            "GeneratedByEngineVersion 1 conflicts with RequiredEngineVersion",
        ));
    }
    Ok(())
}

/// Maps a declared major version onto an implemented grammar.
fn resolve_wire_version(declared_major: u32) -> Result<WireVersion> {
    match declared_major {
        1 => Ok(WireVersion::V1),
        2 => Ok(WireVersion::V2),
        _ => Err(Error::Unsupported(
            "MDict format major version other than 1 or 2",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_each_implemented_major_version() {
        assert_eq!(
            resolve_wire_version(declared_major_version("1.2", "malformed").unwrap()).unwrap(),
            WireVersion::V1
        );
        assert_eq!(
            resolve_wire_version(declared_major_version("2.0", "malformed").unwrap()).unwrap(),
            WireVersion::V2
        );
    }

    #[test]
    fn accepts_a_bare_major_component() {
        assert_eq!(declared_major_version("1", "malformed").unwrap(), 1);
        assert_eq!(declared_major_version("2", "malformed").unwrap(), 2);
    }

    #[test]
    fn rejects_unsupported_and_unparsable_versions() {
        for declared in ["", "x.y", "two", " 2.0", "-1.0", "1x.2", "2.", ".2"] {
            let error = declared_major_version(declared, "malformed").unwrap_err();
            assert!(matches!(error, Error::InvalidFormat("malformed")));
        }
        for declared in ["0.9", "3.0"] {
            let major = declared_major_version(declared, "malformed").unwrap();
            assert!(matches!(
                resolve_wire_version(major),
                Err(Error::Unsupported(_))
            ));
        }
    }

    #[test]
    fn validates_minor_and_trailing_components_without_using_them_for_dispatch() {
        assert_eq!(declared_major_version("1.2.3.4", "malformed").unwrap(), 1);
        assert!(declared_major_version("2.0-beta", "malformed").is_err());
    }

    #[test]
    fn validates_required_version_without_changing_generated_dispatch_authority() {
        assert!(validate_version_relationship(2, 1).is_ok());
        assert!(matches!(
            validate_version_relationship(1, 2),
            Err(Error::InvalidFormat(_))
        ));
        assert!(matches!(
            validate_version_relationship(2, 3),
            Err(Error::Unsupported(_))
        ));
    }
}
