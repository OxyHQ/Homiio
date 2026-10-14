"""Fixture tests for bump-base-digests.py. No network: the registry is faked."""

import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('bump', HERE / 'bump-base-digests.py')
bump = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bump)

OLD_NODE = 'a' * 64
NEW_NODE = 'b' * 64
OLD_BUN = 'c' * 64
NEW_BUN = 'd' * 64
INDEX = bump.INDEX_TYPES[0]

DOCKERFILE = f"""ARG BUN_VERSION=1.4.3
FROM oven/bun:${{BUN_VERSION}}-slim@sha256:{OLD_BUN} AS bun-bin
FROM --platform=linux/arm64 node:22-bookworm-slim@sha256:{OLD_NODE} AS builder
COPY --from=oven/bun:1.4.3@sha256:{OLD_BUN} /usr/local/bin/bun /usr/local/bin/bun
FROM builder AS runtime
COPY --from=builder /app /app
"""


def fake(table):
    def resolver(name, tag):
        return table[name + ':' + tag]
    return resolver


class Fixture(unittest.TestCase):
    def setUp(self):
        # reviewed-image.py refuses a configuration for another repository when
        # GITHUB_REPOSITORY is set, as it always is in Actions. The fixture is
        # its own repository, so the variable is cleared for this process and
        # every child it starts.
        saved = os.environ.pop('GITHUB_REPOSITORY', None)
        if saved is not None:
            self.addCleanup(os.environ.__setitem__, 'GITHUB_REPOSITORY', saved)
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root)
        (self.root / '.github/scripts').mkdir(parents=True)
        shutil.copy(HERE / 'reviewed-image.py', self.root / '.github/scripts/reviewed-image.py')
        (self.root / 'Dockerfile').write_text(DOCKERFILE)
        subprocess.run(['git', 'init', '-q'], cwd=self.root, check=True)
        config = {'repository': 'OxyHQ/Example', 'recipes': [{
            'name': 'example', 'ecrRepository': 'oxy/example', 'dockerfile': 'Dockerfile',
            'context': '.', 'target': None, 'buildInputsSha256': '0' * 64}]}
        (self.root / bump.CONFIG).write_text(json.dumps(config, indent=2) + '\n')
        self.table = {
            'oven/bun:1.4.3-slim': (OLD_BUN, INDEX),
            'node:22-bookworm-slim': (OLD_NODE, INDEX),
            'oven/bun:1.4.3': (OLD_BUN, INDEX),
        }


class Survey(Fixture):
    def test_finds_every_pinned_reference_once_and_skips_stage_names(self):
        rows = bump.survey(self.root, fake(self.table))
        self.assertEqual([r['image'] for r in rows], ['oven/bun:1.4.3-slim', 'node:22-bookworm-slim', 'oven/bun:1.4.3'])

    def test_expands_global_args_for_resolution_only(self):
        rows = bump.survey(self.root, fake(self.table))
        self.assertEqual(rows[0]['reference'], f'oven/bun:${{BUN_VERSION}}-slim@sha256:{OLD_BUN}')

    def test_refuses_an_arg_with_no_default(self):
        (self.root / 'Dockerfile').write_text(f'FROM oven/bun:${{NOPE}}@sha256:{OLD_BUN}\n')
        with self.assertRaises(bump.Refused):
            bump.survey(self.root, fake(self.table))

    def test_refuses_a_tag_that_is_no_longer_an_index(self):
        self.table['node:22-bookworm-slim'] = (NEW_NODE, bump.SINGLE_TYPES[0])
        with self.assertRaises(bump.Refused):
            bump.survey(self.root, fake(self.table))

    def test_registry_mapping(self):
        self.assertEqual(bump.registry_and_repository('node'), ('registry-1.docker.io', 'library/node'))
        self.assertEqual(bump.registry_and_repository('oven/bun'), ('registry-1.docker.io', 'oven/bun'))
        self.assertEqual(bump.registry_and_repository('docker.io/searxng/searxng'), ('registry-1.docker.io', 'searxng/searxng'))
        self.assertEqual(bump.registry_and_repository('mcr.microsoft.com/playwright'), ('mcr.microsoft.com', 'playwright'))


