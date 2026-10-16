"""Rodales management reports: storage and lifecycle over PostGIS (synthetic base)."""

from __future__ import annotations

from pathlib import Path

import pytest
from app.forestry_publication import activate_snapshot
from app.forestry_report_geometry import FeatureInput, ReportValidationError
from app.forestry_reports import (
    ReportError,
    create_report,
    delete_report,
    duplicate_report,
    get_report,
    list_report_features,
    list_report_notes,
    list_report_sources,
    list_reports,
    load_source_polygons,
    save_report_features,
    transition_report,
    update_report_header,
)
from forestry_report_fixtures import (
    BASE_GEOMETRIES,
    BASE_ROWS,
    seed_published_base,
    seed_user,
    square_geojson,
)
from sqlalchemy import Connection, text
from test_forestry_ingestion import build_zip, ingest


@pytest.fixture
def ctx(integration_connection: Connection, tmp_path: Path) -> dict[str, int]:
    integration_connection.execute(
        text("UPDATE forestry.publication_state SET published_snapshot_id = NULL")
    )
    snapshot_id = seed_published_base(integration_connection, tmp_path)
    return {
        "snapshot": snapshot_id,
        "operator": seed_user(integration_connection, "operadora"),
        "admin": seed_user(integration_connection, "admin"),
    }


def new_report(connection: Connection, ctx: dict[str, int], name: str = "Cosecha 2027") -> int:
    return create_report(
        connection,
        name=name,
        report_type="cosecha",
        report_month="2027-01",
        actor_app_user_id=ctx["operator"],
    )


def split_rodal_17() -> list[FeatureInput]:
    return [
        FeatureInput(1, True, {"n_rodal": "17-1"}, square_geojson(0, 0, 60, 100)),
        FeatureInput(1, False, {}, square_geojson(60, 0, 40, 100)),
        FeatureInput(2, False, {}, None),
    ]


def code(error: pytest.ExceptionInfo[ReportError]) -> str:
    return error.value.code


def test_create_starts_a_draft_on_the_published_base(
    integration_connection: Connection, ctx: dict[str, int]
) -> None:
    report_id = new_report(integration_connection, ctx)
    report = get_report(integration_connection, report_id)
    assert report is not None
    assert (report.status, report.revision, report.base_snapshot_id) == (
        "borrador",
        1,
        ctx["snapshot"],
    )
    assert report.created_by_display_name == "operadora"
    assert (report.feature_count, report.managed_area_ha) == (0, 0.0)


def test_create_needs_a_published_base(
    integration_connection: Connection, ctx: dict[str, int]
) -> None:
    integration_connection.execute(
        text("UPDATE forestry.publication_state SET published_snapshot_id = NULL")
    )
    with pytest.raises(ReportError) as raised:
        new_report(integration_connection, ctx)
    assert code(raised) == "no_published_base"


@pytest.mark.parametrize(
    ("name", "expected"), [("   ", "invalid_name"), ("x" * 121, "invalid_name")]
)
def test_create_checks_the_name(
    integration_connection: Connection, ctx: dict[str, int], name: str, expected: str
) -> None:
    with pytest.raises(ReportError) as raised:
        new_report(integration_connection, ctx, name)
    assert code(raised) == expected


def test_create_refuses_a_bad_month(
    integration_connection: Connection, ctx: dict[str, int]
) -> None:
    with pytest.raises(ReportError) as raised:
        create_report(
            integration_connection,
            name="X",
            report_type="cosecha",
            report_month="2027-13",
            actor_app_user_id=ctx["operator"],
        )
    assert code(raised) == "invalid_month"


def test_active_name_must_be_free(integration_connection: Connection, ctx: dict[str, int]) -> None:
    new_report(integration_connection, ctx, "Cosecha")
    with pytest.raises(ReportError) as raised:
        new_report(integration_connection, ctx, "  cosecha ")
    assert code(raised) == "name_taken"


