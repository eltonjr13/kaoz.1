#!/usr/bin/env python3
import argparse
import sys
from pathlib import Path


SUPPORTED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}


def load_dependencies():
    try:
        from PIL import Image
        from rembg import remove
    except ModuleNotFoundError as exc:
        missing = exc.name or "rembg"
        print(
            "Dependencia Python ausente: "
            f"{missing}. Instale com: python -m pip install rembg pillow onnxruntime",
            file=sys.stderr,
        )
        raise SystemExit(2)

    return Image, remove


def process_file(image_module, remove, input_path: Path, output_path: Path):
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with image_module.open(input_path) as image:
        result = remove(image.convert("RGBA"))
        result.save(output_path)


def iter_input_files(input_dir: Path):
    return sorted(
        file_path
        for file_path in input_dir.iterdir()
        if file_path.is_file() and file_path.suffix.lower() in SUPPORTED_EXTENSIONS
    )


def main():
    parser = argparse.ArgumentParser(description="Remove background from image frames using rembg.")
    parser.add_argument("--input", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--input-dir", type=Path)
    parser.add_argument("--output-dir", type=Path)
    args = parser.parse_args()

    image_module, remove = load_dependencies()

    if args.input and args.output:
        process_file(image_module, remove, args.input, args.output)
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
            process_file(image_module, remove, input_path, output_path)
            if index == 1 or index == total or index % 30 == 0:
                print(f"Processados {index}/{total} frames", file=sys.stderr)
        return

    parser.error("Use --input/--output ou --input-dir/--output-dir.")


if __name__ == "__main__":
    main()
