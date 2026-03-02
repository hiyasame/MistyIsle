"""
Modal.com Serverless HLS Video Processor
---------------------------------------
Flow:
1. User uploads video to R2 (e.g., uploads/raw/{video_id}.mp4)
2. Backend calls this Modal function with video_id
3. Modal downloads, slices into HLS, uploads back to R2 (e.g., videos/{video_id}/)
4. Modal notifies Backend via Webhook with stage updates
"""

import modal
import os
import tempfile
import subprocess
import time
from pathlib import Path
from datetime import datetime, timedelta

# 1. Define the Application and Image
app = modal.App("video-hls-processor")

# Custom image with ffmpeg and boto3
image = (
    modal.Image.debian_slim()
    .apt_install("ffmpeg")
    .pip_install("boto3", "requests", "fastapi[standard]")
)

def send_webhook(webhook_url: str, payload: dict):
    """发送 webhook 通知（带重试）"""
    import requests

    # 如果没有 webhook URL，打印日志但不报错
    if not webhook_url:
        print(f"📝 [Webhook Skipped] {payload.get('status', 'unknown')} - {payload.get('progress', 0)}%")
        if payload.get('message'):
            print(f"   Message: {payload.get('message')}")
        return

    for attempt in range(3):  # 最多重试3次
        try:
            resp = requests.post(webhook_url, json=payload, timeout=10)
            if resp.status_code < 300:
                print(f"✅ Webhook sent: {payload.get('status')} ({payload.get('progress', 0)}%)")
                return
            print(f"⚠️ Webhook returned {resp.status_code}: {resp.text}")
        except Exception as e:
            print(f"⚠️ Webhook attempt {attempt+1} failed: {e}")

        if attempt < 2:
            time.sleep(1)  # 重试前等待1秒
        else:
            print("❌ Webhook failed after 3 attempts")