def test_save_stores_pieces_and_bumps_the_revision(
    integration_connection: Connection, ctx: dict[str, int]
) -> None:
    report_id = new_report(integration_connection, ctx)
    outcome = save_report_features(
        integration_connection, report_id=report_id, expected_revision=1, inputs=split_rodal_17()
    )
    assert (outcome.revision, outcome.feature_count) == (2, 3)
    features = list_report_features(integration_connection, report_id)
    assert [f.attributes["n_rodal"] for f in features] == ["17-1", "17", "18"]
    assert [f.geometry_changed for f in features] == [True, True, False]
    assert features[0].attributes["sup_ha"] == pytest.approx(0.6)
    assert features[0].attributes["objectid"] == 11
    report = get_report(integration_connection, report_id)
    assert report is not None
    assert (report.managed_feature_count, report.managed_area_ha) == (1, pytest.approx(0.6))
    sources = list_report_sources(integration_connection, report_id)
    assert sorted(s.feature_ordinal for s in sources) == [1, 2]


def test_save_replaces_the_previous_feature_set(
    integration_connection: Connection, ctx: dict[str, int]
) -> None:
    report_id = new_report(integration_connection, ctx)
    save_report_features(
        integration_connection, report_id=report_id, expected_revision=1, inputs=split_rodal_17()
    )
    save_report_features(
        integration_connection,
        report_id=report_id,
        expected_revision=2,
        inputs=[FeatureInput(3, True, {}, None)],
    )
    assert [
        f.source_feature_ordinal for f in list_report_features(integration_connection, report_id)
    ] == [3]


def test_save_with_an_old_revision_is_refused(
    integration_connection: Connection, ctx: dict[str, int]
) -> None:
    report_id = new_report(integration_connection, ctx)
    save_report_features(
        integration_connection, report_id=report_id, expected_revision=1, inputs=[]
    )
    with pytest.raises(ReportError) as raised:
        save_report_features(
            integration_connection, report_id=report_id, expected_revision=1, inputs=[]
        )
    assert code(raised) == "stale_revision"


def test_geometry_rules_apply_on_save(
    integration_connection: Connection, ctx: dict[str, int]
) -> None:
    report_id = new_report(integration_connection, ctx)
    with pytest.raises(ReportValidationError) as raised:
        save_report_features(
            integration_connection,
            report_id=report_id,
            expected_revision=1,
            inputs=[FeatureInput(1, True, {}, square_geojson(0, 0, 60, 100))],
        )
    assert raised.value.code == "split_coverage"
    assert list_report_features(integration_connection, report_id) == []


def test_invalid_base_polygon_is_carried_with_a_warning(
    integration_connection: Connection, ctx: dict[str, int]
) -> None:
    report_id = new_report(integration_connection, ctx)
    outcome = save_report_features(
        integration_connection,
        report_id=report_id,
        expected_revision=1,
        inputs=[FeatureInput(4, True, {}, None)],
    )
    assert [w.code for w in outcome.warnings] == ["invalid_source_carried"]


def test_polygon_in_another_active_report_warns(
    integration_connection: Connection, ctx: dict[str, int]
) -> None:
    first = new_report(integration_connection, ctx, "Cosecha")
    second = new_report(integration_connection, ctx, "Reforestación")
    save_report_features(
        integration_connection,
        report_id=first,
        expected_revision=1,
        inputs=[FeatureInput(2, True, {}, None)],
    )
    outcome = save_report_features(
        integration_connection,
        report_id=second,
        expected_revision=1,
        inputs=[FeatureInput(2, True, {}, None)],
    )
    assert [(w.code, w.source_feature_ordinal) for w in outcome.warnings] == [
        ("also_in_other_report", 2)
    ]
    assert "«Cosecha»" in outcome.warnings[0].message


def test_saving_after_a_newer_publish_warns_and_uses_the_report_base(
    integration_connection: Connection, ctx: dict[str, int], tmp_path: Path
) -> None:
    report_id = new_report(integration_connection, ctx)
    newer_rows = [dict(row, uso_2026="CLASE B") for row in BASE_ROWS]
    relative = build_zip(tmp_path, newer_rows, geometries=BASE_GEOMETRIES, zip_name="newer.zip")
    newer = ingest(integration_connection, tmp_path, relative).shapefile_snapshot_id
    assert newer != ctx["snapshot"]
    activate_snapshot(
        integration_connection,
        shapefile_snapshot_id=newer,
        actor_app_user_id=ctx["admin"],
        event_type="publish",
        expected_published_snapshot_id=ctx["snapshot"],
    )
    outcome = save_report_features(
        integration_connection, report_id=report_id, expected_revision=1, inputs=split_rodal_17()
    )
    assert "base_outdated" in [w.code for w in outcome.warnings]
    assert len(list_report_features(integration_connection, report_id)) == 3


