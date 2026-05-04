import express from 'express';
import { pool } from '../index.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

// Get all products
router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const { category, status, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    let query = 'SELECT * FROM products WHERE 1=1';
    const params = [];

    if (category) {
      query += ' AND category_id = $' + (params.length + 1);
      params.push(category);
    }
    if (status) {
      query += ' AND status = $' + (params.length + 1);
      params.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, offset);

    const result = await pool.query(query, params);
    res.json({ products: result.rows, total: result.rowCount });
  } catch (error) {
    next(error);
  }
});

// Get product with all attributes
router.get('/:id', authenticateToken, async (req, res, next) => {
  try {
    const { id } = req.params;

    const productResult = await pool.query('SELECT * FROM products WHERE id = $1', [id]);
    if (productResult.rows.length === 0) {
      throw new AppError('Product not found', 404);
    }

    const product = productResult.rows[0];

    // Get core attributes
    const coreResult = await pool.query('SELECT * FROM product_core_attributes WHERE product_id = $1', [id]);
    const advancedResult = await pool.query('SELECT * FROM product_advanced_attributes WHERE product_id = $1', [id]);
    const aiResult = await pool.query('SELECT * FROM product_ai_optimization WHERE product_id = $1', [id]);
    const imagesResult = await pool.query('SELECT * FROM product_images WHERE product_id = $1', [id]);
    const readinessResult = await pool.query('SELECT * FROM content_readiness WHERE product_id = $1', [id]);

    res.json({
      product,
      coreAttributes: coreResult.rows[0],
      advancedAttributes: advancedResult.rows[0],
      aiOptimization: aiResult.rows[0],
      images: imagesResult.rows,
      contentReadiness: readinessResult.rows[0]
    });
  } catch (error) {
    next(error);
  }
});

// Create product
router.post('/', authenticateToken, authorizeRole('ADMIN_GLOBAL', 'PM_LOCAL'), async (req, res, next) => {
  try {
    const { sku, name, category_id, description, price, currency } = req.body;

    const result = await pool.query(
      'INSERT INTO products (id, sku, name, category_id, description, price, currency, created_by, updated_by, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *',
      [uuidv4(), sku, name, category_id, description, price, currency || 'EUR', req.user.id, req.user.id, 'DRAFT']
    );

    // Initialize readiness checklist
    await pool.query(
      'INSERT INTO content_readiness (product_id) VALUES ($1)',
      [result.rows[0].id]
    );

    res.status(201).json({ product: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Update product
router.put('/:id', authenticateToken, authorizeRole('ADMIN_GLOBAL', 'PM_LOCAL'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, description, price, currency, status } = req.body;

    const result = await pool.query(
      'UPDATE products SET name = COALESCE($1, name), description = COALESCE($2, description), price = COALESCE($3, price), currency = COALESCE($4, currency), status = COALESCE($5, status), updated_by = $6, updated_at = CURRENT_TIMESTAMP WHERE id = $7 RETURNING *',
      [name, description, price, currency, status, req.user.id, id]
    );

    if (result.rows.length === 0) {
      throw new AppError('Product not found', 404);
    }

    res.json({ product: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Update core attributes
router.put('/:id/core-attributes', authenticateToken, authorizeRole('ADMIN_GLOBAL', 'PM_LOCAL'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { product_type, intensity_level, bean_type, caffeine_mg_per_portion, sugars_g, calories_per_portion, serving_size_ml } = req.body;

    const result = await pool.query(
      'INSERT INTO product_core_attributes (product_id, product_type, intensity_level, bean_type, caffeine_mg_per_portion, sugars_g, calories_per_portion, serving_size_ml) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (product_id) DO UPDATE SET product_type = COALESCE($2, product_type), intensity_level = COALESCE($3, intensity_level), bean_type = COALESCE($4, bean_type), caffeine_mg_per_portion = COALESCE($5, caffeine_mg_per_portion), sugars_g = COALESCE($6, sugars_g), calories_per_portion = COALESCE($7, calories_per_portion), serving_size_ml = COALESCE($8, serving_size_ml), updated_at = CURRENT_TIMESTAMP RETURNING *',
      [id, product_type, intensity_level, bean_type, caffeine_mg_per_portion, sugars_g, calories_per_portion, serving_size_ml]
    );

    res.json({ coreAttributes: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Update advanced attributes
router.put('/:id/advanced-attributes', authenticateToken, authorizeRole('ADMIN_GLOBAL', 'PM_LOCAL'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { certifications, origin_country, origin_region, altitude_meters, sensory_profile, flavor_notes, consumption_moment, target_consumer_segment, sustainability_score } = req.body;

    const result = await pool.query(
      `INSERT INTO product_advanced_attributes 
       (product_id, certifications, origin_country, origin_region, altitude_meters, sensory_profile, flavor_notes, consumption_moment, target_consumer_segment, sustainability_score) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
       ON CONFLICT (product_id) DO UPDATE SET 
       certifications = COALESCE($2, certifications),
       origin_country = COALESCE($3, origin_country),
       origin_region = COALESCE($4, origin_region),
       altitude_meters = COALESCE($5, altitude_meters),
       sensory_profile = COALESCE($6, sensory_profile),
       flavor_notes = COALESCE($7, flavor_notes),
       consumption_moment = COALESCE($8, consumption_moment),
       target_consumer_segment = COALESCE($9, target_consumer_segment),
       sustainability_score = COALESCE($10, sustainability_score),
       updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [id, certifications, origin_country, origin_region, altitude_meters, sensory_profile, flavor_notes, consumption_moment, target_consumer_segment, sustainability_score]
    );

    res.json({ advancedAttributes: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

export default router;
