/** Library categories. Each is also a tag, so the Community can filter by it. */
export const LIBRARY_CATEGORIES = ['Characters', 'Interactive UI', 'Illustrations', 'Typography', 'Celebrations', 'Loaders'] as const;
export type LibraryCategory = (typeof LIBRARY_CATEGORIES)[number];
export const categoryTag = (c: LibraryCategory) => c.toLowerCase().replace(/\s+/g, '-');
