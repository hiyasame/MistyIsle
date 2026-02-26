"""
Modal.com Serverless HLS Video Processor
---------------------------------------
Flow:
1. User uploads video to R2 (e.g., uploads/raw/{video_id}.mp4)
2. Backend calls this Modal function with video_id
3. Modal downloads, slices into HLS, uploads back to R2 (e.g., videos/{video_id}/)
4. Modal notifies Backend via Webhook
"""

import modal
import os
import tempfile
import subprocess
import time
from pathlib import Path

# 1. Define the Application and Image
app = modal.App("video-hls-processor")

# Custom image with ffmpeg and boto3
image = (
    modal.Image.debian_slim()
    .apt_install("ffmpeg")
    .pip_install("boto3", "requests", "fastapi[standard]")
)

# 2. Configuration & Secrets
# You need a Modal Secret named "r2-credentials" with:
# R2_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
# R2_ACCESS_KEY_ID=...
# R2_SECRET_ACCESS_KEY=...
# R2_BUCKET=...
# R2_PUBLIC_DOMAIN=https://cdn.example.com (optional, for the final URL)

@app.function(
    image=image,
    secrets=[modal.Secret.from_name("r2-credentials")],
    timeout=1800,  # 30 mins
    cpu=4.0,       # More CPUs for faster transcoding
    memory=4096,   # 4GB RAM
)
def process_video_task(video_id: str, webhook_url: str = None, segment_duration: int = 10):
    """
    Core processing task: R2 -> Local -> FFmpeg -> R2 -> Webhook
    """
    import boto3
    import requests

    # Environment variables from secrets
    r2_endpoint = os.environ["R2_ENDPOINT"]
    r2_access_key = os.environ["R2_ACCESS_KEY_ID"]
    r2_secret_key = os.environ["R2_SECRET_ACCESS_KEY"]
    r2_bucket = os.environ["R2_BUCKET"]
    # If no public domain, use the endpoint/bucket structure
    r2_public_domain = os.environ.get("R2_PUBLIC_DOMAIN", f"{r2_endpoint}/{r2_bucket}")

    # Standard S3 client for R2
    s3_client = boto3.client(
        "s3",
        endpoint_url=r2_endpoint,
        aws_access_key_id=r2_access_key,
        aws_secret_access_key=r2_secret_key,
        region_name="auto",
    )

    # We assume the user uploaded to this specific path
    source_key = f"uploads/raw/{video_id}.mp4" 
    target_dir = f"videos/{video_id}"
    
    print(f"🚀 [Video {video_id}] Starting HLS processing...")

    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        local_input = temp_path / "input.mp4"
        hls_output_dir = temp_path / "hls"
        hls_output_dir.mkdir()

        # --- Step 1: Download from R2 ---
        print(f"📦 [1/4] Downloading source: {source_key}")
        try:
            s3_client.download_file(r2_bucket, source_key, str(local_input))
        except Exception as e:
            error_msg = f"Failed to download from R2: {str(e)}"
            print(f"❌ {error_msg}")
            if webhook_url:
                requests.post(webhook_url, json={"video_id": video_id, "status": "failed", "error": error_msg})
            return {"status": "error", "message": error_msg}

        # --- Step 2: HLS Slicing via FFmpeg ---
        print(f"🔪 [2/4] Slicing into HLS (segments: {segment_duration}s)")
        m3u8_path = hls_output_dir / "index.m3u8"
        
        ffmpeg_cmd = [
            "ffmpeg", "-i", str(local_input),
            "-c", "copy",
            "-start_number", "0",
            "-hls_time", str(segment_duration),
            "-hls_list_size", "0",
            "-hls_segment_filename", str(hls_output_dir / "seg_%03d.ts"),
            "-f", "hls",
            "-y", str(m3u8_path)
        ]

        start_time = time.time()
        # capture_output=True might be slow for huge logs, but fine for typical ffmpeg runs
        process = subprocess.run(ffmpeg_cmd, capture_output=True, text=True)
        
        if process.returncode != 0:
            error_msg = f"FFmpeg failed: {process.stderr}"
            print(f"❌ {error_msg}")
            if webhook_url:
                requests.post(webhook_url, json={"video_id": video_id, "status": "failed", "error": error_msg})
            return {"status": "error", "message": error_msg}
        
        duration = time.time() - start_time
        print(f"✅ Slicing completed in {duration:.2f}s")

        # --- Step 3: Upload all files to R2 in parallel ---
        from concurrent.futures import ThreadPoolExecutor
        
        print(f"⬆️ [3/4] Uploading segments to {target_dir}/ (parallel)")
        hls_files = list(hls_output_dir.iterdir())
        
        def upload_file(file_path):
            key = f"{target_dir}/{file_path.name}"
            content_type = "video/MP2T" if file_path.suffix == ".ts" else "application/vnd.apple.mpegurl"
            with open(file_path, "rb") as f:
                s3_client.put_object(
                    Bucket=r2_bucket,
                    Key=key,
                    Body=f,
                    ContentType=content_type
                )
            return key

        # Use 20 threads to upload all files continuously for maximum throughput
        with ThreadPoolExecutor(max_workers=20) as executor:
            list(executor.map(upload_file, hls_files))
        
        playlist_url = f"{r2_public_domain}/{target_dir}/index.m3u8"
        print(f"✅ Uploaded {len(hls_files)} files in parallel. Playlist: {playlist_url}")

        # --- Step 4: Notify via Webhook ---
        result_payload = {
            "video_id": video_id,
            "status": "success",
            "playlist_url": playlist_url,
            "segments_count": len([f for f in hls_files if f.suffix == ".ts"]),
            "processing_time": duration
        }

        if webhook_url:
            print(f"🔗 [4/4] Sending notification to {webhook_url}...")
            try:
                # Post the success result to your backend
                requests.post(webhook_url, json=result_payload, timeout=10)
            except Exception as e:
                print(f"⚠️ Webhook failed: {str(e)}")
        else:
            print("⏭️ [4/4] No webhook_url provided, skipping notification.")

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
