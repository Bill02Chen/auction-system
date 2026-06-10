CREATE DATABASE IF NOT EXISTS auction_master DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE auction_master;

CREATE TABLE IF NOT EXISTS auctions (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    image LONGTEXT,
    description TEXT,
    start_price DECIMAL(12,2) NOT NULL DEFAULT 0,
    current_price DECIMAL(12,2) NOT NULL DEFAULT 0,
    min_increment DECIMAL(12,2) NOT NULL DEFAULT 1,
    max_price DECIMAL(12,2) NOT NULL DEFAULT 999999,
    duration INT NOT NULL DEFAULT 300,
    auto_delay_seconds INT NOT NULL DEFAULT 15,
    status ENUM('pending', 'active', 'paused', 'ended', 'cancelled') DEFAULT 'pending',
    start_time DATETIME,
    end_time DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_status (status),
    INDEX idx_end_time (end_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS bids (
    id VARCHAR(36) PRIMARY KEY,
    auction_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    user_name VARCHAR(100),
    user_avatar LONGTEXT,
    price DECIMAL(12,2) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_auction_id (auction_id),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS orders (
    id VARCHAR(36) PRIMARY KEY,
    auction_id VARCHAR(36) NOT NULL,
    winner_id VARCHAR(36) NOT NULL,
    winner_name VARCHAR(100),
    final_price DECIMAL(12,2) NOT NULL,
    status ENUM('pending_payment', 'paid', 'cancelled') DEFAULT 'pending_payment',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_auction_id (auction_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
