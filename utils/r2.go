package utils

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"misty-isle/cfg"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

// R2 对象存储客户端
type R2 struct {
	client    *s3.Client
	bucket    string
	endpoint  string
	publicURL string
}

// NewR2 创建 R2 客户端
func NewR2(cfg *cfg.Config) (*R2, error) {
	awsCfg, err := config.LoadDefaultConfig(context.Background(),
		config.WithCredentialsProvider(
			credentials.NewStaticCredentialsProvider(cfg.R2AccessKey, cfg.R2SecretKey, ""),
		),
		config.WithRegion("auto"),
	)
	if err != nil {
		return nil, fmt.Errorf("load aws cfg: %w", err)
	}

	client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(cfg.R2Endpoint)
		o.UsePathStyle = true // R2 需要使用 path style
	})

	publicURL := cfg.R2PublicURL
	if publicURL == "" {
		publicURL = cfg.R2Endpoint // 如果没有配置 CDN，使用 endpoint
	}

	return &R2{
		client:    client,
		bucket:    cfg.R2Bucket,
		endpoint:  cfg.R2Endpoint,
		publicURL: publicURL,
	}, nil
}

// GetPublicURL 获取 R2 公共访问地址
func (r *R2) GetPublicURL() string {
	return r.publicURL
}

// UploadOptions 上传选项
type UploadOptions struct {
	ContentType string        // 文件类型，如 video/mp4
	ExpireAfter time.Duration // 多少天后过期
	PublicRead  bool          // 是否公开可读
}

// UploadResult 上传结果
type UploadResult struct {
	Key      string    // 存储路径
	URL      string    // 访问 URL
	ExpireAt time.Time // 过期时间
}

// Upload 上传文件
func (r *R2) Upload(ctx context.Context, key string, data []byte, opts UploadOptions) (*UploadResult, error) {
	input := &s3.PutObjectInput{
		Bucket:      aws.String(r.bucket),
		Key:         aws.String(key),
		Body:        bytes.NewReader(data),
		ContentType: aws.String(opts.ContentType),
	}

	// 设置过期时间
	if opts.ExpireAfter > 0 {
		expireAt := time.Now().Add(opts.ExpireAfter)
		input.Expires = &expireAt
	}

	// 设置 ACL
	if opts.PublicRead {
		input.ACL = types.ObjectCannedACLPublicRead
	}

	_, err := r.client.PutObject(ctx, input)
	if err != nil {
		return nil, fmt.Errorf("put object: %w", err)
	}

	result := &UploadResult{
		Key: key,
		URL: fmt.Sprintf("%s/%s/%s", r.endpoint, r.bucket, key),
	}

	if opts.ExpireAfter > 0 {
		result.ExpireAt = time.Now().Add(opts.ExpireAfter)
	}

	return result, nil
}

// UploadReader 从 Reader 上传（大文件用）
func (r *R2) UploadReader(ctx context.Context, key string, reader io.Reader, size int64, opts UploadOptions) (*UploadResult, error) {
	input := &s3.PutObjectInput{
		Bucket:        aws.String(r.bucket),
		Key:           aws.String(key),
		Body:          reader,
		ContentLength: &size,
		ContentType:   aws.String(opts.ContentType),
	}

	if opts.ExpireAfter > 0 {
		expireAt := time.Now().Add(opts.ExpireAfter)
		input.Expires = &expireAt
	}

	if opts.PublicRead {
		input.ACL = types.ObjectCannedACLPublicRead
	}

	_, err := r.client.PutObject(ctx, input)
	if err != nil {
		return nil, fmt.Errorf("put object: %w", err)
	}

	result := &UploadResult{
		Key: key,
		URL: fmt.Sprintf("%s/%s/%s", r.endpoint, r.bucket, key),
	}

	if opts.ExpireAfter > 0 {
		result.ExpireAt = time.Now().Add(opts.ExpireAfter)
	}

	return result, nil
}

// PresignUpload 生成预签名上传 URL（前端直传）
func (r *R2) PresignUpload(ctx context.Context, key string, expire time.Duration, opts UploadOptions) (string, error) {
	presignClient := s3.NewPresignClient(r.client)

	input := &s3.PutObjectInput{
		Bucket:      aws.String(r.bucket),
		Key:         aws.String(key),
		ContentType: aws.String(opts.ContentType),
	}

	if opts.PublicRead {
		input.ACL = types.ObjectCannedACLPublicRead
	}

	result, err := presignClient.PresignPutObject(ctx, input, s3.WithPresignExpires(expire))
	if err != nil {
		return "", fmt.Errorf("presign put object: %w", err)
	}

	return result.URL, nil
}

// PresignGet 生成预签名下载 URL
func (r *R2) PresignGet(ctx context.Context, key string, expire time.Duration) (string, error) {
	presignClient := s3.NewPresignClient(r.client)

	result, err := presignClient.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(r.bucket),
		Key:    aws.String(key),
	}, s3.WithPresignExpires(expire))

	if err != nil {
		return "", fmt.Errorf("presign get object: %w", err)
	}

	return result.URL, nil
}

// Delete 删除文件
func (r *R2) Delete(ctx context.Context, key string) error {
	_, err := r.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(r.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return fmt.Errorf("delete object: %w", err)
	}
	return nil
}
