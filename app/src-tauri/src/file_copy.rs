use std::{
    fs, io,
    path::{Path, PathBuf},
};

fn copy_contents(source: &Path, target: &Path) -> io::Result<()> {
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let source = entry.path();
        let target = target.join(entry.file_name());
        let kind = entry.file_type()?;
        if kind.is_symlink() {
            let link = fs::read_link(&source)?;
            #[cfg(unix)]
            std::os::unix::fs::symlink(link, target)?;
            #[cfg(windows)]
            if source.is_dir() {
                std::os::windows::fs::symlink_dir(link, target)?;
            } else {
                std::os::windows::fs::symlink_file(link, target)?;
            }
        } else if kind.is_dir() {
            fs::create_dir(&target)?;
            copy_contents(&source, &target)?;
        } else if kind.is_file() {
            let mut output = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&target)?;
            io::copy(&mut fs::File::open(&source)?, &mut output)?;
            fs::set_permissions(target, entry.metadata()?.permissions())?;
        } else {
            return Err(io::Error::other(format!(
                "不支持复制特殊文件: {}",
                source.display()
            )));
        }
    }
    Ok(())
}

pub(crate) fn copy_entry(source: &Path, directory: &Path) -> io::Result<PathBuf> {
    let source = fs::canonicalize(source)?;
    let directory = fs::canonicalize(directory)?;
    let metadata = fs::metadata(&source)?;
    if !directory.is_dir() || (!metadata.is_file() && !metadata.is_dir()) {
        return Err(io::Error::other("源文件或目标目录无效"));
    }
    if metadata.is_dir() && directory.starts_with(&source) {
        return Err(io::Error::other("不能将文件夹复制到自身或其子文件夹中"));
    }
    let name = source
        .file_name()
        .ok_or_else(|| io::Error::other("不能复制磁盘根目录"))?;
    let stem = if metadata.is_dir() {
        name
    } else {
        source.file_stem().unwrap_or(name)
    };
    let extension = if metadata.is_file() {
        source.extension()
    } else {
        None
    };
    for index in 0u32.. {
        let candidate = if index == 0 {
            name.to_os_string()
        } else {
            let mut name = stem.to_os_string();
            name.push(format!(" (copy {index})"));
            if let Some(extension) = extension {
                name.push(".");
                name.push(extension);
            }
            name
        };
        let target = directory.join(&candidate);
        let result: io::Result<()> = if metadata.is_dir() {
            match fs::create_dir(&target) {
                Ok(()) => {
                    let result = copy_contents(&source, &target);
                    if result.is_err() {
                        let _ = fs::remove_dir_all(&target);
                    }
                    return result.map(|()| target);
                }
                Err(error) => Err(error),
            }
        } else {
            match fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&target)
            {
                Ok(mut output) => {
                    let result = (|| {
                        io::copy(&mut fs::File::open(&source)?, &mut output)?;
                        fs::set_permissions(&target, metadata.permissions())
                    })();
                    drop(output);
                    if result.is_err() {
                        let _ = fs::remove_file(&target);
                    }
                    return result.map(|()| target);
                }
                Err(error) => Err(error),
            }
        };
        if let Err(error) = result {
            if error.kind() != io::ErrorKind::AlreadyExists {
                return Err(error);
            }
        }
    }
    Err(io::Error::other("无法生成可用的副本名称"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn copies_files_and_complete_directories_without_overwriting() {
        let root = std::env::temp_dir().join(format!(
            "haomd-copy-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(root.join("source/sub")).unwrap();
        fs::create_dir(root.join("target")).unwrap();
        fs::write(root.join("source/sub/image.bin"), [0, 255, 10]).unwrap();
        fs::write(root.join("source/.hidden"), "hidden").unwrap();
        let copied = copy_entry(&root.join("source"), &root.join("target")).unwrap();
        assert_eq!(
            fs::read(copied.join("sub/image.bin")).unwrap(),
            [0, 255, 10]
        );
        assert!(copied.join(".hidden").exists());
        let second = copy_entry(&root.join("source"), &root.join("target")).unwrap();
        assert_ne!(copied, second);
        assert!(copy_entry(&root.join("source"), &root.join("source/sub")).is_err());
        assert!(copy_entry(&root.join("source"), &root.join("source")).is_err());
        let file = root.join("source/sub/image.bin");
        let duplicate = copy_entry(&file, file.parent().unwrap()).unwrap();
        assert_eq!(duplicate.file_name().unwrap(), "image (copy 1).bin");
        assert_eq!(fs::read(&file).unwrap(), fs::read(duplicate).unwrap());
        assert!(copy_entry(&root.join("missing"), &root).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
