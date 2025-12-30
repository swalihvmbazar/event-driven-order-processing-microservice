const express = require('express');
const orders = require('./routes/orders');
const redis = require('./services/redis');
const db = require('./services/db');

const app = express();

// Request size limit and JSON parsing
app.use(express.json({ limit: '10mb' }));

// Request timeout middleware
app.use((req, res, next) => {
  res.setTimeout(30000, () => {
    res.status(408).json({ error: 'Request timeout' });
  });
  next();
});

// Health check endpoint with dependency validation
app.get('/health', async (req, res) => {
  try {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {}
    };

    // Check Redis connection
    try {
      await redis.ping();
      health.services.redis = 'connected';
    } catch (err) {
      health.services.redis = 'disconnected';
      health.status = 'degraded';
    }

    // Check DB connection
    try {
      await db.query('SELECT 1');
      health.services.database = 'connected';
    } catch (err) {
      health.services.database = 'disconnected';
      health.status = 'degraded';
    }

    const statusCode = health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(health);
  } catch (error) {
    res.status(503).json({ 
      status: 'unhealthy', 
      timestamp: new Date().toISOString(),
      error: error.message 
    });
  }
});

app.use('/orders', orders);

// Error handling middleware
app.use((err, req, res, next) => {
  const errorId = Date.now().toString(36) + Math.random().toString(36).substr(2);
  
  console.error(`[Error ${errorId}] ${req.method} ${req.path}:`, {
    error: err.message,
    stack: err.stack,
    body: req.body,
    params: req.params,
    query: req.query
  });
  
  // Don't leak internal errors in production
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    errorId,
    timestamp: new Date().toISOString(),
    ...(isDevelopment && { stack: err.stack })
  });
});

// 404 handler - must be last middleware
app.use((req, res, next) => {
  res.status(404).json({ 
    error: 'Route not found',
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString()
  });
});

// Startup validation
async function validateConnections() {
  try {
    console.log('Validating service connections...');
    
    // Test Redis connection
    await redis.ping();
    console.log('Redis connection successful');
    
    // Test database connection
    await db.query('SELECT 1');
    console.log('Database connection successful');
    
    return true;
  } catch (error) {
    console.error('Connection validation failed:', error.message);
    throw error;
  }
}

// Graceful shutdown handling
function gracefulShutdown(server) {
  const signals = ['SIGTERM', 'SIGINT'];
  
  signals.forEach(signal => {
    process.on(signal, async () => {
      console.log(`Received ${signal}, starting graceful shutdown...`);
      
      server.close(async () => {
        console.log('HTTP server closed');
        
        try {
          await redis.disconnect();
          console.log('Redis connection closed');
        } catch (err) {
          console.error('Error closing Redis:', err);
        }
        
        try {
          await db.end();
          console.log('Database connection closed');
        } catch (err) {
          console.error('Error closing database:', err);
        }
        
        console.log('Graceful shutdown complete');
        process.exit(0);
      });
    });
  });
}

// Start server after connection validation
const PORT = process.env.PORT || 3000;

validateConnections()
  .then(() => {
    const server = app.listen(PORT, () => {
      console.log(`API server running on port ${PORT}`);
    });
    
    gracefulShutdown(server);
  })
  .catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
