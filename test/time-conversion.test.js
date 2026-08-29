import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { secondsToMinutes, minutesToSeconds } from '../src/anylist-client.js';

// AnyList's PBRecipe stores prepTime/cookTime as int32 seconds (fields 18/19).
// The tools speak minutes, matching what the AnyList apps display.
describe('recipe time conversion', () => {
  it('renders stored seconds as minutes', () => {
    // Real value from "Stracciatella Soup with Spinach and Orzo": the app shows 10 min prep / 20 min cook.
    assert.equal(secondsToMinutes(600), 10);
    assert.equal(secondsToMinutes(1200), 20);
    assert.equal(secondsToMinutes(37800), 630);
  });

  it('treats missing times as null rather than 0', () => {
    assert.equal(secondsToMinutes(null), null);
    assert.equal(secondsToMinutes(undefined), null);
    assert.equal(secondsToMinutes(0), null);
  });

  it('stores minutes as seconds', () => {
    assert.equal(minutesToSeconds(10), 600);
    assert.equal(minutesToSeconds(20), 1200);
    assert.equal(minutesToSeconds(0), 0);
  });

  it('round-trips', () => {
    for (const minutes of [1, 5, 10, 45, 90, 630]) {
      assert.equal(secondsToMinutes(minutesToSeconds(minutes)), minutes);
    }
  });

  it('passes null through on write', () => {
    assert.equal(minutesToSeconds(null), null);
    assert.equal(minutesToSeconds(undefined), null);
  });
});
