"""Create regenerable display images alongside the immutable original store."""
from pathlib import Path
from tempfile import NamedTemporaryFile

from PIL import Image, ImageOps

from app.models import Asset
from app.services.media import resolve_asset_file


_EDGE = 320
_DISPLAY_EDGE = 960


def _thumbnail_path(source: Path, *, display: bool = False) -> Path:
    # The versioned recipe and immutable storage key also make restored caches safe to reuse.
    recipe = "display.v1" if display else "v2"
    return source.parent / ".thumbnails" / f"{source.name}.{recipe}.webp"


def _existing_thumbnail(path: Path) -> Path | None:
    try:
        if not path.parent.is_symlink() and not path.is_symlink() and path.is_file():
            return path
    except OSError:
        pass
    return None


def existing_cover_thumbnail(source: Path) -> Path | None:
    """Return the square variant if it is available."""
    return _existing_thumbnail(_thumbnail_path(source))


def existing_display_thumbnail(source: Path) -> Path | None:
    """Return the aspect-preserving variant if it is available."""
    return _existing_thumbnail(_thumbnail_path(source, display=True))


def _ensure_thumbnail(asset: Asset, *, display: bool) -> bool:
    source = resolve_asset_file(asset)
    destination = _thumbnail_path(source, display=display)
    if _existing_thumbnail(destination) is not None:
        return False

    destination.parent.mkdir(exist_ok=True)
    if destination.parent.is_symlink():
        raise OSError("Thumbnail directory must not be a symbolic link")

    temporary = None
    try:
        with Image.open(source) as image, NamedTemporaryFile(dir=destination.parent, delete=False) as output:
            temporary = Path(output.name)
            ImageOps.exif_transpose(image, in_place=True)
            if display:
                image.thumbnail((_DISPLAY_EDGE, _DISPLAY_EDGE), Image.Resampling.LANCZOS)
                thumbnail = image.convert("RGBA")
            else:
                # Fit the whole source, retaining edges and compositing transparency onto white.
                scale = _EDGE / max(image.size)
                size = tuple(max(1, round(side * scale)) for side in image.size)
                fitted = image.resize(size, Image.Resampling.LANCZOS).convert("RGBA")
                thumbnail = Image.new("RGB", (_EDGE, _EDGE), "white")
                thumbnail.paste(fitted, ((_EDGE - fitted.width) // 2, (_EDGE - fitted.height) // 2), fitted)
            thumbnail.save(output, format="WEBP", quality=80)
        # Publish only complete files. An overlapping rerun can only replace an equivalent variant.
        temporary.replace(destination)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return True


def ensure_cover_thumbnail(asset: Asset) -> bool:
    """Build a missing square WebP atomically without changing the source."""
    return _ensure_thumbnail(asset, display=False)


def ensure_display_thumbnail(asset: Asset) -> bool:
    """Build a missing WebP without changing the source's aspect ratio or file."""
    return _ensure_thumbnail(asset, display=True)
