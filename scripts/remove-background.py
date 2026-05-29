#!/usr/bin/env python3
import argparse
import sys
import time
from pathlib import Path

SUPPORTED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}


def load_dependencies():
    try:
        from PIL import Image
        import mediapipe as mp
        import numpy as np
    except ModuleNotFoundError as exc:
        missing = exc.name or "mediapipe"
        print(
            "Dependencia Python ausente: "
            f"{missing}. Instale com: python -m pip install mediapipe numpy pillow",
            file=sys.stderr,
        )
        raise SystemExit(2)

    return Image, np, mp


def process_file(image_module, numpy_module, segmentor, input_path: Path, output_path: Path):
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
                
                # Get the segmentation mask
                results = segmentor.process(img_np)
                mask = results.segmentation_mask
                
                # Apply simple binary thresholding to get the alpha channel (threshold = 0.5)
                threshold = 0.5
                alpha = numpy_module.where(mask > threshold, 255, 0).astype(numpy_module.uint8)
                
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

    image_module, numpy_module, mp_module = load_dependencies()

    # Use model_selection=0 (general model, faster and lightweight)
    mp_selfie = mp_module.solutions.selfie_segmentation
    
    with mp_selfie.SelfieSegmentation(model_selection=0) as segmentor:
        if args.input and args.output:
            process_file(image_module, numpy_module, segmentor, args.input, args.output)
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
                process_file(image_module, numpy_module, segmentor, input_path, output_path)
                if index == 1 or index == total or index % 30 == 0:
                    print(f"Processados {index}/{total} frames", file=sys.stderr)
            return

    parser.error("Use --input/--output ou --input-dir/--output-dir.")


if __name__ == "__main__":
    main()
