// Insurance against Claude naming a category instead of a product — a
// category never matches anything on Instamart. Used by both the fridge-scan
// prompt and the voice-order prompt, since the failure mode is identical.
const GENERIC_CATEGORY_TERMS = [
  'fresh vegetables', 'vegetables', 'groceries', 'spices', 'dairy', 'essentials', 'snacks',
];

function isGenericCategoryName(name) {
  const n = String(name || '').toLowerCase();
  return GENERIC_CATEGORY_TERMS.some((term) => n.includes(term));
}

export function dropGenericItems(list, bucket) {
  return (list || []).filter((item) => {
    if (isGenericCategoryName(item?.name)) {
      console.warn(`dropped generic-category item from ${bucket}: "${item?.name}"`);
      return false;
    }
    return true;
  });
}
