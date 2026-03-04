package db

import (
	"context"
	"fmt"
	"log"
	"time"

	"misty-isle/cfg"
	"misty-isle/model"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DB 数据库连接池
type DB struct {
	pool *pgxpool.Pool
}

// Connect 创建数据库连接
func Connect(cfg *cfg.Config) (*DB, error) {
	dsn := fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=disable",
		cfg.DBUser,
		cfg.DBPassword,
		cfg.DBHost,
		cfg.DBPort,
		cfg.DBName,
	)

	if cfg.DBDSN != "" {
		dsn = cfg.DBDSN
	}

	poolConfig, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse cfg: %w", err)
	}

	// 连接池配置
	poolConfig.MaxConns = 10
	poolConfig.MinConns = 2
	poolConfig.MaxConnLifetime = time.Hour
	poolConfig.MaxConnIdleTime = 30 * time.Minute

	pool, err := pgxpool.NewWithConfig(context.Background(), poolConfig)
	if err != nil {
		return nil, fmt.Errorf("connect postgres: %w", err)
	}

	// 验证连接
	if err := pool.Ping(context.Background()); err != nil {
		return nil, fmt.Errorf("ping postgres: %w", err)
	}

	log.Println("PostgreSQL connected")

	return &DB{pool: pool}, nil
}

// Close 关闭连接
func (d *DB) Close() {
	if d.pool != nil {
		d.pool.Close()
		log.Println("PostgreSQL disconnected")
	}
}

// Pool 获取连接池
func (d *DB) Pool() *pgxpool.Pool {
	return d.pool
}

// Exec 执行 SQL
func (d *DB) Exec(ctx context.Context, sql string, args ...interface{}) error {
	_, err := d.pool.Exec(ctx, sql, args...)
	return err
}

// QueryRow 查询单行
func (d *DB) QueryRow(ctx context.Context, sql string, args ...interface{}) pgx.Row {
	return d.pool.QueryRow(ctx, sql, args...)
}

// Query 查询多行
func (d *DB) Query(ctx context.Context, sql string, args ...interface{}) (pgx.Rows, error) {
	return d.pool.Query(ctx, sql, args...)
}

// Transaction 执行事务
func (d *DB) Transaction(ctx context.Context, fn func(tx pgx.Tx) error) error {
	tx, err := d.pool.Begin(ctx)
	if err != nil {
		return err
	}

	defer func() {
		if err != nil {
			tx.Rollback(ctx)
		} else {
			err = tx.Commit(ctx)
		}
	}()

	return fn(tx)
}

// ============ 用户相关方法 ============

// CreateUser 创建用户
func (d *DB) CreateUser(user *model.User) error {
	sql := `
		INSERT INTO users (username, email, password_hash, avatar, bio, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id
	`
	return d.pool.QueryRow(context.Background(), sql,
		user.Username,
		user.Email,
		user.PasswordHash,
		user.Avatar,
		user.Bio,
		user.CreatedAt,
		user.UpdatedAt,
	).Scan(&user.ID)
}

