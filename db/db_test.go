package db

import (
	"fmt"
	"misty-isle/cfg"
	"misty-isle/model"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 测试数据库配置（使用测试数据库）
func getTestConfig() *cfg.Config {
	return &cfg.Config{
		DBHost:     "localhost",
		DBPort:     5432,
		DBUser:     "postgres",
		DBPassword: "ghy030608",
		DBName:     "misty_isle_test", // 测试数据库
	}
}

// 设置测试环境
func setupTestDB(t *testing.T) *DB {
	conf := getTestConfig()
	db, err := Connect(conf)
	require.NoError(t, err, "Failed to connect to test database")

	// 删除并重建表
	err = db.DropTables()
	require.NoError(t, err, "Failed to drop tables")

	err = db.Migrate()
	require.NoError(t, err, "Failed to migrate tables")

	return db
}

// 清理测试环境
func teardownTestDB(t *testing.T, db *DB) {
	db.Close()
}

// 创建测试用户
func createTestUser(t *testing.T, db *DB) *model.User {
	user := &model.User{
		Username:     "testuser",
		Email:        "test@example.com",
		PasswordHash: "hashed_password",
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}

	err := db.CreateUser(user)
	require.NoError(t, err)
	require.NotZero(t, user.ID)

	return user
}

// 测试创建视频
func TestCreateVideo(t *testing.T) {
	db := setupTestDB(t)
	defer teardownTestDB(t, db)

	user := createTestUser(t, db)

	video := &model.Video{
		UserID:       user.ID,
		Title:        "Test Video",
		Description:  "Test Description",
		Status:       model.VideoStatusPending,
		R2RawKey:     "uploads/raw/123.mp4",
		OriginalSize: 1024000,
		ExpiresAt:    time.Now().Add(3 * 24 * time.Hour),
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}

	err := db.CreateVideo(video)
	assert.NoError(t, err)
	assert.NotZero(t, video.ID)
}

// 测试获取视频
func TestGetVideoByID(t *testing.T) {
	db := setupTestDB(t)
	defer teardownTestDB(t, db)

	user := createTestUser(t, db)

	// 创建视频
	original := &model.Video{
		UserID:      user.ID,
		Title:       "Test Video",
		Description: "Test Description",
		Status:      model.VideoStatusPending,
		R2RawKey:    "uploads/raw/123.mp4",
		ExpiresAt:   time.Now().Add(3 * 24 * time.Hour),
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	err := db.CreateVideo(original)
	require.NoError(t, err)

	// 获取视频
	fetched, err := db.GetVideoByID(original.ID)
	assert.NoError(t, err)
	assert.Equal(t, original.ID, fetched.ID)
	assert.Equal(t, original.Title, fetched.Title)
	assert.Equal(t, original.R2RawKey, fetched.R2RawKey)
}

// 测试过期视频过滤
func TestGetVideoByID_ExpiredFiltered(t *testing.T) {
	db := setupTestDB(t)
	defer teardownTestDB(t, db)

	user := createTestUser(t, db)

	// 创建已过期的视频
	expiredVideo := &model.Video{
		UserID:    user.ID,
		Title:     "Expired Video",
		Status:    model.VideoStatusReady,
		R2RawKey:  "uploads/raw/expired.mp4",
		ExpiresAt: time.Now().Add(-1 * time.Hour), // 1小时前过期
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	err := db.CreateVideo(expiredVideo)
	require.NoError(t, err)

	// 尝试获取已过期的视频（应该返回 not found）
	_, err = db.GetVideoByID(expiredVideo.ID)
	assert.Error(t, err, "Should not return expired video")
}

// 测试获取用户视频列表
func TestGetVideosByUserID(t *testing.T) {
	db := setupTestDB(t)
	defer teardownTestDB(t, db)

	user := createTestUser(t, db)

	// 创建多个视频
	for i := 0; i < 3; i++ {
		video := &model.Video{
			UserID:    user.ID,
			Title:     fmt.Sprintf("Video %d", i),
			Status:    model.VideoStatusPending,
			R2RawKey:  fmt.Sprintf("uploads/raw/%d.mp4", i),
			ExpiresAt: time.Now().Add(3 * 24 * time.Hour),
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		}
		err := db.CreateVideo(video)
		require.NoError(t, err)
	}

	// 获取列表
	videos, err := db.GetVideosByUserID(user.ID)
	assert.NoError(t, err)
	assert.Len(t, videos, 3)
}

// 测试过期视频列表过滤
func TestGetVideosByUserID_FilterExpired(t *testing.T) {
	db := setupTestDB(t)
	defer teardownTestDB(t, db)

	user := createTestUser(t, db)

	// 创建2个有效视频
	for i := 0; i < 2; i++ {
		video := &model.Video{
			UserID:    user.ID,
			Title:     fmt.Sprintf("Valid Video %d", i),
			Status:    model.VideoStatusReady,
			R2RawKey:  fmt.Sprintf("uploads/raw/valid%d.mp4", i),
			ExpiresAt: time.Now().Add(3 * 24 * time.Hour),
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		}
		err := db.CreateVideo(video)
		require.NoError(t, err)
	}

	// 创建1个过期视频
	expiredVideo := &model.Video{
		UserID:    user.ID,
		Title:     "Expired Video",
		Status:    model.VideoStatusReady,
		R2RawKey:  "uploads/raw/expired.mp4",
		ExpiresAt: time.Now().Add(-1 * time.Hour),
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	err := db.CreateVideo(expiredVideo)
	require.NoError(t, err)

	// 获取列表（应该只返回2个有效视频）
	videos, err := db.GetVideosByUserID(user.ID)
	assert.NoError(t, err)
	assert.Len(t, videos, 2, "Should only return non-expired videos")
}

// 测试更新视频
func TestUpdateVideo(t *testing.T) {
	db := setupTestDB(t)
	defer teardownTestDB(t, db)

	user := createTestUser(t, db)

	video := &model.Video{
		UserID:    user.ID,
		Title:     "Original Title",
		Status:    model.VideoStatusPending,
		Progress:  0,
		R2RawKey:  "uploads/raw/123.mp4",
		ExpiresAt: time.Now().Add(3 * 24 * time.Hour),
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	err := db.CreateVideo(video)
	require.NoError(t, err)

	// 更新状态和进度
	updates := map[string]interface{}{
		"status":   model.VideoStatusReady,
		"progress": 100,
		"hls_path": "videos/123/index.m3u8",
	}
	err = db.UpdateVideo(video.ID, updates)
	assert.NoError(t, err)

	// 验证更新
	updated, err := db.GetVideoByID(video.ID)
	assert.NoError(t, err)
	assert.Equal(t, model.VideoStatusReady, updated.Status)
	assert.Equal(t, 100, updated.Progress)
	assert.Equal(t, "videos/123/index.m3u8", updated.HLSPath)
}

// 测试清理过期视频
func TestCleanupExpiredVideos(t *testing.T) {
	db := setupTestDB(t)
	defer teardownTestDB(t, db)

	user := createTestUser(t, db)

	// 创建1个有效视频
	validVideo := &model.Video{
		UserID:    user.ID,
		Title:     "Valid Video",
		Status:    model.VideoStatusReady,
		R2RawKey:  "uploads/raw/valid.mp4",
		ExpiresAt: time.Now().Add(3 * 24 * time.Hour),
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	err := db.CreateVideo(validVideo)
	require.NoError(t, err)

	// 创建2个过期视频
	for i := 0; i < 2; i++ {
		expiredVideo := &model.Video{
			UserID:    user.ID,
			Title:     fmt.Sprintf("Expired Video %d", i),
			Status:    model.VideoStatusReady,
			R2RawKey:  fmt.Sprintf("uploads/raw/expired%d.mp4", i),
			ExpiresAt: time.Now().Add(-1 * time.Hour),
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		}
		err := db.CreateVideo(expiredVideo)
		require.NoError(t, err)
	}

	// 清理过期视频
	count, err := db.CleanupExpiredVideos()
	assert.NoError(t, err)
	assert.Equal(t, int64(2), count, "Should cleanup 2 expired videos")

	// 验证有效视频仍然存在
	videos, err := db.GetVideosByUserID(user.ID)
	assert.NoError(t, err)
	assert.Len(t, videos, 1)
	assert.Equal(t, "Valid Video", videos[0].Title)
}

// 测试视频过期判断
func TestVideo_IsExpired(t *testing.T) {
	now := time.Now()

	tests := []struct {
		name      string
		expiresAt time.Time
		want      bool
	}{
		{
			name:      "Not expired",
			expiresAt: now.Add(1 * time.Hour),
			want:      false,
		},
		{
			name:      "Expired",
			expiresAt: now.Add(-1 * time.Hour),
			want:      true,
		},
		{
			name:      "Zero time (no expiration)",
			expiresAt: time.Time{},
			want:      false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			v := &model.Video{
				ExpiresAt: tt.expiresAt,
			}
			assert.Equal(t, tt.want, v.IsExpired())
		})
	}
}
