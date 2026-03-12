import { test, expect } from '@playwright/test';

// --- Home Page ---

test.describe('Home page', () => {
  test('loads with title and stats', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Open Legal Codes/);
    await expect(page.getByText('jurisdictions available')).toBeVisible({ timeout: 10_000 });
  });

  test('renders state grid', async ({ page }) => {
    await page.goto('/');
    const cards = page.locator('.browse-card');
    await expect(cards.first()).toBeVisible({ timeout: 10_000 });
    // 50 states + DC + possibly Federal = at least 50
    expect(await cards.count()).toBeGreaterThanOrEqual(50);
  });

  test('search finds jurisdictions', async ({ page }) => {
    await page.goto('/');
    await page.fill('input[type="search"]', 'Mountain View');
    await expect(page.locator('.card-title').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.card-title').first()).toContainText('Mountain View');
  });
});

// --- Jurisdiction Page (Mountain View, Municode) ---

test.describe('Jurisdiction page - Mountain View', () => {
  test('shows heading and breadcrumbs', async ({ page }) => {
    await page.goto('/ca/mountain-view');
    await expect(page.locator('h1')).toContainText('Mountain View', { timeout: 15_000 });
    await expect(page.locator('.breadcrumbs')).toContainText('Codes');
    await expect(page.locator('.breadcrumbs')).toContainText('CA');
  });

  test('renders TOC tree', async ({ page }) => {
    await page.goto('/ca/mountain-view');
    const tocNodes = page.locator('.toc-node');
    await expect(tocNodes.first()).toBeVisible({ timeout: 15_000 });
    expect(await tocNodes.count()).toBeGreaterThan(5);
  });

  test('search within jurisdiction works', async ({ page }) => {
    await page.goto('/ca/mountain-view');
    await expect(page.locator('.search-bar')).toBeVisible({ timeout: 15_000 });
    await page.fill('.search-bar input', 'parking');
    await page.click('.search-bar button');
    await expect(page.getByText('results')).toBeVisible({ timeout: 10_000 });
  });
});

// --- Code Viewer ---

test.describe('Code viewer', () => {
  test('displays section text and breadcrumbs', async ({ page }) => {
    await page.goto('/ca/mountain-view/part-i/article-i/section-100');
    await expect(page.locator('.section-text')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.breadcrumbs')).toContainText('Mountain View');
    await expect(page.locator('.breadcrumbs')).toContainText('part-i/article-i/section-100');
  });

  test('copy link button is visible', async ({ page }) => {
    await page.goto('/ca/mountain-view/part-i/article-i/section-100');
    await expect(page.locator('.copy-link-btn')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.copy-link-btn')).toContainText('Copy link');
  });

  test('nonexistent section shows error', async ({ page }) => {
    await page.goto('/ca/mountain-view/nonexistent-section');
    await expect(page.getByText('Section not found')).toBeVisible({ timeout: 15_000 });
  });
});

// --- Static Pages ---

test.describe('Static pages', () => {
  for (const path of ['/developers', '/faq', '/terms']) {
    test(`${path} loads without error`, async ({ page }) => {
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
    });
  }
});
