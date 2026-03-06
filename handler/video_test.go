package handler

import (
	"bytes"
	"encoding/json"
	"misty-isle/cfg"
	"misty-isle/model"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

// DBMock 数据库 Mock
type DBMock struct {
	mock.Mock
}

func (m *DBMock) CreateVideo(video *model.Video) error {
	args := m.Called(video)
	if args.Error(0) == nil {
		video.ID = 123 // 模拟生成 ID
	}
	return args.Error(0)
}

func (m *DBMock) GetVideoByID(videoID uint64) (*model.Video, error) {
	args := m.Called(videoID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*model.Video), args.Error(1)
}

func (m *DBMock) GetVideosByUserID(userID uint64) ([]*model.Video, error) {
	args := m.Called(userID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).([]*model.Video), args.Error(1)
}

func (m *DBMock) GetAllVideos() ([]*model.Video, error) {
	args := m.Called()
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).([]*model.Video), args.Error(1)
}

func (m *DBMock) UpdateVideo(videoID uint64, updates map[string]interface{}) error {
	args := m.Called(videoID, updates)
	return args.Error(0)
}

func (m *DBMock) DeleteVideo(videoID uint64, userID uint64) error {
	args := m.Called(videoID, userID)
	return args.Error(0)
}

// R2Mock R2 Mock
type R2Mock struct {
	mock.Mock
}

func (m *R2Mock) PresignUpload(ctx interface{}, key string, expire time.Duration, opts interface{}) (string, error) {
	args := m.Called(ctx, key, expire, opts)
	return args.String(0), args.Error(1)
}

func (m *R2Mock) GetPublicURL() string {
	args := m.Called()
	return args.String(0)
}

// WSHubMock WebSocket Hub Mock
type WSHubMock struct {
	mock.Mock
}

func (m *WSHubMock) NotifyUser(userID, notifyType string, data interface{}) {
	m.Called(userID, notifyType, data)
}

// 测试 VideoWebhook
func TestVideoWebhook(t *testing.T) {
	gin.SetMode(gin.TestMode)

	// 创建 Mock
	mockDB := new(DBMock)
	mockWSHub := new(WSHubMock)

	video := &model.Video{
		ID:     123,
		UserID: 1,
		Status: model.VideoStatusUploaded,
	}

	// Mock DB GetVideoByID
	mockDB.On("GetVideoByID", uint64(123)).Return(video, nil)

	// Mock DB UpdateVideo
	mockDB.On("UpdateVideo", uint64(123), mock.MatchedBy(func(updates map[string]interface{}) bool {
		return updates["status"] == model.VideoStatusM3U8Ready &&
			updates["progress"] == 40 &&
			updates["hls_path"] == "videos/123/index.m3u8"
	})).Return(nil)

	// Mock WebSocket notification
	mockWSHub.On("NotifyUser", "1", "video_status", mock.Anything).Return()

	// 创建 Handler（直接构造结构体）
	h := &Handler{
		Cfg:   &cfg.Config{},
		DB:    mockDB,
		WSHub: mockWSHub,
	}

	// 创建 webhook 请求
	reqBody := map[string]interface{}{
		"video_id":      "123",
		"status":        "m3u8_prepared",
		"progress":      40,
		"playlist_path": "videos/123/index.m3u8",
		"message":       "Playlist ready",
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest("POST", "/video/webhook", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	c, _ := gin.CreateTestContext(w)
	c.Request = req

	h.VideoWebhook(c)

	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)

	assert.Equal(t, float64(0), response["code"])

	// 验证 mock 调用
	mockDB.AssertExpectations(t)
	mockWSHub.AssertExpectations(t)
}

// 测试 VideoWebhook - 不同状态
func TestVideoWebhook_DifferentStatuses(t *testing.T) {
	gin.SetMode(gin.TestMode)

	tests := []struct {
		name           string
		webhookStatus  string
		expectedStatus model.VideoStatus
		progress       int
	}{
		{
			name:           "modal_download",
			webhookStatus:  "modal_download",
			expectedStatus: model.VideoStatusDownloading,
			progress:       10,
		},
		{
			name:           "modal_slice",
			webhookStatus:  "modal_slice",
			expectedStatus: model.VideoStatusSlicing,
			progress:       25,
		},
		{
			name:           "modal_upload",
			webhookStatus:  "modal_upload",
			expectedStatus: model.VideoStatusUploading,
			progress:       60,
		},
		{
			name:           "ready",
			webhookStatus:  "ready",
			expectedStatus: model.VideoStatusReady,
			progress:       100,
		},
		{
			name:           "failed",
			webhookStatus:  "failed",
			expectedStatus: model.VideoStatusFailed,
			progress:       0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockDB := new(DBMock)
			mockWSHub := new(WSHubMock)

			video := &model.Video{
				ID:     123,
				UserID: 1,
			}

			mockDB.On("GetVideoByID", uint64(123)).Return(video, nil)
			mockDB.On("UpdateVideo", uint64(123), mock.MatchedBy(func(updates map[string]interface{}) bool {
				return updates["status"] == tt.expectedStatus
			})).Return(nil)
			mockWSHub.On("NotifyUser", "1", "video_status", mock.Anything).Return()

			h := &Handler{
				Cfg:   &cfg.Config{},
				DB:    mockDB,
				WSHub: mockWSHub,
			}

			reqBody := map[string]interface{}{
				"video_id": "123",
				"status":   tt.webhookStatus,
				"progress": tt.progress,
			}
			body, _ := json.Marshal(reqBody)

			req := httptest.NewRequest("POST", "/video/webhook", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			c, _ := gin.CreateTestContext(w)
			c.Request = req

			h.VideoWebhook(c)

			assert.Equal(t, http.StatusOK, w.Code)

			mockDB.AssertExpectations(t)
			mockWSHub.AssertExpectations(t)
		})
	}
}

// 测试 VideoList
func TestVideoList(t *testing.T) {
	gin.SetMode(gin.TestMode)

	mockDB := new(DBMock)

	videos := []*model.Video{
		{
			ID:        1,
			UserID:    1,
			Title:     "Video 1",
			Status:    model.VideoStatusReady,
			Progress:  100,
			HLSPath:   "videos/1/index.m3u8",
			ExpiresAt: time.Now().Add(3 * 24 * time.Hour),
			CreatedAt: time.Now(),
		},
		{
			ID:        2,
			UserID:    1,
			Title:     "Video 2",
			Status:    model.VideoStatusUploading,
			Progress:  60,
			HLSPath:   "videos/2/index.m3u8",
			ExpiresAt: time.Now().Add(3 * 24 * time.Hour),
			CreatedAt: time.Now(),
		},
	}

	mockDB.On("GetAllVideos").Return(videos, nil)

	h := &Handler{
		Cfg: &cfg.Config{},
		DB:  mockDB,
	}

	req := httptest.NewRequest("GET", "/video/list", nil)
	w := httptest.NewRecorder()

	c, _ := gin.CreateTestContext(w)
	c.Request = req
	c.Set("userID", uint64(1))

	h.VideoList(c)

	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)

	assert.Equal(t, float64(0), response["code"])
	data := response["data"].(map[string]interface{})
	list := data["list"].([]interface{})
	assert.Len(t, list, 2)

	// 验证返回的是 hls_path 而不是 hls_url
	firstVideo := list[0].(map[string]interface{})
	assert.Contains(t, firstVideo, "hls_path")
	assert.Equal(t, "videos/1/index.m3u8", firstVideo["hls_path"])

	mockDB.AssertExpectations(t)
}

