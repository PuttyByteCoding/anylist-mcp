# Tool Reference

Functionality is organized into **5 domain-grouped tools**. Every domain tool takes an `action` enum plus action-specific parameters.

```json
{ "name": "shopping", "arguments": { "action": "add_item", "name": "Milk", "quantity": 2 } }
```

---

## `health_check`

Tests the connection to AnyList and verifies access to the target list.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `list_name` | string | No | List to test (defaults to configured default) |

---

## `shopping`

Manage shopping lists and items.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | enum | Yes | See actions below |
| `list_name` | string | No | Target list (defaults to configured default) |
| `name` | string | For item actions | Item name |
| `quantity` | number | No | Item quantity (add_item only, default 1) |
| `notes` | string | No | Item notes (add_item only) |
| `include_checked` | boolean | No | Include checked-off items (list_items only) |
| `include_notes` | boolean | No | Include item notes in output (list_items only) |
| `store_name` | string | No | Filter items by store (add_items, set_item_category only) |
| `category` | string | No | Category for item (add_item only) |

**Actions:**

```json
// List all shopping lists with item counts
{ "name": "shopping", "arguments": { "action": "list_lists" } }

// List items on a list, grouped by category
{ "name": "shopping", "arguments": { "action": "list_items", "list_name": "Costco", "include_notes": true } }

// Add an item
{ "name": "shopping", "arguments": { "action": "add_item", "name": "Eggs", "quantity": 2, "notes": "organic", "store": "Costco"} }

// Check off an item (supports partial name matching)
{ "name": "shopping", "arguments": { "action": "check_item", "name": "Eggs" } }

// Delete an item permanently
{ "name": "shopping", "arguments": { "action": "delete_item", "name": "Eggs" } }

// Get favorite items for a list
{ "name": "shopping", "arguments": { "action": "get_favorites" } }

// Get recently added items for a list
{ "name": "shopping", "arguments": { "action": "get_recents" } }

// Set store for an item
{ "name": "shopping", "arguments": { "action": "set_item_store", "name": "Milk", "store_name": "Costco" } }

// Set category for an item
```

---

## `recipes`

Manage AnyList recipes, including URL import and text parsing.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | enum | Yes | See actions below |
| `name` | string | For most actions | Recipe name (or AnyList recipe ID for `get`/`update`) |
| `new_name` | string | No | Rename the recipe (update only) |
| `search` | string | No | Filter recipes by name (list only) |
| `limit` | integer | No | Maximum recipes to return, 1-100 (list only, default 25) |
| `offset` | integer | No | Number of matching recipes to skip (list only, default 0) |
| `ingredients` | array | No | `[{ name, quantity, note?, is_heading? }]` (create, update). On update this replaces the whole list. |
| `steps` | string[] | No | Preparation steps (create only) |
| `steps_replace` | string[] | No | Replacement preparation steps (update only) |
| `note` | string | No | Recipe notes (create, update) |
| `source_name` | string | No | Source attribution (create, update) |
| `source_url` | string | No | Source URL (create, update) |
| `prep_time` | number | No | Prep time in minutes (create, update) |
| `cook_time` | number | No | Cook time in minutes (create, update) |
| `rating` | number | No | 0-5 (update only) |
| `servings` | string | No | e.g. `"4"` or `"4-6"` (create, update) |
| `url` | string | For import/normalize | URL to fetch recipe from |
| `text` | string | For normalize | Raw recipe text to parse |
| `save` | boolean | No | Save normalized result to AnyList (normalize only) |
| `path` | string | No | Destination directory for `backup` (default `./anylist-backup-<timestamp>/`). A leading `~/` is expanded. |
| `include_photos` | boolean | No | Download photo files during `backup` (default `true`) |
| `dry_run` | boolean | No | Validate and preview without writing (`apply_updates` only) |

**Backup layout:**

```
anylist-backup-2026-08-29T15-42-00-000Z/
  recipes.json          # schema anylist-mcp/recipe-backup@2
  photos/<recipeId>/<photoId>.jpg
```

Photo URLs are derived as `https://photos.anylist.com/<photoId>.jpg`. AnyList's
sync payload populates `photoIds` but leaves `photoUrls` empty, so the URL is
built from the ID; an explicit `photoUrls` entry, if present, wins.

`recipes.json` holds every recipe at full fidelity — ingredient IDs and `isHeading`
flags, ratings, nutrition, photo IDs and URLs, both timestamps — plus every
collection's `recipeIds`. Times are the raw AnyList values, in **seconds**, so a
restore round-trips exactly. Each recipe carries a `photoFiles` array in the same
order as its `photoIds`, recording the saved path or the download error.

**Actions:**

