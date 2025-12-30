# Event-Driven Orders System - PRODUCTION READY ✨

A robust, scalable event-driven order processing system built with Node.js, Redis Streams, and MySQL. This system demonstrates clean architecture with proper separation between API and worker services.

## 🏗️ Architecture Overview

```
┌─────────────────┐    ┌──────────────┐    ┌─────────────────┐
│                 │    │              │    │                 │
│   API Service   │───▶│ Redis Streams│───▶│  Worker Service │
│   (Express.js)  │    │   (Queue)    │    │   (Processor)   │
│                 │    │              │    │                 │
└─────────────────┘    └──────────────┘    └─────────────────┘
         │                      │                      │
         │                      │                      │
         ▼                      ▼                      ▼
┌─────────────────┐    ┌──────────────┐    ┌─────────────────┐
│                 │    │              │    │                 │
│ Redis Cache     │    │    MySQL     │◀───│    Database     │
│ (Fast Access)   │    │  (Persistent)│    │   Operations    │
│                 │    │              │    │                 │
└─────────────────┘    └──────────────┘    └─────────────────┘
```

## 🚀 Quick Start

### Prerequisites
- Docker & Docker Compose
- Git

### Start the System
```bash
# Clone and start
git clone <repository>
cd event-driven-orders

# Start all services
docker-compose up --build

# Verify health
curl http://localhost:3000/health
```

### Test the System
```bash
# Create an order
curl -X POST http://localhost:3000/orders \\
  -H "Content-Type: application/json" \\
  -d '{"order_id": "test-001", "amount": 100.00}'

# Get order status
curl http://localhost:3000/orders/test-001

# View metrics
curl http://localhost:3000/metrics
```

## 📁 Project Structure

```
event-driven-orders/
├── api/                        # API Service
│   ├── src/
│   │   ├── app.js             # Main application
│   │   ├── routes/
│   │   │   ├── orders.js      # Order endpoints
│   │   │   └── monitoring.js  # Health & metrics
│   │   └── services/
│   │       ├── db.js          # Database connection
│   │       └── redis.js       # Redis connection
│   ├── Dockerfile             # Multi-stage production build
│   └── package.json
├── worker/                     # Worker Service
│   ├── src/
│   │   ├── worker.js          # Message processor
│   │   └── services/
│   │       ├── db.js          # Database connection
│   │       └── redis.js       # Redis connection
│   ├── Dockerfile             # Multi-stage production build
│   └── package.json
├── db/
│   └── schema.sql             # Database schema with indexes
├── docker-compose.yml         # Full stack orchestration
└── README.md                  # This file
```

## 🔗 API Endpoints

### Order Management
- `POST /orders` - Create new order
- `GET /orders/:id` - Get order status

### Monitoring
- `GET /health` - Health check with dependency status

## Technical Details

### Database Schema
```sql
CREATE TABLE orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id VARCHAR(100) NOT NULL,
  amount DECIMAL(12,4) NOT NULL,
  tax DECIMAL(12,4) NOT NULL,
  total DECIMAL(12,4) NOT NULL,
  status ENUM('processing', 'completed', 'failed') DEFAULT 'processing',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  processed_at TIMESTAMP NULL,
  
  -- Performance indexes
  UNIQUE KEY unique_order_id (order_id),
  INDEX idx_status_created (status, created_at),
  INDEX idx_created_at (created_at),
  INDEX idx_amount_range (amount)
);
```

### Cache Strategy
1. **Write-through**: Data written to both cache and database
2. **Cache-aside**: Read from cache first, fallback to database
3. **TTL Management**: 1-hour expiry with sliding window on access
4. **Error Tolerance**: Graceful degradation if cache unavailable

### Message Processing
- **Redis Streams**: Reliable message queuing
- **Automatic Retry**: Exponential backoff on failures
- **Error Isolation**: Failed messages don't block processing
- **Graceful Shutdown**: Complete current messages before exit

## Configuration

### Environment Variables
```bash
# API Service
PORT=3000
REDIS_HOST=redis
REDIS_PORT=6379
DB_HOST=db
DB_USER=root
DB_PASSWORD=root
DB_NAME=orders_db

# Worker Service  
REDIS_HOST=redis
REDIS_PORT=6379
DB_HOST=db
DB_USER=root
DB_PASSWORD=root
DB_NAME=orders_db
```

## Monitoring

### Health Check Response
```json
{
  "status": "healthy",
  "timestamp": "2025-12-30T10:00:00Z",
  "services": {
    "redis": "connected",
    "database": "connected"
  }
}
```

### Metrics Response
```json
{
  "timestamp": "2025-12-30T10:00:00Z",
  "uptime": 3600,
  "memory": { "rss": 50331648, "heapUsed": 20971520 },
  "services": {
    "redis": {
      "status": "connected",
      "total_commands_processed": 1000,
      "instantaneous_ops_per_sec": 10
    },
    "database": {
      "status": "connected",
      "stats": {
        "total_orders": 500,
        "completed_orders": 485,
        "processing_orders": 15,
        "total_revenue": 50000.00
      }
    }
  }
}
```

## Security Features

- **Non-root containers**: Services run as unprivileged users
- **Input validation**: Comprehensive request validation
- **Error handling**: No sensitive data in error responses
- **Health isolation**: Health checks don't expose internal details
- **Resource limits**: Built-in timeouts and rate limiting

## Production Readiness

### Deployment
- Multi-stage Docker builds for minimal attack surface
- Health checks for orchestration platforms
- Graceful shutdown for zero-downtime deployments
- Environment-based configuration

### Scaling
- Stateless services for horizontal scaling
- Database connection pooling
- Redis clustering support
- Load balancer ready endpoints

### Monitoring
- Structured logging with correlation IDs
- Application metrics endpoint
- Database performance metrics
- Error tracking with unique identifiers

## Troubleshooting

### Common Issues
1. **Connection errors**: Check health endpoint for service status
2. **Processing delays**: Monitor metrics endpoint for queue depth
3. **Memory issues**: Check metrics for memory usage trends

### Logs
```bash
# View API logs
docker-compose logs -f api

# View worker logs  
docker-compose logs -f worker

# View all logs
docker-compose logs -f
```

### Debug Mode
```bash
# Start with debug logging
NODE_ENV=development docker-compose up
```