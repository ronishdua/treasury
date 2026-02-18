import io

from PIL import Image, ImageEnhance, ImageOps

MAX_DIMENSION = 1600
JPEG_QUALITY = 85
CONTRAST_FACTOR = 1.2


def preprocess_image(raw_bytes: bytes) -> bytes:
    """
    Preprocess a label image for vision model consumption.

    Steps:
    1. Safety validation (decompression bomb guard via Pillow defaults)
    2. EXIF auto-rotate (phone photos)
    3. Light contrast boost (helps poorly lit labels)
    4. Resize longest edge to 1600px
    5. Convert to RGB (required for JPEG)
    6. Compress to JPEG quality 85

    Returns compressed JPEG bytes.
    """
    try:
        img = Image.open(io.BytesIO(raw_bytes))
    except Exception as e:
        raise ValueError(f"Cannot open image: {e}")

    # EXIF auto-rotate: handles phone photos taken in portrait/landscape
    try:
        img = ImageOps.exif_transpose(img)
    except Exception:
        pass  # Some images lack EXIF data; that's fine

    # Convert to RGB (required for JPEG; handles RGBA, P, LA modes)
    if img.mode not in ("RGB",):
        img = img.convert("RGB")

    # Resize if larger than max dimension (preserve aspect ratio)
    if max(img.size) > MAX_DIMENSION:
        img.thumbnail((MAX_DIMENSION, MAX_DIMENSION), Image.LANCZOS)

    # Light contrast boost for poorly lit label photos
    img = ImageEnhance.Contrast(img).enhance(CONTRAST_FACTOR)

    # Compress to JPEG
    buffer = io.BytesIO()
    img.save(buffer, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    return buffer.getvalue()
