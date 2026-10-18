import { icons, type LucideIcon } from 'lucide-react';

/** Lucide names its components after the kebab-case icon name: "building-2" is Building2. */
const componentName = (name: string) =>
  name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

const byName: Record<string, LucideIcon | undefined> = icons;

/** The Lucide icon for a kebab-case name, or null; `validate` has already rejected names Lucide lacks. */
export function lucideIcon(name: string | undefined): LucideIcon | null {
  return name ? (byName[componentName(name)] ?? null) : null;
}
