import requests
import sys
import os

def check_local_api(port):
    url = f"http://127.0.0.1:{port}/api/health"
    print(f"Checking local API at {url}...")
    try:
        resp = requests.get(url, timeout=5)
        print(f"Status Code: {resp.status_code}")
        print(f"Response Body: {resp.text}")
        if resp.status_code == 200:
            print("[SUCCESS] Backend is reachable and responding to /api/health")
        else:
            print(f"[WARNING] Backend returned an unexpected status code: {resp.status_code}")
    except Exception as e:
        print(f"[ERROR] Could not reach backend: {e}")

if __name__ == "__main__":
    # Try to get port from .env
    port = 80
    if os.path.exists(".env"):
        with open(".env", "r") as f:
            for line in f:
                if line.startswith("APP_PORT="):
                    try:
                        port = int(line.split("=")[1].strip())
                    except: pass
    
    check_local_api(port)
