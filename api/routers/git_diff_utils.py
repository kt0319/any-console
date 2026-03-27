import re


def _resolve_rename_path(path: str) -> str:
    m = re.search(r'\{[^}]* => ([^}]*)\}', path)
    if not m:
        return path
    new_name = m.group(1).strip()
    return path[:m.start()] + new_name + path[m.end():]


def parse_numstat(stdout: str) -> dict[str, dict[str, int | None]]:
    stats: dict[str, dict[str, int | None]] = {}
    for line in stdout.splitlines():
        if not line.strip():
            continue
        parts = line.split("\t", 2)
        if len(parts) < 3:
            continue
        ins_raw, del_raw, path = parts
        if not path:
            continue
        insertions = None if ins_raw == "-" else int(ins_raw or 0)
        deletions = None if del_raw == "-" else int(del_raw or 0)
        stat = {"insertions": insertions, "deletions": deletions}
        stats[path] = stat
        resolved = _resolve_rename_path(path)
        if resolved != path:
            stats[resolved] = stat
    return stats


def parse_numstat_result(result: dict[str, object]) -> dict[str, dict[str, int | None]]:
    if result.get("exit_code") != 0:
        return {}
    stdout = result.get("stdout")
    return parse_numstat(stdout) if isinstance(stdout, str) else {}


def build_file_entry(
    name: str,
    numstat: dict[str, dict[str, int | None]],
    status: str | None = None,
) -> dict[str, str | int | None]:
    stat = numstat.get(name, {})
    entry: dict[str, str | int | None] = {
        "name": name,
        "insertions": stat.get("insertions"),
        "deletions": stat.get("deletions"),
    }
    if status is not None:
        entry["status"] = status
    return entry


def build_file_list(files_result, numstat):
    files = []
    if files_result["exit_code"] == 0:
        for f in files_result["stdout"].splitlines():
            file_name = f.strip()
            if file_name:
                files.append(build_file_entry(file_name, numstat))
    return files