```json
// Browse the first 25 recipes (summaries: name, rating, times, servings)
{ "name": "recipes", "arguments": { "action": "list" } }

// Browse the next 25 recipes
{ "name": "recipes", "arguments": { "action": "list", "offset": 25 } }

// Search recipes
{ "name": "recipes", "arguments": { "action": "list", "search": "chicken" } }

// Get full details — ingredients and steps (name or ID)
{ "name": "recipes", "arguments": { "action": "get", "name": "Chicken Tikka Masala" } }

// Create a recipe
{ "name": "recipes", "arguments": {
    "action": "create",
    "name": "Simple Pasta",
    "ingredients": [
      { "name": "spaghetti", "quantity": "1 lb" },
      { "name": "garlic cloves", "quantity": "2" },
      { "name": "olive oil", "quantity": "1/4 cup" }
    ],
    "steps": ["Boil pasta", "Sauté garlic in oil", "Toss together"],
    "servings": "4"
} }

// Update fields in place; untouched fields (photos, rating, nutrition, collections) are preserved
{ "name": "recipes", "arguments": {
  "action": "update",
  "name": "Chicken Piccata",
  "prep_time": 25,
  "cook_time": 20,
  "note": "Prep time 15 -> 25 min (author excluded pounding and dredging the cutlets)."
} }

// Group ingredients into sections with is_heading
{ "name": "recipes", "arguments": {
  "action": "update",
  "name": "Meatloaf",
  "ingredients": [
    { "name": "Meatloaf", "quantity": "", "is_heading": true },
    { "name": "ground beef", "quantity": "1.5 lbs" },
    { "name": "Glaze", "quantity": "", "is_heading": true },
    { "name": "ketchup", "quantity": "1/3 cup" }
  ]
} }

// Apply a large edit from a file instead of one call per recipe
{ "name": "recipes", "arguments": { "action": "apply_updates", "path": "~/changes.json", "dry_run": true } }
{ "name": "recipes", "arguments": { "action": "apply_updates", "path": "~/changes.json" } }
// changes.json is an array: [{ "id": "<recipeId>", "prep_time": 25, "note": "…", "ingredients": [...] }, …]
// Each entry accepts the same fields as `update`. Failures are reported per entry; one bad
// entry does not stop the rest.

// Back up the whole library (one API call for metadata, plus one download per photo)
{ "name": "recipes", "arguments": { "action": "backup" } }
{ "name": "recipes", "arguments": { "action": "backup", "path": "~/Backups/anylist/2026-08-29" } }

// Metadata only, no photo downloads
{ "name": "recipes", "arguments": { "action": "backup", "include_photos": false } }

// Delete a recipe
{ "name": "recipes", "arguments": { "action": "delete", "name": "Simple Pasta" } }

// Import a recipe from a website URL
{ "name": "recipes", "arguments": { "action": "import_url", "url": "https://..." } }

// Parse and preview a recipe without saving (set save=true to also save)
{ "name": "recipes", "arguments": { "action": "normalize", "url": "https://..." } }
{ "name": "recipes", "arguments": { "action": "normalize", "text": "Pasta\n\n1 lb spaghetti\n\n1. Boil pasta", "save": true } }
```

---

## `meal_plan`

Manage the AnyList meal planning calendar.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | enum | Yes | See actions below |
| `date` | string | For create | Date in `YYYY-MM-DD` format |
| `title` | string | No | Event title (use this or `recipe_id`) |
| `recipe_id` | string | No | Link an existing recipe by ID |
| `label_id` | string | No | Meal type label ID (get from `list_labels`) |
| `details` | string | No | Additional notes |
| `event_id` | string | For delete | Event ID to delete |

**Actions:**

```json
// View all meal plan events, sorted by date
{ "name": "meal_plan", "arguments": { "action": "list_events" } }

// Get available labels (Breakfast, Lunch, Dinner, etc.) with their IDs
{ "name": "meal_plan", "arguments": { "action": "list_labels" } }

// Schedule a meal
{ "name": "meal_plan", "arguments": {
    "action": "create_event",
    "date": "2025-02-15",
    "title": "Pizza Night",
    "label_id": "<id from list_labels>"
} }

// Delete an event
{ "name": "meal_plan", "arguments": { "action": "delete_event", "event_id": "<id>" } }
```

---

## `recipe_collections`

Organize recipes into named collections.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | enum | Yes | `list`, `create`, `add_recipes`, `remove_recipes`, `delete` |
| `name` | string | For most actions | Collection name or ID |
| `recipe_names` | string[] | No | Recipes to include on creation |
| `recipe_ids` | string[] | For add/remove | Recipe IDs to add or remove. IDs, not names, because recipe names are not unique. |

Deleting a collection removes only the collection; the recipes in it are kept.

`remove_recipes` sends only the targeted recipe IDs. The underlying
`remove-recipes-from-collection` handler removes every ID present in the
payload, so sending the collection's full membership (as `anylist-js`'s
`RecipeCollection.removeRecipe()` does) empties the entire collection.

**Actions:**

```json
// List all collections (includes each collection's ID and recipe IDs)
{ "name": "recipe_collections", "arguments": { "action": "list" } }

// Add existing recipes to an existing collection
{ "name": "recipe_collections", "arguments": {
  "action": "add_recipes",
  "name": "Chicken",
  "recipe_ids": ["9be36bbe6c134a638a960f32cc55adc7"]
} }

// Remove recipes from a collection (the recipes themselves are kept)
{ "name": "recipe_collections", "arguments": {
  "action": "remove_recipes",
  "name": "c-stub-id",
  "recipe_ids": ["9be36bbe6c134a638a960f32cc55adc7"]
} }

// Create a collection
{ "name": "recipe_collections", "arguments": {
    "action": "create",
    "name": "Weeknight Dinners",
    "recipe_names": ["Simple Pasta", "Chicken Tikka Masala"]
} }
```

---

## Typical multi-step interaction

1. **Browse recipes** — `recipes` → `list`
2. **Get details** — `recipes` → `get` with `name`
3. **Plan the meal** — `meal_plan` → `create_event` with date and title
4. **Add ingredients** — `shopping` → `add_item` for each ingredient
