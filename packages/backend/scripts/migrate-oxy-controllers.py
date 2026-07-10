#!/usr/bin/env python3
"""Mechanical controller renames for oxyUserId ownership migration."""

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
CONTROLLERS = ROOT / "controllers"

REPLACEMENTS = [
    ("landlordProfileId", "landlordOxyUserId"),
    ("tenantProfileId", "tenantOxyUserId"),
    ("applicantProfileId", "applicantOxyUserId"),
    ("requesterProfileId", "requesterOxyUserId"),
    ("ownerProfileId", "ownerOxyUserId"),
    ("hostProfileId", "hostOxyUserId"),
    ("guestProfileId", "guestOxyUserId"),
    ("reviewerProfileId", "reviewerOxyUserId"),
    ("subjectProfileId", "subjectOxyUserId"),
    ("reporterProfileId", "reporterOxyUserId"),
    ("fromProfileId", "fromOxyUserId"),
    ("toProfileId", "toOxyUserId"),
    ("profile1Id", "oxyUser1Id"),
    ("profile2Id", "oxyUser2Id"),
    ("property.profileId", "property.oxyUserId"),
    ("parent.profileId", "parent.oxyUserId"),
    ("filters.profileId", "filters.oxyUserId"),
    ("query.profileId", "query.oxyUserId"),
    ("savedProperty.profileId", "savedProperty.oxyUserId"),
    ("createForProfile", "createForUser"),
]

SKIP = {"migrate-oxy-ownership.py", "migrate-oxy-ownership-fk-types.py", "migrate-oxy-controllers.py"}


def patch_file(path: Path) -> bool:
    text = path.read_text()
    original = text
    for old, new in REPLACEMENTS:
        text = text.replace(old, new)
    # profileId as ownership field (careful: skip comments about mass-assignment)
    text = re.sub(r"\bprofileId\b(?=\s*[=:])", "oxyUserId", text)
    text = re.sub(r"\.profileId\b", ".oxyUserId", text)
    text = re.sub(r"\{ profileId", "{ oxyUserId", text)
    if text != original:
        path.write_text(text)
        return True
    return False


def main() -> None:
    changed = []
    for path in sorted(CONTROLLERS.rglob("*.ts")):
        if patch_file(path):
            changed.append(str(path.relative_to(ROOT)))
    for extra in [ROOT / "routes" / "profiles.ts", ROOT / "routes" / "ai.ts"]:
        if extra.exists() and patch_file(extra):
            changed.append(str(extra.relative_to(ROOT)))
    print("\n".join(changed) if changed else "(none)")


if __name__ == "__main__":
    main()
