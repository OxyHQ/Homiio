/**
 * Tips Controller
 *
 * Serves the Tips knowledge base (renting guides, safety, legal, inspection
 * articles) from the Tip collection. Articles are seeded/managed via
 * `scripts/seedTips.ts` and gated by the `published` flag. List endpoints
 * return empty arrays (200) when nothing matches.
 */

import { Request, Response, NextFunction } from 'express';

import { Tip } from '../models';
import { logger } from '../middlewares/logging';

const LIST_PROJECTION = '-content';
const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;
const DEFAULT_FEATURED_LIMIT = 4;

function parsePagination(query: Request['query']): { page: number; limit: number; skip: number } {
  const page = Math.max(1, parseInt(String(query.page ?? '1'), 10) || 1);
  const limit = Math.min(
    MAX_PAGE_LIMIT,
    Math.max(1, parseInt(String(query.limit ?? String(DEFAULT_PAGE_LIMIT)), 10) || DEFAULT_PAGE_LIMIT)
  );
  return { page, limit, skip: (page - 1) * limit };
}

// Get all tips/articles (paginated, optional category/tag filters)
export const getAllTips = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { category, tag } = req.query;
    const { page, limit, skip } = parsePagination(req.query);

    const filters: Record<string, unknown> = { published: true };
    if (category) filters.category = String(category);
    if (tag) filters.tags = String(tag).toLowerCase();

    const [tips, total] = await Promise.all([
      Tip.find(filters)
        .select(LIST_PROJECTION)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Tip.countDocuments(filters),
    ]);

    res.json({
      success: true,
      data: tips,
      total,
      page,
      limit,
    });
  } catch (error) {
    logger.error('Failed to fetch tips', { error: error instanceof Error ? error.message : String(error) });
    next(error);
  }
};

// Get a single tip/article by articleId or slug
export const getTipById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const tip = await Tip.findOne({
      $or: [{ articleId: id }, { slug: id }],
      published: true,
    }).lean();

    if (!tip) {
      return res.status(404).json({
        success: false,
        message: 'Tip not found',
      });
    }

    res.json({
      success: true,
      data: tip,
    });
  } catch (error) {
    logger.error('Failed to fetch tip', { id: req.params.id, error: error instanceof Error ? error.message : String(error) });
    next(error);
  }
};

// Get tips by category
export const getTipsByCategory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { category } = req.params;
    const { page, limit, skip } = parsePagination(req.query);

    const filters = { category, published: true };

    const [tips, total] = await Promise.all([
      Tip.find(filters)
        .select(LIST_PROJECTION)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Tip.countDocuments(filters),
    ]);

    res.json({
      success: true,
      data: tips,
      total,
      page,
      limit,
    });
  } catch (error) {
    logger.error('Failed to fetch tips by category', { category: req.params.category, error: error instanceof Error ? error.message : String(error) });
    next(error);
  }
};

// Get featured tips
export const getFeaturedTips = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(
      MAX_PAGE_LIMIT,
      Math.max(1, parseInt(String(req.query.limit ?? String(DEFAULT_FEATURED_LIMIT)), 10) || DEFAULT_FEATURED_LIMIT)
    );

    const tips = await Tip.find({ featured: true, published: true })
      .select(LIST_PROJECTION)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    res.json({
      success: true,
      data: tips,
      total: tips.length,
    });
  } catch (error) {
    logger.error('Failed to fetch featured tips', { error: error instanceof Error ? error.message : String(error) });
    next(error);
  }
};

// Search tips (text index over title/description/content, optional category/tag filters)
export const searchTips = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { q, category, tag } = req.query;
    const { page, limit, skip } = parsePagination(req.query);

    const filters: Record<string, unknown> = { published: true };
    if (q) filters.$text = { $search: String(q) };
    if (category) filters.category = String(category);
    if (tag) filters.tags = String(tag).toLowerCase();

    const sort: { [key: string]: import('mongoose').SortOrder | { $meta: 'textScore' } } = q
      ? { score: { $meta: 'textScore' }, createdAt: -1 }
      : { createdAt: -1 };

    const [tips, total] = await Promise.all([
      Tip.find(filters)
        .select(LIST_PROJECTION)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
      Tip.countDocuments(filters),
    ]);

    res.json({
      success: true,
      data: tips,
      total,
      page,
      limit,
    });
  } catch (error) {
    logger.error('Failed to search tips', { error: error instanceof Error ? error.message : String(error) });
    next(error);
  }
};

module.exports = {
  getAllTips,
  getTipById,
  getTipsByCategory,
  getFeaturedTips,
  searchTips,
};
