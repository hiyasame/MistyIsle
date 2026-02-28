package model

// RoomStatus 房间状态
type RoomStatus string

const (
	RoomStatusIdle        RoomStatus = "idle"         // 空闲
	RoomStatusPlayingVOD  RoomStatus = "playing_vod"  // 播放上传视频
	RoomStatusPlayingLive RoomStatus = "playing_live" // 真直播
)

// Room 房间信息
type Room struct {
	ID     string     `json:"room_id"`
	Name   string     `json:"name"`
	Desc   string     `json:"description"`
	HostID string     `json:"host_id"`
	Status RoomStatus `json:"status"` // idle, playing_vod, playing_live

	// 点播相关
	VideoID   string `json:"video_id"`   // 当前播放的视频ID
	VideoName string `json:"video_name"` // 当前播放的视频名称
	VideoPath string `json:"video_path"` // 当前播放的视频相对路径 (videos/{id}/index.m3u8)

	// 直播相关
	StreamKey     string `json:"stream_key,omitempty"`      // 推流密钥（仅房主可见）
	StreamURL     string `json:"stream_url,omitempty"`      // 推流地址 rtmp://...
	LiveHLSPath   string `json:"live_hls_path,omitempty"`   // 直播相对路径 (/live/{roomId}.flv)
	LiveStartedAt int64  `json:"live_started_at,omitempty"` // 直播开始时间戳
}

// RoomOptions 创建房间选项
type RoomOptions struct {
	Name string `json:"name"`
	Desc string `json:"description"`
}
