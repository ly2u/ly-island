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
5. Address syntax: the shared cases in fixtures/addresses.json, plus a few
   thousand generated strings that are run through both the schema patterns
   and the JavaScript rules (via node) and must get the same answers.

Requires: jsonschema, cryptography, and node on PATH.
"""

from __future__ import annotations

import base64
import json
import random
import re
import subprocess
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


COMMON = "https://schema.islands.invalid/0/common.schema.json"


def load_validators() -> dict[str, Draft202012Validator]:
    registry = Registry()
    documents = {}
    for path in sorted((PACKAGE / "schema").glob("*.schema.json")):
        document = json.loads(path.read_text(encoding="utf-8"))
        Draft202012Validator.check_schema(document)
        documents[path.name] = document
        registry = registry.with_resource(document["$id"], Resource.from_contents(document))
    validators = {kind: Draft202012Validator(documents[name], registry=registry) for kind, name in SCHEMAS.items()}
    for definition in ("origin", "url", "keyId"):
        validators[definition] = Draft202012Validator({"$ref": f"{COMMON}#/$defs/{definition}"}, registry=registry)
    return validators


def check_addresses(validators: dict[str, Draft202012Validator]) -> int:
    cases = json.loads((PACKAGE / "fixtures" / "addresses.json").read_text(encoding="utf-8"))["cases"]
    for case in cases:
        for definition in ("origin", "url", "keyId"):
            accepted = validators[definition].is_valid(case["value"])
            if accepted != case[definition]:
                fail(f"address {case['value']!r} ({case['note']}): schema {definition} gives {accepted}")
    return len(cases)


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


def generated_addresses(count: int = 4000) -> list[str]:
    """Deterministic address-like strings: mostly well-formed, with one
    defect injected here and there, so both outcomes are well exercised."""
    rng = random.Random(20261014)
    letters = "abcdefghijklmnopqrstuvwxyz"
    plain = letters + "0123456789"
    tricky = ["-", "_", "A", "é", ".", "%", ":", "@", " ", "xn--"]

    def label(length: int) -> str:
        text = "".join(rng.choice(plain) for _ in range(length))
        if rng.random() < 0.15:
            spot = rng.randrange(len(text) + 1)
            text = text[:spot] + rng.choice(tricky) + text[spot:]
        if rng.random() < 0.05:
            text = "xn--" + text
        return text

    def tld() -> str:
        if rng.random() < 0.8:
            return "".join(rng.choice(letters) for _ in range(rng.choice([2, 3, 4, 6, 63, 64])))
        return rng.choice(["123", "0x1", "c0m", "co-m", "", "a", "-com", "com-"])

    schemes = ["https://"] * 16 + ["http://", "HTTPS://", "https:/", "https:///"]
    suffixes = ["", "", "", "", "/", "/a/b", "?q=1", "#k1", "#k_2.x-y", "#k 1", "#" + "k" * 64, "#" + "k" * 65,
                ":443", ":8443", ".", "/笔", " ", "\n", "\\x", "/%41", "/a\\b", "/#k1", "#k1/x", "?#", "/~!$&'()*+,;=:@"]
    out = []
    for _ in range(count):
        count_labels = rng.choices([0, 1, 2, 3], weights=[1, 6, 3, 1])[0]
        lengths = [rng.choice([1, 2, 3, 5, 10, 61, 62, 63, 64]) for _ in range(count_labels)]
        host = ".".join([label(n) for n in lengths] + [tld()])
        if rng.random() < 0.03:
            host = rng.choice(["1.2.3.4", "[::1]", "[2606:4700::1]", "localhost", "example.0x1", "example.123"])
        out.append(rng.choice(schemes) + host + rng.choice(suffixes))
    return out


def check_address_differential(validators: dict[str, Draft202012Validator]) -> int:
    """Runs the JavaScript rules on the same generated strings and compares."""
    values = generated_addresses()
    oracle = PACKAGE / "scripts" / "address-oracle.mjs"
    completed = subprocess.run(
        ["node", str(oracle)], input=json.dumps(values), capture_output=True, text=True, check=True
    )
    for value, (origin, url, key_id) in zip(values, json.loads(completed.stdout)):
        expected = {"origin": origin, "url": url, "keyId": key_id}
        for definition, js_result in expected.items():
            if validators[definition].is_valid(value) != js_result:
                fail(f"address {value!r}: JavaScript {definition}={js_result}, schema disagrees")
    return len(values)


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
    addresses = check_addresses(validators)
    generated = check_address_differential(validators)
    examples = check_docs(validators)
    check_vector()
    print(
        f"schemas: {len(SCHEMAS)} documents, {fixtures} fixtures, {addresses} addresses, "
        f"{generated} generated addresses compared with JavaScript, {examples} docs examples, 1 signing vector"
    )
    if failures:
        print(f"{len(failures)} failure(s)")
        return 1
    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
