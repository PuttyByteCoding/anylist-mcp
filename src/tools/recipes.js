import { writeFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import { textResponse, errorResponse } from "./helpers.js";
import { createElicitationHelpers } from "./elicitation.js";
import { normalizeRecipe } from "../recipe-normalizer.js";

// AnyList's sync payload populates photoIds but leaves photoUrls empty; clients
// build the URL from the ID. Verified public (no auth) against photos.anylist.com.
const PHOTO_BASE_URL = "https://photos.anylist.com";
const PHOTO_CONCURRENCY = 5;
const PHOTO_TIMEOUT_MS = 30000;

function photoExtension(url) {
  const match = /\.(jpe?g|png|gif|webp|heic)(?:$|\?)/i.exec(url);
  return match ? `.${match[1].toLowerCase()}` : '.jpg';
}

// Downloads every recipe photo into <dir>/photos/<recipeId>/. One failure does not
// abort the backup; each photo's outcome is recorded in the returned manifest.
async function downloadPhotos(recipes, dir) {
  const jobs = [];
  for (const recipe of recipes) {
    const ids = recipe.photoIds || [];
    const urls = recipe.photoUrls || [];
    for (let index = 0; index < Math.max(ids.length, urls.length); index++) {
      const photoId = ids[index] || null;
      const url = urls[index] || (photoId ? `${PHOTO_BASE_URL}/${photoId}.jpg` : null);
      if (!url) continue;
      jobs.push({ recipeId: recipe.identifier, photoId: photoId || `${index}`, url, index });
    }
  }
  // Slot-indexed so the manifest keeps each recipe's photo order regardless of
  // which download finishes first — photoFiles[i] must line up with photoIds[i].
  const results = new Array(jobs.length);
  let cursor = 0;
  async function worker() {
    while (cursor < jobs.length) {
      const slot = cursor++;
      const job = jobs[slot];
      const relative = `photos/${job.recipeId}/${job.photoId}${photoExtension(job.url)}`;
      try {
        const response = await fetch(job.url, { signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        const target = join(dir, relative);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, bytes);
        results[slot] = { ...job, file: relative, bytes: bytes.length, status: 'saved' };
      } catch (error) {
        results[slot] = { ...job, file: null, bytes: 0, status: 'failed', error: error.message };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PHOTO_CONCURRENCY, jobs.length) }, worker));
  return results;
}

export function register(server, getClient) {
  const { elicitRequiredField } = createElicitationHelpers(server);

  server.registerTool("recipes", {
    title: "Recipes",
    description: `Manage AnyList recipes. Actions:
- list: Browse recipes in pages (returns summaries: name, rating, times, servings). Use 'search' to filter.
- get: Get full recipe details (ingredients, steps) by name or recipe ID
- create: Create a new recipe. If the name is taken, saves as "<name>-v1", "-v2", etc. rather than overwriting.
- update: Change fields on an existing recipe in place. Only the fields you pass are touched; everything else (photos, rating, nutrition, collections) is preserved. Returns the old and new value of each changed field.
- delete: Delete a recipe by name
- import_url: Import a recipe from a website URL (parses ingredients, steps, etc.)
- normalize: Preview/parse a recipe from a URL or raw text without saving (set save=true to also save)
- apply_updates: Apply many recipe updates from a local JSON file, so a large edit does not need one tool call per recipe. The file is a JSON array of objects, each with "id" plus any of the update fields (note, ingredients, prep_time, cook_time, servings, rating, new_name, steps_replace). Use dry_run to validate the file and preview the change counts without writing.
- backup: Write every recipe and collection to a local backup directory at full fidelity (ingredient IDs, headings, ratings, nutrition, collection membership), and download the photo files. One API call regardless of library size; photos are one download each.`,
    inputSchema: {
      action: z.enum(["list", "get", "create", "update", "delete", "import_url", "normalize", "backup", "apply_updates"]).describe("The recipe action to perform"),
      name: z.string().optional().describe("Recipe name or ID (required for get, update and delete; name required for create)"),
      new_name: z.string().optional().describe("Rename the recipe to this (update only)"),
      search: z.string().optional().describe("Search query to filter recipes (list only)"),
      limit: z.number().int().min(1).max(100).optional().describe("Maximum recipes to return (list only, default 25)"),
      offset: z.number().int().min(0).optional().describe("Number of matching recipes to skip (list only, default 0)"),
      ingredients: z.array(z.object({
        name: z.string().describe("Ingredient name, e.g. 'flour'"),
        quantity: z.string().describe("Quantity with unit, e.g. '2 cups' — AnyList has no separate unit field, the unit belongs here"),
        note: z.string().optional().describe("Preparation note, e.g. 'chopped'"),
        is_heading: z.boolean().optional().describe("True if this line is a section heading like 'For the sauce' rather than an ingredient"),
      })).optional().describe("Ingredients (create, update). On update this replaces the whole list."),
      steps: z.array(z.string()).optional().describe("Preparation steps in order (create only)"),
      steps_replace: z.array(z.string()).optional().describe("Replacement preparation steps (update only)"),
      note: z.string().optional().describe("Recipe notes (create, update)"),
      source_name: z.string().optional().describe("Source name (create, update)"),
      source_url: z.string().optional().describe("Source URL (create, update)"),
      prep_time: z.number().optional().describe("Prep time in minutes (create, update)"),
      cook_time: z.number().optional().describe("Cook time in minutes (create, update)"),
      rating: z.number().int().min(0).max(5).optional().describe("Rating 0-5 (update only)"),
      servings: z.string().optional().describe("Servings, e.g. '4' or '4-6' (create, update)"),
      url: z.string().optional().describe("URL to import recipe from (import_url, normalize)"),
      text: z.string().optional().describe("Raw recipe text to parse (normalize only)"),
      save: z.boolean().optional().describe("If true, also save normalized recipe to AnyList (normalize only, default false)"),
      path: z.string().optional().describe("Directory to write the backup into (backup only). Defaults to ./anylist-backup-<timestamp>/"),
      include_photos: z.boolean().optional().describe("Download recipe photo files as well as metadata (backup only, default true)"),
      dry_run: z.boolean().optional().describe("Validate and report what would change without writing (apply_updates only)"),
    }
  }, async (params) => {
    const { action, name, new_name, search, limit = 25, offset = 0, ingredients, steps, steps_replace, note, source_name, source_url, prep_time, cook_time, rating, servings, url, text: recipeText, save: saveRecipe, path: backupPath, include_photos: includePhotos = true, dry_run: dryRun = false } = params;
    try {
      const client = await getClient();
      await client.connect(null, { requireList: false });
      switch (action) {
        case "list": {
          const recipes = await client.getRecipes(search || null);
          if (recipes.length === 0) return textResponse(search ? `No recipes found matching "${search}".` : "No recipes found.");
          const page = recipes.slice(offset, offset + limit);
          const list = page.map(r => {
            const parts = [`- **${r.name}**`];
            if (r.rating) parts.push(`⭐${r.rating}`);
            if (r.prepTime) parts.push(`prep: ${r.prepTime}min`);
            if (r.cookTime) parts.push(`cook: ${r.cookTime}min`);
            if (r.servings) parts.push(`serves: ${r.servings}`);
            parts.push(`(id: ${r.identifier})`);
            return parts.join(' | ');
          }).join('\n');
          const rangeStart = offset + 1;
          const rangeEnd = offset + page.length;
          const nextOffset = offset + page.length;
          const nextPage = nextOffset < recipes.length
            ? `\n\nMore results available. Use offset: ${nextOffset}.`
            : "";
          return textResponse(`Recipes ${rangeStart}-${rangeEnd} of ${recipes.length}:\n${list}${nextPage}`);
        }
        case "get": {
          let getRecipeName = name;
          if (!getRecipeName) getRecipeName = await elicitRequiredField("name", "Which recipe name or ID would you like to view?");
          const recipe = await client.getRecipeDetails(getRecipeName);
          let text = `# ${recipe.name}\n\nID: ${recipe.identifier}\n`;
          if (recipe.sourceName) text += `Source: ${recipe.sourceName}\n`;
          if (recipe.sourceUrl) text += `URL: ${recipe.sourceUrl}\n`;
          if (recipe.rating) text += `Rating: ${'⭐'.repeat(recipe.rating)}\n`;
          if (recipe.prepTime) text += `Prep: ${recipe.prepTime} min\n`;
          if (recipe.cookTime) text += `Cook: ${recipe.cookTime} min\n`;
          if (recipe.servings) text += `Servings: ${recipe.servings}\n`;
          if (recipe.createdAt) text += `Created: ${recipe.createdAt}\n`;
          if (recipe.note) text += `\nNotes: ${recipe.note}\n`;
          if (recipe.ingredients.length > 0) {
            text += `\n## Ingredients\n`;
            recipe.ingredients.forEach(i => {
              const line = i.rawIngredient || [i.quantity, i.name, i.note].filter(Boolean).join(' ');
              text += i.isHeading ? `\n**${line}**\n` : `- ${line}\n`;
            });
          }
          if (recipe.preparationSteps.length > 0) {
            text += `\n## Steps\n`;
            recipe.preparationSteps.forEach((s, idx) => { text += `${idx + 1}. ${s}\n`; });
          }
          return textResponse(text);
        }
        case "create": {
          let recipeName = name;
          if (!recipeName) recipeName = await elicitRequiredField("name", "What should the recipe be called?");
          const existingRecipes = await client.getRecipes(recipeName);
          const taken = new Set(existingRecipes.map(r => r.name.toLowerCase()));
          let finalName = recipeName;
          let version = 0;
          while (taken.has(finalName.toLowerCase())) {
            version += 1;
            finalName = `${recipeName}-v${version}`;
          }
          const result = await client.createRecipe({
            name: finalName,
            ingredients: (ingredients || []).map(i => ({
              name: i.name,
              quantity: i.quantity,
              note: i.note || null,
              isHeading: Boolean(i.is_heading),
              rawIngredient: `${i.quantity} ${i.name}`.trim(),
            })),
            preparationSteps: steps || [],
            note: note || null,
            sourceName: source_name || null,
            sourceUrl: source_url || null,
            prepTime: prep_time || null,
            cookTime: cook_time || null,
            servings: servings || null,
          });
          return textResponse(version > 0
            ? `Created recipe "${result.name}" ("${recipeName}" already existed, so it was saved as a new version).`
            : `Created recipe "${result.name}"`);
        }
        case "update": {
          let updateRef = name;
          if (!updateRef) updateRef = await elicitRequiredField("name", "Which recipe name or ID would you like to update?");
          const fields = {};
          if (new_name !== undefined) fields.name = new_name;
          if (note !== undefined) fields.note = note;
          if (source_name !== undefined) fields.sourceName = source_name;
          if (source_url !== undefined) fields.sourceUrl = source_url;
          if (prep_time !== undefined) fields.prepTime = prep_time;
          if (cook_time !== undefined) fields.cookTime = cook_time;
          if (rating !== undefined) fields.rating = rating;
          if (servings !== undefined) fields.servings = servings;
          if (steps_replace !== undefined) fields.preparationSteps = steps_replace;
          if (ingredients !== undefined) {
            fields.ingredients = ingredients.map(i => ({
              name: i.name,
              quantity: i.quantity,
              note: i.note || null,
              isHeading: Boolean(i.is_heading),
            }));
          }
          if (Object.keys(fields).length === 0) {
            throw new Error('Action "update" requires at least one field to change');
          }
          const updated = await client.updateRecipe(updateRef, fields);
          if (updated.changed.length === 0) return textResponse(`No changes — "${updated.name}" already had those values.`);
          const summary = updated.changed
            .map(c => `- ${c.field}: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`)
            .join('\n');
          return textResponse(`Updated "${updated.name}" (${updated.identifier}):\n${summary}`);
        }
        case "apply_updates": {
          if (!backupPath) throw new Error('Action "apply_updates" requires "path" to a JSON file');
          const file = resolve(backupPath.startsWith('~/') ? join(homedir(), backupPath.slice(2)) : backupPath);
          const parsed = JSON.parse(await readFile(file, 'utf8'));
          if (!Array.isArray(parsed)) throw new Error('The file must contain a JSON array of update objects');

          const results = [];
          for (const entry of parsed) {
            if (!entry || !entry.id) { results.push({ id: entry && entry.id, status: 'skipped', reason: 'missing id' }); continue; }
            const fields = {};
            if (entry.new_name !== undefined) fields.name = entry.new_name;
            if (entry.note !== undefined) fields.note = entry.note;
            if (entry.source_name !== undefined) fields.sourceName = entry.source_name;
            if (entry.source_url !== undefined) fields.sourceUrl = entry.source_url;
            if (entry.prep_time !== undefined) fields.prepTime = entry.prep_time;
            if (entry.cook_time !== undefined) fields.cookTime = entry.cook_time;
            if (entry.rating !== undefined) fields.rating = entry.rating;
            if (entry.servings !== undefined) fields.servings = entry.servings;
            if (entry.steps_replace !== undefined) fields.preparationSteps = entry.steps_replace;
            if (entry.ingredients !== undefined) {
              fields.ingredients = entry.ingredients.map(i => ({
                name: i.name, quantity: i.quantity, note: i.note || null, isHeading: Boolean(i.is_heading),
              }));
            }
            if (Object.keys(fields).length === 0) { results.push({ id: entry.id, status: 'skipped', reason: 'no fields' }); continue; }
            if (dryRun) { results.push({ id: entry.id, status: 'would-update', fields: Object.keys(fields) }); continue; }
            try {
              const r = await client.updateRecipe(entry.id, fields);
              results.push({ id: entry.id, name: r.name, status: r.changed.length ? 'updated' : 'no-change', changed: r.changed.length });
            } catch (error) {
              results.push({ id: entry.id, status: 'failed', reason: error.message });
            }
          }
          const tallyOf = s2 => results.filter(r => r.status === s2).length;
          const failures = results.filter(r => r.status === 'failed' || r.status === 'skipped');
          let out = dryRun
            ? `Dry run: ${tallyOf('would-update')} of ${parsed.length} entries would be updated.`
            : `Applied ${tallyOf('updated')} of ${parsed.length} updates (${tallyOf('no-change')} already matched).`;
          if (failures.length) {
            out += `\n${failures.length} not applied:\n` + failures.slice(0, 15)
              .map(f => `- ${f.id}: ${f.reason}`).join('\n');
            if (failures.length > 15) out += `\n…and ${failures.length - 15} more`;
          }
          return textResponse(out);
        }
        case "backup": {
          const data = await client.exportRecipes();
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          const requested = backupPath || `anylist-backup-${stamp}`;
          const dir = resolve(requested.startsWith('~/') ? join(homedir(), requested.slice(2)) : requested);
          await mkdir(dir, { recursive: true });

          let photoResults = [];
          if (includePhotos) {
            photoResults = await downloadPhotos(data.recipes, dir);
            const byRecipe = new Map();
            for (const r of photoResults) {
              if (!byRecipe.has(r.recipeId)) byRecipe.set(r.recipeId, []);
              byRecipe.get(r.recipeId).push({ photoId: r.photoId, url: r.url, file: r.file, bytes: r.bytes, status: r.status, ...(r.error ? { error: r.error } : {}) });
            }
            for (const recipe of data.recipes) {
              recipe.photoFiles = byRecipe.get(recipe.identifier) || [];
            }
          }

          const saved = photoResults.filter(r => r.status === 'saved');
          const failed = photoResults.filter(r => r.status === 'failed');
          const payload = {
            schema: 'anylist-mcp/recipe-backup@2',
            exportedAt: new Date().toISOString(),
            note: 'prepTime and cookTime are raw AnyList values, in seconds. Photo files are under photos/<recipeId>/ and indexed per recipe in photoFiles.',
            counts: {
              recipes: data.recipes.length,
              collections: data.collections.length,
              photosSaved: saved.length,
              photosFailed: failed.length,
            },
            recipes: data.recipes,
            collections: data.collections,
          };
          const serialized = JSON.stringify(payload, null, 2);
          await writeFile(join(dir, 'recipes.json'), serialized, 'utf8');

          const photoBytes = saved.reduce((sum, r) => sum + r.bytes, 0);
          const totalMb = ((Buffer.byteLength(serialized, 'utf8') + photoBytes) / 1024 / 1024).toFixed(2);
          let out = `Backed up ${payload.counts.recipes} recipes and ${payload.counts.collections} collections to ${dir} (${totalMb} MB total).`;
          if (includePhotos) {
            out += `\nPhotos: ${saved.length} saved`;
            if (failed.length > 0) {
              const sample = failed.slice(0, 3).map(f => `${f.recipeId}/${f.photoId} (${f.error})`).join('; ');
              out += `, ${failed.length} failed — ${sample}${failed.length > 3 ? ', …' : ''}`;
            }
            out += '.';
          } else {
            out += '\nPhotos skipped (include_photos: false).';
          }
          return textResponse(out);
        }
        case "delete": {
          let deleteRecipeName = name;
          if (!deleteRecipeName) deleteRecipeName = await elicitRequiredField("name", "Which recipe would you like to delete?");
          await client.deleteRecipe(deleteRecipeName);
          return textResponse(`Deleted recipe "${deleteRecipeName}"`);
        }
        case "import_url": {
          let importUrl = url;
          if (!importUrl) importUrl = await elicitRequiredField("url", "What URL would you like to import a recipe from?");
          const result = await client.importRecipeFromUrl(importUrl);
          let importText = `Imported recipe "${result.name}"\n`;
          importText += `- ${result.ingredientCount} ingredients, ${result.stepCount} steps\n`;
          if (result.source) importText += `- Source: ${result.source}\n`;
          if (result.sourceUrl) importText += `- URL: ${result.sourceUrl}\n`;
          if (result.method) importText += `- Method: ${result.method}\n`;
          return textResponse(importText);
        }
        case "normalize": {
          if (!url && !recipeText) {
            throw new Error('Action "normalize" requires either "url" or "text" parameter');
          }
          const input = {};
          if (url) input.url = url;
          if (recipeText) input.text = recipeText;
          const normalized = await normalizeRecipe(input);

          let output = `# ${normalized.name}\n\n`;
          if (normalized.sourceName) output += `Source: ${normalized.sourceName}\n`;
          if (normalized.sourceUrl) output += `URL: ${normalized.sourceUrl}\n`;
          if (normalized.prepTime) output += `Prep: ${normalized.prepTime}\n`;
          if (normalized.cookTime) output += `Cook: ${normalized.cookTime}\n`;
          if (normalized.servings) output += `Servings: ${normalized.servings}\n`;
          if (normalized.note) output += `Note: ${normalized.note}\n`;
          output += `\n## Ingredients (${normalized.ingredients.length})\n`;
          normalized.ingredients.forEach(i => { output += `- ${i.rawIngredient}\n`; });
          output += `\n## Steps (${normalized.preparationSteps.length})\n`;
          normalized.preparationSteps.forEach((s, idx) => { output += `${idx + 1}. ${s}\n`; });

          if (saveRecipe) {
            const created = await client.createRecipe({
              name: normalized.name,
              ingredients: normalized.ingredients,
              preparationSteps: normalized.preparationSteps,
              note: normalized.note,
              sourceName: normalized.sourceName,
              sourceUrl: normalized.sourceUrl,
              prepTime: normalized.prepTime,
              cookTime: normalized.cookTime,
              servings: normalized.servings,
            });
            output += `\n✅ Saved to AnyList as "${created.name}"`;
          }
          return textResponse(output);
        }
      }
    } catch (error) {
      return errorResponse(`Recipes ${action} failed: ${error.message}`);
    }
  });
}
