import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from '../../src/tools/recipe-collections.js';
import { MockAnyListClient, createMockServer } from './helpers.js';

describe('recipe_collections tool', () => {
  let client;
  let handlers;

  beforeEach(() => {
    client = new MockAnyListClient();
    const { server, handlers: h } = createMockServer();
    register(server, () => Promise.resolve(client));
    handlers = h;
  });

  describe('list', () => {
    it('returns empty message when no collections', async () => {
      const result = await handlers.recipe_collections({ action: 'list' });
      assert.ok(result.content[0].text.includes('No recipe collections'));
    });

    it('lists collections with recipe names', async () => {
      client._collections.push({ name: 'Weeknight', recipeCount: 2, recipeNames: ['Pasta', 'Salad'] });
      const result = await handlers.recipe_collections({ action: 'list' });
      assert.ok(result.content[0].text.includes('Weeknight'));
      assert.ok(result.content[0].text.includes('Pasta'));
    });
  });

  describe('create', () => {
    it('creates a collection', async () => {
      const result = await handlers.recipe_collections({ action: 'create', name: 'Quick Meals' });
      assert.ok(result.content[0].text.includes('Created recipe collection "Quick Meals"'));
    });

    it('creates collection with recipes', async () => {
      await handlers.recipe_collections({ action: 'create', name: 'Favs', recipe_names: ['Pasta'] });
      assert.equal(client._collections[client._collections.length - 1].recipeNames[0], 'Pasta');
    });
  });

  describe('delete', () => {
    it('deletes an existing collection', async () => {
      client._collections.push({ name: 'Old Collection', recipeCount: 0, recipeNames: [] });
      const result = await handlers.recipe_collections({ action: 'delete', name: 'Old Collection' });
      assert.ok(result.content[0].text.includes('Deleted recipe collection'));
      assert.equal(client._collections.length, 0);
    });

    it('returns error for non-existent collection', async () => {
      const result = await handlers.recipe_collections({ action: 'delete', name: 'Nope' });
      assert.equal(result.isError, true);
      assert.ok(result.content[0].text.includes('not found'));
    });
  });

  describe('membership', () => {
    it('adds recipes to an existing collection without recreating it', async () => {
      client._collections.push({ identifier: 'c-9', name: 'Chicken', recipeIds: ['r-1'], recipeCount: 1, recipeNames: [] });
      const result = await handlers.recipe_collections({ action: 'add_recipes', name: 'Chicken', recipe_ids: ['r-2', 'r-3'] });
      assert.ok(result.content[0].text.includes('Added 2 recipe(s) to "Chicken"'));
      assert.deepEqual(client._collections[0].recipeIds, ['r-1', 'r-2', 'r-3']);
      assert.equal(client._collections.length, 1);
    });

    it('skips recipes already in the collection', async () => {
      client._collections.push({ identifier: 'c-9', name: 'Chicken', recipeIds: ['r-1'], recipeCount: 1, recipeNames: [] });
      const result = await handlers.recipe_collections({ action: 'add_recipes', name: 'Chicken', recipe_ids: ['r-1'] });
      assert.ok(result.content[0].text.includes('Skipped 1'));
      assert.deepEqual(client._collections[0].recipeIds, ['r-1']);
    });

    it('removes recipes from a collection', async () => {
      client._collections.push({ identifier: 'c-9', name: 'Chicken', recipeIds: ['r-1', 'r-2'], recipeCount: 2, recipeNames: [] });
      const result = await handlers.recipe_collections({ action: 'remove_recipes', name: 'Chicken', recipe_ids: ['r-1'] });
      assert.ok(result.content[0].text.includes('Removed 1 recipe(s) from "Chicken"'));
      assert.deepEqual(client._collections[0].recipeIds, ['r-2']);
    });

    it('can target a collection by id when names are duplicated', async () => {
      client._collections.push(
        { identifier: 'c-big', name: 'Beef', recipeIds: [], recipeCount: 0, recipeNames: [] },
        { identifier: 'c-stub', name: 'Beef', recipeIds: [], recipeCount: 0, recipeNames: [] },
      );
      await handlers.recipe_collections({ action: 'add_recipes', name: 'c-stub', recipe_ids: ['r-7'] });
      assert.deepEqual(client._collections[0].recipeIds, []);
      assert.deepEqual(client._collections[1].recipeIds, ['r-7']);
    });

    it('requires recipe_ids', async () => {
      client._collections.push({ identifier: 'c-9', name: 'Chicken', recipeIds: [], recipeCount: 0, recipeNames: [] });
      const result = await handlers.recipe_collections({ action: 'add_recipes', name: 'Chicken' });
      assert.ok(result.content[0].text.includes('recipe_ids'));
    });
  });
});
