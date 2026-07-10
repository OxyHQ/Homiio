#!/usr/bin/env python3
"""One-shot schema field renames: profileId/*ProfileId -> oxyUserId/*OxyUserId."""

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
SCHEMAS = ROOT / "models" / "schemas"

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
    ("profileId", "oxyUserId"),
]

# Ownership FK blocks: ObjectId ref Profile -> String
OWNERSHIP_FIELDS = {
    "oxyUserId",
    "landlordOxyUserId",
    "tenantOxyUserId",
    "applicantOxyUserId",
    "requesterOxyUserId",
    "ownerOxyUserId",
    "hostOxyUserId",
    "guestOxyUserId",
    "reviewerOxyUserId",
    "subjectOxyUserId",
    "reporterOxyUserId",
    "fromOxyUserId",
    "toOxyUserId",
}

OBJECTID_BLOCK = re.compile(
    r"(\s+)({field}):\s*\{{\s*"
    r"type:\s*mongoose\.Schema\.Types\.ObjectId,\s*"
    r"ref:\s*'Profile',\s*"
    r"(required:[^\n]+,?\s*)?"
    r"\}}",
    re.MULTILINE,
)


def patch_file(path: Path) -> bool:
    text = path.read_text()
    original = text
    for old, new in REPLACEMENTS:
        text = text.replace(old, new)
    for field in OWNERSHIP_FIELDS:
        pattern = OBJECTID_BLOCK.pattern.replace("{field}", field)
        text = re.sub(
            pattern,
            rf"\1{field}: {{\n\1  type: String,\n\1  \3}}",
            text,
        )
    if text != original:
        path.write_text(text)
        return True
    return False


def main() -> None:
    changed = []
    for path in sorted(SCHEMAS.glob("*.ts")):
        if path.name == "ProfileSchema.ts":
            continue
        if patch_file(path):
            changed.append(path.name)
    print("Patched:", ", ".join(changed) or "(none)")


if __name__ == "__main__":
    main()
