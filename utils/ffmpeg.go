package utils

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	ffmpeg "github.com/u2takey/ffmpeg-go"
)

// FFmpeg 视频处理工具
type FFmpeg struct{}

// NewFFmpeg 创建 FFmpeg 工具
func NewFFmpeg() *FFmpeg {
	return &FFmpeg{}
}

// VideoInfo 视频信息
type VideoInfo struct {
	Duration float64 // 秒
	Width    int
	Height   int
	Bitrate  int64
}

// GetVideoInfo 获取视频信息
func (f *FFmpeg) GetVideoInfo(ctx context.Context, inputPath string) (*VideoInfo, error) {
	// 使用 ffprobe 获取视频信息
	probeData, err := ffmpeg.ProbeWithTimeout(inputPath, 30000, ffmpeg.KwArgs{}) // 30秒超时
	if err != nil {
		return nil, fmt.Errorf("ffprobe failed: %w", err)
	}

	// 解析 ffprobe 输出
	info := &VideoInfo{}

	// 从 probeData 中提取信息（简化版）
	// 实际应该解析 JSON 输出
	_ = probeData

	return info, nil
}

// HLSOptions HLS 切片选项
type HLSOptions struct {
	SegmentDuration int    // 每个切片的时长（秒），默认 10
	OutputDir       string // 输出目录
	VideoID         string // 视频ID，用于生成文件名
}

// HLSResult HLS 转换结果
type HLSResult struct {
	M3U8Path  string   // m3u8 文件路径
	Files     []string // 所有生成的文件（包含 m3u8 和 ts）
	OutputDir string   // 输出目录
}

// ConvertToHLS 将视频转换为 HLS 格式
func (f *FFmpeg) ConvertToHLS(ctx context.Context, inputPath string, opts HLSOptions) (*HLSResult, error) {
	if opts.SegmentDuration == 0 {
		opts.SegmentDuration = 10
	}

	// 创建输出目录
	outputDir := opts.OutputDir
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return nil, fmt.Errorf("create output dir: %w", err)
	}

	m3u8Path := filepath.Join(outputDir, "index.m3u8")
	segmentPattern := filepath.Join(outputDir, "segment_%03d.ts")

	// 使用 ffmpeg-go 构建命令
	// ffmpeg -i input.mp4 -codec: copy -start_number 0 -hls_time 10
	//        -hls_list_size 0 -hls_segment_filename segment_%03d.ts -f hls index.m3u8
	err := ffmpeg.Input(inputPath).
		Output(m3u8Path,
			ffmpeg.KwArgs{
				"codec:":               "copy",               // 直接复制，不重新编码
				"start_number":         0,                    // 切片从 0 开始
				"hls_time":             opts.SegmentDuration, // 每个切片时长
				"hls_list_size":        0,                    // 保留所有切片
				"hls_segment_filename": segmentPattern,       // 切片文件名格式
				"f":                    "hls",                // 输出格式 HLS
			},
		).
		OverWriteOutput(). // 覆盖已存在的文件
		Run()

	if err != nil {
		return nil, fmt.Errorf("ffmpeg failed: %w", err)
	}

	// 获取生成的文件列表
	files, err := getHLSFiles(outputDir)
	if err != nil {
		return nil, fmt.Errorf("get hls files: %w", err)
	}

	return &HLSResult{
		M3U8Path:  m3u8Path,
		Files:     files,
		OutputDir: outputDir,
	}, nil
}

// getHLSFiles 获取 HLS 生成的所有文件
func getHLSFiles(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}

	var files []string
	for _, entry := range entries {
		if !entry.IsDir() {
			files = append(files, filepath.Join(dir, entry.Name()))
		}
	}
	return files, nil
}

// Cleanup 清理临时文件
func (f *FFmpeg) Cleanup(dir string) error {
	return os.RemoveAll(dir)
}
