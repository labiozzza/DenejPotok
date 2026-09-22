#!/usr/bin/env python3
# get_project.py
import os
import argparse
from typing import Set

EXTENSIONS: Set[str] = {'.py', '.txt', '.json', '.html', '.css', '.js'}
IGNORED_DIRECTORIES = {
    '.git', '.venv', '__pycache__', '.idea', 'env', 'venv',
    'node_modules', 'site-packages', 'hooks', 'logs', 'refs', 'pack'
}

def read_file_safe(path: str) -> str:
    """Пытаемся прочитать в utf-8, иначе в latin-1; возвращаем текст или сообщение об ошибке."""
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return f.read()
    except UnicodeDecodeError:
        try:
            with open(path, 'r', encoding='latin-1') as f:
                return f.read()
        except Exception as e:
            return f"\n[Ошибка чтения (кодировка) файла {path}: {e}]\n"
    except Exception as e:
        return f"\n[Ошибка чтения файла {path}: {e}]\n"

def should_skip_file(name: str) -> bool:
    ext = os.path.splitext(name)[1].lower()
    return ext not in EXTENSIONS

def collect_to_output(root_dir: str, out_path: str):
    root_dir = os.path.abspath(root_dir)
    with open(out_path, 'w', encoding='utf-8') as out:
        out.write(f"Сбор из: {root_dir}\n")
        for current_root, dirs, files in os.walk(root_dir):
            # Фильтруем директории, чтобы os.walk не заходил в них
            dirs[:] = [d for d in dirs if d not in IGNORED_DIRECTORIES]
            rel_root = os.path.relpath(current_root, root_dir)
            out.write(f"\n===== ДИРЕКТОРИЯ: {rel_root} =====\n")
            for filename in sorted(files):
                if should_skip_file(filename):
                    continue
                full_path = os.path.join(current_root, filename)
                rel_path = os.path.join(rel_root, filename)
                out.write(f"\n--- ФАЙЛ: {rel_path} ---\n")
                content = read_file_safe(full_path)
                out.write(content)
                out.write("\n")  # разделитель

def parse_args():
    p = argparse.ArgumentParser(description="Собрать содержимое файлов в один файл (os.walk).")
    p.add_argument("--root", "-r", default=".", help="Корень проекта (по умолчанию текущая папка).")
    p.add_argument("--out", "-o", default="акции.txt", help="Выходной файл.")
    return p.parse_args()

def main():
    args = parse_args()
    collect_to_output(args.root, args.out)
    print(f"Готово. Результат в {args.out}")

if __name__ == "__main__":
    main()
