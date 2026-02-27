package db

import (
	"context"
	"fmt"
	"log"
)

// Migrate 自动创建数据库表
func (d *DB) Migrate() error {
	log.Println("Running database migration...")

	// 创建用户表
	if err := d.createUsersTable(); err != nil {
		return fmt.Errorf("create users table: %w", err)
	}

	// 创建视频表
	if err := d.createVideosTable(); err != nil {
		return fmt.Errorf("create videos table: %w", err)
	}

	log.Println("Database migration completed")
	return nil
}

// createUsersTable 创建用户表
func (d *DB) createUsersTable() error {
	sql := `
	CREATE TABLE IF NOT EXISTS users (
		id BIGSERIAL PRIMARY KEY,
		username VARCHAR(32) UNIQUE NOT NULL,
		email VARCHAR(255) UNIQUE NOT NULL,
		password_hash VARCHAR(255) NOT NULL,
		avatar VARCHAR(500) DEFAULT '',
		bio TEXT DEFAULT '',
		created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
	);

	-- 创建索引
	CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
	CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
	`

	_, err := d.pool.Exec(context.Background(), sql)
	if err != nil {
		return err
	}

	log.Println("Table 'users' created or already exists")
	return nil
}

// createVideosTable 创建视频表
func (d *DB) createVideosTable() error {
	sql := `
	CREATE TABLE IF NOT EXISTS videos (
		id BIGSERIAL PRIMARY KEY,
		user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		title VARCHAR(200) NOT NULL,
		description TEXT DEFAULT '',
		status VARCHAR(20) DEFAULT 'pending',
		progress INTEGER DEFAULT 0, -- 0-100
		r2_raw_key VARCHAR(500) DEFAULT '', -- R2 原始文件路径
		original_size BIGINT DEFAULT 0,
		duration INTEGER DEFAULT 0, -- 秒
		hls_path VARCHAR(500) DEFAULT '', -- HLS 相对路径
		error_msg TEXT DEFAULT '',
		expires_at TIMESTAMP WITH TIME ZONE DEFAULT NULL, -- 过期时间（3天后）
		created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
	);

	CREATE INDEX IF NOT EXISTS idx_videos_user_id ON videos(user_id);
	CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);
	CREATE INDEX IF NOT EXISTS idx_videos_expires_at ON videos(expires_at);
	`

	_, err := d.pool.Exec(context.Background(), sql)
	if err != nil {
		return err
	}

	log.Println("Table 'videos' created or already exists")
	return nil
}

// DropTables 删除所有表（危险操作，仅测试用）
func (d *DB) DropTables() error {
	log.Println("Dropping all tables...")

	sql := `
	DROP TABLE IF EXISTS videos CASCADE;
	DROP TABLE IF EXISTS users CASCADE;
	`

	_, err := d.pool.Exec(context.Background(), sql)
	if err != nil {
		return err
	}

	log.Println("All tables dropped")
	return nil
}
