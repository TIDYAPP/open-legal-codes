import type { RegistryEntry } from './api';

function stripPrefix(name: string): string {
  return name.replace(/^(City of|Town of|Village of|County of|Borough of)\s+/i, '');
}

function stripStateSuffix(name: string): string {
  return name.replace(/,\s*[A-Z]{2}$/, '');
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function jurisdictionUrl(entry: { name: string; type: string; state: string | null; id: string }): string {
  if (entry.type === 'federal') {
    const slug = entry.id.replace(/^us-/, '');
    return `/federal/${slug}`;
  }
  if (entry.state) {
    const slug = slugify(stripStateSuffix(stripPrefix(entry.name)));
    return `/${entry.state.toLowerCase()}/${slug}`;
  }
  return `/${entry.id}`;
}