class Rewrite(Fixture):
    def test_nothing_moved_changes_nothing(self):
        before = (self.root / 'Dockerfile').read_text()
        moved = bump.rewrite(self.root, bump.survey(self.root, fake(self.table)))
        self.assertEqual(moved, [])
        self.assertEqual((self.root / 'Dockerfile').read_text(), before)

    def test_moves_only_the_digest_and_keeps_the_tag_text(self):
        self.table['node:22-bookworm-slim'] = (NEW_NODE, INDEX)
        self.table['oven/bun:1.4.3-slim'] = (NEW_BUN, INDEX)
        moved = bump.rewrite(self.root, bump.survey(self.root, fake(self.table)))
        text = (self.root / 'Dockerfile').read_text()
        self.assertEqual(len(moved), 2)
        self.assertIn(f'FROM --platform=linux/arm64 node:22-bookworm-slim@sha256:{NEW_NODE} AS builder', text)
        self.assertIn(f'FROM oven/bun:${{BUN_VERSION}}-slim@sha256:{NEW_BUN} AS bun-bin', text)
        # The same digest under a different tag that did NOT move stays put.
        self.assertIn(f'COPY --from=oven/bun:1.4.3@sha256:{OLD_BUN} ', text)
        self.assertNotIn(OLD_NODE, text)

    def test_rewrites_whole_references_only(self):
        (self.root / 'Dockerfile').write_text(f'FROM node:22-bookworm-slim@sha256:{OLD_NODE}\n'
                                              f'FROM mirror/node:22-bookworm-slim@sha256:{OLD_NODE}\n')
        self.table['node:22-bookworm-slim'] = (NEW_NODE, INDEX)
        self.table['mirror/node:22-bookworm-slim'] = (OLD_NODE, INDEX)
        bump.rewrite(self.root, bump.survey(self.root, fake(self.table)))
        text = (self.root / 'Dockerfile').read_text()
        self.assertIn(f'FROM node:22-bookworm-slim@sha256:{NEW_NODE}', text)
        self.assertIn(f'FROM mirror/node:22-bookworm-slim@sha256:{OLD_NODE}', text)

    def test_repin_makes_check_pass(self):
        self.table['node:22-bookworm-slim'] = (NEW_NODE, INDEX)
        bump.rewrite(self.root, bump.survey(self.root, fake(self.table)))
        repinned = bump.repin(self.root)
        self.assertEqual([p['recipe'] for p in repinned], ['example'])
        result = subprocess.run([sys.executable, '.github/scripts/reviewed-image.py', 'pin'], cwd=self.root,
                                capture_output=True, text=True, check=True)
        self.assertEqual(json.loads(result.stdout)['repinned'], [])

    def test_bump_command_rewrites_repins_and_writes_the_body(self):
        self.table['node:22-bookworm-slim'] = (NEW_NODE, INDEX)
        original = bump.resolve
        bump.resolve = fake(self.table)
        self.addCleanup(setattr, bump, 'resolve', original)
        body = self.root / 'body.md'
        self.assertEqual(bump.main(['bump', '--root', str(self.root), '--summary', str(body)]), 0)
        check = subprocess.run([sys.executable, '.github/scripts/reviewed-image.py', 'pin'], cwd=self.root,
                               capture_output=True, text=True, check=True)
        self.assertEqual(json.loads(check.stdout)['repinned'], [])
        self.assertNotEqual(json.loads((self.root / bump.CONFIG).read_text())['recipes'][0]['buildInputsSha256'], '0' * 64)
        self.assertIn(NEW_NODE, body.read_text())

    def test_summary_carries_the_signoff_banner(self):
        text = bump.summary([{'dockerfile': 'Dockerfile', 'image': 'node:22', 'pinned': OLD_NODE, 'current': NEW_NODE}],
                            [{'recipe': 'example', 'from': '0' * 64, 'to': '1' * 64}])
        self.assertIn('do not merge without the owner', text)
        self.assertIn(NEW_NODE, text)


if __name__ == '__main__':
    unittest.main()
