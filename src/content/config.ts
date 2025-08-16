import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),     // coerce lets you keep a YYYY-MM-DD string
    image: z.string().optional(), // <-- add this line
    tags: z.array(z.string()).optional(),
    draft: z.boolean().optional(), // if you use drafts
  }),
});
export const SITE = "https://crocheo.net";
export const collections = { blog };
