import { Hono } from 'hono';
import { store } from '../store/index.js';
import { CodeWriter } from '../store/writer.js';
import { BRANDING } from '../branding.js';

const VALID_TYPES = ['legal_analysis', 'government_guidance', 'academic', 'news', 'other'] as const;
const MAX_TITLE_LENGTH = 500;
const MAX_DESCRIPTION_LENGTH = 2000;
const RATE_LIMIT_PER_HOUR = 10;

export const annotationRoutes = new Hono();

/**
 * POST /jurisdictions/:id/annotations
 * Submit an annotation (external reference) for a code section or case law decision.
 *
 * For sections: provide `path` (required).
 * For case law: provide `clusterId` (required).
 */
annotationRoutes.post('/:id/annotations', async (c) => {
  const id = c.req.param('id');

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400);
  }

  const { path, clusterId, url, title, sourceName, annotationType, description, codeId } = body;

  // Determine target type
  const targetType = clusterId != null ? 'caselaw' : 'section';
  if (targetType === 'section' && (!path || typeof path !== 'string')) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'path is required for section annotations' } }, 400);
  }
  if (targetType === 'caselaw' && (typeof clusterId !== 'number' || !Number.isInteger(clusterId))) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'clusterId must be an integer for case law annotations' } }, 400);
  }

  if (!url || typeof url !== 'string') {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'url is required' } }, 400);
  }
  if (!title || typeof title !== 'string') {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'title is required' } }, 400);
  }
  if (title.length > MAX_TITLE_LENGTH) {
    return c.json({ error: { code: 'BAD_REQUEST', message: `title must be ${MAX_TITLE_LENGTH} characters or fewer` } }, 400);
  }
  if (annotationType && !VALID_TYPES.includes(annotationType)) {
    return c.json({
      error: { code: 'BAD_REQUEST', message: `annotationType must be one of: ${VALID_TYPES.join(', ')}` },
    }, 400);
  }
  if (description && typeof description === 'string' && description.length > MAX_DESCRIPTION_LENGTH) {
    return c.json({
      error: { code: 'BAD_REQUEST', message: `description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer` },
    }, 400);
  }

  // Validate URL format
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('bad protocol');
    }
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'url must be a valid http or https URL' } }, 400);
  }

  // Verify jurisdiction exists
  const jurisdiction = store.getJurisdiction(id);
  if (!jurisdiction) {
    return c.json({ error: { code: 'NOT_FOUND', message: `Jurisdiction '${id}' not found` } }, 404);
  }

  // Rate limit by IP
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    || c.req.header('x-real-ip')
    || 'unknown';

  if (ip !== 'unknown') {
    const recentCount = store.countRecentAnnotations(ip, 60);
    if (recentCount >= RATE_LIMIT_PER_HOUR) {
      return c.json({
        error: { code: 'RATE_LIMITED', message: 'Too many submissions. Please try again later.' },
      }, 429);
    }
  }

  // Domain-based trust: check if URL is from a trusted domain
  const sourceDomain = parsedUrl.hostname.replace(/^www\./, '');
  const trustCheck = store.isTrustedDomain(sourceDomain);
  const status = trustCheck.trusted ? 'approved' : 'pending';
  const resolvedSourceName = sourceName || trustCheck.sourceName || '';

  const writer = new CodeWriter();
  let annotationId: number;
  try {
    annotationId = writer.createAnnotation({
      targetType,
      jurisdictionId: id,
      codeId: codeId || undefined,
      path: path || undefined,
      clusterId: clusterId ?? undefined,
      url,
      title: title.trim(),
      sourceName: resolvedSourceName,
      sourceDomain,
      annotationType: annotationType || 'other',
      description: (description || '').trim(),
      ipAddress: ip,
      status,
    });
  } catch (err: any) {
    if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return c.json({
        error: { code: 'DUPLICATE', message: 'This URL has already been submitted for this target.' },
      }, 409);
    }
    throw err;
  }

  return c.json({
    data: { id: annotationId, status },
    meta: { timestamp: new Date().toISOString(), poweredBy: BRANDING.poweredBy },
  }, 201);
});

/**
 * GET /jurisdictions/:id/annotations/*path
 * Get approved annotations for a specific code section.
 */
annotationRoutes.get('/:id/annotations/*', (c) => {
  const id = c.req.param('id');
  const path = c.req.path.split('/annotations/')[1] || '';
  const type = c.req.query('type') || undefined;
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 200);
  const offset = parseInt(c.req.query('offset') || '0', 10);
  const codeId = c.req.query('codeId') || undefined;

  const rows = store.listAnnotations({
    targetType: 'section',
    jurisdictionId: id,
    path,
    codeId,
    status: 'approved',
    type,
    limit,
    offset,
  });

  c.header('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=3600');
  return c.json({
    data: rows,
    meta: { timestamp: new Date().toISOString(), poweredBy: BRANDING.poweredBy },
  });
});

/**
 * GET /jurisdictions/:id/caselaw-annotations/:clusterId
 * Get approved annotations for a specific court decision.
 */
annotationRoutes.get('/:id/caselaw-annotations/:clusterId', (c) => {
  const clusterId = parseInt(c.req.param('clusterId'), 10);
  if (isNaN(clusterId)) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'clusterId must be an integer' } }, 400);
  }

  const type = c.req.query('type') || undefined;
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 200);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  const rows = store.listAnnotations({
    targetType: 'caselaw',
    clusterId,
    status: 'approved',
    type,
    limit,
    offset,
  });

  c.header('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=3600');
  return c.json({
    data: rows,
    meta: { timestamp: new Date().toISOString(), poweredBy: BRANDING.poweredBy },
  });
});

/** Top-level annotation routes. */
export const globalAnnotationRoutes = new Hono();

/**
 * GET /annotations/domains
 * Public list of trusted domains for auto-approval.
 */
globalAnnotationRoutes.get('/domains', (c) => {
  const domains = store.listTrustedDomains();
  c.header('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=86400');
  return c.json({
    data: domains,
    meta: { timestamp: new Date().toISOString(), poweredBy: BRANDING.poweredBy },
  });
});
