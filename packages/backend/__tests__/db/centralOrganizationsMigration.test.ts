import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import postgres from 'postgres';
import { createTestDatabase, dropTestDatabase } from '@oxy.so/db/testing';
import { runMigrations } from '@oxy.so/db/migrate';
import { findMigrationsFolder } from '../../db/migrate';
import { ensureExtensions } from '../../db/extensions';

async function through(url: string, tag: string, run: 'all' | 'pre' | 'post' = 'all') {
  const original = findMigrationsFolder();
  const journal = JSON.parse(readFileSync(join(original, 'meta/_journal.json'), 'utf8'));
  const end = journal.entries.findIndex((entry: { tag: string }) => entry.tag === tag);
  if (end < 0) throw new Error('Missing historical migration');
  const entries: { tag: string }[] = journal.entries.slice(0, end + 1);
  const folder = mkdtempSync(join(tmpdir(), 'homiio-agency-migration-'));
  try {
    mkdirSync(join(folder, 'meta'));
    writeFileSync(join(folder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
    for (const entry of entries)
      copyFileSync(join(original, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
    const database = new URL(url).pathname.slice(1);
    await ensureExtensions(url, database);
    await runMigrations({
      databaseUrl: url,
      migrationsFolder: folder,
      extensions: [],
      run,
      expectedDatabase: database,
      dryRun: false,
      logger: { info: () => undefined, debug: () => undefined },
    });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

it('preserves unresolved source references, freezes identity writers and permits canonical references through the rollout', async () => {
  const adminUrl = process.env.TEST_DATABASE_URL;
  if (!adminUrl) throw new Error('TEST_DATABASE_URL required');
  const url = await createTestDatabase({
    adminUrl,
    migrate: async (target) => through(target, '0030_placeholder_region_merge'),
  });
  const db = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    await db`insert into agencies(id,name,normalized_name,slug) values ('legacy','An observed agency','an observed agency','legacy-slug'),('generic','OpenRent landlord','openrent landlord','generic-slug')`;
    await db`insert into countries(id,name,code) values ('country','Test country','ES')`;
    await db`insert into regions(id,country_id,name) values ('region','country','Test region')`;
    await db`insert into cities(id,country_id,region_id,name) values ('city','country','region','Test city')`;
    await db`insert into addresses(id,country_id,region_id,city_id,country_code,street,postal_code,longitude,latitude) values ('address','country','region','city','ES','Test street','08001',2,41)`;
    await db`insert into properties(id,address_id,agency_id,title,oxy_user_id) values ('historical-listing','address','legacy','Original source listing','source-owner')`;
    await db`insert into eviction_organizations(id,name,normalized_name,description,public_channels,verified_at,verification_source) values ('support','Housing collective','housing collective','Tenant support','[]',now(),'Public contact channel check')`;
    await through(url, '0032_retire_local_organization_identity', 'pre');
    expect(
      await db`select agency_id,observed_name from agency_identity_archives order by agency_id`,
    ).toEqual([
      { agency_id: 'generic', observed_name: 'OpenRent landlord' },
      { agency_id: 'legacy', observed_name: 'An observed agency' },
    ]);
    await expect(db`update agencies set name='Independent edit' where id='legacy'`).rejects.toThrow(
      'owned by Oxy',
    );
    await expect(
      db`insert into agencies(id,name,normalized_name,slug) values ('old','Old writer','old writer','old')`,
    ).rejects.toThrow('canonical Oxy');
    await db`insert into agencies(id,slug,oxy_account_id,identity_status) values ('new','canonical-reference','oxy-company','linked')`;
    await db`update agencies set identity_status='not_organization' where id='generic'`;
    await expect(
      db`update eviction_organizations set name='Local rename' where id='support'`,
    ).rejects.toThrow('owned by Oxy');
    await db`insert into eviction_organizations(id,oxy_account_id,identity_status) values ('new-support','oxy-company','linked')`;
    await through(url, '0032_retire_local_organization_identity', 'post');
    expect(
      await db`select organization_id,observed_name from eviction_organization_identity_archives`,
    ).toEqual([{ organization_id: 'support', observed_name: 'Housing collective' }]);
    expect(
      await db`select description,verification_source,identity_status from eviction_organizations where id='support'`,
    ).toEqual([
      {
        description: 'Tenant support',
        verification_source: 'Public contact channel check',
        identity_status: 'unresolved',
      },
    ]);
    await expect(db`delete from eviction_organization_identity_archives`).rejects.toThrow(
      'immutable',
    );
    expect(
      await db`select id,slug,identity_status,oxy_account_id from agencies order by id`,
    ).toEqual([
      {
        id: 'generic',
        slug: 'generic-slug',
        identity_status: 'not_organization',
        oxy_account_id: null,
      },
      { id: 'legacy', slug: 'legacy-slug', identity_status: 'unresolved', oxy_account_id: null },
      {
        id: 'new',
        slug: 'canonical-reference',
        identity_status: 'linked',
        oxy_account_id: 'oxy-company',
      },
    ]);
    expect(await db`select agency_id from properties where id='historical-listing'`).toEqual([
      { agency_id: 'legacy' },
    ]);
    expect(
      await db`select column_name from information_schema.columns where table_schema='public' and table_name='agencies' and column_name in ('name','normalized_name')`,
    ).toEqual([]);
    await expect(db`update agency_identity_archives set observed_name='Changed'`).rejects.toThrow(
      'immutable',
    );
    await expect(db`delete from agency_identity_archives`).rejects.toThrow('immutable');
    await expect(
      db`update agencies set identity_status='linked' where id='legacy'`,
    ).rejects.toThrow();
    // The automatic deploy post phase precedes the reviewed backfill: source extraction remains available.
    expect(
      await db`select a.id,e.observed_name,count(p.id)::int as source_count from agencies a join agency_identity_archives e on e.agency_id=a.id left join properties p on p.agency_id=a.id where a.id='legacy' group by a.id,e.observed_name`,
    ).toEqual([{ id: 'legacy', observed_name: 'An observed agency', source_count: 1 }]);
    await db`update agencies set identity_status='linked',oxy_account_id='resolved-later' where id='legacy'`;
  } finally {
    await db.end();
    await dropTestDatabase(url);
  }
}, 180_000);
