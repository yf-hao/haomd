//! Accepting the `file://` URLs a mobile file picker hands out.
//!
//! A desktop file dialog answers with a path. iOS answers its document picker
//! with `NSURL`s, and Android's Storage Access Framework does the same, so an
//! application that passes the picker's answer straight through arrives here
//! with `file:///private/var/.../OALD.mdx` — a string that names no file and
//! fails to open with a bare "No such file or directory". Decoding it here
//! means every caller gets the same tolerance from one implementation, and a
//! percent-encoded name (a space is `%20`) survives the trip.
//!
//! Only local files are accepted: an empty authority or `localhost`. A URL
//! naming another host is refused rather than silently read as a local path,
//! because the two are not the same file and guessing is how a reader ends up
//! parsing the wrong bytes.

use std::path::{Path, PathBuf};

use crate::error::{Error, Result};

const SCHEME: &str = "file://";

/// The path a caller meant, whether they wrote one or a `file://` URL.
///
/// Anything that is not a `file://` URL is returned untouched, so a real path
/// — including one that merely contains the text somewhere in the middle — is
/// never reinterpreted.
///
/// # Errors
///
/// Returns [`Error::InvalidData`] when the URL names a remote host, or when
/// its percent-encoding is malformed or decodes to something that is not
/// valid UTF-8.
pub fn resolve(path: &Path) -> Result<PathBuf> {
    let Some(text) = path.to_str() else {
        return Ok(path.to_path_buf());
    };
    if !text.starts_with(SCHEME) {
        return Ok(path.to_path_buf());
    }
    let rest = &text[SCHEME.len()..];
    // Everything up to the first `/` is the authority, and a file URL's
    // authority is either absent or this machine.
    let (authority, encoded) = match rest.find('/') {
        Some(index) => rest.split_at(index),
        None => (rest, "/"),
    };
    if !(authority.is_empty() || authority.eq_ignore_ascii_case("localhost")) {
        return Err(Error::InvalidData(format!(
            "file URL names the remote host {authority}, which is not a local dictionary"
        )));
    }
    let decoded = percent_decode(encoded)?;
    Ok(PathBuf::from(windows_drive_path(&decoded)))
}

/// `/C:/Users/…` is how a Windows path travels in a URL; the leading slash is
/// the URL's, not the path's.
fn windows_drive_path(decoded: &str) -> String {
    let bytes = decoded.as_bytes();
    let drive_letter = bytes.get(1).is_some_and(u8::is_ascii_alphabetic);
    let drive_colon = matches!(bytes.get(2), Some(b':'));
    if bytes.first() == Some(&b'/') && drive_letter && drive_colon {
        return decoded[1..].to_string();
    }
    decoded.to_string()
}

/// Undo the URL's own escaping, without taking a dependency to do it.
fn percent_decode(encoded: &str) -> Result<String> {
    let bytes = encoded.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        let byte = bytes[index];
        if byte != b'%' {
            decoded.push(byte);
            index += 1;
            continue;
        }
        let high = bytes.get(index + 1).copied().and_then(hex_value);
        let low = bytes.get(index + 2).copied().and_then(hex_value);
        let (Some(high), Some(low)) = (high, low) else {
            return Err(Error::InvalidData(
                "file URL contains a malformed percent-escape".to_string(),
            ));
        };
        decoded.push((high << 4) | low);
        index += 3;
    }
    String::from_utf8(decoded)
        .map_err(|_| Error::InvalidData("file URL does not decode to valid UTF-8".to_string()))
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_path_is_left_exactly_as_it_was_written() {
        for path in [
            "/Users/reader/Dictionaries/oald.mdx",
            "relative/oald.mdx",
            // The text appears, but not as a scheme: this is a real directory
            // that happens to be named after one.
            "/tmp/file://not-a-url/oald.mdx",
        ] {
            assert_eq!(resolve(Path::new(path)).unwrap(), PathBuf::from(path));
        }
    }

    #[test]
    fn a_pickers_file_url_names_the_file_it_points_at() {
        assert_eq!(
            resolve(Path::new("file:///private/var/mobile/OALD/oald.mdx")).unwrap(),
            PathBuf::from("/private/var/mobile/OALD/oald.mdx"),
        );
        assert_eq!(
            resolve(Path::new("file://localhost/srv/dicts/oald.mdx")).unwrap(),
            PathBuf::from("/srv/dicts/oald.mdx"),
        );
    }

    #[test]
    fn escaped_names_survive_the_trip() {
        assert_eq!(
            resolve(Path::new("file:///tmp/WordNet%203.1/WordNet%203.1.mdx")).unwrap(),
            PathBuf::from("/tmp/WordNet 3.1/WordNet 3.1.mdx"),
        );
        // Non-ASCII names are the common case for the dictionaries this reads.
        assert_eq!(
            resolve(Path::new(
                "file:///tmp/%E7%89%9B%E6%B4%A5/%E7%89%9B%E6%B4%A5.mdx"
            ))
            .unwrap(),
            PathBuf::from("/tmp/牛津/牛津.mdx"),
        );
    }

    #[test]
    fn a_windows_drive_keeps_its_letter_and_loses_the_urls_slash() {
        assert_eq!(
            resolve(Path::new("file:///C:/Users/reader/oald.mdx")).unwrap(),
            PathBuf::from("C:/Users/reader/oald.mdx"),
        );
    }

    #[test]
    fn a_remote_host_is_refused_rather_than_read_as_a_local_path() {
        let error = resolve(Path::new("file://dictionaries.example.com/oald.mdx")).unwrap_err();
        assert!(matches!(error, Error::InvalidData(_)), "{error:?}");
    }

    #[test]
    fn a_malformed_escape_is_refused_rather_than_guessed_at() {
        for broken in ["file:///tmp/oald%2.mdx", "file:///tmp/oald%zz.mdx"] {
            let error = resolve(Path::new(broken)).unwrap_err();
            assert!(matches!(error, Error::InvalidData(_)), "{error:?}");
        }
    }

    #[test]
    fn a_url_with_no_path_at_all_reads_as_the_root() {
        assert_eq!(resolve(Path::new("file://")).unwrap(), PathBuf::from("/"));
    }
}
