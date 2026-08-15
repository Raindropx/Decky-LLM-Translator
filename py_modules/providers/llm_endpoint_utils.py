from collections.abc import Iterable


def next_endpoint_copy_name(
    source_name: str,
    existing_names: Iterable[str],
    max_length: int = 80,
) -> str:
    """Return a numbered endpoint-copy name that does not already exist."""
    if max_length < 3:
        raise ValueError("max_length must leave room for a name and numeric suffix")

    base_name = str(source_name or "").strip() or "Endpoint"
    normalized_existing = {
        str(name).strip().casefold()
        for name in existing_names
    }

    copy_number = 2
    while True:
        suffix = f" {copy_number}"
        trimmed_base = base_name[:max_length - len(suffix)].rstrip()
        candidate = f"{trimmed_base}{suffix}"
        if candidate.casefold() not in normalized_existing:
            return candidate
        copy_number += 1
