import io
import os
import sys
import tarfile
import time

EXEC_FILES = ("usr/libexec/rpcd/esp-switch",)


def add_tree(tar, root, prefix):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort()
        filenames.sort()
        rel = os.path.relpath(dirpath, root).replace("\\", "/")
        base = prefix if rel == "." else "%s/%s" % (prefix, rel)
        info = tarfile.TarInfo(base + "/")
        info.type = tarfile.DIRTYPE
        info.mode = 0o755
        info.mtime = int(time.time())
        info.uname = "root"
        info.gname = "root"
        tar.addfile(info)
        for name in filenames:
            path = os.path.join(dirpath, name)
            target = "%s/%s" % (base, name)
            mode = 0o755 if target.lstrip("./") in EXEC_FILES else 0o644
            data = open(path, "rb").read()
            info = tarfile.TarInfo(target)
            info.size = len(data)
            info.mode = mode
            info.mtime = int(time.time())
            info.uname = "root"
            info.gname = "root"
            tar.addfile(info, io.BytesIO(data))


def gz(data):
    import gzip
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", mtime=0) as fh:
        fh.write(data)
    return buf.getvalue()


def ar(members):
    out = io.BytesIO()
    out.write(b"!<arch>\n")
    for name, data in members:
        header = "%-16s%-12d%-6d%-6d%-8s%-10d`\n" % (name, int(time.time()), 0, 0, "100644", len(data))
        out.write(header.encode("ascii"))
        out.write(data)
        if len(data) % 2:
            out.write(b"\n")
    return out.getvalue()


def main():
    root = sys.argv[1]
    version = sys.argv[2]
    out_path = sys.argv[3]
    split = len(sys.argv) > 4 and sys.argv[4] == "--split"
    pkgname = os.path.basename(root.rstrip("/\\"))

    data = io.BytesIO()
    with tarfile.open(fileobj=data, mode="w") as tar:
        add_tree(tar, root, ".")

    total = 0
    raw = data.getvalue()
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r") as tar:
        for member in tar.getmembers():
            if member.isfile():
                total += member.size

    control = "\n".join([
        "Package: %s" % pkgname,
        "Version: %s" % version,
        "Depends: luci-base, curl, avahi-daemon, avahi-utils, ubus, rpcd",
        "SourceName: %s" % pkgname,
        "License: MIT",
        "Section: luci",
        "Architecture: all",
        "Installed-Size: %d" % ((total + 1023) // 1024),
        "Description: Discover and control ESP8266 relay switch boards from LuCI",
        "",
    ]).encode("utf-8")

    control_tar = io.BytesIO()
    with tarfile.open(fileobj=control_tar, mode="w") as tar:
        info = tarfile.TarInfo("./control")
        info.size = len(control)
        info.mode = 0o644
        info.mtime = int(time.time())
        info.uname = "root"
        info.gname = "root"
        tar.addfile(info, io.BytesIO(control))

    members = [
        ("debian-binary", b"2.0\n"),
        ("control.tar.gz", gz(control_tar.getvalue())),
        ("data.tar.gz", gz(raw)),
    ]
    out_dir = os.path.dirname(out_path)
    if out_dir and not os.path.isdir(out_dir):
        os.makedirs(out_dir)
    if split:
        if not os.path.isdir(out_path):
            os.makedirs(out_path)
        for name, data in members:
            with open(os.path.join(out_path, name), "wb") as fh:
                fh.write(data)
        print("split %s (%d files bytes)" % (out_path, total))
        return
    ipk = ar(members)
    with open(out_path, "wb") as fh:
        fh.write(ipk)
    print("built %s (%d bytes, %d files bytes)" % (out_path, len(ipk), total))


if __name__ == "__main__":
    main()
