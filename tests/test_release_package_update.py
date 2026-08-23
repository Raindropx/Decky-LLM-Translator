import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = REPO_ROOT / ".github" / "scripts" / "update_package_release.py"
spec = importlib.util.spec_from_file_location("update_package_release", SCRIPT_PATH)
update_package_release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(update_package_release)


class ReleasePackageUpdateTests(unittest.TestCase):
    def test_updates_fork_url_hash_and_semver(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            package_path = Path(temp_dir) / "package.json"
            package_path.write_text(json.dumps({
                "version": "0.2.0",
                "remote_binary": [{
                    "name": "plugin-dependencies.tar.gz",
                    "url": "https://github.com/upstream/project/releases/download/0.9.1/plugin-dependencies.tar.gz",
                    "sha256hash": "0" * 64,
                }],
            }), encoding="utf-8")

            update_package_release.update_package_release(
                package_path,
                "Raindropx/Decky-LLM-Translator",
                "v0.2.1",
                "a" * 64,
                "0.2.1",
            )

            updated = json.loads(package_path.read_text(encoding="utf-8"))
            self.assertEqual(updated["version"], "0.2.1")
            dependency = updated["remote_binary"][0]
            self.assertEqual(
                dependency["url"],
                "https://github.com/Raindropx/Decky-LLM-Translator/releases/download/v0.2.1/plugin-dependencies.tar.gz",
            )
            self.assertEqual(dependency["sha256hash"], "a" * 64)

    def test_workflow_uses_fork_artifact_names(self):
        workflow = (REPO_ROOT / ".github" / "workflows" / "build.yml").read_text(encoding="utf-8")
        self.assertNotIn("cat-in-a-box", workflow)
        self.assertNotIn('"Decky Translator.zip"', workflow)
        self.assertNotIn("decky-translator-plugin", workflow)
        self.assertIn('"Decky LLM Translator.zip"', workflow)
        self.assertIn("decky-llm-translator-plugin", workflow)


if __name__ == "__main__":
    unittest.main()
