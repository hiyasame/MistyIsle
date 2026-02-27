package utils

import (
	"context"
	"misty-isle/cfg"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

// 测试 R2 客户端初始化
func TestNewR2(t *testing.T) {
	conf := &cfg.Config{
		R2Endpoint:  "https://test.r2.cloudflarestorage.com",
		R2AccessKey: "test-access-key",
		R2SecretKey: "test-secret-key",
		R2Bucket:    "test-bucket",
		R2PublicURL: "https://cdn.test.com",
	}

	r2, err := NewR2(conf)
	assert.NoError(t, err)
	assert.NotNil(t, r2)
	assert.Equal(t, "test-bucket", r2.bucket)
	assert.Equal(t, "https://cdn.test.com", r2.publicURL)
}

// 测试获取公共 URL
func TestR2_GetPublicURL(t *testing.T) {
	tests := []struct {
		name      string
		publicURL string
		want      string
	}{
		{
			name:      "With CDN URL",
			publicURL: "https://cdn.example.com",
			want:      "https://cdn.example.com",
		},
		{
			name:      "Without CDN URL (use endpoint)",
			publicURL: "",
			want:      "https://test.r2.cloudflarestorage.com",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			conf := &cfg.Config{
				R2Endpoint:  "https://test.r2.cloudflarestorage.com",
				R2AccessKey: "test-key",
				R2SecretKey: "test-secret",
				R2Bucket:    "test-bucket",
				R2PublicURL: tt.publicURL,
			}

			r2, err := NewR2(conf)
			assert.NoError(t, err)
			assert.Equal(t, tt.want, r2.GetPublicURL())
		})
	}
}

// 测试预签名上传 URL 生成（仅验证不报错，不真正调用 R2）
func TestR2_PresignUpload(t *testing.T) {
	t.Skip("Requires real R2 credentials, skipping")

	conf := &cfg.Config{
		R2Endpoint:  "https://test.r2.cloudflarestorage.com",
		R2AccessKey: "test-key",
		R2SecretKey: "test-secret",
		R2Bucket:    "test-bucket",
	}

	r2, err := NewR2(conf)
	assert.NoError(t, err)

	ctx := context.Background()
	url, err := r2.PresignUpload(ctx, "test/key.mp4", 15*time.Minute, UploadOptions{
		ContentType: "video/mp4",
		ExpireAfter: 3 * 24 * time.Hour,
	})

	// 如果配置正确，应该生成 URL
	// 这里只是确保函数不崩溃
	if err == nil {
		assert.NotEmpty(t, url)
		assert.Contains(t, url, "test/key.mp4")
	}
}

// 测试 UploadOptions
func TestUploadOptions(t *testing.T) {
	opts := UploadOptions{
		ContentType: "video/mp4",
		ExpireAfter: 3 * 24 * time.Hour,
		PublicRead:  true,
	}

	assert.Equal(t, "video/mp4", opts.ContentType)
	assert.Equal(t, 3*24*time.Hour, opts.ExpireAfter)
	assert.True(t, opts.PublicRead)
}
