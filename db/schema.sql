CREATE DATABASE IF NOT EXISTS orders_db;

USE orders_db;

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
  
  -- Indexes for performance
  UNIQUE KEY unique_order_id (order_id),
  INDEX idx_status_created (status, created_at),
  INDEX idx_created_at (created_at),
  INDEX idx_updated_at (updated_at),
  INDEX idx_amount_range (amount),
  
  -- Full-text search on order_id if needed
  FULLTEXT KEY ft_order_id (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
