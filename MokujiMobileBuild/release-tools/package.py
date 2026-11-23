"""Build the redistributable Windows/source archive and its installation inventory."""

from pathlib import Path, PurePosixPath
import argparse
import os
import re
import stat
import tempfile
import zipfile

ROOT_FILES = {
    'Start-Mokuji.cmd', 'Stop-Mokuji.cmd', 'Create-Desktop-Shortcut.cmd',
    '使用说明.txt', 'launcher.mjs', 'server.mjs', 'backend.mjs', 'reader-source.mjs',
    'open-books.mjs', 'wikisource-html.cjs', 'mobile-access.mjs', 'online-cache.mjs',
    'online-catalog.mjs', 'external-books.mjs', 'chinese-collections.mjs', 'kodo-storage.mjs',
    'cn-open.mjs', 'foreign-open.mjs', 'wiki-import.mjs', 'web-fiction.mjs', 'webclip-profile.mjs',
    'epub-storage.mjs', 'epub-reader.cjs', 'epub-deps.cjs',
    'cotex-native-source.mjs', 'cotex-bridge.mjs',
}
PROVIDER_NAME = re.compile(
    r'(?:cn-open|foreign-open|wiki-extra|wiki-import|collections|poetry|indie|community|'
    r'mainstream|web-fiction|awards|jinjiang|zongheng)(?:-[a-z][a-z0-9]*)*\.(?:mjs|cjs)$'
)
DEPLOY_FILES = {
    '.env.example', '.gitignore', 'Caddyfile', 'compose.yaml', 'Dockerfile', 'Dockerfile.dockerignore', 'README.md',
}
TREE_TYPES = {
    'client-source': {'.css', '.html', '.js', '.jsx', '.json', '.md', '.mjs', '.cjs', '.ts', '.tsx', '.txt', '.svg', '.png', '.webp', '.woff', '.woff2'},
    'web': {'.html', '.css', '.js', '.txt', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.avif', '.ico', '.woff', '.woff2'},
}
PRIVATE_DIRS = {'.git', '.env', 'data', 'node_modules', 'dist', 'output', 'test-results', 'coverage', '__pycache__'}
SKIP_PROVIDER = re.compile(r'(?:^|-)(?:tests?|specs?|fixtures?|backups?|secrets?|scratch|debug|dev|tmp|credentials?)(?:-|\.)')
LOCAL_IMPORT = re.compile(r"""(?:\b(?:from|import)\s*|\b(?:import|require)\s*\(\s*)['"](\./[\w./-]+\.(?:mjs|cjs))['"]""")

def checked_file(path, root):
    if not path.is_file() or path.is_symlink() or path.resolve().parent != path.parent.resolve():
        raise ValueError('Missing or linked file: ' + str(path))
    for component in (path, *path.parents):
        if component == root:
            break
        if getattr(component.lstat(), 'st_file_attributes', 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT:
            raise ValueError('Linked filesystem entry: ' + str(component))
    return path.relative_to(root).as_posix()

def collect(stage):
    names = {checked_file(stage / name, stage) for name in ROOT_FILES}
    for f in stage.iterdir():
        if PROVIDER_NAME.fullmatch(f.name) and not SKIP_PROVIDER.search(f.name):
            names.add(checked_file(f, stage))
    for tree, allowed_types in TREE_TYPES.items():
        for f in (stage / tree).rglob('*'):
            parts = f.relative_to(stage / tree).parts
            if any(n.startswith('.') or n.lower() in PRIVATE_DIRS for n in parts):
                continue
            if f.is_file() and (f.suffix.lower() in allowed_types or f.relative_to(stage).as_posix() in {'web/install/Mokuji-Android.apk', 'web/install/Mokuji-iPhone-Unsigned.ipa'}):
                names.add(checked_file(f, stage))
    for name in DEPLOY_FILES:
        names.add(checked_file(stage / 'server-deploy' / name, stage))
    for required in ['web/index.html', 'client-source/package.json', 'client-source/main.tsx', 'client-source/build.mjs', 'web/install/index.html', 'web/install/install.js', 'web/install/install.css', 'web/install/Mokuji-Android.apk', 'web/install/Mokuji-iPhone-Unsigned.ipa']:
        if required not in names:
            raise ValueError('Missing application entry: ' + required)
    for name in names:
        file = PurePosixPath(name)
        if len(file.parts) != 1 or file.suffix not in {'.mjs', '.cjs'}:
            continue
        for target in LOCAL_IMPORT.findall((stage / name).read_text(encoding='utf-8-sig')):
            if PurePosixPath(target).as_posix() not in names:
                raise ValueError(f'{name} references missing module {target}')
    return sorted(names)

def temp_path(destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=destination.name + '.', suffix='.tmp', dir=destination.parent)
    os.close(fd)
    return Path(name)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stage', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('manifest', type=Path)
    args = parser.parse_args()
    stage, output, manifest = map(Path.resolve, [args.stage, args.output, args.manifest])
    if output.is_relative_to(stage) or manifest.is_relative_to(stage) or output == manifest:
        raise ValueError('Use separate archive and manifest destinations outside the application directory.')
    names = collect(stage)
    archive_tmp = temp_path(output)
    manifest_tmp = temp_path(manifest)
    try:
        with zipfile.ZipFile(archive_tmp, 'w', zipfile.ZIP_DEFLATED, compresslevel=7) as archive:
            for name in names:
                archive.write(stage / name, 'Mokuji/' + name)
        with zipfile.ZipFile(archive_tmp) as archive:
            invalid = archive.testzip()
            if invalid or archive.namelist() != ['Mokuji/' + name for name in names]:
                raise ValueError('Incomplete archive: ' + str(invalid))
        manifest_tmp.write_text('\n'.join(names) + '\n', encoding='utf-8')
        os.replace(archive_tmp, output)
        os.replace(manifest_tmp, manifest)
    finally:
        archive_tmp.unlink(missing_ok=True)
        manifest_tmp.unlink(missing_ok=True)
    print(f'{len(names)} files, {output.stat().st_size:,} bytes')

if __name__ == '__main__':
    main()