// GetUserByID 根据ID获取用户
func (d *DB) GetUserByID(userID uint64) (*model.User, error) {
	sql := `
		SELECT id, username, email, password_hash, avatar, bio, created_at, updated_at
		FROM users WHERE id = $1
	`
	user := &model.User{}
	err := d.pool.QueryRow(context.Background(), sql, userID).Scan(
		&user.ID,
		&user.Username,
		&user.Email,
		&user.PasswordHash,
		&user.Avatar,
		&user.Bio,
		&user.CreatedAt,
		&user.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return user, nil
}

// GetUserByEmail 根据邮箱获取用户
func (d *DB) GetUserByEmail(email string) (*model.User, error) {
	sql := `
		SELECT id, username, email, password_hash, avatar, bio, created_at, updated_at
		FROM users WHERE email = $1
	`
	user := &model.User{}
	err := d.pool.QueryRow(context.Background(), sql, email).Scan(
		&user.ID,
		&user.Username,
		&user.Email,
		&user.PasswordHash,
		&user.Avatar,
		&user.Bio,
		&user.CreatedAt,
		&user.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return user, nil
}

// CheckEmailExists 检查邮箱是否已存在
func (d *DB) CheckEmailExists(email string) (bool, error) {
	var exists bool
	sql := `SELECT EXISTS(SELECT 1 FROM users WHERE email = $1)`
	err := d.pool.QueryRow(context.Background(), sql, email).Scan(&exists)
	return exists, err
}

// CheckUsernameExists 检查用户名是否已存在
func (d *DB) CheckUsernameExists(username string) (bool, error) {
	var exists bool
	sql := `SELECT EXISTS(SELECT 1 FROM users WHERE username = $1)`
	err := d.pool.QueryRow(context.Background(), sql, username).Scan(&exists)
	return exists, err
}

// UpdateUser 更新用户信息
func (d *DB) UpdateUser(userID uint64, updates map[string]interface{}) error {
	if len(updates) == 0 {
		return nil
	}

	// 动态构建 SQL
	setParts := make([]string, 0, len(updates))
	args := make([]interface{}, 0, len(updates)+1)
	argIdx := 1

	for field, value := range updates {
		setParts = append(setParts, fmt.Sprintf("%s = $%d", field, argIdx))
		args = append(args, value)
		argIdx++
	}

	args = append(args, userID)
	sql := fmt.Sprintf("UPDATE users SET %s WHERE id = $%d",
		joinStrings(setParts, ", "), argIdx)

	_, err := d.pool.Exec(context.Background(), sql, args...)
	return err
}

// ============ 视频相关方法 ============

// CreateVideo 创建视频记录
func (d *DB) CreateVideo(video *model.Video) error {
	sql := `
		INSERT INTO videos (user_id, title, description, status, r2_raw_key, original_size, expires_at, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id
	`
	return d.pool.QueryRow(context.Background(), sql,
		video.UserID,
		video.Title,
		video.Description,
		video.Status,
		video.R2RawKey,
		video.OriginalSize,
		video.ExpiresAt,
		video.CreatedAt,
		video.UpdatedAt,
	).Scan(&video.ID)
}

// GetVideoByID 根据ID获取视频（自动过滤过期记录）
func (d *DB) GetVideoByID(videoID uint64) (*model.Video, error) {
	sql := `
		SELECT id, user_id, title, description, status, progress, r2_raw_key, original_size,
			duration, hls_path, error_msg, expires_at, created_at, updated_at
		FROM videos
		WHERE id = $1 AND (expires_at IS NULL OR expires_at > NOW())
	`
	video := &model.Video{}
	err := d.pool.QueryRow(context.Background(), sql, videoID).Scan(
		&video.ID, &video.UserID, &video.Title, &video.Description,
		&video.Status, &video.Progress, &video.R2RawKey, &video.OriginalSize,
		&video.Duration, &video.HLSPath, &video.ErrorMsg, &video.ExpiresAt,
		&video.CreatedAt, &video.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return video, nil
}

// GetVideosByUserID 获取用户的视频列表（自动过滤过期记录）
func (d *DB) GetVideosByUserID(userID uint64) ([]*model.Video, error) {
	sql := `
		SELECT id, user_id, title, description, status, progress, r2_raw_key, original_size,
			duration, hls_path, error_msg, expires_at, created_at, updated_at
		FROM videos
		WHERE user_id = $1 AND (expires_at IS NULL OR expires_at > NOW())
		ORDER BY created_at DESC
	`
	rows, err := d.pool.Query(context.Background(), sql, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var videos []*model.Video
	for rows.Next() {
		video := &model.Video{}
		err := rows.Scan(
			&video.ID, &video.UserID, &video.Title, &video.Description,
			&video.Status, &video.Progress, &video.R2RawKey, &video.OriginalSize,
			&video.Duration, &video.HLSPath, &video.ErrorMsg, &video.ExpiresAt,
			&video.CreatedAt, &video.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}
		videos = append(videos, video)
	}
	return videos, nil
}

// UpdateVideo 更新视频信息
func (d *DB) UpdateVideo(videoID uint64, updates map[string]interface{}) error {
	if len(updates) == 0 {
		return nil
	}

	setParts := make([]string, 0, len(updates))
	args := make([]interface{}, 0, len(updates)+1)
	argIdx := 1

	for field, value := range updates {
		setParts = append(setParts, fmt.Sprintf("%s = $%d", field, argIdx))
		args = append(args, value)
		argIdx++
	}

	args = append(args, videoID)
	sql := fmt.Sprintf("UPDATE videos SET %s WHERE id = $%d",
		joinStrings(setParts, ", "), argIdx)

	_, err := d.pool.Exec(context.Background(), sql, args...)
	return err
}

// DeleteVideo 删除视频记录（仅删除数据库记录，不删除 R2 文件）
func (d *DB) DeleteVideo(videoID uint64, userID uint64) error {
	sql := `DELETE FROM videos WHERE id = $1 AND user_id = $2`
	result, err := d.pool.Exec(context.Background(), sql, videoID, userID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// CleanupExpiredVideos 清理过期视频记录（定时任务调用）
func (d *DB) CleanupExpiredVideos() (int64, error) {
	sql := `DELETE FROM videos WHERE expires_at IS NOT NULL AND expires_at <= NOW()`
	result, err := d.pool.Exec(context.Background(), sql)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected(), nil
}

// joinStrings 辅助函数
func joinStrings(strs []string, sep string) string {
	result := ""
	for i, s := range strs {
		if i > 0 {
			result += sep
		}
		result += s
	}
	return result
}