// 测试 VideoStatus
func TestVideoStatus(t *testing.T) {
	gin.SetMode(gin.TestMode)

	mockDB := new(DBMock)

	video := &model.Video{
		ID:        123,
		UserID:    1,
		Status:    model.VideoStatusM3U8Ready,
		Progress:  40,
		HLSPath:   "videos/123/index.m3u8",
		ExpiresAt: time.Now().Add(3 * 24 * time.Hour),
	}

	mockDB.On("GetVideoByID", uint64(123)).Return(video, nil)

	h := &Handler{
		Cfg: &cfg.Config{},
		DB:  mockDB,
	}

	req := httptest.NewRequest("GET", "/video/123/status", nil)
	w := httptest.NewRecorder()

	c, _ := gin.CreateTestContext(w)
	c.Request = req
	c.Params = gin.Params{{Key: "id", Value: "123"}}
	c.Set("userID", uint64(1))

	h.VideoStatus(c)

	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)

	assert.Equal(t, float64(0), response["code"])
	data := response["data"].(map[string]interface{})
	assert.Equal(t, float64(123), data["video_id"])
	assert.Equal(t, "m3u8_prepared", data["status"])
	assert.Equal(t, float64(40), data["progress"])
	assert.Equal(t, "videos/123/index.m3u8", data["hls_path"])

	mockDB.AssertExpectations(t)
}

// 测试 getContentType
func TestGetContentType(t *testing.T) {
	tests := []struct {
		ext  string
		want string
	}{
		{".mp4", "video/mp4"},
		{".mov", "video/quicktime"},
		{".avi", "video/x-msvideo"},
		{".mkv", "video/x-matroska"},
		{".flv", "video/x-flv"},
		{".webm", "video/webm"},
		{".unknown", "video/mp4"}, // 默认
	}

	for _, tt := range tests {
		t.Run(tt.ext, func(t *testing.T) {
			result := getContentType(tt.ext)
			assert.Equal(t, tt.want, result)
		})
	}
}
