const express = require('express');
const redis = require('../services/redis');
const db = require('../services/db');

const router = express.Router();

/**
 * POST /orders
 * Creates a new order and publishes it to the queue
 */
router.post('/', async (req, res) => {
  try {
    const { order_id, amount } = req.body;

    // Comprehensive input validation
    if (!order_id || !amount) {
      return res.status(400).json({ 
        error: 'Missing required fields: order_id and amount' 
      });
    }

    // Validate order_id format (alphanumeric, hyphens, underscores)
    if (!/^[a-zA-Z0-9_-]+$/.test(order_id) || order_id.length > 100) {
      return res.status(400).json({ 
        error: 'Invalid order_id format. Use alphanumeric characters, hyphens, or underscores (max 100 chars)' 
      });
    }

    // Validate amount
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > 999999.9999) {
      return res.status(400).json({ 
        error: 'Amount must be a positive number less than 1,000,000' 
      });
    }

    // Check if order already exists
    const existingOrder = await redis.get(`order:${order_id}`);
    if (existingOrder) {
      return res.status(409).json({
        error: 'Order already exists',
        order_id,
        existing_order: JSON.parse(existingOrder)
      });
    }

    // Check database as fallback
    const [existingRows] = await db.query(
      'SELECT order_id, status FROM orders WHERE order_id = ?',
      [order_id]
    );
    
    if (existingRows.length > 0) {
      const existing = existingRows[0];
      return res.status(409).json({
        error: 'Order already exists in database',
        order_id,
        status: existing.status
      });
    }

    // Publish to Redis stream with additional metadata
    const messageData = {
      order_id,
      amount: numericAmount,
      created_at: new Date().toISOString(),
      request_ip: req.ip || req.connection.remoteAddress
    };

    const streamArgs = ['orders_stream', '*'];
    Object.entries(messageData).forEach(([key, value]) => {
      if (value !== null && value !== undefined) {
        streamArgs.push(key, value.toString());
      }
    });

    await redis.xadd(...streamArgs);

    console.log(`Order ${order_id} queued for processing (amount: $${numericAmount})`);
    
    res.status(201).json({ 
      status: 'queued', 
      order_id, 
      amount: numericAmount,
      message: 'Order submitted for processing',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error(`Error creating order:`, {
      error: error.message,
      stack: error.stack,
      body: req.body
    });
    res.status(500).json({ 
      error: 'Failed to queue order',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /orders/:order_id
 * Retrieves order details, first from cache then from database
 */
router.get('/:order_id', async (req, res) => {
  try {
    const { order_id } = req.params;

    if (!order_id || order_id.trim().length === 0) {
      return res.status(400).json({ 
        error: 'Order ID is required and cannot be empty' 
      });
    }

    // Validate order_id format
    if (!/^[a-zA-Z0-9_-]+$/.test(order_id) || order_id.length > 100) {
      return res.status(400).json({ 
        error: 'Invalid order_id format' 
      });
    }

    console.log(`Retrieving order: ${order_id}`);

    // 1. Check Redis cache first (with error handling)
    let cached;
    try {
      cached = await redis.get(`order:${order_id}`);
      if (cached) {
        const orderData = JSON.parse(cached);
        console.log(`Order ${order_id} served from cache`);
        
        // Extend cache TTL on access (sliding window)
        await redis.expire(`order:${order_id}`, 3600);
        
        return res.json({
          ...orderData,
          cache_hit: true,
          retrieved_at: new Date().toISOString()
        });
      }
    } catch (cacheError) {
      console.warn(`Cache read error for order ${order_id}:`, cacheError.message);
      // Continue to database lookup
    }

    // 2. Check database if not in cache
    console.log(`Cache miss for order ${order_id}, checking database...`);
    
    const [rows] = await db.query(
      `SELECT order_id, amount, tax, total, status, 
              created_at, updated_at, processed_at 
       FROM orders 
       WHERE order_id = ?`,
      [order_id]
    );

    if (!rows.length) {
      return res.status(404).json({ 
        error: 'Order not found or not processed yet',
        order_id,
        suggestion: 'Order may still be processing. Try again in a few seconds.'
      });
    }

    const order = rows[0];
    
    // Enrich order data
    const enrichedOrder = {
      ...order,
      cache_hit: false,
      retrieved_at: new Date().toISOString(),
      // Convert decimals to numbers for JSON response
      amount: Number(order.amount),
      tax: Number(order.tax),
      total: Number(order.total)
    };
    
    // Cache the result for future requests (with error handling)
    try {
      const cacheData = JSON.stringify(enrichedOrder);
      await redis.setex(`order:${order_id}`, 3600, cacheData); // 1 hour cache
      console.log(`Order ${order_id} cached for future requests`);
    } catch (cacheError) {
      console.warn(`Failed to cache order ${order_id}:`, cacheError.message);
      // Don't fail the request if caching fails
    }
    
    console.log(`Order ${order_id} served from database`);
    res.json(enrichedOrder);
  } catch (error) {
    console.error(`Error retrieving order ${req.params.order_id}:`, {
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({ 
      error: 'Failed to retrieve order',
      order_id: req.params.order_id,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