@app.function(
    image=image,
    secrets=[modal.Secret.from_name("r2-credentials")],
    timeout=1800,  # 30 mins
    cpu=4.0,       # More CPUs for faster transcoding
    memory=4096,   # 4GB RAM
)
def process_video_task(video_id: str, webhook_url: str = None, segment_duration: int = 6):
    """
    Core processing task: R2 -> Local -> FFmpeg -> R2 -> Webhook

    States:
    1. user_upload (already done by user)
    2. modal_download - Downloading from R2
    3. modal_slice - FFmpeg slicing
    4. m3u8_prepared - M3U8 ready (can start playback)
    5. modal_upload - Uploading segments (with 10% increments)
    """
    import boto3

    # Environment variables from secrets
    r2_endpoint = os.environ["R2_ENDPOINT"]
    r2_access_key = os.environ["R2_ACCESS_KEY_ID"]
    r2_secret_key = os.environ["R2_SECRET_ACCESS_KEY"]
    r2_bucket = os.environ["R2_BUCKET"]
    r2_public_domain = os.environ.get("R2_PUBLIC_DOMAIN", f"{r2_endpoint}/{r2_bucket}")

    # 3天后过期时间
    expire_time = datetime.utcnow() + timedelta(days=3)

    # Standard S3 client for R2
    s3_client = boto3.client(
        "s3",
        endpoint_url=r2_endpoint,
        aws_access_key_id=r2_access_key,
        aws_secret_access_key=r2_secret_key,
        region_name="auto",
    )

    # 查找源文件（支持多种扩展名）
    source_key = None
    for ext in ['.mp4', '.mov', '.avi', '.mkv', '.flv', '.webm']:
        try_key = f"uploads/raw/{video_id}{ext}"
        try:
            s3_client.head_object(Bucket=r2_bucket, Key=try_key)
            source_key = try_key
            break
        except:
            continue

    if not source_key:
        error_msg = f"Source file not found for video_id={video_id}"
        print(f"❌ {error_msg}")
        send_webhook(webhook_url, {
            "video_id": video_id,
            "status": "failed",
            "error": error_msg
        })
        return {"status": "error", "message": error_msg}

    target_dir = f"videos/{video_id}"
    print(f"🚀 [Video {video_id}] Starting HLS processing from {source_key}")

    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        local_input = temp_path / "input.mp4"
        hls_output_dir = temp_path / "hls"
        hls_output_dir.mkdir()

        # ===== Stage 1: modal_download =====
        print(f"📦 [Stage 1/4] modal_download: Downloading from R2...")
        send_webhook(webhook_url, {
            "video_id": video_id,
            "status": "modal_download",
            "progress": 10,
            "message": "Downloading video from R2"
        })

        try:
            s3_client.download_file(r2_bucket, source_key, str(local_input))
            print(f"✅ Download completed: {local_input.stat().st_size} bytes")
        except Exception as e:
            error_msg = f"Download failed: {str(e)}"
            print(f"❌ {error_msg}")
            send_webhook(webhook_url, {
                "video_id": video_id,
                "status": "failed",
                "error": error_msg
            })
            return {"status": "error", "message": error_msg}

        # ===== Stage 1.5: Probe Codecs =====
        print(f"🔍 [Stage 1.5/4] probing: detecting video/audio formats...")
        v_codec, a_codec = "unknown", "unknown"
        try:
            v_probe = subprocess.check_output([
                "ffprobe", "-v", "error", "-select_streams", "v:0",
                "-show_entries", "stream=codec_name",
                "-of", "default=noprint_wrappers=1:nokey=1",
                str(local_input)
            ]).decode().strip().lower()
            a_probe = subprocess.check_output([
                "ffprobe", "-v", "error", "-select_streams", "a:0",
                "-show_entries", "stream=codec_name",
                "-of", "default=noprint_wrappers=1:nokey=1",
                str(local_input)
            ]).decode().strip().lower()
            v_codec, a_codec = v_probe, a_probe
            print(f"🎥 Codecs: {v_codec} / {a_codec}")
        except Exception as e:
            print(f"⚠️ Probing failed: {e}, falling back to full transcode.")

        # ===== Stage 2: modal_slice =====
        # 判断是否可以走秒切（Copy）模式
        # 1. H.264 + AAC: 全平台最强兼容，直接 copy 到 fmp4
        # 2. AV1 + Opus: 现代高清标准，直接 copy 到 fmp4
        is_h264_aac = (v_codec == "h264" and a_codec == "aac")
        is_av1_opus = (v_codec == "av1" and a_codec == "opus")
        
        use_copy = is_h264_aac or is_av1_opus
        
        if use_copy:
            action_name = "Fast Copy (Muxing only)"
            progress_msg = f"Ultra-fast HLS muxing ({v_codec}/{a_codec})"
        else:
            action_name = "Transcoding to HLS"
            progress_msg = f"Transcoding and slicing video into HLS"

        print(f"🔪 [Stage 2/4] modal_slice: {action_name} (segment={segment_duration}s)...")
        send_webhook(webhook_url, {
            "video_id": video_id,
            "status": "modal_slice",
            "progress": 25,
            "message": progress_msg
        })

        m3u8_path = hls_output_dir / "index.m3u8"
        
        if use_copy:
             ffmpeg_cmd = [
                "ffmpeg", "-i", str(local_input),
                "-c", "copy",                # 直接流拷贝，速度极快
                "-f", "hls",
                "-hls_segment_type", "fmp4", # Copy 模式推荐使用 fMP4 以支持 AV1
                "-hls_fmp4_init_filename", "init.mp4",
                "-hls_time", str(segment_duration),
                "-hls_list_size", "0",
                "-hls_segment_filename", str(hls_output_dir / "seg_%03d.m4s"),
                "-y", str(m3u8_path)
            ]
        else:
            ffmpeg_cmd = [
                "ffmpeg", "-i", str(local_input),
                "-c:v", "libx264", "-preset", "ultrafast",
                "-tune", "zerolatency", "-profile:v", "main", "-level", "4.0",
                "-pix_fmt", "yuv420p", "-g", "60", "-keyint_min", "60", "-sc_threshold", "0",
                "-c:a", "aac", "-b:a", "128k", "-ac", "2", "-ar", "44100",
                "-f", "hls", # 转码模式依然使用传统的 TS
                "-hls_time", str(segment_duration),
                "-hls_list_size", "0",
                "-hls_segment_filename", str(hls_output_dir / "seg_%03d.ts"),
                "-y", str(m3u8_path)
            ]

        start_time = time.time()
        process = subprocess.run(ffmpeg_cmd, capture_output=True, text=True)

        if process.returncode != 0:
            error_msg = f"FFmpeg failed: {process.stderr[:500]}"
            print(f"❌ {error_msg}")
            send_webhook(webhook_url, {
                "video_id": video_id,
                "status": "failed",
                "error": error_msg
            })
            return {"status": "error", "message": error_msg}

        slice_duration = time.time() - start_time
        print(f"✅ Slicing completed in {slice_duration:.2f}s")

        hls_files = list(hls_output_dir.iterdir())
        
        # 定义需要上传的文件分组
        m3u8_file = next((f for f in hls_files if f.suffix == ".m3u8"), None)
        # 除 index 以外的所有数据分片 (ts, m4s, mp4, init.mp4)
        data_files = [f for f in hls_files if f.suffix in [".ts", ".m4s", ".mp4"] and f.name != "index.m3u8"]
        
        print(f"⬆️ [Stage 3/4] Uploading {len(data_files) + 1} files...")

        def get_content_type(filename):
            ext = os.path.splitext(filename)[1].lower()
            if ext == '.m3u8': return "application/vnd.apple.mpegurl"
            if ext == '.ts': return "video/MP2T"
            if ext == '.m4s': return "video/iso.segment"
            if ext == '.mp4': return "video/mp4" # 主要是针对 init.mp4
            return "application/octet-stream"

        # 1. 优先上传 index.m3u8 (确保前端能尽快拿到播放列表)
        if m3u8_file:
            m3u8_key = f"{target_dir}/{m3u8_file.name}"
            with open(m3u8_file, "rb") as f:
                s3_client.put_object(
                    Bucket=r2_bucket, Key=m3u8_key, Body=f,
                    ContentType=get_content_type(m3u8_file.name),
                    Expires=expire_time
                )

            playlist_path = f"{target_dir}/index.m3u8"
            print(f"✅ Playlist ready: {playlist_path}")
            send_webhook(webhook_url, {
                "video_id": video_id,
                "status": "m3u8_prepared",
                "progress": 40,
                "playlist_path": playlist_path,
                "message": "Playlist ready, starting segment synchronization"
            })

        # ===== Stage 4: modal_upload (Concurrent) =====
        print(f"⬆️ [Stage 4/4] modal_upload: Uploading {len(data_files)} segments...")

        from concurrent.futures import ThreadPoolExecutor, as_completed

        uploaded_count = 0
        last_progress = 40
        failed_uploads = []

        def upload_data_file(file_path):
            """上传单个数据文件"""
            try:
                key = f"{target_dir}/{file_path.name}"
                with open(file_path, "rb") as f:
                    s3_client.put_object(
                        Bucket=r2_bucket, Key=key, Body=f,
                        ContentType=get_content_type(file_path.name),
                        Expires=expire_time
                    )
                return (True, file_path.name)
            except Exception as e:
                return (False, file_path.name, str(e))

        # 使用线程池并发上传，充分利用 R2 的并发处理能力
        with ThreadPoolExecutor(max_workers=20) as executor:
            future_to_file = {executor.submit(upload_data_file, f): f for f in data_files}
            for future in as_completed(future_to_file):
                result = future.result()
                if result[0]: uploaded_count += 1
                else:
                    failed_uploads.append(result[1])
                    print(f"⚠️ Failed to upload {result[1]}: {result[2]}")

                # 计算动态进度
                current_progress = 40 + int((uploaded_count / len(data_files)) * 60)
                if current_progress >= last_progress + 10 or uploaded_count == len(data_files):
                    send_webhook(webhook_url, {
                        "video_id": video_id,
                        "status": "modal_upload",
                        "progress": min(99, current_progress), # Ready 才会发 100%
                        "segments_uploaded": uploaded_count,
                        "segments_total": len(data_files),
                        "message": f"Uploading: {uploaded_count}/{len(data_files)}"
                    })
                    last_progress = current_progress

        # 检查是否有上传失败的切片
        if failed_uploads:
            error_msg = f"Failed to upload {len(failed_uploads)} segments: {', '.join(failed_uploads[:5])}"
            print(f"❌ {error_msg}")
            send_webhook(webhook_url, {
                "video_id": video_id, "status": "failed", "error": error_msg
            })
            return {"status": "error", "message": error_msg}

        # ===== Final: Success =====
        print(f"✅ All files uploaded successfully!")

        result_payload = {
            "video_id": video_id,
            "status": "ready",
            "progress": 100,
            "playlist_path": playlist_path,
            "segments_count": uploaded_count,
            "is_copy": use_copy,
            "v_codec": v_codec,
            "a_codec": a_codec,
            "message": f"Completed ({'Copy' if use_copy else 'Transcode'})"
        }

        send_webhook(webhook_url, result_payload)
        return result_payload

# 3. Webhook Entrypoint (Optional: so your backend can just HTTP POST here to start)
@app.function(image=image, secrets=[modal.Secret.from_name("r2-credentials")])
@modal.web_endpoint(method="POST")
def trigger_process(data: dict):
    """
    HTTP Entrypoint:
    POST request with {"video_id": "...", "webhook_url": "..."}
    """
    video_id = data.get("video_id")
    webhook_url = data.get("webhook_url")

    if not video_id:
        return {"error": "Missing video_id"}, 400

    # We use .spawn() to start the task and return immediately
    # This prevents the HTTP request from timing out during long video processing
    process_video_task.spawn(video_id, webhook_url)

    return {"status": "accepted", "video_id": video_id}

# 4. Local CLI Entrypoint
@app.local_entrypoint()
def main(video_id: str = None, webhook: str = None):
    if not video_id:
        print("Usage: modal run modal_video_processor.py --video-id <id> [--webhook <url>]")
        return

    print(f"--- Starting local test for {video_id} ---")
    result = process_video_task.remote(video_id, webhook_url=webhook)
    print(f"--- Result: {result} ---")
