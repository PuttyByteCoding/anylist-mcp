import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildRawIngredient } from '../src/anylist-client.js';

// AnyList's display line is "<quantity> <name>, <note>". Every one of the 1359
// noted ingredients in the library follows it, so writes must too.
describe('rawIngredient display line', () => {
  it('appends the note after a comma', () => {
    assert.equal(
      buildRawIngredient({ quantity: '6-8', name: 'ripe plum tomatoes', note: 'diced' }),
      '6-8 ripe plum tomatoes, diced');
  });

  it('omits the comma when there is no note', () => {
    assert.equal(buildRawIngredient({ quantity: '1 tbsp', name: 'olive oil' }), '1 tbsp olive oil');
    assert.equal(buildRawIngredient({ quantity: '1 tbsp', name: 'olive oil', note: '' }), '1 tbsp olive oil');
  });

  it('handles a missing quantity', () => {
    assert.equal(
      buildRawIngredient({ quantity: '', name: 'salt and pepper', note: 'to taste' }),
      'salt and pepper, to taste');
  });

  it('does not lose the note when there is nothing else', () => {
    assert.equal(buildRawIngredient({ quantity: '', name: '', note: 'to taste' }), 'to taste');
  });

  it('trims stray whitespace rather than doubling spaces', () => {
    assert.equal(
      buildRawIngredient({ quantity: ' 2 cloves ', name: ' garlic ', note: ' thinly sliced ' }),
      '2 cloves garlic, thinly sliced');
  });
});
