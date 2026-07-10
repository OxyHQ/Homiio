#!/usr/bin/env python3
"""Bulk controller/service renames for oxyUserId ownership."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
BE = ROOT / "packages" / "backend"

SKIP = {
    "ProfileSchema.ts",
    "seedProperties.ts",
}

REPLACEMENTS = [
    ("landlordProfileId", "landlordOxyUserId"),
    ("tenantProfileId", "tenantOxyUserId"),
    ("applicantProfileId", "applicantOxyUserId"),
    ("requesterProfileId", "requesterOxyUserId"),
    ("ownerProfileId", "ownerOxyUserId"),
    ("guestProfileId", "guestOxyUserId"),
    ("hostProfileId", "hostOxyUserId"),
    ("fromProfileId", "fromOxyUserId"),
    ("toProfileId", "toOxyUserId"),
    ("reviewerProfileId", "reviewerOxyUserId"),
    ("subjectProfileId", "subjectOxyUserId"),
    ("reporterProfileId", "reporterOxyUserId"),
    ("participant1Id", "participant1OxyUserId"),
    ("participant2Id", "participant2OxyUserId"),
    ("profile1Id", "participant1OxyUserId"),
    ("profile2Id", "participant2OxyUserId"),
    ("'coTenants.profileId'", "'coTenants.oxyUserId'"),
    ("coTenants.profileId", "coTenants.oxyUserId"),
]

# property ownership field renames (careful with route params)
PROPERTY_FIELD = [
    ("property.profileId", "property.oxyUserId"),
    ("Property.find({ profileId:", "Property.find({ oxyUserId:"),
    ("Property.countDocuments({ profileId:", "Property.countDocuments({ oxyUserId:"),
    ("{ profileId: activeProfile._id", "{ oxyUserId"),
    ("{ profileId: oxyUserId", "{ oxyUserId"),
    ("profileId: activeProfile._id", "oxyUserId"),
    ("Saved.find({ profileId:", "Saved.find({ oxyUserId:"),
    ("Saved.findOne({ profileId:", "Saved.findOne({ profileId:"),  # fix below
    ("RecentlyViewed.find({ profileId:", "RecentlyViewed.find({ oxyUserId:"),
    ("RecentlyViewed.countDocuments({ profileId:", "RecentlyViewed.countDocuments({ oxyUserId:"),
    ("SavedSearch.find({ profileId:", "SavedSearch.find({ oxyUserId:"),
    ("SavedPropertyFolder.find({ profileId:", "SavedPropertyFolder.find({ oxyUserId:"),
    ("Review.find({ profileId", "Review.find({ oxyUserId"),
    ("Review.countDocuments({ profileId", "Review.countDocuments({ oxyUserId"),
]


def patch_text(text: str, path: str) -> str:
    for a, b in REPLACEMENTS:
        text = text.replace(a, b)
    for a, b in PROPERTY_FIELD:
        text = text.replace(a, b)
    # Saved findOne remaining profileId keys
    text = re.sub(
        r"Saved\.findOne\(\{ profileId:",
        "Saved.findOne({ oxyUserId:",
        text,
    )
    text = re.sub(
        r"Saved\.deleteOne\(\{ profileId:",
        "Saved.deleteOne({ oxyUserId:",
        text,
    )
    text = re.sub(
        r"\$set: \{ profileId:",
        "$set: { oxyUserId:",
        text,
    )
    # routes: exchange reviews by oxy user id
    if "routes/profiles.ts" in path:
        text = text.replace("/:profileId/exchange-reviews", "/:oxyUserId/exchange-reviews")
    return text


def main() -> None:
    for p in BE.rglob("*.ts"):
        if p.name in SKIP:
            continue
        if "__tests__" in p.parts and "integration" not in str(p):
            pass  # still patch unit tests if any
        text = p.read_text()
        new = patch_text(text, str(p))
        if new != text:
            p.write_text(new)
            print(f"patched {p.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
