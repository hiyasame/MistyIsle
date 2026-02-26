"""
Modal.com Serverless HLS Video Processor
从 R2 下载视频 -> HLS 切片 -> 上传回 R2

使用方法:
    modal run modal_video_processor.py --source-key uploads/video.mp4 --target-prefix videos/123
"""

import modal
import os
import tempfile
import subprocess
from pathlib import Path

# 创建 Modal 应用
app = modal.App("hls-video-processor")

# 定义镜像，包含 ffmpeg
image = (
    modal.Image.debian_slim()
    .apt_install("ffmpeg")
    .pip_install(
        "boto3",
        "requests",
    )
)

# R2 配置（通过 Modal secrets 注入）
# 创建 secret: modal secret create r2-credentials \
#   R2_ENDPOINT=https://xxx.r2.cloudflarestorage.com \
#   R2_ACCESS_KEY_ID=xxx \
#   R2_SECRET_ACCESS_KEY=xxx \
#   R2_BUCKET=your-bucket


@app.function(
    image=image,
    secrets=[modal.Secret.from_name("r2-credentials")],
    timeout=1800,  # 30 分钟超时
    memory=2048,   # 2GB 内存
    cpu=2,         # 2 核 CPU
)
def process_video_to_hls(source_key: str, target_prefix: str, segment_duration: int = 10):
    """
    将 R2 上的视频转换为 HLS 格式并上传回 R2

    Args:
        source_key: R2 上的源视频路径，如 "uploads/video.mp4"
        target_prefix: HLS 输出路径前缀，如 "videos/123"
        segment_duration: 每个切片的时长（秒），默认 10
    """
    import boto3
    import requests
    from urllib.parse import urlparse

    # 从环境变量读取 R2 配置
    r2_endpoint = os.environ["R2_ENDPOINT"]
    r2_access_key = os.environ["R2_ACCESS_KEY_ID"]
    r2_secret_key = os.environ["R2_SECRET_ACCESS_KEY"]
    r2_bucket = os.environ["R2_BUCKET"]

    # 初始化 S3 客户端（R2 兼容 S3 API）
    s3_client = boto3.client(
        "s3",
        endpoint_url=r2_endpoint,
        aws_access_key_id=r2_access_key,
        aws_secret_access_key=r2_secret_key,
        region_name="auto",
    )

    print(f"🎬 开始处理视频: {source_key}")

    # 创建临时工作目录
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)

        # 1. 从 R2 下载视频
        print(f"⬇️  从 R2 下载视频...")
        local_input = temp_path / f"input{Path(source_key).suffix}"

        # 生成预签名 URL 用于下载
        presigned_url = s3_client.generate_presigned_url(
            "get_object",
            Params={"Bucket": r2_bucket, "Key": source_key},
            ExpiresIn=3600,
        )

        # 下载文件
        response = requests.get(presigned_url, stream=True)
        response.raise_for_status()

        total_size = int(response.headers.get("content-length", 0))
        downloaded = 0

        with open(local_input, "wb") as f:
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
                    downloaded += len(chunk)
                    if total_size > 0:
                        progress = (downloaded / total_size) * 100
                        print(f"   下载进度: {progress:.1f}%", end="\r")

        print(f"\n✅ 下载完成: {local_input} ({downloaded} bytes)")

        # 2. HLS 切片
        print(f"🔪 开始 HLS 切片 (每段 {segment_duration} 秒)...")

        hls_output_dir = temp_path / "hls"
        hls_output_dir.mkdir(exist_ok=True)

        m3u8_path = hls_output_dir / "index.m3u8"
        segment_pattern = hls_output_dir / "segment_%03d.ts"

        # 构建 ffmpeg 命令
        cmd = [
            "ffmpeg",
            "-i", str(local_input),
            "-codec:", "copy",
            "-start_number", "0",
            "-hls_time", str(segment_duration),
            "-hls_list_size", "0",
            "-hls_segment_filename", str(segment_pattern),
            "-f", "hls",
            "-y",  # 覆盖已存在文件
            str(m3u8_path),
        ]

        print(f"   执行命令: {' '.join(cmd)}")

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
        )

        if result.returncode != 0:
            print(f"❌ FFmpeg 错误: {result.stderr}")
            raise RuntimeError(f"FFmpeg failed: {result.stderr}")

        # 获取生成的文件列表
        hls_files = list(hls_output_dir.iterdir())
        print(f"✅ HLS 切片完成，共生成 {len(hls_files)} 个文件")

        # 3. 上传 HLS 文件到 R2
        print(f"⬆️  上传 HLS 文件到 R2...")

        uploaded_files = []
        for file_path in hls_files:
            key = f"{target_prefix}/{file_path.name}"

            # 根据文件类型设置 Content-Type
            content_type = "video/MP2T"  # .ts 文件
            if file_path.suffix == ".m3u8":
                content_type = "application/vnd.apple.mpegurl"

            print(f"   上传: {key}")

            with open(file_path, "rb") as f:
                s3_client.put_object(
                    Bucket=r2_bucket,
                    Key=key,
                    Body=f,
                    ContentType=content_type,
                )

            uploaded_files.append(key)

        print(f"✅ 上传完成，共 {len(uploaded_files)} 个文件")

        # 构建公共访问 URL
        public_url = f"{r2_endpoint}/{r2_bucket}/{target_prefix}/index.m3u8"

        return {
            "status": "success",
            "source_key": source_key,
            "target_prefix": target_prefix,
            "uploaded_files": uploaded_files,
            "hls_playlist_url": public_url,
            "segment_count": len([f for f in uploaded_files if f.endswith(".ts")]),
        }


