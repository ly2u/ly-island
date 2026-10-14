#!/usr/bin/env python3
"""Second, independent implementation of the islands/0 checks.

1. Every JSON Schema is itself valid (draft 2020-12).
2. fixtures/cases.json: valid cases pass the schemas; "schema" layer cases
   fail them; "rules" layer cases pass them (those rules live in the
   protocol core, which the JavaScript tests check).
3. The JSON examples in docs/protocol-v0.md pass the schemas, and the signed
   examples verify with the example key, using Python's own canonical JSON
   and Ed25519 (the cryptography package).
4. The committed signing vector verifies.

Requires: jsonschema, cryptography.
"""

from __future__ import annotations

import base64
import json
import re
import sys
from pathlib import Path

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

PACKAGE = Path(__file__).resolve().parent.parent
REPO = PACKAGE.parent.parent
SCHEMAS = {
    "activity": "activity.schema.json",
    "manifest": "manifest.schema.json",
    "outbox": "outbox.schema.json",
    "friends": "friends.schema.json",
    "keylog": "keylog.schema.json",
}

failures: list[str] = []


def fail(message: str) -> None:
    failures.append(message)
    print(f"FAIL {message}")


def load_validators() -> dict[str, Draft202012Validator]:
    registry = Registry()
    documents = {}
    for path in sorted((PACKAGE / "schema").glob("*.schema.json")):
        document = json.loads(path.read_text(encoding="utf-8"))
        Draft202012Validator.check_schema(document)
        documents[path.name] = document
        registry = registry.with_resource(document["$id"], Resource.from_contents(document))
    return {kind: Draft202012Validator(documents[name], registry=registry) for kind, name in SCHEMAS.items()}


def schema_errors(validators: dict[str, Draft202012Validator], kind: str, data: object) -> list[str]:
    return [f"{'/'.join(map(str, error.absolute_path))}: {error.message}" for error in validators[kind].iter_errors(data)]


def check_fixtures(validators: dict[str, Draft202012Validator]) -> int:
    cases = json.loads((PACKAGE / "fixtures" / "cases.json").read_text(encoding="utf-8"))["cases"]
    for case in cases:
        errors = schema_errors(validators, case["kind"], case["data"])
        label = f"fixture {case['kind']}: {case['name']}"
        rejects = case["expect"] == "invalid" and case["layer"] == "schema"
        if rejects and not errors:
            fail(f"{label}: the schema should reject it")
        if not rejects and errors:
            fail(f"{label}: the schema should accept it: {errors[:3]}")
    return len(cases)


def canonical(value: object) -> str:
    """RFC 8785 for the data the examples use: no floating-point numbers."""
    if value is None or isinstance(value, bool):
        return json.dumps(value)
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        raise ValueError("floating-point numbers are not used in the examples")
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list):
        return "[" + ",".join(canonical(item) for item in value) + "]"
    if isinstance(value, dict):
        names = sorted(value, key=lambda name: name.encode("utf-16-be"))
        return "{" + ",".join(f"{json.dumps(name, ensure_ascii=False)}:{canonical(value[name])}" for name in names) + "}"
    raise TypeError(f"not JSON data: {type(value).__name__}")


def b64url(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def verifies(activity: dict, public_key: bytes) -> bool:
    unsigned = {name: value for name, value in activity.items() if name != "proof"}
    try:
        Ed25519PublicKey.from_public_bytes(public_key).verify(
            b64url(activity["proof"]["value"]), canonical(unsigned).encode("utf-8")
        )
        return True
    except InvalidSignature:
        return False


def check_docs(validators: dict[str, Draft202012Validator]) -> int:
    text = (REPO / "docs" / "protocol-v0.md").read_text(encoding="utf-8")
    examples = [json.loads(block) for block in re.findall(r"```json\n(.*?)```", text, flags=re.S)]
    manifest = next(example for example in examples if "keys" in example and "protocol" in example)
    keys = {key["id"]: b64url(key["publicKey"]) for key in manifest["keys"]}
    for example in examples:
        if "keys" in example:
            kind = "manifest"
        elif str(example.get("id", "")).endswith("outbox.json"):
            kind = "outbox"
        elif str(example.get("id", "")).endswith("friends.json"):
            kind = "friends"
        else:
            kind = "activity"
        errors = schema_errors(validators, kind, example)
        if errors:
            fail(f"docs example {kind} {example.get('id')}: {errors[:3]}")
        if kind == "activity" and not verifies(example, keys[example["proof"]["key"]]):
            fail(f"docs example {example['id']}: signature does not verify")
    return len(examples)


def check_vector() -> None:
    vector = json.loads((PACKAGE / "fixtures" / "vectors" / "signing.json").read_text(encoding="utf-8"))
    if canonical(vector["unsigned"]) != vector["canonical"]:
        fail("signing vector: canonical form differs")
    signed = {**vector["unsigned"], "proof": {"key": vector["keyId"], "value": vector["signature"]}}
    if not verifies(signed, b64url(vector["publicKey"])):
        fail("signing vector: signature does not verify")


def main() -> int:
    validators = load_validators()
    fixtures = check_fixtures(validators)
    examples = check_docs(validators)
    check_vector()
    print(f"schemas: {len(SCHEMAS)} documents, {fixtures} fixtures, {examples} docs examples, 1 signing vector")
    if failures:
        print(f"{len(failures)} failure(s)")
        return 1
    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
