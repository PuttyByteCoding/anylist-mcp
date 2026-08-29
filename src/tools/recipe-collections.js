import { z } from "zod";
import { textResponse, errorResponse } from "./helpers.js";
import { createElicitationHelpers } from "./elicitation.js";

export function register(server, getClient) {
  const { elicitRequiredField } = createElicitationHelpers(server);

  server.registerTool("recipe_collections", {
    title: "Recipe Collections",
    description: `Manage AnyList recipe collections. Actions:
- list: Show all collections with recipe counts, recipe names and recipe IDs
- create: Create a new collection, optionally with recipes
- add_recipes: Add existing recipes to an existing collection, by recipe ID
- remove_recipes: Remove recipes from a collection, by recipe ID (the recipes themselves are kept)
- delete: Delete a collection (the recipes in it are kept)`,
    inputSchema: {
      action: z.enum(["list", "create", "add_recipes", "remove_recipes", "delete"]).describe("The collection action to perform"),
      name: z.string().optional().describe("Collection name or ID (required for create, add_recipes, remove_recipes, delete)"),
      recipe_names: z.array(z.string()).optional().describe("Recipe names to include (create only)"),
      recipe_ids: z.array(z.string()).optional().describe("Recipe IDs to add or remove (add_recipes, remove_recipes). IDs are used rather than names because names are not unique."),
    }
  }, async (params) => {
    const { action, name, recipe_names, recipe_ids } = params;
    try {
      const client = await getClient();
      await client.connect(null, { requireList: false });
      switch (action) {
        case "list": {
          const collections = await client.getRecipeCollections();
          if (collections.length === 0) return textResponse("No recipe collections found.");
          const list = collections.map(c => `- **${c.name}** [${c.identifier}] (${c.recipeCount} recipes)${c.recipeCount > 0 ? ': ' + c.recipeNames.join(', ') : ''}`).join('\n');
          return textResponse(`Recipe Collections (${collections.length}):\n${list}`);
        }
        case "create": {
          let collectionName = name;
          if (!collectionName) collectionName = await elicitRequiredField("name", "What should the collection be called?");
          const result = await client.createRecipeCollection(collectionName, recipe_names || []);
          return textResponse(`Created recipe collection "${result.name}"`);
        }
        case "add_recipes":
        case "remove_recipes": {
          let collectionRef = name;
          if (!collectionRef) collectionRef = await elicitRequiredField("name", "Which collection?");
          if (!recipe_ids || recipe_ids.length === 0) {
            throw new Error(`Action "${action}" requires "recipe_ids"`);
          }
          const mode = action === "add_recipes" ? "add" : "remove";
          const res = await client.modifyCollectionRecipes(collectionRef, recipe_ids, mode);
          const verb = mode === "add" ? "Added" : "Removed";
          const preposition = mode === "add" ? "to" : "from";
          let out = `${verb} ${res.applied.length} recipe(s) ${preposition} "${res.name}".`;
          if (res.skipped.length > 0) {
            out += `\nSkipped ${res.skipped.length} (already ${mode === "add" ? "in" : "absent from"} the collection): ${res.skipped.join(', ')}`;
          }
          return textResponse(out);
        }
        case "delete": {
          let deleteCollectionName = name;
          if (!deleteCollectionName) deleteCollectionName = await elicitRequiredField("name", "Which collection would you like to delete?");
          await client.deleteRecipeCollection(deleteCollectionName);
          return textResponse(`Deleted recipe collection "${deleteCollectionName}"`);
        }
      }
    } catch (error) {
      return errorResponse(`Recipe collections ${action} failed: ${error.message}`);
    }
  });
}
