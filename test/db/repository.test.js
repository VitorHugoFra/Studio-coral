const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Database } = require('../../src/db/Database');
const { defineTable, isUuid, scopeId, NIL_UUID } = require('../../src/db/mapper');
const { Repository } = require('../../src/db/repositories/base');

const things = defineTable({
  name: 'things',
  columns: ['name', 'price', 'data', 'tags', 'active', 'label'],
  json: ['data'],
  numeric: ['price'],
  hidden: ['secret'],
  unique: { things_name: 'Esse nome já existe.' },
});

class ThingsRepo extends Repository {
  constructor(db) {
    super(db, things);
  }

  beforeWrite(data) {
    return data.name !== undefined ? { ...data, secret: data.name.toUpperCase() } : data;
  }
}

describe('mapeamento e repositório base', () => {
  let db;
  let repo;
  before(async () => {
    db = await Database.open({ pgliteDir: 'memory://' });
    await db.exec(`CREATE TABLE things (
      id uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz,
      name text NOT NULL, price numeric(12,2), data jsonb, tags text[] NOT NULL DEFAULT '{}',
      active boolean NOT NULL DEFAULT true, label text NOT NULL DEFAULT 'padrão', secret text,
      CONSTRAINT things_name UNIQUE (name))`);
    repo = new ThingsRepo(db);
  });
  after(() => db.close());

  it('isUuid e scopeId', () => {
    assert.equal(isUuid('8e5ff564-1299-4909-9c35-f414fed26f24'), true);
    assert.equal(isUuid('nao-e-uuid'), false);
    assert.equal(isUuid(null), false);
    assert.equal(scopeId(''), null);
    assert.equal(scopeId(undefined), null);
    assert.equal(scopeId('xyz'), NIL_UUID);
    assert.equal(scopeId('8e5ff564-1299-4909-9c35-f414fed26f24'), '8e5ff564-1299-4909-9c35-f414fed26f24');
  });

  it('create devolve camelCase, datas ISO, números, JSON e padrões; esconde colunas internas', async () => {
    const t = await repo.create({ name: 'Pizza', price: 39.9, data: [{ a: 1 }], tags: ['x', 'y'] });
    assert.ok(isUuid(t.id));
    assert.match(t.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal(t.updatedAt, null);
    assert.equal(t.price, 39.9);
    assert.deepEqual(t.data, [{ a: 1 }]);
    assert.deepEqual(t.tags, ['x', 'y']);
    assert.equal(t.active, true);
    assert.equal(t.label, 'padrão');
    assert.equal(t.secret, undefined);
    assert.equal((await db.one('SELECT secret FROM things WHERE id = $1', [t.id])).secret, 'PIZZA');
  });

  it('mantém id e createdAt informados', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const t = await repo.create({ id, name: 'Antiga', createdAt: '2026-01-02T03:04:05.000Z' });
    assert.equal(t.id, id);
    assert.equal(t.createdAt, '2026-01-02T03:04:05.000Z');
  });

  it('recusa campo desconhecido', async () => {
    await assert.rejects(repo.create({ name: 'X', inventado: 1 }), /Campo desconhecido em things: inventado/);
  });

  it('insertMany usa DEFAULT nos campos ausentes e grava em lotes', async () => {
    const rows = await repo.insertMany([{ name: 'A1', label: 'com rótulo' }, { name: 'A2' }]);
    assert.deepEqual(rows.map((r) => r.label), ['com rótulo', 'padrão']);
    const many = Array.from({ length: 1201 }, (_, i) => ({ name: `lote-${i}`, price: i }));
    assert.equal((await repo.insertMany(many)).length, 1201);
    assert.equal((await db.one("SELECT count(*)::int AS n FROM things WHERE name LIKE 'lote-%'")).n, 1201);
  });

  it('insertMany com onConflict ignora os repetidos', async () => {
    const rows = await repo.insertMany([{ name: 'A1' }, { name: 'Nova' }], { onConflict: 'ON CONFLICT (name) DO NOTHING' });
    assert.deepEqual(rows.map((r) => r.name), ['Nova']);
    assert.equal(await repo.create({ name: 'Nova' }, { onConflict: 'ON CONFLICT (name) DO NOTHING' }), null);
  });

  it('update grava, marca updatedAt e copia no objeto recebido', async () => {
    const t = await repo.create({ name: 'Original', price: 10 });
    const updated = await repo.update(t, { name: 'Renomeado', data: { ok: true } });
    assert.equal(updated.name, 'Renomeado');
    assert.ok(updated.updatedAt);
    assert.equal(t.name, 'Renomeado');
    assert.deepEqual(t.data, { ok: true });
    assert.equal((await db.one('SELECT secret FROM things WHERE id = $1', [t.id])).secret, 'RENOMEADO');
    assert.equal((await repo.update(t.id, { price: 12.5 })).price, 12.5);
  });

  it('get, update e remove com id inexistente ou inválido', async () => {
    const missing = '22222222-2222-4222-8222-222222222222';
    assert.equal(await repo.get('nao-e-uuid'), null);
    assert.equal(await repo.get(missing), null);
    assert.equal(await repo.update('nao-e-uuid', { name: 'x' }), null);
    assert.equal(await repo.update(missing, { name: 'x' }), null);
    assert.equal(await repo.remove('nao-e-uuid'), false);
    const t = await repo.create({ name: 'Apagar' });
    assert.equal(await repo.remove(t.id), true);
    assert.equal(await repo.remove(t.id), false);
  });

  it('unicidade vira mensagem amigável com status 400', async () => {
    await assert.rejects(repo.create({ name: 'Pizza' }), (err) => err.message === 'Esse nome já existe.' && err.status === 400);
  });

  it('where, first, all e count', async () => {
    assert.deepEqual((await repo.where('name = ANY($1)', [['A1', 'A2']], 'name')).map((r) => r.name), ['A1', 'A2']);
    assert.equal((await repo.first('name LIKE $1', ['lote-%'], 'price DESC')).name, 'lote-1200');
    assert.equal(await repo.first('name = $1', ['nenhum']), null);
    assert.equal((await repo.all()).length, await repo.count());
  });
});
