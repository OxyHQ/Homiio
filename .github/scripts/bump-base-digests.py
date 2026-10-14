"""Bump the digest-pinned base images of every reviewed production image, and re-pin.

Every production Dockerfile pins its bases by multi-arch index digest
(`FROM image:tag@sha256:...`, `COPY --from=image:tag@sha256:...`). That freezes
the base OS: a patched `node:22-bookworm-slim` reaches production only when
someone moves the digest. This script is that someone, on a schedule:

  list    print every digest-pinned base reference in the reviewed Dockerfiles,
          the digest it pins and the digest its tag resolves to today. Exit 0.
  bump    rewrite each moved digest in place, then run `reviewed-image.py pin`
          so the PR carries its own re-pin, and write a Markdown summary.

It never merges anything and never touches a tag: a new digest for the SAME tag
is the only change it makes. Moving to a new tag (a new Bun, a new Node major)
stays a human change. A tag that now resolves to a single-platform manifest
instead of an index is refused, because every pin here is an index digest and
the deploy builds linux/arm64.

The PR it feeds is an owner review like any other re-pin: the `check` step
already fails a Dockerfile change whose pin does not match, and the deploy's
`guard` refuses an unreviewed pin. Standard library only.
"""

import argparse
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

CONFIG = Path('.github/scripts/reviewed-images.json')
REVIEWED_IMAGE = Path('.github/scripts/reviewed-image.py')
INDEX_TYPES = (
    'application/vnd.oci.image.index.v1+json',
    'application/vnd.docker.distribution.manifest.list.v2+json',
)
SINGLE_TYPES = (
    'application/vnd.oci.image.manifest.v1+json',
    'application/vnd.docker.distribution.manifest.v2+json',
)
# `FROM [--platform=...] <ref> [AS name]` and `COPY --from=<ref>`; only refs that
# carry a digest are bumped. A stage name never carries one.
FROM_LINE = re.compile(r'^\s*FROM\s+(?:--platform=\S+\s+)?(?P<ref>\S+)', re.I | re.M)
COPY_FROM = re.compile(r'--from=(?P<ref>[^\s]+)')
PINNED = re.compile(r'^(?P<name>[^@\s]+):(?P<tag>[^@:/\s]+)@sha256:(?P<digest>[0-9a-f]{64})$')
ARG_LINE = re.compile(r'^\s*ARG\s+(?P<name>[A-Za-z_][A-Za-z0-9_]*)=(?P<value>\S+)\s*$', re.M)
VARIABLE = re.compile(r'\$(?:\{(?P<braced>[A-Za-z_][A-Za-z0-9_]*)\}|(?P<bare>[A-Za-z_][A-Za-z0-9_]*))')
TIMEOUT = 30


class Refused(Exception):
    pass


def dockerfiles(root):
    config = json.loads((root / CONFIG).read_text())
    seen = []
    for recipe in config['recipes']:
        path = PurePosixPath(recipe['dockerfile'])
        if path.is_absolute() or '..' in path.parts:
            raise Refused('Dockerfile path escapes the repository: ' + str(path))
        if str(path) not in seen:
            seen.append(str(path))
    return seen


def global_args(text):
    """ARG defaults declared before the first FROM: the only ones a FROM can read."""
    first = FROM_LINE.search(text)
    head = text[: first.start()] if first else text
    return {m['name']: m['value'].strip('"\'') for m in ARG_LINE.finditer(head)}


def expand(ref, args):
    def value(m):
        name = m['braced'] or m['bare']
        if name not in args:
            raise Refused('Base reference ' + ref + ' uses ' + name + ', which has no ARG default before the first FROM')
        return args[name]
    return VARIABLE.sub(value, ref)


def references(text):
    """Every digest-pinned base reference, as written, in file order, once each."""
    found = []
    for pattern in (FROM_LINE, COPY_FROM):
        for m in pattern.finditer(text):
            ref = m['ref']
            if '@sha256:' in ref and ref not in found:
                found.append(ref)
    return found


def split(ref):
    m = PINNED.match(ref)
    if not m:
        raise Refused('Cannot parse pinned reference ' + ref + ' (expected name:tag@sha256:<64 hex>)')
    return m['name'], m['tag'], m['digest']


def registry_and_repository(name):
    first, _, rest = name.partition('/')
    if rest and ('.' in first or ':' in first or first == 'localhost'):
        host, repository = first, rest
    else:
        host, repository = 'docker.io', name
    if host == 'docker.io':
        host = 'registry-1.docker.io'
        if '/' not in repository:
            repository = 'library/' + repository
    return host, repository


def bearer_challenge(header):
    if not header or not header.lower().startswith('bearer '):
        return None
    return dict(re.findall(r'(\w+)="([^"]*)"', header))