@app.local_entrypoint()
def main(
    source_key: str = None,
    target_prefix: str = None,
    segment_duration: int = 10,
):
    """
    本地入口点，用于通过 modal run 命令调用

    示例:
        modal run modal_video_processor.py --source-key uploads/video.mp4 --target-prefix videos/123
    """
    if not source_key or not target_prefix:
        print("❌ 请提供必要参数:")
        print("   --source-key: R2 上的源视频路径")
        print("   --target-prefix: HLS 输出路径前缀")
        print("")
        print("示例:")
        print("   modal run modal_video_processor.py --source-key uploads/video.mp4 --target-prefix videos/123")
        return

    # 调用远程函数
    result = process_video_to_hls.remote(
        source_key=source_key,
        target_prefix=target_prefix,
        segment_duration=segment_duration,
    )

    print("\n" + "=" * 50)
    print("🎉 处理完成!")
    print("=" * 50)
    print(f"📁 源文件: {result['source_key']}")
    print(f"📂 输出路径: {result['target_prefix']}")
    print(f"📊 切片数量: {result['segment_count']}")
    print(f"🔗 HLS 播放地址: {result['hls_playlist_url']}")


# 批量处理功能
@app.function(
    image=image,
    secrets=[modal.Secret.from_name("r2-credentials")],
    timeout=3600,
    memory=2048,
    cpu=2,
)
def batch_process_videos(tasks: list[dict]):
    """
    批量处理多个视频

    Args:
        tasks: 任务列表，每个任务包含 source_key 和 target_prefix
               如: [{"source_key": "a.mp4", "target_prefix": "videos/1"}, ...]
    """
    results = []
    for task in tasks:
        try:
            result = process_video_to_hls.remote(
                source_key=task["source_key"],
                target_prefix=task["target_prefix"],
                segment_duration=task.get("segment_duration", 10),
            )
            results.append({"success": True, "result": result})
        except Exception as e:
            results.append({"success": False, "error": str(e), "task": task})

    return results


# Webhook API 端点（可选）
@app.function(
    image=image,
    secrets=[modal.Secret.from_name("r2-credentials")],
    timeout=1800,
    memory=2048,
    cpu=2,
)
@modal.web_endpoint(method="POST")
def webhook_process_video(request: dict):
    """
    Webhook API 端点，接收 HTTP 请求处理视频

    请求体:
        {
            "source_key": "uploads/video.mp4",
            "target_prefix": "videos/123",
            "segment_duration": 10  // 可选
        }
    """
    source_key = request.get("source_key")
    target_prefix = request.get("target_prefix")
    segment_duration = request.get("segment_duration", 10)

    if not source_key or not target_prefix:
        return {"error": "Missing source_key or target_prefix"}, 400

    try:
        result = process_video_to_hls.remote(
            source_key=source_key,
            target_prefix=target_prefix,
            segment_duration=segment_duration,
        )
        return result
    except Exception as e:
        return {"error": str(e)}, 500
