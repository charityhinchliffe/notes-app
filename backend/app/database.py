import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable, List, Optional

DB_PATH = Path(__file__).resolve().parent.parent / "notes.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_name ON tags(name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS note_tags (
    note_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (note_id, tag_id),
    FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    password TEXT NOT NULL,
    locked INTEGER NOT NULL DEFAULT 0
);

INSERT INTO settings (id, password)
SELECT 1, 'password123'
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE id = 1);
"""


class MissingNote(Exception):
    pass


class MissingTags(Exception):
    def __init__(self, tag_ids: List[str]):
        self.tag_ids = tag_ids
        super().__init__(", ".join(tag_ids))


class IncorrectPassword(Exception):
    pass


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def connect():
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def init_db() -> None:
    fresh = not DB_PATH.exists()
    with connect() as connection:
        connection.executescript(SCHEMA)
        columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(settings)")
        }
        if "locked" not in columns:
            connection.execute(
                "ALTER TABLE settings ADD COLUMN locked INTEGER NOT NULL DEFAULT 0"
            )
        if fresh:
            seed(connection)


def seed(connection: sqlite3.Connection) -> None:
    moment = datetime.now(timezone.utc)
    hour = timedelta(hours=1)

    tags = [
        ("tag-ideas", "Ideas", moment - 50 * hour),
        ("tag-personal", "Personal", moment - 40 * hour),
        ("tag-errands", "Errands", moment - 30 * hour),
    ]
    connection.executemany(
        "INSERT INTO tags (id, name, created_at) VALUES (?, ?, ?)",
        [(tag_id, name, created.isoformat()) for tag_id, name, created in tags],
    )

    notes = [
        (
            "note-market",
            "Saturday market",
            "Peonies if they have them, sourdough, and a card for mum.\n\nLeave by ten so the good stalls are still open.",
            moment - 26 * hour,
            moment - 2 * hour,
            ["tag-errands", "tag-personal"],
        ),
        (
            "note-reading",
            "Reading list",
            "Finish the chapter on colour and contrast.\n\nPull three quotes that could shape the next research note.",
            moment - 50 * hour,
            moment - 8 * hour,
            ["tag-ideas"],
        ),
        (
            "note-layout",
            "Layout sketch",
            "Keep the list on the left and the open note on the right. Quick create stays within reach at the top.",
            moment - 6 * hour,
            moment - timedelta(minutes=30),
            ["tag-ideas", "tag-personal"],
        ),
        (
            "note-call",
            "Call the studio",
            "Ask about Thursday. Mention the pink samples and confirm the pickup time.",
            moment - 3 * hour,
            moment - 3 * hour,
            ["tag-errands"],
        ),
    ]
    for note_id, title, content, created_at, updated_at, tag_ids in notes:
        connection.execute(
            """
            INSERT INTO notes (id, title, content, tags, created_at, updated_at)
            VALUES (?, ?, ?, '[]', ?, ?)
            """,
            (note_id, title, content, created_at.isoformat(), updated_at.isoformat()),
        )
        for tag_id in tag_ids:
            connection.execute(
                """
                INSERT INTO note_tags (note_id, tag_id, created_at)
                VALUES (?, ?, ?)
                """,
                (note_id, tag_id, created_at.isoformat()),
            )
        sync_tags_column(connection, note_id)


def sync_tags_column(connection: sqlite3.Connection, note_id: str) -> None:
    rows = connection.execute(
        """
        SELECT tags.name
        FROM note_tags
        JOIN tags ON tags.id = note_tags.tag_id
        WHERE note_tags.note_id = ?
        ORDER BY tags.name COLLATE NOCASE
        """,
        (note_id,),
    ).fetchall()
    names = [row["name"] for row in rows]
    connection.execute(
        "UPDATE notes SET tags = ? WHERE id = ?",
        (json.dumps(names), note_id),
    )


def _tag_row(row: sqlite3.Row) -> dict:
    return {"id": row["id"], "name": row["name"], "created_at": row["created_at"]}


def _note_from_row(connection: sqlite3.Connection, row: sqlite3.Row) -> dict:
    tags = connection.execute(
        """
        SELECT tags.id, tags.name, tags.created_at
        FROM note_tags
        JOIN tags ON tags.id = note_tags.tag_id
        WHERE note_tags.note_id = ?
        ORDER BY tags.name COLLATE NOCASE
        """,
        (row["id"],),
    ).fetchall()
    return {
        "id": row["id"],
        "title": row["title"],
        "content": row["content"],
        "tags": [_tag_row(tag) for tag in tags],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _require_note(connection: sqlite3.Connection, note_id: str) -> sqlite3.Row:
    row = connection.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    if row is None:
        raise MissingNote(note_id)
    return row


def _require_tags(connection: sqlite3.Connection, tag_ids: Iterable[str]) -> None:
    ids = list(tag_ids)
    if not ids:
        return
    placeholders = ",".join("?" for _ in ids)
    rows = connection.execute(
        f"SELECT id FROM tags WHERE id IN ({placeholders})",
        ids,
    ).fetchall()
    found = {row["id"] for row in rows}
    missing = [tag_id for tag_id in ids if tag_id not in found]
    if missing:
        raise MissingTags(missing)


def list_tags() -> List[dict]:
    with connect() as connection:
        rows = connection.execute(
            "SELECT id, name, created_at FROM tags ORDER BY name COLLATE NOCASE"
        ).fetchall()
        return [_tag_row(row) for row in rows]


def create_tag(name: str) -> dict:
    with connect() as connection:
        existing = connection.execute(
            "SELECT id, name, created_at FROM tags WHERE name = ? COLLATE NOCASE",
            (name,),
        ).fetchone()
        if existing is not None:
            tag = _tag_row(existing)
            tag["created"] = False
            return tag

        tag_id = str(uuid.uuid4())
        created_at = now_iso()
        connection.execute(
            "INSERT INTO tags (id, name, created_at) VALUES (?, ?, ?)",
            (tag_id, name, created_at),
        )
        return {"id": tag_id, "name": name, "created_at": created_at, "created": True}


def delete_tag(tag_id: str) -> bool:
    with connect() as connection:
        row = connection.execute("SELECT id FROM tags WHERE id = ?", (tag_id,)).fetchone()
        if row is None:
            return False
        note_ids = [
            item["note_id"]
            for item in connection.execute(
                "SELECT note_id FROM note_tags WHERE tag_id = ?",
                (tag_id,),
            ).fetchall()
        ]
        connection.execute("DELETE FROM tags WHERE id = ?", (tag_id,))
        for note_id in note_ids:
            sync_tags_column(connection, note_id)
        return True


def list_notes() -> List[dict]:
    with connect() as connection:
        rows = connection.execute(
            "SELECT * FROM notes ORDER BY updated_at DESC"
        ).fetchall()
        return [_note_from_row(connection, row) for row in rows]


def get_note(note_id: str) -> Optional[dict]:
    with connect() as connection:
        try:
            row = _require_note(connection, note_id)
        except MissingNote:
            return None
        return _note_from_row(connection, row)


def create_note(title: str, content: str, tag_ids: List[str]) -> dict:
    with connect() as connection:
        _require_tags(connection, tag_ids)
        note_id = str(uuid.uuid4())
        timestamp = now_iso()
        connection.execute(
            """
            INSERT INTO notes (id, title, content, tags, created_at, updated_at)
            VALUES (?, ?, ?, '[]', ?, ?)
            """,
            (note_id, title, content, timestamp, timestamp),
        )
        for tag_id in tag_ids:
            connection.execute(
                """
                INSERT INTO note_tags (note_id, tag_id, created_at)
                VALUES (?, ?, ?)
                """,
                (note_id, tag_id, timestamp),
            )
        sync_tags_column(connection, note_id)
        return _note_from_row(connection, _require_note(connection, note_id))


def update_note(note_id: str, title: Optional[str], content: Optional[str]) -> Optional[dict]:
    with connect() as connection:
        try:
            current = _require_note(connection, note_id)
        except MissingNote:
            return None
        next_title = current["title"] if title is None else title
        next_content = current["content"] if content is None else content
        connection.execute(
            """
            UPDATE notes
            SET title = ?, content = ?, updated_at = ?
            WHERE id = ?
            """,
            (next_title, next_content, now_iso(), note_id),
        )
        return _note_from_row(connection, _require_note(connection, note_id))


def delete_note(note_id: str) -> bool:
    with connect() as connection:
        cursor = connection.execute("DELETE FROM notes WHERE id = ?", (note_id,))
        return cursor.rowcount > 0


def attach_tags(note_id: str, tag_ids: List[str]) -> dict:
    with connect() as connection:
        _require_note(connection, note_id)
        _require_tags(connection, tag_ids)
        timestamp = now_iso()
        for tag_id in tag_ids:
            connection.execute(
                """
                INSERT OR IGNORE INTO note_tags (note_id, tag_id, created_at)
                VALUES (?, ?, ?)
                """,
                (note_id, tag_id, timestamp),
            )
        connection.execute(
            "UPDATE notes SET updated_at = ? WHERE id = ?",
            (timestamp, note_id),
        )
        sync_tags_column(connection, note_id)
        return _note_from_row(connection, _require_note(connection, note_id))


def get_password() -> str:
    with connect() as connection:
        row = connection.execute("SELECT password FROM settings WHERE id = 1").fetchone()
        if row is None:
            raise RuntimeError("Password setting is missing")
        return row["password"]


def is_locked() -> bool:
    with connect() as connection:
        row = connection.execute("SELECT locked FROM settings WHERE id = 1").fetchone()
        if row is None:
            return False
        return bool(row["locked"])


def lock_notes() -> None:
    with connect() as connection:
        connection.execute("UPDATE settings SET locked = 1 WHERE id = 1")


def verify_password(password: str) -> bool:
    return password == get_password()


def unlock_with_password(password: str) -> bool:
    with connect() as connection:
        row = connection.execute("SELECT password FROM settings WHERE id = 1").fetchone()
        if row is None or row["password"] != password:
            return False
        connection.execute("UPDATE settings SET locked = 0 WHERE id = 1")
        return True


def change_password(current_password: str, new_password: str) -> None:
    with connect() as connection:
        row = connection.execute("SELECT password FROM settings WHERE id = 1").fetchone()
        if row is None or row["password"] != current_password:
            raise IncorrectPassword()
        connection.execute(
            "UPDATE settings SET password = ? WHERE id = 1",
            (new_password,),
        )


def detach_tag(note_id: str, tag_id: str) -> dict:
    with connect() as connection:
        _require_note(connection, note_id)
        _require_tags(connection, [tag_id])
        connection.execute(
            "DELETE FROM note_tags WHERE note_id = ? AND tag_id = ?",
            (note_id, tag_id),
        )
        timestamp = now_iso()
        connection.execute(
            "UPDATE notes SET updated_at = ? WHERE id = ?",
            (timestamp, note_id),
        )
        sync_tags_column(connection, note_id)
        return _note_from_row(connection, _require_note(connection, note_id))
