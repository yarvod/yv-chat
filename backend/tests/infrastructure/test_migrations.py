"""Static Alembic graph invariants that fail before database deployment."""

from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory


def test_migration_graph_has_one_head_and_version_ids_fit_version_table() -> None:
    backend_root = Path(__file__).resolve().parents[2]
    scripts = ScriptDirectory.from_config(Config(backend_root / "alembic.ini"))
    revisions = list(scripts.walk_revisions())

    assert scripts.get_heads() == ["0027_single_history_sync"]
    assert len({revision.revision for revision in revisions}) == len(revisions)
    assert all(len(revision.revision) <= 32 for revision in revisions)
