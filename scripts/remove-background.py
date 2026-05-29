#!/usr/bin/env python3
import argparse
import sys
import time
import urllib.request
from pathlib import Path

SUPPORTED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
MODEL_URL = "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite"
MODEL_PATH = Path(__file__).parent / "selfie_segmenter.tflite"


def load_dependencies():
    try:
        from PIL import Image
        import mediapipe as mp
        from mediapipe.tasks import python
        from mediapipe.tasks.python import vision
        import numpy as np
    except ModuleNotFoundError as exc:
        missing = exc.name or "mediapipe"
        print(
            "Dependencia Python ausente: "
            f"{missing}. Instale com: python -m pip install mediapipe numpy pillow",
            file=sys.stderr,
        )
        raise SystemExit(2)

    return Image, np, mp, python, vision


def download_model_if_needed():
    if not MODEL_PATH.exists():
        print(f"Baixando modelo do MediaPipe de {MODEL_URL} para {MODEL_PATH}...", file=sys.stderr)
        MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
        try:
            # Download file
            urllib.request.urlretrieve(MODEL_URL, str(MODEL_PATH))
            print("Download concluido.", file=sys.stderr)
        except Exception as exc:
            print(f"Erro ao baixar o modelo do MediaPipe: {exc}", file=sys.stderr)
            raise SystemExit(3)


def process_file(image_module, numpy_module, mp_module, segmenter, input_path: Path, output_path: Path):
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Retry mechanism to handle Windows/OneDrive file locking or VFS sync latency
    for attempt in range(5):
        try:
            with image_module.open(input_path) as img:
                # Convert image to RGBA (for transparency merging later)
                img_rgba = img.convert("RGBA")
                # MediaPipe Selfie Segmentation expects RGB input
                img_rgb = img.convert("RGB")
                img_np = numpy_module.array(img_rgb)
                
                # Create MediaPipe Image
                mp_image = mp_module.Image(image_format=mp_module.ImageFormat.SRGB, data=img_np)
                
                # Get the segmentation mask
                results = segmenter.segment(mp_image)
                if not results.category_mask:
                    raise ValueError("Nao foi possivel obter a mascara de categoria do segmentador.")
                
                cat_mask = results.category_mask.numpy_view()
                mask_2d = cat_mask.squeeze(axis=-1)
                
                # In selfie_segmenter, 0 is the foreground (person) and 255 is the background.
                # So we make the person opaque (255) and the background transparent (0).
                alpha = numpy_module.where(mask_2d == 0, 255, 0).astype(numpy_module.uint8)
                
                # Split channels of the original RGBA image
                r, g, b, _ = img_rgba.split()
                
                # Create alpha channel image from numpy array and merge
                alpha_img = image_module.fromarray(alpha, mode="L")
                result_img = image_module.merge("RGBA", (r, g, b, alpha_img))
                
                result_img.save(output_path)
            return
        except Exception as exc:
            if attempt == 4:
                raise exc
            print(f"Aviso: Tentativa {attempt + 1} falhou para {input_path.name}: {exc}. Retentando...", file=sys.stderr)
            time.sleep(0.3)


def iter_input_files(input_dir: Path):
    return sorted(
        file_path
        for file_path in input_dir.iterdir()
        if file_path.is_file() and file_path.suffix.lower() in SUPPORTED_EXTENSIONS
    )


def main():
    parser = argparse.ArgumentParser(description="Remove background from image frames using MediaPipe Selfie Segmentation.")
    parser.add_argument("--input", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--input-dir", type=Path)
    parser.add_argument("--output-dir", type=Path)
    args = parser.parse_args()

    image_module, numpy_module, mp_module, python_module, vision_module = load_dependencies()
    download_model_if_needed()

    base_options = python_module.BaseOptions(model_asset_path=str(MODEL_PATH))
    options = vision_module.ImageSegmenterOptions(
        base_options=base_options,
        output_category_mask=True
    )
    
    with vision_module.ImageSegmenter.create_from_options(options) as segmenter:
        if args.input and args.output:
            process_file(image_module, numpy_module, mp_module, segmenter, args.input, args.output)
            return

        if args.input_dir and args.output_dir:
            files = iter_input_files(args.input_dir)
            if not files:
                print(f"Nenhum frame encontrado em {args.input_dir}", file=sys.stderr)
                raise SystemExit(1)

            args.output_dir.mkdir(parents=True, exist_ok=True)
            total = len(files)
            for index, input_path in enumerate(files, start=1):
                output_path = args.output_dir / f"{input_path.stem}.png"
                process_file(image_module, numpy_module, mp_module, segmenter, input_path, output_path)
                if index == 1 or index == total or index % 30 == 0:
                    print(f"Processados {index}/{total} frames", file=sys.stderr)
            return

    parser.error("Use --input/--output ou --input-dir/--output-dir.")


if __name__ == "__main__":
    main()