def resolve(name, tag):
    """The digest and media type `name:tag` resolves to on its registry today."""
    host, repository = registry_and_repository(name)
    url = 'https://' + host + '/v2/' + repository + '/manifests/' + urllib.parse.quote(tag, safe='')
    headers = {'Accept': ', '.join(INDEX_TYPES + SINGLE_TYPES)}

    def head(extra):
        request = urllib.request.Request(url, method='HEAD', headers={**headers, **extra})
        return urllib.request.urlopen(request, timeout=TIMEOUT)

    try:
        response = head({})
    except urllib.error.HTTPError as error:
        challenge = bearer_challenge(error.headers.get('WWW-Authenticate')) if error.code == 401 else None
        if not challenge or 'realm' not in challenge:
            raise Refused(name + ':' + tag + ': registry answered ' + str(error.code)) from None
        query = {k: v for k, v in challenge.items() if k in ('service', 'scope')}
        query.setdefault('scope', 'repository:' + repository + ':pull')
        token_url = challenge['realm'] + '?' + urllib.parse.urlencode(query)
        with urllib.request.urlopen(token_url, timeout=TIMEOUT) as token_response:
            body = json.load(token_response)
        token = body.get('token') or body.get('access_token')
        if not token:
            raise Refused(name + ':' + tag + ': the registry issued no pull token') from None
        try:
            response = head({'Authorization': 'Bearer ' + token})
        except urllib.error.HTTPError as again:
            raise Refused(name + ':' + tag + ': registry answered ' + str(again.code)) from None
    with response:
        digest = response.headers.get('Docker-Content-Digest', '')
        media_type = response.headers.get('Content-Type', '').split(';')[0].strip()
    if not re.fullmatch(r'sha256:[0-9a-f]{64}', digest):
        raise Refused(name + ':' + tag + ': the registry returned no usable digest')
    return digest.split(':', 1)[1], media_type


def survey(root, resolver=None):
    resolver = resolver or resolve
    rows = []
    for dockerfile in dockerfiles(root):
        text = (root / dockerfile).read_text()
        args = global_args(text)
        for ref in references(text):
            name, tag, pinned = split(ref)
            current, media_type = resolver(expand(name, args), expand(tag, args))
            if media_type not in INDEX_TYPES:
                raise Refused(ref + ' in ' + dockerfile + ': the tag now resolves to ' + (media_type or 'an unknown type')
                              + ', not a multi-platform index; a human has to look at this one')
            rows.append({'dockerfile': dockerfile, 'reference': ref, 'image': expand(name, args) + ':' + expand(tag, args),
                         'pinned': pinned, 'current': current})
    return rows


def rewrite(root, rows):
    moved = [r for r in rows if r['pinned'] != r['current']]
    for dockerfile in sorted({r['dockerfile'] for r in moved}):
        path = root / dockerfile
        text = path.read_text()
        for r in (r for r in moved if r['dockerfile'] == dockerfile):
            new_ref = r['reference'].replace('@sha256:' + r['pinned'], '@sha256:' + r['current'])
            # Whole references only: `node:22@...` must not match inside `x/node:22@...`.
            whole = re.compile(r'(?<=[\s=])' + re.escape(r['reference']) + r'(?=\s|$)', re.M)
            text, count = whole.subn(lambda _m, new_ref=new_ref: new_ref, text)
            if count < 1:
                raise Refused('Reference vanished while rewriting: ' + r['reference'])
        path.write_text(text)
    return moved


def repin(root):
    result = subprocess.run([sys.executable, str(REVIEWED_IMAGE), 'pin', '--root', str(root)],
                            cwd=root, capture_output=True, text=True, timeout=60, check=False)
    if result.returncode != 0:
        raise Refused('reviewed-image.py pin failed: ' + (result.stderr or result.stdout).strip())
    return json.loads(result.stdout.strip().splitlines()[-1])['repinned']


def summary(moved, repinned):
    lines = [
        '**Requires owner sign-off: do not merge without the owner\'s explicit approval.**',
        '',
        'The scheduled base-image digest bump found these tags pointing at new images. Each line is the SAME tag, so',
        'this is a rebuilt base (OS and runtime patches), not a version change. The reviewed-image pin is re-pinned in',
        'this PR so `check` passes; that re-pin is the owner\'s review of the new bases.',
        '',
        '| Dockerfile | Image | Pinned digest | New digest |',
        '|---|---|---|---|',
    ]
    for r in moved:
        lines.append('| `' + r['dockerfile'] + '` | `' + r['image'] + '` | `' + r['pinned'][:12] + '…` | `' + r['current'] + '` |')
    lines += ['', '| Recipe | Old pin | New pin |', '|---|---|---|']
    for p in repinned:
        lines.append('| `' + p['recipe'] + '` | `' + p['from'][:12] + '…` | `' + p['to'] + '` |')
    lines += [
        '',
        'Before approving: read the base image\'s release notes or changelog for the period, confirm CI\'s image build',
        'and boot test passed on this branch, and check the new digests on the registry yourself.',
    ]
    return '\n'.join(lines) + '\n'


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('phase', choices=['list', 'bump'])
    parser.add_argument('--root', default='.')
    parser.add_argument('--summary', help='bump: write the PR body here')
    args = parser.parse_args(argv)
    root = Path(args.root)
    try:
        rows = survey(root)
        if args.phase == 'list':
            for r in rows:
                print(json.dumps(r))
            return 0
        moved = rewrite(root, rows)
        if not moved:
            print(json.dumps({'moved': []}))
            return 0
        repinned = repin(root)
        if args.summary:
            Path(args.summary).write_text(summary(moved, repinned))
        print(json.dumps({'moved': moved, 'repinned': repinned}))
    except Refused as error:
        print('::error::' + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
