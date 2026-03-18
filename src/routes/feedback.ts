import { Hono } from 'hono';
import { store } from '../store/index.js';
import { CodeWriter } from '../store/writer.js';
import { BRANDING } from '../branding.js';

const VALID_TYPES = ['bad_citation', 'out_of_date', 'wrong_text', 'other'] as const;
const MAX_DESCRIPTION_LENGTH = 2000;
const RATE_LIMIT_PER_HOUR = 10;

export const feedbackRoutes = new Hono();

/**
 * POST /jurisdictions/:id/feedback
 * Submit a feedback report for a code section.
 */
feedbackRoutes.post('/:id/feedback', async (c) => {
  const id = c.req.param('id');

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400);
  }

  const { path, reportType, description } = body;

  if (!path || typeof path !== 'string') {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'path is required' } }, 400);
  }
  if (!reportType || !VALID_TYPES.includes(reportType)) {
    return c.json({
      error: { code: 'BAD_REQUEST', message: `reportType must be one of: ${VALID_TYPES.join(', ')}` },
    }, 400);
  }
  if (description && typeof description === 'string' && description.length > MAX_DESCRIPTION_LENGTH) {
    return c.json({
      error: { code: 'BAD_REQUEST', message: `description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer` },
    }, 400);
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
    const recentCount = store.countRecentFeedback(ip, 60);
    if (recentCount >= RATE_LIMIT_PER_HOUR) {
      return c.json({
        error: { code: 'RATE_LIMITED', message: 'Too many reports. Please try again later.' },
      }, 429);
    }
  }

  const writer = new CodeWriter();
  const feedbackId = writer.createFeedback({
    jurisdictionId: id,
    path,
    reportType,
    description: (description || '').trim(),
    ipAddress: ip,
  });

  return c.json({
    data: { id: feedbackId, status: 'pending' },
    meta: { timestamp: new Date().toISOString(), poweredBy: BRANDING.poweredBy },
  }, 201);
});

/**
 * GET /jurisdictions/:id/feedback
 * List feedback reports for a jurisdiction.
 */
feedbackRoutes.get('/:id/feedback', (c) => {
  const id = c.req.param('id');
  const status = c.req.query('status') || undefined;
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 200);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  const rows = store.listFeedback({ jurisdictionId: id, status, limit, offset });

  return c.json({
    data: rows,
    meta: { timestamp: new Date().toISOString(), poweredBy: BRANDING.poweredBy },
  });
});

/** Top-level feedback route for listing all feedback across jurisdictions. */
export const globalFeedbackRoutes = new Hono();

globalFeedbackRoutes.get('/', (c) => {
  const status = c.req.query('status') || undefined;
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 200);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  const rows = store.listFeedback({ status, limit, offset });

  return c.json({
    data: rows,
    meta: { timestamp: new Date().toISOString(), poweredBy: BRANDING.poweredBy },
  });
});
