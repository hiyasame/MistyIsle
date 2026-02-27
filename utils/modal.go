package utils

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// ModalClient Modal.com 云函数客户端
type ModalClient struct {
	endpoint string
	token    string
	client   *http.Client
}

// NewModalClient 创建 Modal 客户端
func NewModalClient(endpoint, token string) *ModalClient {
	return &ModalClient{
		endpoint: endpoint,
		token:    token,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// ProcessVideoRequest Modal 处理视频请求
type ProcessVideoRequest struct {
	VideoID         string `json:"video_id"`
	WebhookURL      string `json:"webhook_url"`
	SegmentDuration int    `json:"segment_duration,omitempty"` // 可选，默认10秒
}

// ProcessVideoResponse Modal 响应
type ProcessVideoResponse struct {
	Status  string `json:"status"`
	VideoID string `json:"video_id"`
	Message string `json:"message,omitempty"`
}

// TriggerVideoProcess 触发 Modal 视频处理
func (m *ModalClient) TriggerVideoProcess(ctx context.Context, req ProcessVideoRequest) (*ProcessVideoResponse, error) {
	if m.endpoint == "" {
		return nil, fmt.Errorf("modal endpoint not configured")
	}

	// 设置默认分片时长
	if req.SegmentDuration == 0 {
		req.SegmentDuration = 10
	}

	// 构建请求体
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	// 创建 HTTP 请求
	httpReq, err := http.NewRequestWithContext(ctx, "POST", m.endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	if m.token != "" {
		httpReq.Header.Set("Authorization", fmt.Sprintf("Bearer %s", m.token))
	}

	// 发送请求
	resp, err := m.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("send request: %w", err)
	}
	defer resp.Body.Close()

	// 读取响应
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	// 检查状态码
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusAccepted {
		return nil, fmt.Errorf("modal returned status %d: %s", resp.StatusCode, string(respBody))
	}

	// 解析响应
	var result ProcessVideoResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("unmarshal response: %w", err)
	}

	return &result, nil
}
