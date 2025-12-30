const redis = require('./services/redis');
const db = require('./services/db');

console.log('🚀 Starting worker service...');

// Graceful shutdown handling
let isShuttingDown = false;

function gracefulShutdown() {
  const signals = ['SIGTERM', 'SIGINT'];
  
  signals.forEach(signal => {
    process.on(signal, async () => {
      if (isShuttingDown) return;
      
      console.log(`🚨 Received ${signal}, starting graceful shutdown...`);
      isShuttingDown = true;
      
      try {
        console.log('💾 Closing Redis connection...');
        await redis.disconnect();
        console.log('✓ Redis connection closed');
      } catch (err) {
        console.error('❌ Error closing Redis:', err);
      }
      
      try {
        console.log('💾 Closing database connection...');
        await db.end();
        console.log('✓ Database connection closed');
      } catch (err) {
        console.error('❌ Error closing database:', err);
      }
      
      console.log('✓ Graceful shutdown complete');
      process.exit(0);
    });
  });
}

// Connection validation
async function validateConnections() {
  try {
    console.log('🔍 Validating service connections...');
    
    // Test Redis connection
    await redis.ping();
    console.log('✓ Worker connected to Redis');
    
    // Test database connection
    await db.query('SELECT 1');
    console.log('✓ Worker connected to database');
    
    return true;
  } catch (error) {
    console.error('❌ Connection validation failed:', error.message);
    throw error;
  }
}

async function processOrders() {
  try {
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 5;
    
    while (!isShuttingDown) {
      try {
        const results = await redis.xread(
          'BLOCK', 5000, // 5 second timeout
          'STREAMS', 'orders_stream', '$'
        );

        if (!results) {
          // Reset error counter on successful operation
          consecutiveErrors = 0;
          continue;
        }

        for (const [streamName, messages] of results) {
          for (const [messageId, fields] of messages) {
            if (isShuttingDown) {
              console.log('⚠️ Shutdown requested, stopping message processing');
              return;
            }
            
            console.log(`📦 Processing message: ${messageId}`);
            
            try {
              // Convert Redis fields array to object
              const data = {};
              for (let i = 0; i < fields.length; i += 2) {
                data[fields[i]] = fields[i + 1];
              }

              const { order_id, amount, customer_id, description, created_at } = data;
              
              if (!order_id || !amount) {
                console.error(`❌ Invalid message data: ${JSON.stringify(data)}`);
                continue;
              }
              
              const amountNum = Number(amount);
              if (!Number.isFinite(amountNum) || amountNum <= 0) {
                console.error(`❌ Invalid amount for order ${order_id}: ${amount}`);
                continue;
              }
              
              const tax = Math.round(amountNum * 0.18 * 10000) / 10000; // Round to 4 decimal places
              const total = Math.round((amountNum + tax) * 10000) / 10000;

              console.log(`📊 Processing order ${order_id}: amount=$${amountNum}, tax=$${tax}, total=$${total}`);

              // Save to database with status tracking
              await db.query(
                `INSERT INTO orders (order_id, amount, tax, total, status, processed_at)
                 VALUES (?, ?, ?, ?, 'completed', NOW())
                 ON DUPLICATE KEY UPDATE
                 amount = VALUES(amount), 
                 tax = VALUES(tax), 
                 total = VALUES(total),
                 status = VALUES(status),
                 processed_at = VALUES(processed_at),
                 updated_at = NOW()`,
                [order_id, amountNum, tax, total]
              );

              // Update cache with enriched data
              const orderData = {
                order_id,
                amount: amountNum,
                tax,
                total,
                status: 'completed',
                customer_id: customer_id || null,
                description: description || null,
                created_at: created_at || new Date().toISOString(),
                processed_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              };
              
              await redis.setex(`order:${order_id}`, 3600, JSON.stringify(orderData));
              
              console.log(`✓ Order ${order_id} processed successfully`);
              
              // Reset error counter on successful processing
              consecutiveErrors = 0;
              
            } catch (processingError) {
              console.error(`❌ Error processing message ${messageId}:`, {
                error: processingError.message,
                stack: processingError.stack,
                data: data
              });
            }
          }
        }
      } catch (err) {
        consecutiveErrors++;
        console.error(`❌ Error in message processing loop (${consecutiveErrors}/${maxConsecutiveErrors}):`, {
          error: err.message,
          stack: err.stack
        });
        
        if (consecutiveErrors >= maxConsecutiveErrors) {
          console.error('❌ Too many consecutive errors, restarting worker...');
          throw err;
        }
        
        // Exponential backoff
        const delay = Math.min(1000 * Math.pow(2, consecutiveErrors - 1), 30000);
        console.log(`⏳ Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  } catch (err) {
    console.error('❌ Fatal error in worker:', err);
    
    if (!isShuttingDown) {
      console.log('♻️ Attempting to restart in 5 seconds...');
      setTimeout(() => {
        if (!isShuttingDown) {
          processOrders(); // Restart processing
        }
      }, 5000);
    }
  }
}

// Initialize worker
async function initializeWorker() {
  try {
    await validateConnections();
    gracefulShutdown(); // Setup shutdown handlers
    
    console.log('🔄 Starting order processing...');
    await processOrders();
  } catch (error) {
    console.error('❌ Failed to initialize worker:', error);
    process.exit(1);
  }
}

// Start the worker
initializeWorker();
