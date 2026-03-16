/** Build a permalink URL that matches the frontend's /:state/:slug/:path routing. */

const BASE_URL = 'https://openlegalcodes.org';

function stripPrefix(name: string): string {
  return name.replace(/^(City of|Town of|Village of|County of|Borough of)\s+/i, '');
}

function stripStateSuffix(name: string): string {
  return name.replace(/,\s*[A-Z]{2}$/, '');
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function permalinkUrl(
  jurisdiction: { id: string; name: string; type: string; state: string | null },
  codePath?: string,
): string {
  let base: string;

  if (jurisdiction.type === 'federal') {
    const slug = jurisdiction.id.replace(/^us-/, '');
    base = `${BASE_URL}/federal/${slug}`;
  } else if (jurisdiction.state) {
    const slug = slugify(stripStateSuffix(stripPrefix(jurisdiction.name)));
    base = `${BASE_URL}/${jurisdiction.state.toLowerCase()}/${slug}`;
  } else {
    base = `${BASE_URL}/${jurisdiction.id}`;
  }

  return codePath ? `${base}/${codePath}` : base;
}
