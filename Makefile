.PHONY: setup lint format format-check typecheck test test-api docs-check check db-test-up db-test-reset db-test-down migration-check persistence-check

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
	uv run pytest apps/api/tests

docs-check:
	uv run python scripts/check_doc_links.py

check: format-check lint typecheck test docs-check

db-test-up:
	docker compose up -d --wait postgres-test

db-test-reset:
	docker compose rm -sf postgres-test
	docker compose up -d --wait postgres-test

db-test-down:
	docker compose rm -sf postgres-test

migration-check: db-test-reset
	APP_ENV=test \
	POSTGRES_DB=campo_digital_test \
	POSTGRES_USER=campo_digital_test \
	POSTGRES_PASSWORD=campo_digital_test \
	POSTGRES_HOST=127.0.0.1 \
	POSTGRES_PORT=5433 \
	PYTHONPATH=apps/api \
	uv run python scripts/migration_check.py

persistence-check: migration-check
	APP_ENV=test \
	POSTGRES_DB=campo_digital_test \
	POSTGRES_USER=campo_digital_test \
	POSTGRES_PASSWORD=campo_digital_test \
	POSTGRES_HOST=127.0.0.1 \
	POSTGRES_PORT=5433 \
	PYTHONPATH=apps/api \
	uv run pytest -q apps/api/integration_tests