def test_full_review_cycle_with_notes(
    integration_connection: Connection, ctx: dict[str, int]
) -> None:
    report_id = new_report(integration_connection, ctx)
    save_report_features(
        integration_connection, report_id=report_id, expected_revision=1, inputs=split_rodal_17()
    )
    assert (
        transition_report(
            integration_connection,
            report_id=report_id,
            action="submit",
            expected_revision=2,
            actor_app_user_id=ctx["operator"],
        )
        == "enviado"
    )
    assert (
        transition_report(
            integration_connection,
            report_id=report_id,
            action="request_changes",
            expected_revision=3,
            actor_app_user_id=ctx["admin"],
            note="  Saca el rodal 18.  ",
        )
        == "cambios_solicitados"
    )
    save_report_features(
        integration_connection,
        report_id=report_id,
        expected_revision=4,
        inputs=split_rodal_17()[:2],
    )
    transition_report(
        integration_connection,
        report_id=report_id,
        action="submit",
        expected_revision=5,
        actor_app_user_id=ctx["operator"],
    )
    assert (
        transition_report(
            integration_connection,
            report_id=report_id,
            action="approve",
            expected_revision=6,
            actor_app_user_id=ctx["admin"],
        )
        == "aprobado"
    )
    report = get_report(integration_connection, report_id)
    assert report is not None
    assert (report.status, report.revision, report.decided_by_display_name) == (
        "aprobado",
        7,
        "admin",
    )
    assert report.submitted_at is not None and report.decided_at is not None
    notes = list_report_notes(integration_connection, report_id)
    assert [(n.kind, n.body, n.author_display_name) for n in notes] == [
        ("cambios_solicitados", "Saca el rodal 18.", "admin")
    ]


def test_submit_needs_a_marked_polygon(
    integration_connection: Connection, ctx: dict[str, int]
) -> None:
    report_id = new_report(integration_connection, ctx)
    save_report_features(
        integration_connection,
        report_id=report_id,
        expected_revision=1,
        inputs=[FeatureInput(2, False, {}, None)],
    )
    with pytest.raises(ReportError) as raised:
        transition_report(
            integration_connection,
            report_id=report_id,
            action="submit",
            expected_revision=2,
            actor_app_user_id=ctx["operator"],
        )
    assert code(raised) == "nothing_marked"


def test_request_changes_needs_a_note(
    integration_connection: Connection, ctx: dict[str, int]
) -> None:
    report_id = submitted_report(integration_connection, ctx)
    for note, expected in (
        (None, "note_required"),
        ("   ", "note_required"),
        ("x" * 2001, "note_too_long"),
    ):
        with pytest.raises(ReportError) as raised:
            transition_report(
                integration_connection,
                report_id=report_id,
                action="request_changes",
                expected_revision=3,
                actor_app_user_id=ctx["admin"],
                note=note,
            )
        assert code(raised) == expected


def test_approve_with_an_old_revision_is_refused(
    integration_connection: Connection, ctx: dict[str, int]
) -> None:
    report_id = submitted_report(integration_connection, ctx)
    with pytest.raises(ReportError) as raised:
        transition_report(
            integration_connection,
            report_id=report_id,
            action="approve",
            expected_revision=2,
            actor_app_user_id=ctx["admin"],
        )
    assert code(raised) == "stale_revision"


