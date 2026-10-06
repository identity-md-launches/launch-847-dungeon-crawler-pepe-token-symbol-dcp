#!/usr/bin/env python3
"""Create an offline source handoff without accessing git, runtime data or credentials."""
from pathlib import Path
import gzip
import hashlib
import io
import tarfile

root = Path(__file__).resolve().parents[1]
paths = [root / "README.md", root / "DESIGN.md", root / "REVIEW.md", root / "foundry.toml"]
for name in ("contracts", "server", "web", "dist", "test", "scripts", "deploy", "docs", "lib"):
    paths.extend((root / name).rglob("*"))
files = []
for path in paths:
    rel = path.relative_to(root)
    if not path.is_file() or path.is_symlink():
        continue
    if any(p in (".git", ".github", "node_modules", "scratch", "__pycache__") or p.startswith(".env") for p in rel.parts):
        continue
    files.append(path)
artifact = root / "artifacts" / "dcp-source.tar.gz"
artifact.parent.mkdir(exist_ok=True)
with artifact.open("wb") as output:
    with gzip.GzipFile(fileobj=output, mode="wb", filename="", mtime=0) as zipped:
        with tarfile.open(fileobj=zipped, mode="w") as archive:
            for path in sorted(set(files)):
                data = path.read_bytes()
                info = tarfile.TarInfo("dcp/" + path.relative_to(root).as_posix())
                info.size = len(data)
                info.mode = 0o644
                archive.addfile(info, io.BytesIO(data))
digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
(artifact.parent / "dcp-source.sha256").write_text(digest + "  dcp-source.tar.gz\n")
print(f"Offline source handoff: {len(set(files))} files, {artifact.stat().st_size} bytes")
