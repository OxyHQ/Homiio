#!/usr/bin/env python3
"""Convert remaining Profile ObjectId ownership FKs to String."""

from pathlib import Path
import re

SCHEMAS = Path(__file__).resolve().parents[1] / "models" / "schemas"

INLINE = re.compile(
    r"oxyUserId:\s*\{\s*type:\s*mongoose\.Schema\.Types\.ObjectId,\s*ref:\s*'Profile',\s*required:\s*true,\s*index:\s*true\s*\}"
)
INLINE_REPL = "oxyUserId: { type: String, required: true, index: true }"

MULTI = re.compile(
    r"(\w+OxyUserId):\s*\{\s*type:\s*mongoose\.Schema\.Types\.ObjectId,\s*ref:\s*'Profile',\s*required:\s*([^\}]+)\}",
    re.MULTILINE,
)


def patch(text: str) -> str:
    text = INLINE.sub(INLINE_REPL, text)
    text = MULTI.sub(r"\1: { type: String, required: \2 }", text)
    # ConversationSchema profileId was renamed to oxyUserId but may still be ObjectId
    text = re.sub(
        r"oxyUserId:\s*\{\s*type:\s*mongoose\.Schema\.Types\.ObjectId,\s*ref:\s*'Profile',\s*required:\s*([^\}]+)\}",
        r"oxyUserId: { type: String, required: \1 }",
        text,
    )
    # SavedSearch interface line
    text = text.replace("oxyUserId: Types.ObjectId;", "oxyUserId: string;")
    return text


def main() -> None:
    for path in sorted(SCHEMAS.glob("*.ts")):
        if path.name == "ProfileSchema.ts":
            continue
        original = path.read_text()
        updated = patch(original)
        if updated != original:
            path.write_text(updated)
            print("fixed", path.name)


if __name__ == "__main__":
    main()
