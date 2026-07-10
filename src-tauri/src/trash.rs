//! Narrow OS-trash adapter. Domain modules depend on this trait rather than
//! Finder/Explorer integration so their tests remain deterministic headlessly.

use std::path::Path;

pub trait Trash {
    fn move_to_trash(&self, path: &Path) -> std::io::Result<()>;
}

pub struct SystemTrash;

impl Trash for SystemTrash {
    fn move_to_trash(&self, path: &Path) -> std::io::Result<()> {
        ::trash::delete(path).map_err(|error| std::io::Error::other(error.to_string()))
    }
}
