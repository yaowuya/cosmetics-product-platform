"""Create regenerable card images alongside the immutable original store."""
from pathlib import Path
from tempfile import NamedTemporaryFile

from PIL import Image, ImageOps

from app.models import Asset
from app.services.media import resolve_asset_file


_EDGE = 320


def _thumbnail_path(source: Path) -> Path:
    # The versioned recipe and immutable storage key also make restored caches safe to reuse.
    return source.parent / ".thumbnails" / f"{source.name}.v2.webp"


def existing_cover_thumbnail(source: Path) -> Path | None:
    """Return this source's generated variant, falling back when the cache is unavailable."""
    path = _thumbnail_path(source)
    try:
        if not path.parent.is_symlink() and not path.is_symlink() and path.is_file():
            return path
    except OSError:
        pass
    return None


def ensure_cover_thumbnail(asset: Asset) -> bool:
    """Build a missing square WebP atomically without changing the source; return whether it was built."""
    source = resolve_asset_file(asset)
    if existing_cover_thumbnail(source) is not None:
        return False

    destination = _thumbnail_path(source)
    destination.parent.mkdir(exist_ok=True)
    if destination.parent.is_symlink():
        raise OSError("Thumbnail directory must not be a symbolic link")

    temporary = None
    try:
        with Image.open(source) as image, NamedTemporaryFile(dir=destination.parent, delete=False) as output:
            temporary = Path(output.name)
            ImageOps.exif_transpose(image, in_place=True)
            # Fit the whole source, retaining edges and compositing transparency onto white.
            scale = _EDGE / max(image.size)
            size = tuple(max(1, round(side * scale)) for side in image.size)
            fitted = image.resize(size, Image.Resampling.LANCZOS).convert("RGBA")
            square = Image.new("RGB", (_EDGE, _EDGE), "white")
            square.paste(fitted, ((_EDGE - fitted.width) // 2, (_EDGE - fitted.height) // 2), fitted)
            square.save(output, format="WEBP", quality=80)
        # Publish only complete files. An overlapping rerun can only replace an equivalent variant.
        temporary.replace(destination)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return True
