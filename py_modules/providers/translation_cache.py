import os
import re
import time
import sqlite3
import logging
import threading

logger = logging.getLogger(__name__)

# A request reuses a cached entry only if its tier is >= the selected provider's tier, so quality only flows downward
PROVIDER_TIERS = {
    "ct2": 1,
    "freegoogle": 2,
    "googlecloud": 3,
    "gemini_vision": 3,
}

# When exceeded, the least recently used rows are dropped
MAX_ROWS = 50000

_WHITESPACE = re.compile(r"\s+")


def normalize(text):
    return _WHITESPACE.sub(" ", text.strip()).casefold()


class TranslationCache:
    def __init__(self, db_path):
        self._db_path = db_path
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA synchronous=NORMAL")
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS translations (
                source_lang   TEXT NOT NULL,
                target_lang   TEXT NOT NULL,
                norm_text     TEXT NOT NULL,
                source_text   TEXT,
                translation   TEXT NOT NULL,
                tier          INTEGER NOT NULL,
                provider      TEXT,
                created_at    INTEGER,
                last_used_at  INTEGER,
                hit_count     INTEGER DEFAULT 0,
                PRIMARY KEY (source_lang, target_lang, norm_text)
            )
            """
        )
        cols = [r[1] for r in self._conn.execute("PRAGMA table_info(translations)")]
        if "source_text" not in cols:
            self._conn.execute("ALTER TABLE translations ADD COLUMN source_text TEXT")
        self._conn.commit()

    def get_many(self, texts, source_lang, target_lang, min_tier):
        norm_by_input = {}
        for text in texts:
            if text and text.strip():
                norm_by_input[text] = normalize(text)
        if not norm_by_input:
            return {}

        unique_norms = list(set(norm_by_input.values()))
        placeholders = ",".join("?" for _ in unique_norms)
        with self._lock:
            rows = self._conn.execute(
                f"""
                SELECT norm_text, translation FROM translations
                WHERE source_lang=? AND target_lang=? AND tier>=?
                  AND norm_text IN ({placeholders})
                """,
                [source_lang, target_lang, min_tier, *unique_norms],
            ).fetchall()

            if rows:
                hit_norms = [r[0] for r in rows]
                hit_placeholders = ",".join("?" for _ in hit_norms)
                self._conn.execute(
                    f"""
                    UPDATE translations
                    SET hit_count = hit_count + 1, last_used_at = ?
                    WHERE source_lang=? AND target_lang=?
                      AND norm_text IN ({hit_placeholders})
                    """,
                    [int(time.time()), source_lang, target_lang, *hit_norms],
                )
                self._conn.commit()

        translation_by_norm = {r[0]: r[1] for r in rows}
        return {
            text: translation_by_norm[norm]
            for text, norm in norm_by_input.items()
            if norm in translation_by_norm
        }

    def put_many(self, pairs, source_lang, target_lang, tier, provider):
        now = int(time.time())
        rows = []
        for text, translation in pairs:
            if not text or not text.strip() or not translation:
                continue
            rows.append((source_lang, target_lang, normalize(text), text,
                         translation, tier, provider, now, now))
        if not rows:
            return

        with self._lock:
            # Only a higher tier may overwrite
            self._conn.executemany(
                """
                INSERT INTO translations
                    (source_lang, target_lang, norm_text, source_text, translation,
                     tier, provider, created_at, last_used_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(source_lang, target_lang, norm_text) DO UPDATE SET
                    source_text = excluded.source_text,
                    translation = excluded.translation,
                    tier = excluded.tier,
                    provider = excluded.provider,
                    last_used_at = excluded.last_used_at
                WHERE excluded.tier > translations.tier
                """,
                rows,
            )
            self._conn.commit()
            self._evict_if_needed()

    def _evict_if_needed(self):
        count = self._conn.execute("SELECT COUNT(*) FROM translations").fetchone()[0]
        if count <= MAX_ROWS:
            return
        to_remove = count - MAX_ROWS
        self._conn.execute(
            """
            DELETE FROM translations WHERE rowid IN (
                SELECT rowid FROM translations ORDER BY last_used_at ASC LIMIT ?
            )
            """,
            [to_remove],
        )
        self._conn.commit()
        logger.info(f"Translation cache evicted {to_remove} least-used entries (cap {MAX_ROWS})")

    def clear(self):
        with self._lock:
            count = self._conn.execute("SELECT COUNT(*) FROM translations").fetchone()[0]
            self._conn.execute("DELETE FROM translations")
            self._conn.commit()
            self._conn.execute("VACUUM")
        return count

    def stats(self):
        with self._lock:
            row = self._conn.execute(
                "SELECT COUNT(*), COALESCE(SUM(hit_count), 0) FROM translations"
            ).fetchone()
        size_bytes = os.path.getsize(self._db_path) if os.path.exists(self._db_path) else 0
        return {"entries": row[0], "hits": row[1], "size_bytes": size_bytes}

    def list_entries(self, limit=300):
        with self._lock:
            rows = self._conn.execute(
                """
                SELECT COALESCE(source_text, norm_text), translation,
                       source_lang, target_lang, tier, hit_count, created_at, provider
                FROM translations
                ORDER BY created_at DESC
                LIMIT ?
                """,
                [limit],
            ).fetchall()
        return [
            {"source": r[0], "translation": r[1], "sourceLang": r[2],
             "targetLang": r[3], "tier": r[4], "hits": r[5], "createdAt": r[6], "provider": r[7]}
            for r in rows
        ]

    def delete_entry(self, source_lang, target_lang, source_text):
        with self._lock:
            cur = self._conn.execute(
                "DELETE FROM translations WHERE source_lang=? AND target_lang=? AND norm_text=?",
                [source_lang, target_lang, normalize(source_text)],
            )
            self._conn.commit()
        return cur.rowcount

    def close(self):
        with self._lock:
            self._conn.close()