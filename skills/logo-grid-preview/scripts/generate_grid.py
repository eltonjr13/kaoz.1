import sys
import os
import json
import subprocess

def main():
    args = {}
    if len(sys.argv) > 1:
        try:
            args = json.loads(sys.argv[1])
        except Exception as e:
            sys.stderr.write(f"Erro ao decodificar JSON dos argumentos: {e}\n")
            sys.exit(1)
    else:
        kaoz_args = os.environ.get('KAOZ_SKILL_ARGS')
        if kaoz_args:
            try:
                args = json.loads(kaoz_args)
            except Exception as e:
                sys.stderr.write(f"Erro ao decodificar KAOZ_SKILL_ARGS: {e}\n")
                sys.exit(1)
        else:
            sys.stderr.write("Argumentos nao fornecidos.\n")
            sys.exit(1)

    images_paths = args.get('images')
    output_path = args.get('output_path')

    if not images_paths or not isinstance(images_paths, list):
        sys.stderr.write("Lista de imagens ('images') eh obrigatoria e deve ser uma lista.\n")
        sys.exit(1)
    
    if len(images_paths) != 9:
        sys.stderr.write(f"A lista de imagens deve conter exatamente 9 caminhos de arquivos. Recebido: {len(images_paths)}\n")
        sys.exit(1)

    if not output_path:
        sys.stderr.write("Caminho de saida ('output_path') eh obrigatorio.\n")
        sys.exit(1)

    try:
        from PIL import Image
    except ImportError:
        try:
            sys.stderr.write("Instalando Pillow para processamento de imagem...\n")
            subprocess.check_call([sys.executable, "-m", "pip", "install", "Pillow"])
            from PIL import Image
        except Exception as e:
            sys.stderr.write(f"Falha ao instalar Pillow: {e}\n")
            sys.exit(1)

    loaded_images = []
    tile_size = (600, 600)
    
    for path in images_paths:
        if not os.path.exists(path):
            sys.stderr.write(f"Arquivo nao encontrado no caminho: {path}\n")
            sys.exit(1)
        try:
            img = Image.open(path)
            if img.mode != 'RGB':
                img = img.convert('RGB')
            img = img.resize(tile_size, Image.Resampling.LANCZOS)
            loaded_images.append(img)
        except Exception as e:
            sys.stderr.write(f"Erro ao carregar a imagem {path}: {e}\n")
            sys.exit(1)

    grid_w = tile_size[0] * 3
    grid_h = tile_size[1] * 3
    grid_img = Image.new('RGB', (grid_w, grid_h), color=(255, 255, 255))

    for i in range(9):
        row = i // 3
        col = i % 3
        x = col * tile_size[0]
        y = row * tile_size[1]
        grid_img.paste(loaded_images[i], (x, y))

    try:
        out_dir = os.path.dirname(os.path.abspath(output_path))
        if out_dir and not os.path.exists(out_dir):
            os.makedirs(out_dir)
        grid_img.save(output_path, 'JPEG', quality=95)
    except Exception as e:
        sys.stderr.write(f"Erro ao salvar a imagem final: {e}\n")
        sys.exit(1)

    result = {
        "success": True,
        "grid_path": output_path,
        "message": f"Grid 3x3 gerado com sucesso em {output_path}"
    }
    print(json.dumps(result))

if __name__ == '__main__':
    main()