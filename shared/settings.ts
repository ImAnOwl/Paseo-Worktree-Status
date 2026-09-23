import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

// A workspace without an entry is linked automatically; an empty list means "no worktree".
// The client reads these and sends them with each request, so the server needs no settings API
// beyond registration, which keeps the plugin working with Paseo 0.8.
export const linkSettings = defineSettings({
  id: "links",
  scope: "host",
  version: 1,
  schema: z.object({
    overrides: z.record(z.string(), z.object({ worktrees: z.array(z.string()) })).default({}),
  }),
});
export type LinkSettings = z.infer<typeof linkSettings.schema>;
