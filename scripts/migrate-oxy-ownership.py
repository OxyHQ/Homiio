#!/usr/bin/env python3
"""Bulk schema + backend renames for oxyUserId ownership migration."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BE = ROOT / "packages" / "backend"
ST = ROOT / "packages" / "shared-types" / "src"

SCHEMA_REPLACEMENTS = [
    # Property
    (
        "profileId: {\n    type: mongoose.Schema.Types.ObjectId,\n    ref: 'Profile',\n    required: function(this: any) { return !this.isExternal; },",
        "oxyUserId: {\n    type: String,\n    required: function(this: any) { return !this.isExternal; },",
    ),
    ("propertySchema.index({ profileId: 1, status: 1 });", "propertySchema.index({ oxyUserId: 1, status: 1 });"),
    ("propertySchema.index({ profileId: 1, createdAt: -1 });", "propertySchema.index({ oxyUserId: 1, createdAt: -1 });"),
    ("if (this.profileId) {\n      this.profileId = undefined;", "if (this.oxyUserId) {\n      this.oxyUserId = undefined;"),
    ("profileId: ObjectIdLike,", "oxyUserId: string,"),
    ("return this.find({ profileId, status:", "return this.find({ oxyUserId, status:"),
    # Lease
    ("landlordProfileId:", "landlordOxyUserId:"),
    ("tenantProfileId:", "tenantOxyUserId:"),
    ("leaseSchema.index({ landlordProfileId:", "leaseSchema.index({ landlordOxyUserId:"),
    ("leaseSchema.index({ tenantProfileId:", "leaseSchema.index({ tenantOxyUserId:"),
    ("findByTenant = function(tenantProfileId:", "findByTenant = function(tenantOxyUserId:"),
    ("findByLandlord = function(landlordProfileId:", "findByLandlord = function(landlordOxyUserId:"),
    ("return this.find({ tenantProfileId }", "return this.find({ tenantOxyUserId }"),
    ("return this.find({ landlordProfileId }", "return this.find({ landlordOxyUserId }"),
    # Saved / recent / folders / searches
    ("profileId: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile', required: true, index: true },", "oxyUserId: { type: String, required: true, index: true },"),
    ("profileId: {\n    type: mongoose.Schema.Types.ObjectId,\n    ref: 'Profile',\n    required: true,\n    index: true,\n  },", "oxyUserId: {\n    type: String,\n    required: true,\n    index: true,\n  },"),
    ("recentlyViewedSchema.index({ profileId:", "recentlyViewedSchema.index({ oxyUserId:"),
    ("savedSearchSchema.index({ profileId:", "savedSearchSchema.index({ oxyUserId:"),
    ("savedPropertyFolderSchema.index({ profileId:", "savedPropertyFolderSchema.index({ oxyUserId:"),
    # Tenant application
    ("applicantProfileId:", "applicantOxyUserId:"),
    ("landlordProfileId:", "landlordOxyUserId:"),
    # Viewing
    ("requesterProfileId:", "requesterOxyUserId:"),
    ("ownerProfileId:", "ownerOxyUserId:"),
    # Roommate
    ("fromProfileId:", "fromOxyUserId:"),
    ("toProfileId:", "toOxyUserId:"),
    ("profile1Id:", "participant1OxyUserId:"),
    ("profile2Id:", "participant2OxyUserId:"),
    # Reservation / exchange
    ("guestProfileId:", "guestOxyUserId:"),
    ("hostProfileId:", "hostOxyUserId:"),
    ("reviewerProfileId:", "reviewerOxyUserId:"),
    ("subjectProfileId:", "subjectOxyUserId:"),
    ("reporterProfileId:", "reporterOxyUserId:"),
]

# Co-tenant in lease schema
CO_TENANT = (
    "    profileId: {\n      type: mongoose.Schema.Types.ObjectId,\n      ref: 'Profile',\n      required: true\n    },",
    "    oxyUserId: {\n      type: String,\n      required: true\n    },",
)


def patch_file(path: Path, replacements: list[tuple[str, str]]) -> bool:
    if not path.exists():
        return False
    text = path.read_text()
    orig = text
    for old, new in replacements:
        text = text.replace(old, new)
    if CO_TENANT[0] in text:
        text = text.replace(CO_TENANT[0], CO_TENANT[1])
    # Fix lease/applicant ObjectId refs left as Profile ref for oxy fields
    for field in (
        "landlordOxyUserId", "tenantOxyUserId", "applicantOxyUserId",
        "requesterOxyUserId", "ownerOxyUserId", "guestOxyUserId", "hostOxyUserId",
    ):
        text = re.sub(
            rf"({field}: \{{\n    type: )mongoose\.Schema\.Types\.ObjectId,\n    ref: 'Profile',",
            r"\1String,",
            text,
        )
    if text != orig:
        path.write_text(text)
        print(f"patched {path.relative_to(ROOT)}")
        return True
    return False


def main() -> None:
    schema_dir = BE / "models" / "schemas"
    for p in schema_dir.glob("*.ts"):
        patch_file(p, SCHEMA_REPLACEMENTS)

    # Property.ts model duplicate
    patch_file(BE / "models" / "Property.ts", SCHEMA_REPLACEMENTS)
    patch_file(BE / "models" / "Review.ts", [("profileId:", "oxyUserId:")])

    # shared-types
    for p in [ST / "property.ts", ST / "lease.ts", ST / "review.ts"]:
        if p.exists():
            t = p.read_text()
            t2 = t.replace("profileId", "oxyUserId")
            if t2 != t:
                p.write_text(t2)
                print(f"patched {p.relative_to(ROOT)}")

    print("done")


if __name__ == "__main__":
    main()