def test_approved_report_is_frozen(integration_connection: Connection, ctx: dict[str, int]) -> None:
    report_id = submitted_report(integration_connection, ctx)
    transition_report(
        integration_connection,
        report_id=report_id,
        action="approve",
        expected_revision=3,
        actor_app_user_id=ctx["admin"],
    )
    with pytest.raises(ReportError) as raised:
        save_report_features(
            integration_connection, report_id=report_id, expected_revision=4, inputs=[]
        )
    assert code(raised) == "not_editable"
    with pytest.raises(ReportError) as raised:
        transition_report(
            integration_connection,
            report_id=report_id,
            action="submit",
            expected_revision=4,
            actor_app_user_id=ctx["operator"],
        )
    assert code(raised) == "invalid_transition"


def test_duplicate_copies_features_into_a_new_draft(
    integration_connection: Connection, ctx: dict[str, int]
) -> None:
    report_id = submitted_report(integration_connection, ctx)
    copy_id = duplicate_report(
        integration_connection, report_id=report_id, actor_app_user_id=ctx["operator"]
    )
    second_copy = duplicate_report(
        integration_connection, report_id=report_id, actor_app_user_id=ctx["operator"]
    )
    copy = get_report(integration_connection, copy_id)
    assert copy is not None
    assert (copy.name, copy.status, copy.revision) == ("Cosecha 2027 (copia)", "borrador", 1)
    second = get_report(integration_connection, second_copy)
    assert second is not None
    assert second.name == "Cosecha 2027 (copia 2)"
    assert len(list_report_features(integration_connection, copy_id)) == 3


def test_header_update_checks_revision_and_name(
    integration_connection: Connection, ctx: dict[str, int]
) -> None:
    report_id = new_report(integration_connection, ctx)
    new_report(integration_connection, ctx, "Otro")
    revision = update_report_header(
        integration_connection,
        report_id=report_id,
        expected_revision=1,
        name="Raleo",
        report_type="manejo",
        report_month="2026-12",
    )
    report = get_report(integration_connection, report_id)
    assert report is not None
    assert (revision, report.name, report.report_type, report.report_month) == (
        2,
        "Raleo",
        "manejo",
        "2026-12",
    )
    with pytest.raises(ReportError) as raised:
        update_report_header(
            integration_connection, report_id=report_id, expected_revision=2, name="otro"
        )
    assert code(raised) == "name_taken"


def test_delete_only_never_submitted_drafts(
    integration_connection: Connection, ctx: dict[str, int]
) -> None:
    draft = new_report(integration_connection, ctx, "Borrador")
    delete_report(integration_connection, report_id=draft)
    assert get_report(integration_connection, draft) is None
    submitted = submitted_report(integration_connection, ctx)
    with pytest.raises(ReportError) as raised:
        delete_report(integration_connection, report_id=submitted)
    assert code(raised) == "cannot_delete"


def test_list_orders_submitted_first_and_filters(
    integration_connection: Connection, ctx: dict[str, int]
) -> None:
    draft = new_report(integration_connection, ctx, "Borrador")
    submitted = submitted_report(integration_connection, ctx)
    assert [r.id for r in list_reports(integration_connection)][:1] == [submitted]
    assert [r.id for r in list_reports(integration_connection, statuses=["borrador"])] == [draft]


def test_source_polygons_come_from_the_given_snapshot(
    integration_connection: Connection, ctx: dict[str, int]
) -> None:
    sources = load_source_polygons(
        integration_connection, snapshot_id=ctx["snapshot"], ordinals=[1, 4, 99]
    )
    assert sorted(sources) == [1, 4]
    assert sources[4].is_valid is False
    assert sources[1].attributes["n_rodal"] == "17"


def test_missing_report_is_not_found(
    integration_connection: Connection, ctx: dict[str, int]
) -> None:
    assert get_report(integration_connection, 999_999) is None
    with pytest.raises(ReportError) as raised:
        save_report_features(
            integration_connection, report_id=999_999, expected_revision=1, inputs=[]
        )
    assert code(raised) == "not_found"


def submitted_report(connection: Connection, ctx: dict[str, int]) -> int:
    """A report with the rodal-17 split, submitted (revision 3)."""

    report_id = new_report(connection, ctx)
    save_report_features(
        connection, report_id=report_id, expected_revision=1, inputs=split_rodal_17()
    )
    transition_report(
        connection,
        report_id=report_id,
        action="submit",
        expected_revision=2,
        actor_app_user_id=ctx["operator"],
    )
    return report_id
