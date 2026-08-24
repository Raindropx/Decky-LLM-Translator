import json
import os


def write_settings_updates(settings_path, updates):
    """Atomically merge multiple settings into a JSON file."""
    if not isinstance(updates, dict) or not updates:
        raise ValueError("Settings updates must be a non-empty object")

    current = {}
    if os.path.exists(settings_path):
        with open(settings_path, "r") as settings_file:
            current = json.load(settings_file)
        if not isinstance(current, dict):
            raise ValueError("Settings file must contain an object")

    next_settings = {**current, **updates}
    directory = os.path.dirname(settings_path)
    os.makedirs(directory, exist_ok=True)
    temp_path = f"{settings_path}.tmp"
    try:
        with open(temp_path, "w") as temp_file:
            json.dump(next_settings, temp_file, indent=4)
            temp_file.flush()
            os.fsync(temp_file.fileno())
        os.chmod(temp_path, 0o600)
        os.replace(temp_path, settings_path)
    except Exception:
        try:
            os.remove(temp_path)
        except OSError:
            pass
        raise
    return next_settings
