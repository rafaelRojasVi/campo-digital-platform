.PHONY: setup lint format format-check typecheck test test-api docs-check check

setup:
	uv sync --all-extras --dev

lint:
	uv run ruff check .

format:
	uv run ruff format .

format-check:
	uv run ruff format --check .

typecheck:
	uv run mypy .

test:
	uv run pytest

test-api:
	uv run pytest tests/test_api.py

docs-check:
	uv run python scripts/check_doc_links.py

check: format-check lint typecheck test docs-check
