import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from '../../src/tools/recipes.js';
import { MockAnyListClient, createMockServer } from './helpers.js';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

describe('recipes tool', () => {
  let client;
  let handlers;

  beforeEach(() => {
    client = new MockAnyListClient();
    const { server, handlers: h } = createMockServer();
    register(server, () => Promise.resolve(client));
    handlers = h;
  });

  describe('list', () => {
    it('returns empty message when no recipes', async () => {
      const result = await handlers.recipes({ action: 'list' });
      assert.ok(result.content[0].text.includes('No recipes found'));
      assert.deepEqual(client._connectCalls[0], { listName: null, options: { requireList: false } });
    });

    it('lists recipes with metadata and id', async () => {
      client._recipes.push({ identifier: 'r-abc', name: 'Pasta', rating: 5, prepTime: 10, cookTime: 20, servings: '4' });
      const result = await handlers.recipes({ action: 'list' });
      assert.ok(result.content[0].text.includes('Pasta'));
      assert.ok(result.content[0].text.includes('⭐5'));
      assert.ok(result.content[0].text.includes('r-abc'));
    });

    it('filters by search query', async () => {
      client._recipes.push({ identifier: 'r-1', name: 'Pasta' }, { identifier: 'r-2', name: 'Salad' });
      const result = await handlers.recipes({ action: 'list', search: 'pasta' });
      assert.ok(result.content[0].text.includes('Pasta'));
      assert.ok(!result.content[0].text.includes('Salad'));
    });

    it('paginates recipe results and reports the next offset', async () => {
      client._recipes.push(
        { identifier: 'r-1', name: 'First' },
        { identifier: 'r-2', name: 'Second' },
        { identifier: 'r-3', name: 'Third' },
      );
      const result = await handlers.recipes({ action: 'list', limit: 2 });
      assert.ok(result.content[0].text.includes('Recipes 1-2 of 3'));
      assert.ok(result.content[0].text.includes('First'));
      assert.ok(result.content[0].text.includes('Second'));
      assert.ok(!result.content[0].text.includes('Third'));
      assert.ok(result.content[0].text.includes('offset: 2'));
    });
  });

  describe('get', () => {
    it('returns full recipe details with id', async () => {
      client._recipes.push({
        identifier: 'r-xyz',
        name: 'Pasta',
        ingredients: [{ rawIngredient: '2 cups flour' }],
        preparationSteps: ['Boil water', 'Cook pasta'],
      });
      const result = await handlers.recipes({ action: 'get', name: 'Pasta' });
      assert.ok(result.content[0].text.includes('# Pasta'));
      assert.ok(result.content[0].text.includes('r-xyz'));
      assert.ok(result.content[0].text.includes('2 cups flour'));
      assert.ok(result.content[0].text.includes('Boil water'));
    });

    it('returns error for non-existent recipe', async () => {
      const result = await handlers.recipes({ action: 'get', name: 'Nope' });
      assert.equal(result.isError, true);
      assert.ok(result.content[0].text.includes('not found'));
    });

    it('gets a recipe by its AnyList identifier', async () => {
      client._recipes.push({ identifier: 'r-xyz', name: 'Pasta', ingredients: [], preparationSteps: [] });
      const result = await handlers.recipes({ action: 'get', name: 'r-xyz' });
      assert.ok(result.content[0].text.includes('# Pasta'));
    });
  });

  describe('create', () => {
    it('creates a recipe', async () => {
      const result = await handlers.recipes({ action: 'create', name: 'New Recipe' });
      assert.ok(result.content[0].text.includes('Created recipe "New Recipe"'));
      assert.equal(client._recipes.length, 1);
    });

    it('creates recipe with all fields', async () => {
      await handlers.recipes({
        action: 'create',
        name: 'Full Recipe',
        ingredients: [{ name: 'sugar', quantity: '1 cup' }],
        steps: ['Mix well'],
        note: 'Delicious',
        prep_time: 5,
        cook_time: 30,
        servings: '4',
      });
      assert.equal(client._recipes[0].name, 'Full Recipe');
    });
  });

  describe('import_url', () => {
    it('imports a recipe from a URL', async () => {
      client._pendingImport = {
        name: 'Chicken Tikka Masala',
        ingredientCount: 12,
        stepCount: 6,
        source: 'AllRecipes',
        sourceUrl: 'https://example.com/recipe',
      };
      const result = await handlers.recipes({ action: 'import_url', url: 'https://example.com/recipe' });
      assert.ok(result.content[0].text.includes('Imported recipe "Chicken Tikka Masala"'));
      assert.ok(result.content[0].text.includes('12 ingredients'));
      assert.ok(result.content[0].text.includes('6 steps'));
      assert.ok(result.content[0].text.includes('AllRecipes'));
    });

    it('returns error when URL cannot be parsed', async () => {
      client._pendingImport = null;
      const result = await handlers.recipes({ action: 'import_url', url: 'https://bad-site.com' });
      assert.equal(result.isError, true);
      assert.ok(result.content[0].text.includes('Could not parse'));
    });
  });

  describe('delete', () => {
    it('deletes an existing recipe', async () => {
      client._recipes.push({ name: 'Old Recipe' });
      const result = await handlers.recipes({ action: 'delete', name: 'Old Recipe' });
      assert.ok(result.content[0].text.includes('Deleted recipe'));
      assert.equal(client._recipes.length, 0);
    });

    it('returns error for non-existent recipe', async () => {
      const result = await handlers.recipes({ action: 'delete', name: 'Nope' });
      assert.equal(result.isError, true);
    });
  });

  describe('create name collisions', () => {
    it('appends -v1 instead of overwriting an existing recipe', async () => {
      client._recipes.push({ identifier: 'r-1', name: 'Meatloaf' });
      const result = await handlers.recipes({ action: 'create', name: 'Meatloaf', ingredients: [] });
      assert.ok(result.content[0].text.includes('Meatloaf-v1'));
      // original survives
      assert.equal(client._recipes.filter(r => r.name === 'Meatloaf').length, 1);
      assert.equal(client._recipes.length, 2);
    });

    it('walks to the next free version', async () => {
      client._recipes.push(
        { identifier: 'r-1', name: 'Meatloaf' },
        { identifier: 'r-2', name: 'Meatloaf-v1' },
      );
      await handlers.recipes({ action: 'create', name: 'Meatloaf', ingredients: [] });
      assert.ok(client._recipes.some(r => r.name === 'Meatloaf-v2'));
      assert.equal(client._recipes.length, 3);
    });

    it('uses the plain name when it is free', async () => {
      const result = await handlers.recipes({ action: 'create', name: 'Meatloaf', ingredients: [] });
      assert.ok(result.content[0].text.includes('Created recipe "Meatloaf"'));
      assert.ok(!result.content[0].text.includes('-v1'));
    });
  });

  describe('update', () => {
    it('reports old and new values for each changed field', async () => {
      client._recipes.push({ identifier: 'r-1', name: 'Pasta', prepTime: 10, cookTime: 20 });
      const result = await handlers.recipes({ action: 'update', name: 'Pasta', prep_time: 25 });
      const text = result.content[0].text;
      assert.ok(text.includes('prepTime'));
      assert.ok(text.includes('10'));
      assert.ok(text.includes('25'));
    });

    it('leaves fields it was not given alone', async () => {
      client._recipes.push({ identifier: 'r-1', name: 'Pasta', prepTime: 10, cookTime: 20, rating: 4, servings: '4' });
      await handlers.recipes({ action: 'update', name: 'Pasta', prep_time: 25 });
      const r = client._recipes[0];
      assert.equal(r.cookTime, 20);
      assert.equal(r.rating, 4);
      assert.equal(r.servings, '4');
      assert.equal(r.name, 'Pasta');
    });

    it('requires at least one field', async () => {
      client._recipes.push({ identifier: 'r-1', name: 'Pasta' });
      const result = await handlers.recipes({ action: 'update', name: 'Pasta' });
      assert.ok(result.content[0].text.includes('at least one field'));
    });

    it('says so when nothing actually changed', async () => {
      client._recipes.push({ identifier: 'r-1', name: 'Pasta', prepTime: 10 });
      const result = await handlers.recipes({ action: 'update', name: 'Pasta', prep_time: 10 });
      assert.ok(result.content[0].text.includes('No changes'));
    });

    it('passes ingredient headings through', async () => {
      client._recipes.push({ identifier: 'r-1', name: 'Pasta', ingredients: [] });
      await handlers.recipes({
        action: 'update',
        name: 'Pasta',
        ingredients: [
          { name: 'For the sauce', quantity: '', is_heading: true },
          { name: 'tomatoes', quantity: '2 cups' },
        ],
      });
      const ing = client._recipes[0].ingredients;
      assert.equal(ing[0].isHeading, true);
      assert.equal(ing[1].isHeading, false);
      assert.equal(ing[1].quantity, '2 cups');
    });
  });

  describe('get rendering', () => {
    it('renders headings differently from ingredients', async () => {
      client._recipes.push({
        identifier: 'r-1',
        name: 'Meatloaf',
        ingredients: [
          { rawIngredient: 'Glaze', isHeading: true },
          { rawIngredient: '1/3 cup ketchup' },
        ],
        preparationSteps: [],
      });
      const text = (await handlers.recipes({ action: 'get', name: 'Meatloaf' })).content[0].text;
      assert.ok(text.includes('**Glaze**'));
      assert.ok(text.includes('- 1/3 cup ketchup'));
      assert.ok(!text.includes('- Glaze'));
    });
  });

  describe('backup', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'anylist-backup-'));
    let photoServer;
    let photoBase;

    before(async () => {
      photoServer = createServer((req, res) => {
        if (req.url.startsWith('/missing')) { res.statusCode = 404; res.end('nope'); return; }
        res.setHeader('content-type', 'image/jpeg');
        res.end(Buffer.from('fake-jpeg-bytes'));
      });
      await new Promise(r => photoServer.listen(0, '127.0.0.1', r));
      photoBase = `http://127.0.0.1:${photoServer.address().port}`;
    });

    after(() => photoServer.close());

    it('writes recipes.json at full fidelity', async () => {
      client._recipes.push({
        identifier: 'r-1',
        name: 'Meatloaf',
        prepTime: 1800,
        rating: 4,
        photoIds: [],
        photoUrls: [],
        ingredients: [{ identifier: 'i-1', rawIngredient: 'Glaze', isHeading: true }],
        preparationSteps: ['Bake'],
      });
      client._collections.push({ identifier: 'c-1', name: 'Beef', recipeIds: ['r-1'] });

      const dir = join(tmpDir, 'full');
      const result = await handlers.recipes({ action: 'backup', path: dir });
      assert.ok(result.content[0].text.includes('1 recipes and 1 collections'));

      const saved = JSON.parse(readFileSync(join(dir, 'recipes.json'), 'utf8'));
      assert.equal(saved.schema, 'anylist-mcp/recipe-backup@2');
      assert.equal(saved.recipes[0].prepTime, 1800, 'times stay raw seconds');
      assert.equal(saved.recipes[0].rating, 4);
      assert.equal(saved.recipes[0].ingredients[0].isHeading, true);
      assert.equal(saved.recipes[0].ingredients[0].identifier, 'i-1');
      assert.deepEqual(saved.collections[0].recipeIds, ['r-1']);
    });

    it('downloads photo files into photos/<recipeId>/', async () => {
      client._recipes.push({
        identifier: 'r-9',
        name: 'Pasta',
        photoIds: ['p-a', 'p-b'],
        photoUrls: [`${photoBase}/a.jpg`, `${photoBase}/b.png`],
      });
      const dir = join(tmpDir, 'photos-ok');
      const result = await handlers.recipes({ action: 'backup', path: dir });

      assert.ok(result.content[0].text.includes('Photos: 2 saved'));
      assert.equal(readFileSync(join(dir, 'photos/r-9/p-a.jpg'), 'utf8'), 'fake-jpeg-bytes');
      assert.ok(existsSync(join(dir, 'photos/r-9/p-b.png')), 'extension comes from the URL');

      const saved = JSON.parse(readFileSync(join(dir, 'recipes.json'), 'utf8'));
      assert.equal(saved.counts.photosSaved, 2);
      // manifest order must match photoIds order, not download completion order
      assert.deepEqual(saved.recipes[0].photoFiles.map(f => f.file),
        ['photos/r-9/p-a.jpg', 'photos/r-9/p-b.png']);
      assert.ok(saved.recipes[0].photoFiles.every(f => f.status === 'saved'));
    });

    it('records a failed photo without aborting the backup', async () => {
      client._recipes.push({
        identifier: 'r-7',
        name: 'Soup',
        photoIds: ['p-good', 'p-bad'],
        photoUrls: [`${photoBase}/good.jpg`, `${photoBase}/missing.jpg`],
      });
      const dir = join(tmpDir, 'photos-partial');
      const result = await handlers.recipes({ action: 'backup', path: dir });

      assert.ok(result.content[0].text.includes('1 saved'));
      assert.ok(result.content[0].text.includes('1 failed'));
      const saved = JSON.parse(readFileSync(join(dir, 'recipes.json'), 'utf8'));
      assert.equal(saved.counts.photosSaved, 1);
      assert.equal(saved.counts.photosFailed, 1);
      const bad = saved.recipes[0].photoFiles.find(f => f.photoId === 'p-bad');
      assert.equal(bad.status, 'failed');
      assert.ok(bad.error.includes('404'));
      // recipes.json still written and complete
      assert.equal(saved.counts.recipes, 1);
    });

    it('skips downloads when include_photos is false', async () => {
      client._recipes.push({ identifier: 'r-3', name: 'Chili', photoIds: ['p-x'], photoUrls: [`${photoBase}/x.jpg`] });
      const dir = join(tmpDir, 'no-photos');
      const result = await handlers.recipes({ action: 'backup', path: dir, include_photos: false });
      assert.ok(result.content[0].text.includes('Photos skipped'));
      assert.ok(!existsSync(join(dir, 'photos')));
    });

    it('expands a leading ~ instead of making a literal ~ directory', async () => {
      const result = await handlers.recipes({ action: 'backup', path: '~/anylist-mcp-test-backup' });
      assert.ok(result.content[0].text.includes(homedir()));
      assert.ok(!result.content[0].text.includes('~'));
      rmSync(join(homedir(), 'anylist-mcp-test-backup'), { recursive: true, force: true });
    });

    it('reports an empty library rather than failing', async () => {
      const dir = join(tmpDir, 'empty');
      const result = await handlers.recipes({ action: 'backup', path: dir });
      assert.ok(result.content[0].text.includes('0 recipes'));
    });
  });
});