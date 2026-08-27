"""Enforce repository-level Python architecture boundaries."""

from __future__ import annotations

import ast
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
PRODUCTS_ROOT = REPO_ROOT / "products"


@dataclass(frozen=True, slots=True)
class Violation:
    path: Path
    line: int
    message: str


def discover_product_packages() -> dict[str, set[str]]:
    """Map each materialized product to its top-level Python packages."""

    products: dict[str, set[str]] = {}

    if not PRODUCTS_ROOT.is_dir():
        return products

    for product_root in sorted(PRODUCTS_ROOT.iterdir()):
        if not product_root.is_dir():
            continue

        src_root = product_root / "src"

        if not src_root.is_dir():
            continue

        package_names = {
            candidate.name
            for candidate in src_root.iterdir()
            if candidate.is_dir() and (candidate / "__init__.py").is_file()
        }

        if package_names:
            products[product_root.name] = package_names

    return products


def imported_roots(tree: ast.AST) -> list[tuple[int, str]]:
    """Return top-level import roots with their source line numbers."""

    imports: list[tuple[int, str]] = []

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                imports.append(
                    (
                        node.lineno,
                        alias.name.split(".", 1)[0],
                    )
                )

        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            imports.append(
                (
                    node.lineno,
                    node.module.split(".", 1)[0],
                )
            )

    return imports


def check_product_source_file(
    path: Path,
    *,
    product_name: str,
    product_packages: dict[str, set[str]],
) -> list[Violation]:
    """Check one product-owned Python source file."""

    tree = ast.parse(
        path.read_text(encoding="utf-8"),
        filename=str(path),
    )

    violations: list[Violation] = []

    other_product_packages = {
        package_name
        for other_product, package_names in product_packages.items()
        if other_product != product_name
        for package_name in package_names
    }

    for line, import_root in imported_roots(tree):
        if import_root == "fastapi":
            violations.append(
                Violation(
                    path=path,
                    line=line,
                    message=("product-domain code must not depend on FastAPI"),
                )
            )

        if import_root == "app":
            violations.append(
                Violation(
                    path=path,
                    line=line,
                    message=("product code must not depend on the API application"),
                )
            )

        if import_root in other_product_packages:
            violations.append(
                Violation(
                    path=path,
                    line=line,
                    message=(
                        f"product {product_name!r} must not import "
                        f"another product package {import_root!r}"
                    ),
                )
            )

    return violations


def collect_violations() -> list[Violation]:
    """Collect all executable architecture violations."""

    product_packages = discover_product_packages()
    violations: list[Violation] = []

    for product_name in sorted(product_packages):
        src_root = PRODUCTS_ROOT / product_name / "src"

        for path in sorted(src_root.rglob("*.py")):
            violations.extend(
                check_product_source_file(
                    path,
                    product_name=product_name,
                    product_packages=product_packages,
                )
            )

    return violations


def main() -> int:
    violations = collect_violations()

    if not violations:
        print("Architecture boundaries: OK")
        return 0

    print("Architecture boundary violations:")

    for violation in violations:
        relative_path = violation.path.relative_to(REPO_ROOT)

        print(f"- {relative_path}:{violation.line}: {violation.message}")

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
