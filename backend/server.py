# server.py
from __future__ import annotations

import os
import uuid
import json
import asyncio
import logging
from dotenv import load_dotenv
from typing import Set, AsyncIterator
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from starlette.websockets import WebSocketState # <-- 추가된 import
import uvicorn

# --- 초기 설정 ---
dotenv_path = os.path.join(os.path.dirname(__file__), '.env')
if os.path.exists(dotenv_path):
    load_dotenv(dotenv_path=dotenv_path)
    print(f"✅ .env file loaded from: {dotenv_path}")
else:
    print(f"⚠️ .env file not found at: {dotenv_path}")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# --- FastAPI 애플리케이션 설정 ---
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"], # React 개발 서버 주소
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Azure Voice Live API 관련 클래스 ---
from websockets.asyncio.client import connect as ws_connect
from websockets.asyncio.client import ClientConnection as AsyncWebsocket
from websockets.asyncio.client import HeadersLike
from websockets.typing import Data
from websockets.exceptions import WebSocketException

class AsyncVoiceLiveConnection:
    _connection: AsyncWebsocket
    def __init__(self, url: str, additional_headers: HeadersLike) -> None:
        self._url, self._additional_headers, self._connection = url, additional_headers, None
    async def __aenter__(self) -> AsyncVoiceLiveConnection:
        try:
            self._connection = await ws_connect(self._url, additional_headers=self._additional_headers)
        except Exception as e:
            logger.error(f"🔴 FAILED to establish WebSocket connection to Azure: {e}", exc_info=True)
            raise
        return self
    async def __aexit__(self, exc_type, exc_value, traceback) -> None:
        if self._connection: await self._connection.close()
    async def recv(self) -> Data: return await self._connection.recv()
    async def __aiter__(self) -> AsyncIterator[Data]:
        async for data in self._connection: yield data
    async def send(self, message: Data) -> None: await self._connection.send(message)

class AsyncAzureVoiceLive:
    def __init__(self, *, azure_endpoint: str, api_version: str, api_key: str) -> None:
        self._azure_endpoint, self._api_version, self._api_key = azure_endpoint, api_version, api_key
    def connect(self, model: str) -> AsyncVoiceLiveConnection:
        url = f"{self._azure_endpoint.rstrip('/')}/voice-live/realtime?api-version={self._api_version}&model={model}".replace("https://", "wss://")
        headers = {"api-key": self._api_key, "x-ms-client-request-id": str(uuid.uuid4())}
        return AsyncVoiceLiveConnection(url, additional_headers=headers)

# --- WebSocket 통신 로직 ---
async def react_to_azure(react_ws: WebSocket, azure_ws: AsyncVoiceLiveConnection):
    """React 클라이언트로부터 메시지를 받아 Azure로 전달합니다."""
    try:
        while True:
            data = await react_ws.receive_json()
            if data.get("type") == "audio":
                # 오디오 청크를 Azure가 기대하는 포맷으로 감싸서 전송
                azure_payload = {
                    "type": "input_audio_buffer.append",
                    "audio": data.get("audio"),
                    "event_id": "" # 필요시 event_id 추가
                }
                await azure_ws.send(json.dumps(azure_payload))
            elif data.get("type") == "recording_stopped":
                # 녹음 중지 시 commit 메시지 전송
                await azure_ws.send(json.dumps({"type": "input_audio_buffer.commit", "event_id": ""}))
                logger.info("➡️ Received recording_stopped. Sent 'commit' message to Azure.")
    except WebSocketDisconnect:
        logger.warning("React client disconnected.")
        raise

async def azure_to_react(react_ws: WebSocket, azure_ws: AsyncVoiceLiveConnection):
    """Azure로부터 응답을 받아 React 클라이언트로 전달합니다."""
    try:
        async for raw_event in azure_ws:
            event = json.loads(raw_event)
            # 오디오 데이터 외의 로그는 터미널에 출력
            if event.get("type") != "response.audio.delta":
                 logger.info(f"⬅️ Received from Azure: {event}")

            # base64 인코딩된 오디오 데이터는 'audio' 키에 담아 React로 전달
            if event.get("type") == "response.audio.delta":
                await react_ws.send_text(json.dumps({"type": "audio", "audio": event.get("delta")}))
            else:
                await react_ws.send_text(json.dumps(event))

    except WebSocketException as e:
        logger.error(f"🔴 Azure WebSocket connection error: {e.code} {e.reason}", exc_info=True)
        raise

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    logger.info("✅ React client connected.")

    endpoint = os.environ.get("AZURE_VOICE_LIVE_ENDPOINT")
    model = os.environ.get("VOICE_LIVE_MODEL", "gpt-4o")
    api_version = os.environ.get("AZURE_VOICE_LIVE_API_VERSION", "2025-05-01-preview")
    api_key = os.environ.get("AZURE_VOICE_LIVE_API_KEY")

    if not all([endpoint, api_key]):
        await websocket.close(code=1008, reason="Server environment variables not configured.")
        return

    client = AsyncAzureVoiceLive(azure_endpoint=endpoint, api_version=api_version, api_key=api_key)
    tasks: Set[asyncio.Task] = set()
    try:
        async with client.connect(model=model) as azure_connection:
            logger.info("✅ Successfully connected to Azure Voice Live API.")

            # 1. 세션 업데이트 메시지 전송
            session_update = {
                "type": "session.update",
                "session": {
                    "instructions": "You are a helpful AI assistant.",
                    "turn_detection": {"type": "azure_semantic_vad", "silence_duration_ms": 500},
                    "voice": {"name": "en-US-AvaNeural"},
                }
            }
            await azure_connection.send(json.dumps(session_update))
            logger.info("Sent session update to Azure. Waiting for session.created confirmation...")

            # 2. Azure로부터 'session.created' 응답을 기다림
            session_created = False
            while not session_created:
                raw_event = await azure_connection.recv()
                event = json.loads(raw_event)
                logger.info(f"⬅️ Received from Azure during init: {event}")
                if event.get("type") == "session.created":
                    session_created = True
                    logger.info("✅ Azure session successfully created.")
                    await websocket.send_text(json.dumps(event))
                elif event.get("type") == "error":
                    logger.error(f"🔴 Azure returned an error during session creation: {event}")
                    raise WebSocketException(f"Azure error: {event.get('error', {}).get('message')}")

            # 3. 세션 생성이 확인된 후에 데이터 중계 태스크 시작
            task_react_to_azure = asyncio.create_task(react_to_azure(websocket, azure_connection))
            task_azure_to_react = asyncio.create_task(azure_to_react(websocket, azure_connection))
            tasks.update([task_react_to_azure, task_azure_to_react])

            done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in pending: task.cancel()

    except Exception as e:
        logger.error(f"🔴 Main websocket handler error: {e}", exc_info=True)
    finally:
        logger.warning("Connection cleanup initiated.")
        if websocket.client_state != WebSocketState.DISCONNECTED:
            await websocket.close()
        logger.warning("React client connection closed.")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)